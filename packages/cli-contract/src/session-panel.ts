import { z } from "zod";

import { TimestampSchema } from "./timestamp";

export const TaskStageSchema = z.enum([
  "created",
  "in_progress",
  "in_review",
  "merged",
  "done",
  "cancelled",
]);
export type TaskStage = z.infer<typeof TaskStageSchema>;

const PanelTaskSchema = z.object({
  key: z.string(),
  title: z.string().nullable(),
  stage: TaskStageSchema,
  hours: z.number(),
  agentHours: z.number(),
  pageUrl: z.string().nullable(),
});

// The MCP tool `get_session_panel`'s `status: "ok"` answer, which the Claude Code
// plugin's hooks module reads (`apps/cli/claude-plugin/hooks/panel.ts`).
export const SessionPanelSchema = z.object({
  status: z.literal("ok"),
  project: z.object({
    id: z.string(),
    name: z.string(),
    organizationId: z.string(),
    organizationSlug: z.string().nullable(),
  }),
  taskKey: z.string().nullable(),
  task: PanelTaskSchema.nullable(),
  branchTask: PanelTaskSchema.nullable(),
  attribution: z.object({
    agent: z.string(),
    sessionId: z.string(),
    known: z.boolean(),
    currentKey: z.string().nullable(),
    branchKey: z.string().nullable(),
    countsTowardTask: z.boolean(),
    // US dollars; null when the agent reports no spend.
    sessionCostUsd: z.number().nullable(),
    tasks: z.array(
      z.object({
        key: z.string(),
        share: z.number(),
        costUsd: z.number().nullable(),
      }),
    ),
    startedAt: TimestampSchema.nullable(),
    lastActivityAt: TimestampSchema.nullable(),
    closedAt: TimestampSchema.nullable(),
  }),
  goal: z
    .object({
      id: z.string(),
      ref: z.string(),
      title: z.string(),
      doneCount: z.number(),
      open: z.array(
        z.object({
          key: z.string(),
          title: z.string().nullable(),
          // Null for a key Clocktopus hasn't seen.
          stage: TaskStageSchema.nullable(),
          claimed: z.boolean(),
        }),
      ),
    })
    .nullable(),
  // Where the CLI the caller named in `cliVersion` stands; absent without it.
  cli: z
    .object({
      version: z.string(),
      latest: z.string().nullable(),
      minimum: z.string(),
      isBehind: z.boolean(),
      // The CLI routes refuse this version.
      isUnsupported: z.boolean(),
    })
    .optional(),
});
