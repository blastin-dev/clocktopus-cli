import { describe, expect, it } from "vitest";

import { contextCommandFor, isContextHookCommand } from "./context-hook.js";

describe("contextCommandFor", () => {
  it("swaps the subcommand and keeps the launcher and provider", () => {
    expect(
      contextCommandFor("clocktopus agent hook --provider codex_cli"),
    ).toBe("clocktopus agent context --provider codex_cli");
    expect(
      contextCommandFor(
        '"/opt/node 22/bin/node" /home/me/clocktopus/dist/bin/clocktopus.js agent hook --provider claude_code',
      ),
    ).toBe(
      '"/opt/node 22/bin/node" /home/me/clocktopus/dist/bin/clocktopus.js agent context --provider claude_code',
    );
  });
});

describe("isContextHookCommand", () => {
  it("matches the context hook with or without a provider, and nothing else", () => {
    expect(isContextHookCommand("clocktopus agent context")).toBe(true);
    expect(
      isContextHookCommand("clocktopus agent context --provider opencode"),
    ).toBe(true);
    expect(
      isContextHookCommand("clocktopus agent hook --provider codex_cli"),
    ).toBe(false);
    expect(isContextHookCommand(undefined)).toBe(false);
  });
});
