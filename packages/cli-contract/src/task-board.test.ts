import { describe, expect, it } from "vitest";

import { TaskBoardSchema } from "./task-board";

describe("TaskBoardSchema", () => {
  it("reads a board from a server older than the merged and done stages as having none", () => {
    const board = TaskBoardSchema.parse({
      status: "ok",
      project: {
        id: "project-1",
        name: "Acme Portal",
        organizationId: "org-1",
        organizationName: "Acme",
        pageUrl: null,
      },
      tasks: [],
      todoTotal: 0,
      goals: [],
    });

    expect(board).toMatchObject({ mergedTotal: 0, deliveredTotal: 0 });
  });
});
