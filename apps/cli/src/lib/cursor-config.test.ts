import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyCursorHooks,
  applyCursorMcp,
  CursorConfigParseError,
  readCursorContextCommand,
  readCursorCredentials,
  readCursorHookCommands,
  readCursorJson,
  readCursorMcpUrl,
  removeCursorHooks,
  removeCursorMcp,
  writeCursorCredentials,
} from "./cursor-config";

const HOOK = "clocktopus agent hook --provider cursor";
const CONTEXT = "clocktopus agent context --provider cursor";

const userHooks = {
  version: 1,
  hooks: {
    sessionStart: [{ command: "./hooks/greet.sh" }],
    afterFileEdit: [{ command: "./hooks/format.sh" }],
  },
};

describe("applyCursorHooks", () => {
  it("adds its hooks to sessionStart and sessionEnd beside the user's own", () => {
    const next = applyCursorHooks(userHooks, { hookCommand: HOOK });

    expect(next).toEqual({
      version: 1,
      hooks: {
        sessionStart: [
          { command: "./hooks/greet.sh" },
          { command: HOOK, timeout: 10 },
          { command: CONTEXT, timeout: 5 },
        ],
        sessionEnd: [{ command: HOOK, timeout: 10 }],
        afterFileEdit: [{ command: "./hooks/format.sh" }],
      },
    });
    expect(readCursorHookCommands(next)).toEqual({
      SessionStart: HOOK,
      SessionEnd: HOOK,
    });
    expect(readCursorContextCommand(next)).toBe(CONTEXT);
  });

  it("replaces its own hooks on a re-run rather than adding a second", () => {
    const once = applyCursorHooks({}, { hookCommand: "clocktopus agent hook" });
    const twice = applyCursorHooks(once, { hookCommand: HOOK });

    expect(twice.hooks).toEqual({
      sessionStart: [
        { command: HOOK, timeout: 10 },
        { command: CONTEXT, timeout: 5 },
      ],
      sessionEnd: [{ command: HOOK, timeout: 10 }],
    });
    expect(twice.version).toBe(1);
  });
});

describe("removeCursorHooks", () => {
  it("removes only its own hooks", () => {
    const installed = applyCursorHooks(userHooks, { hookCommand: HOOK });
    const { file, removed } = removeCursorHooks(installed);

    expect(removed).toBe(true);
    expect(file).toEqual(userHooks);
  });
});

describe("Cursor MCP entry", () => {
  it("adds and removes the clocktopus server, keeping the user's others", () => {
    const user = { mcpServers: { other: { url: "https://mcp.example.com" } } };
    const added = applyCursorMcp(user, { apiUrl: "https://clocktopus.app/" });

    expect(readCursorMcpUrl(added)).toBe("https://clocktopus.app/api/mcp");
    expect(removeCursorMcp(added)).toEqual({ file: user, removed: true });
    expect(removeCursorMcp(user).removed).toBe(false);
  });
});

describe("Cursor files", () => {
  it("refuses to read a hooks.json that is not JSON", () => {
    const path = join(mkdtempSync(join(tmpdir(), "clocktopus-cursor-")), "h");
    writeFileSync(path, "{ not json");

    expect(() => readCursorJson(path)).toThrow(CursorConfigParseError);
  });

  it("keeps the token in a file only its owner can read", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "clocktopus-cursor-")),
      "clocktopus.json",
    );
    writeCursorCredentials(
      { token: "ct_ingest_example", endpoint: "https://otel.example.com/" },
      path,
    );

    expect(readCursorCredentials(path).credentials).toEqual({
      token: "ct_ingest_example",
      endpoint: "https://otel.example.com",
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
