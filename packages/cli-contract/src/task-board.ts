import { z } from "zod";

import { TaskPullRequestSchema } from "./pull-request";
import { TimestampSchema } from "./timestamp";

// The stages a task board lists, in its column order: To do, In progress, In
// review, Ready to ship. A board lists `merged` only when asked for it
// (`mergedLimit`), so a CLI whose schema lacks it still parses the board.
export const BoardStageSchema = z.enum([
  "created",
  "in_progress",
  "in_review",
  "merged",
]);
export type BoardStage = z.infer<typeof BoardStageSchema>;

// How many To do tasks `GET /api/agent/task-board` lists when asked for none,
// and at most.
export const TODO_LIMIT_DEFAULT = 30;
export const TODO_LIMIT_MAX = 500;

// How many Ready to ship tasks the CLI asks `GET /api/agent/task-board` for,
// and the most it lists. A request without `mergedLimit` gets none.
export const MERGED_LIMIT_DEFAULT = 20;
export const MERGED_LIMIT_MAX = 100;

const BoardSessionSchema = z.object({
  // The agent-session provider, such as `claude_code` or `codex_cli`.
  agent: z.string(),
  // The agent's own session id, which it resumes by.
  sessionId: z.string(),
  // A path on the machine that ran the session; null when its hook sent none.
  cwd: z.string().nullable(),
  gitBranch: z.string().nullable(),
  startedAt: TimestampSchema.nullable(),
  lastActivityAt: TimestampSchema.nullable(),
  closedAt: TimestampSchema.nullable(),
  // This task is the one the session works on: the one it was last tied to,
  // or any it names when it was never tied.
  current: z.boolean(),
});

const BoardTaskSchema = z.object({
  key: z.string(),
  title: z.string().nullable(),
  kind: z.string().nullable(),
  stage: BoardStageSchema,
  // When it entered its stage.
  stageSince: TimestampSchema.nullable(),
  lastActivityAt: TimestampSchema.nullable(),
  // In progress with nothing on it for `STALE_AFTER_DAYS` and no agent working.
  stale: z.boolean(),
  // The active goal holding it, newest goal first.
  goal: z.object({ ref: z.string(), title: z.string() }).nullable(),
  pageUrl: z.string().nullable(),
  // Agent sessions, anyone's, working on it now: not closed, telemetry in the
  // last `AGENT_ACTIVE_MINUTES`, and this the task they work on (`isCurrentTicket`).
  working: z.array(
    z.object({
      agent: z.string(),
      userName: z.string().nullable(),
      mine: z.boolean(),
      lastActivityAt: TimestampSchema.nullable(),
    }),
  ),
  // The caller's own sessions on it, newest first.
  sessions: z.array(BoardSessionSchema),
  // Newest first; absent from a server older than this field.
  pullRequests: z.array(TaskPullRequestSchema).default([]),
});
export type BoardTask = z.infer<typeof BoardTaskSchema>;

// `GET /api/agent/task-board`. To do lists the active goals' tasks in goal
// order, then the newest others, up to the request's `todoLimit`; `todoTotal`
// counts them all. Ready to ship lists up to `mergedLimit`, most recently
// merged first; `mergedTotal` counts them all.
export const TaskBoardSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    project: z.object({
      id: z.string(),
      name: z.string(),
      organizationId: z.string(),
      // The organisation the repository resolved to; a member may belong to several.
      organizationName: z.string().nullable(),
      // The project's Work page.
      pageUrl: z.string().nullable(),
    }),
    tasks: z.array(BoardTaskSchema),
    todoTotal: z.number(),
    // Every merged task, listed or not; absent from a server older than the
    // `merged` stage.
    mergedTotal: z.number().default(0),
    // The project's active goals, newest first, each with the keys of its
    // tasks on the board, in goal order.
    goals: z.array(
      z.object({
        ref: z.string(),
        title: z.string(),
        keys: z.array(z.string()),
      }),
    ),
  }),
  z.object({ status: z.literal("unsupported_repository") }),
  z.object({ status: z.literal("no_project"), repository: z.string() }),
  z.object({
    status: z.literal("choose_organization"),
    projects: z.array(
      z.object({
        projectId: z.string(),
        projectName: z.string(),
        organizationId: z.string(),
        organizationName: z.string().nullable(),
      }),
    ),
  }),
]);
export type TaskBoard = z.infer<typeof TaskBoardSchema>;
