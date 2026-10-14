import { describe, expect, it } from "vitest";

import { sessionContext } from "./context.js";

describe("sessionContext", () => {
  it("names the task a branch carries, with the session id and agent", () => {
    expect(
      sessionContext({
        provider: "claude_code",
        sessionId: "s-1",
        branch: "dana/acme-42-export",
      }),
    ).toBe(
      "Clocktopus: branch dana/acme-42-export carries task ACME-42, so this session's commits, pull requests and agent spend count towards it. Session id: s-1, agent claude_code.",
    );
  });

  it("points Claude Code at the plugin's start-work skill when the branch names no task", () => {
    expect(
      sessionContext({
        provider: "claude_code",
        sessionId: "s-1",
        branch: "main",
      }),
    ).toContain("use the clocktopus:start-work skill");
  });

  it("points Codex at the shared skill's folder name, and names its agent", () => {
    const line = sessionContext({
      provider: "codex_cli",
      sessionId: "s-1",
      branch: "main",
    });
    expect(line).toContain("use the clocktopus-start-work skill");
    expect(line).toContain("Session id: s-1, agent codex_cli.");
  });

  it("treats a detached HEAD as naming no task", () => {
    expect(
      sessionContext({
        provider: "claude_code",
        sessionId: undefined,
        branch: undefined,
      }),
    ).toBe(
      "Clocktopus: HEAD is detached, so this session's work counts towards no task. Before changing code, use the clocktopus:start-work skill to pick up or create the task.",
    );
  });

  it("says nothing outside a git repository", () => {
    expect(
      sessionContext({
        provider: "claude_code",
        sessionId: "s-1",
        branch: null,
      }),
    ).toBeNull();
  });
});
