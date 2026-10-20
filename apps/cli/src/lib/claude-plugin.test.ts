import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ClaudeRunner } from "./claude-plugin.js";
import {
  buildMarketplace,
  CLAUDE_PLUGIN_ID,
  installClaudePlugin,
  pluginSourceDir,
  readClaudePlugin,
  removeClaudePlugin,
} from "./claude-plugin.js";

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function recorder(fail: string[] = []) {
  const calls: string[][] = [];
  const run: ClaudeRunner = (args) => {
    calls.push(args);
    return fail.includes(args.slice(0, 3).join(" "))
      ? { ok: false, output: "boom" }
      : { ok: true, output: "" };
  };
  return { calls, run };
}

describe("buildMarketplace", () => {
  it("stamps the CLI version and points the MCP server at the API", () => {
    const targetDir = mkdtempSync(join(tmpdir(), "clocktopus-mkt-"));
    const { pluginDir } = buildMarketplace({
      sourceDir: pluginSourceDir(),
      targetDir,
      version: "1.2.3",
      apiUrl: "https://staging.clocktopus.app/",
    });

    expect(
      readJson(join(pluginDir, ".claude-plugin", "plugin.json")),
    ).toMatchObject({ name: "clocktopus", version: "1.2.3" });
    expect(readJson(join(pluginDir, ".mcp.json"))).toEqual({
      mcpServers: {
        clocktopus: {
          type: "http",
          url: "https://staging.clocktopus.app/api/mcp",
        },
      },
    });
    expect(
      readJson(join(targetDir, ".claude-plugin", "marketplace.json")),
    ).toMatchObject({
      name: "clocktopus",
      plugins: [{ name: "clocktopus", source: "./plugins/clocktopus" }],
    });
  });

  it("leaves out the skills or the MCP server when they are not wanted", () => {
    const build = (include: { skills: boolean; mcp: boolean }) =>
      buildMarketplace({
        sourceDir: pluginSourceDir(),
        targetDir: mkdtempSync(join(tmpdir(), "clocktopus-mkt-")),
        version: "1.2.3",
        apiUrl: "https://clocktopus.app",
        ...include,
      }).pluginDir;

    const mcpOnly = build({ skills: false, mcp: true });
    expect(existsSync(join(mcpOnly, "skills"))).toBe(false);
    expect(existsSync(join(mcpOnly, ".mcp.json"))).toBe(true);

    const skillsOnly = build({ skills: true, mcp: false });
    expect(existsSync(join(skillsOnly, "skills"))).toBe(true);
    expect(existsSync(join(skillsOnly, ".mcp.json"))).toBe(false);
  });
});

describe("installClaudePlugin", () => {
  it("adds the local marketplace, then installs and updates the plugin from it", () => {
    const targetDir = mkdtempSync(join(tmpdir(), "clocktopus-mkt-"));
    const { calls, run } = recorder();

    const result = installClaudePlugin({
      version: "1.2.3",
      apiUrl: "https://clocktopus.app",
      run,
      targetDir,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["plugin", "marketplace", "add", targetDir],
      ["plugin", "install", CLAUDE_PLUGIN_ID],
      ["plugin", "update", CLAUDE_PLUGIN_ID],
    ]);
  });

  it("reports the failing command and stops", () => {
    const { calls, run } = recorder(["plugin marketplace add"]);

    const result = installClaudePlugin({
      version: "1.2.3",
      apiUrl: "https://clocktopus.app",
      run,
      targetDir: mkdtempSync(join(tmpdir(), "clocktopus-mkt-")),
    });

    expect(result).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
  });
});

describe("removeClaudePlugin", () => {
  it("uninstalls, removes the marketplace and deletes its folder", () => {
    const targetDir = mkdtempSync(join(tmpdir(), "clocktopus-mkt-"));
    const { run } = recorder();

    expect(removeClaudePlugin({ run, targetDir })).toEqual([
      `plugin ${CLAUDE_PLUGIN_ID}`,
      "marketplace clocktopus",
      targetDir,
    ]);
    expect(existsSync(targetDir)).toBe(false);
  });

  it("lists only what it actually removed", () => {
    const { run } = recorder(["plugin uninstall clocktopus@clocktopus"]);

    expect(
      removeClaudePlugin({ run, targetDir: join(tmpdir(), "absent-mkt") }),
    ).toEqual(["marketplace clocktopus"]);
  });
});

describe("readClaudePlugin", () => {
  const list =
    (output: string, ok = true): ClaudeRunner =>
    () => ({ ok, output });

  it("finds the plugin in 'claude plugin list --json'", () => {
    expect(
      readClaudePlugin(
        list(
          JSON.stringify([
            { id: "other@x", version: "9", enabled: true },
            { id: CLAUDE_PLUGIN_ID, version: "1.2.3", enabled: false },
          ]),
        ),
      ),
    ).toEqual({ installed: true, enabled: false, version: "1.2.3" });
  });

  it("says not installed when the list lacks it", () => {
    expect(readClaudePlugin(list("[]"))).toEqual({
      installed: false,
      enabled: false,
      version: null,
    });
  });

  it("returns null when the list can't be read", () => {
    expect(readClaudePlugin(list("", false))).toBeNull();
    expect(readClaudePlugin(list("not json"))).toBeNull();
  });
});
