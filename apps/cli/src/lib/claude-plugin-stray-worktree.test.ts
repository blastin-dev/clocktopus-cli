import { describe, expect, it } from "vitest";

import {
  strayWorktreeNote,
  strayWorktreeOf,
  workedInOf,
} from "../../claude-plugin/hooks/stray-worktree.js";

const MAIN =
  "/work/acme-portal\n/work/acme-portal/.git\n/work/acme-portal/.git\n";
const SIBLING =
  "/work/acme-portal-42\n/work/acme-portal/.git/worktrees/acme-portal-42\n/work/acme-portal/.git\n";
const NESTED =
  "/work/acme-portal/.claude/worktrees/acme-42\n/work/acme-portal/.git/worktrees/acme-42\n/work/acme-portal/.git\n";
const OTHER_REPO = "/work/billing\n/work/billing/.git\n/work/billing/.git\n";

describe("workedInOf", () => {
  it("reads the folder of a file a writing tool names", () => {
    expect(
      workedInOf("Edit", { file_path: "/work/acme-portal-42/src/a.ts" }),
    ).toBe("/work/acme-portal-42/src");
    expect(workedInOf("Write", { file_path: "/a.ts" })).toBe("/");
    expect(
      workedInOf("NotebookEdit", { notebook_path: "/work/n/x.ipynb" }),
    ).toBe("/work/n");
  });

  it("reads the folder a Bash command starts by changing into", () => {
    expect(
      workedInOf("Bash", { command: "cd /work/acme-portal-42 && git status" }),
    ).toBe("/work/acme-portal-42");
    expect(
      workedInOf("Bash", { command: 'cd "/work/acme portal/" ; ls' }),
    ).toBe("/work/acme portal");
    expect(workedInOf("Bash", { command: "cd /work/acme-portal-42" })).toBe(
      "/work/acme-portal-42",
    );
  });

  it("names no folder for reads, relative paths or a cd later in the command", () => {
    expect(workedInOf("Read", { file_path: "/work/acme-portal-42/a.ts" })).toBe(
      null,
    );
    expect(workedInOf("Edit", { file_path: "src/a.ts" })).toBe(null);
    expect(workedInOf("Bash", { command: "cd apps/cli && pnpm test" })).toBe(
      null,
    );
    expect(workedInOf("Bash", { command: "git fetch && cd /tmp" })).toBe(null);
    expect(workedInOf("Bash", { command: "cdk deploy /tmp" })).toBe(null);
  });
});

describe("strayWorktreeOf", () => {
  it("finds a linked worktree of the session's repository, beside or inside it", () => {
    expect(strayWorktreeOf(MAIN, SIBLING)).toEqual({
      root: "/work/acme-portal-42",
      sessionRoot: "/work/acme-portal",
      mayNeedExit: false,
    });
    expect(strayWorktreeOf(MAIN, NESTED)?.root).toBe(
      "/work/acme-portal/.claude/worktrees/acme-42",
    );
    expect(strayWorktreeOf(NESTED, SIBLING)?.root).toBe("/work/acme-portal-42");
  });

  it("flags a session in a linked worktree heading outside the main checkout's .claude/worktrees", () => {
    expect(strayWorktreeOf(NESTED, SIBLING)?.mayNeedExit).toBe(true);
    expect(strayWorktreeOf(SIBLING, NESTED)?.mayNeedExit).toBe(false);
    expect(strayWorktreeOf(MAIN, SIBLING)?.mayNeedExit).toBe(false);
  });

  it("finds nothing in the session's own checkout, the main checkout or another repository", () => {
    expect(strayWorktreeOf(SIBLING, SIBLING)).toBe(null);
    expect(strayWorktreeOf(SIBLING, MAIN)).toBe(null);
    expect(strayWorktreeOf(MAIN, OTHER_REPO)).toBe(null);
    expect(strayWorktreeOf("", SIBLING)).toBe(null);
  });
});

describe("strayWorktreeNote", () => {
  const stray = {
    root: "/work/acme-portal-42",
    sessionRoot: "/work/acme-portal",
    mayNeedExit: false,
  };

  it("names the worktree to move into with EnterWorktree", () => {
    const note = strayWorktreeNote(stray);
    expect(note).toContain(
      'EnterWorktree tool and path "/work/acme-portal-42"',
    );
    expect(note).toContain("still /work/acme-portal,");
    expect(note).not.toContain("ExitWorktree");
  });

  it("names ExitWorktree as the way out when EnterWorktree may refuse", () => {
    expect(strayWorktreeNote({ ...stray, mayNeedExit: true })).toContain(
      'ExitWorktree with action "keep" first',
    );
  });
});
