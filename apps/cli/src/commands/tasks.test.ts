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
    pullRequests: [],
    ...overrides,
  };
}

function board(tasks: BoardTask[], todoTotal = 0, mergedTotal = 0): OkBoard {
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
    mergedTotal,
    goals: [],
  };
}

describe("taskBoardPath", () => {
  it("sends the remote, the to do and ready to ship limits and the organisation when given", () => {
    expect(
      taskBoardPath({
        repositoryUrl: "git@github.com:acme-co/acme-portal.git",
        org: "org-1",
        todoLimit: 10,
      }),
    ).toBe(
      "/api/agent/task-board?repositoryUrl=git%40github.com%3Aacme-co%2Facme-portal.git&todoLimit=10&mergedLimit=20&orgId=org-1",
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

  it("lists ready to ship after in review, saying how many it left out", () => {
    const text = formatTaskBoard(
      board([task("ACME-4", { stage: "merged" })], 0, 3),
    );

    expect(text).toContain(
      [
        "In review · 0",
        "",
        "Ready to ship · 1 of 3",
        "  ACME-4     Task ACME-4",
      ].join("\n"),
    );
  });

  it("marks a task with its pull requests that aren't closed", () => {
    const pullRequest = (
      number: number,
      status: BoardTask["pullRequests"][number]["status"],
    ) => ({
      provider: "github",
      repository: "acme-co/acmeportal",
      number,
      title: `Pull request ${number}`,
      url: `https://github.com/acme-co/acmeportal/pull/${number}`,
      status,
      openedAt: "2026-11-05T09:00:00.000Z",
    });
    const text = formatTaskBoard(
      board([
        task("ACME-5", {
          stage: "in_review",
          pullRequests: [
            pullRequest(12, "draft"),
            pullRequest(11, "closed"),
            pullRequest(10, "merged"),
          ],
        }),
      ]),
    );

    expect(text).toContain(
      "  ACME-5     Task ACME-5  [#12 draft · #10 merged]",
    );
  });

  it("leaves out ready to ship when nothing is merged", () => {
    expect(formatTaskBoard(board([]))).not.toContain("Ready to ship");
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
