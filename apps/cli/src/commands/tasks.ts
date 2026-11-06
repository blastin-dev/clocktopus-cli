import type { BoardStage, TaskBoard } from "@repo/cli-contract/task-board";
import {
  BoardStageSchema,
  TaskBoardSchema,
  TODO_LIMIT_DEFAULT,
  TODO_LIMIT_MAX,
} from "@repo/cli-contract/task-board";

import { ApiError, get } from "../lib/api.js";
import { isLoggedIn } from "../lib/config.js";
import { formatAgo } from "../lib/format.js";
import { getRepositoryRemotes } from "../lib/git.js";

export type TasksOptions = {
  json?: boolean;
  repository?: string;
  org?: string;
  limit?: string;
};

// What `--json` prints: the server's board, or a status the CLI decided on
// before or instead of asking it. Herdr's Clocktopus mod reads this.
type TasksOutput =
  | TaskBoard
  | { status: "signed_out" }
  | { status: "not_a_repository" }
  | { status: "error"; message: string };

export const STAGE_LABELS: Record<BoardStage, string> = {
  created: "To do",
  in_progress: "In progress",
  in_review: "In review",
};

export function taskBoardPath(input: {
  repositoryUrl: string;
  org?: string;
  todoLimit: number;
}) {
  const query = new URLSearchParams({
    repositoryUrl: input.repositoryUrl,
    todoLimit: String(input.todoLimit),
  });
  if (input.org) query.set("orgId", input.org);
  return `/api/agent/task-board?${query.toString()}`;
}

export async function loadTaskBoard(options: TasksOptions): Promise<{
  output: TasksOutput;
  failed: boolean;
}> {
  if (!isLoggedIn()) return { output: { status: "signed_out" }, failed: true };
  const repositoryUrl = options.repository ?? getRepositoryRemotes()[0];
  if (!repositoryUrl) {
    return { output: { status: "not_a_repository" }, failed: true };
  }
  const limit = Number.parseInt(options.limit ?? "", 10);
  const todoLimit = Math.min(Math.max(limit, 0), TODO_LIMIT_MAX);
  try {
    const board = TaskBoardSchema.parse(
      await get(
        taskBoardPath({
          repositoryUrl,
          org: options.org,
          todoLimit: Number.isFinite(todoLimit)
            ? todoLimit
            : TODO_LIMIT_DEFAULT,
        }),
      ),
    );
    return { output: board, failed: false };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { output: { status: "signed_out" }, failed: true };
    }
    return {
      output: {
        status: "error",
        message: error instanceof Error ? error.message : "unknown error",
      },
      failed: true,
    };
  }
}

export function formatTaskBoard(output: TasksOutput): string {
  switch (output.status) {
    case "signed_out":
      return "Not logged in. Run 'clocktopus login' first.";
    case "not_a_repository":
      return "This folder has no git remote. Run it in a checkout, or pass --repository <url>.";
    case "error":
      return `Failed to fetch tasks: ${output.message}`;
    case "unsupported_repository":
      return "Clocktopus reads GitHub and Bitbucket remotes only.";
    case "no_project":
      return `${output.repository} is linked to no Clocktopus project you can see. Run 'clocktopus init' to link it.`;
    case "choose_organization":
      return [
        "Several organisations link this repository. Pass one with --org:",
        ...output.projects.map(
          (project) =>
            `  ${project.organizationId}  ${project.organizationName ?? "(unnamed)"} (${project.projectName})`,
        ),
      ].join("\n");
    case "ok":
      break;
  }

  const lines = [
    [output.project.name, output.project.organizationName]
      .filter(Boolean)
      .join(" · "),
  ];
  for (const stage of BoardStageSchema.options) {
    const tasks = output.tasks.filter((task) => task.stage === stage);
    const count =
      stage === "created" && output.todoTotal > tasks.length
        ? `${tasks.length} of ${output.todoTotal}`
        : `${tasks.length}`;
    lines.push("", `${STAGE_LABELS[stage]} · ${count}`);
    for (const task of tasks) {
      const marks = [
        task.working.length > 0
          ? `● ${task.working
              .map((session) =>
                session.mine
                  ? session.agent
                  : `${session.agent} (${session.userName ?? "someone"})`,
              )
              .join(", ")}`
          : null,
        task.stale ? `quiet since ${formatAgo(task.lastActivityAt)}` : null,
        task.goal ? task.goal.ref : null,
      ].filter(Boolean);
      lines.push(
        `  ${task.key.padEnd(10)} ${task.title ?? "(untitled)"}${
          marks.length > 0 ? `  [${marks.join(" · ")}]` : ""
        }`,
      );
    }
  }
  if (output.project.pageUrl) lines.push("", output.project.pageUrl);
  return lines.join("\n");
}

export async function tasksCommand(options: TasksOptions): Promise<void> {
  const { output, failed } = await loadTaskBoard(options);
  if (options.json) {
    console.log(JSON.stringify(output));
  } else if (failed) {
    console.error(formatTaskBoard(output));
  } else {
    console.log(formatTaskBoard(output));
  }
  if (failed) process.exit(1);
}
