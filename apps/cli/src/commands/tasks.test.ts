import type { TaskBoard } from "@repo/cli-contract/task-board";
import { describe, expect, it } from "vitest";

import { formatTaskBoard, taskBoardPath } from "./tasks.js";

type OkBoard = Extract<TaskBoard, { status: "ok" }>;
type BoardTask = OkBoard["tasks"][number];

function task(key: string, overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    key,
    title: `Task ${key}`,
    kind: "feature",
    stage: "created",
    stageSince: null,
    lastActivityAt: null,
    stale: false,
    goal: null,
    pageUrl: null,
    working: [],
    sessions: [],
    ...overrides,
  };
}

function board(tasks: BoardTask[], todoTotal = 0): OkBoard {
  return {
    status: "ok",
    project: {
      id: "project-1",
      name: "Acme Portal",
      organizationId: "org-1",
      organizationName: "Acme",
      pageUrl: "https://app.example.test/acme/work/tasks",
    },
    tasks,
    todoTotal,
    goals: [],
  };
}

describe("taskBoardPath", () => {
  it("sends the remote, the to do limit and the organisation when given", () => {
    expect(
      taskBoardPath({
        repositoryUrl: "git@github.com:acme-co/acme-portal.git",
        org: "org-1",
        todoLimit: 10,
      }),
    ).toBe(
      "/api/agent/task-board?repositoryUrl=git%40github.com%3Aacme-co%2Facme-portal.git&todoLimit=10&orgId=org-1",
    );
  });
});

describe("formatTaskBoard", () => {
  it("groups the tasks by stage and says how many to do tasks it left out", () => {
    const text = formatTaskBoard(
      board(
        [
          task("ACME-1", { goal: { ref: "G-1", title: "Invoices" } }),
          task("ACME-2", {
            stage: "in_progress",
            working: [
              {
                agent: "claude_code",
                userName: "Dana Acme",
                mine: true,
                lastActivityAt: null,
              },
              {
                agent: "codex_cli",
                userName: "Sam Acme",
                mine: false,
                lastActivityAt: null,
              },
            ],
          }),
          task("ACME-3", { stage: "in_review", title: null }),
        ],
        5,
      ),
    );

    expect(text).toBe(
      [
        "Acme Portal · Acme",
        "",
        "To do · 1 of 5",
        "  ACME-1     Task ACME-1  [G-1]",
        "",
        "In progress · 1",
        "  ACME-2     Task ACME-2  [● claude_code, codex_cli (Sam Acme)]",
        "",
        "In review · 1",
        "  ACME-3     (untitled)",
        "",
        "https://app.example.test/acme/work/tasks",
      ].join("\n"),
    );
  });

  it("names the organisations to choose from", () => {
    expect(
      formatTaskBoard({
        status: "choose_organization",
        projects: [
          {
            projectId: "project-1",
            projectName: "Acme Portal",
            organizationId: "org-1",
            organizationName: "Acme",
          },
        ],
      }),
    ).toContain("org-1  Acme (Acme Portal)");
  });
});
