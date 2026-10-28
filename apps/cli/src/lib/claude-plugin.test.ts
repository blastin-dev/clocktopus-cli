import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import type { ClaudeRunner } from "./claude-plugin.js";
import {
  buildMarketplace,
  CLAUDE_PLUGIN_ID,
  installClaudePlugin,
  PANEL_MIN_CLAUDE_VERSION,
  panelUnsupportedReason,
  PLUGIN_PARTS,
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

  it("copies the session panel's hooks module and its state contract", () => {
    const { pluginDir } = buildMarketplace({
      sourceDir: pluginSourceDir(),
      targetDir: mkdtempSync(join(tmpdir(), "clocktopus-mkt-")),
      version: "1.2.3",
      apiUrl: "https://clocktopus.app",
    });

    expect(readJson(join(pluginDir, "hooks", "hooks.json"))).toEqual({
      modules: ["./register.tsx"],
    });
    expect(existsSync(join(pluginDir, "hooks", "register.tsx"))).toBe(true);
    expect(
      readJson(join(pluginDir, ".claude-plugin", "plugin.json")),
    ).toMatchObject({ types: "./types/index.d.ts" });
    expect(existsSync(join(pluginDir, "types", "index.d.ts"))).toBe(true);
    expect(existsSync(join(pluginDir, "hooks", "panel.ts"))).toBe(true);
  });

  it("leaves out the engine's pinned declarations and the plugin's tsconfig", () => {
    const { pluginDir } = buildMarketplace({
      sourceDir: pluginSourceDir(),
      targetDir: mkdtempSync(join(tmpdir(), "clocktopus-mkt-")),
      version: "1.2.3",
      apiUrl: "https://clocktopus.app",
    });

    expect(existsSync(join(pluginSourceDir(), "types", "claude-code"))).toBe(
      true,
    );
    expect(existsSync(join(pluginDir, "types", "claude-code"))).toBe(false);
    expect(existsSync(join(pluginDir, "tsconfig.json"))).toBe(false);
  });

  it("leaves the same development files out of the npm package", () => {
    const { files } = readJson(join(pluginSourceDir(), "..", "package.json"));
    const prefix = "!claude-plugin/";
    expect(
      files
        .filter((entry: string) => entry.startsWith(prefix))
        .map((entry: string) => entry.slice(prefix.length))
        .sort(),
    ).toEqual(
      PLUGIN_PARTS.development.map((path) => path.split(sep).join("/")).sort(),
    );
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

describe("buildMarketplace without the panel", () => {
  it("leaves out the hooks module, its tests and the state contract plugin.json names", () => {
    const { pluginDir } = buildMarketplace({
      sourceDir: pluginSourceDir(),
      targetDir: mkdtempSync(join(tmpdir(), "clocktopus-mkt-")),
      version: "1.2.3",
      apiUrl: "https://clocktopus.app",
      panel: false,
    });

    expect(existsSync(join(pluginDir, "hooks"))).toBe(false);
    expect(existsSync(join(pluginDir, "tests"))).toBe(false);
    expect(existsSync(join(pluginDir, "types"))).toBe(false);
    const manifest = readJson(join(pluginDir, ".claude-plugin", "plugin.json"));
    expect(manifest).not.toHaveProperty("types");
    expect(manifest).toMatchObject({ name: "clocktopus", version: "1.2.3" });
    expect(existsSync(join(pluginDir, ".mcp.json"))).toBe(true);
    expect(existsSync(join(pluginDir, "skills"))).toBe(true);
  });
});

describe("panelUnsupportedReason", () => {
  it("accepts the minimum and anything newer", () => {
    expect(panelUnsupportedReason(PANEL_MIN_CLAUDE_VERSION)).toBeNull();
    expect(panelUnsupportedReason("2.1.311 (Claude Code)")).toBeNull();
    expect(panelUnsupportedReason("2.2.0")).toBeNull();
    expect(panelUnsupportedReason("10.0.3")).toBeNull();
    expect(panelUnsupportedReason("3.0.0")).toBeNull();
  });

  it("names an older Claude Code, comparing each part as a number", () => {
    expect(panelUnsupportedReason("2.1.99")).toBe(
      `Claude Code 2.1.99 is older than ${PANEL_MIN_CLAUDE_VERSION}`,
    );
    expect(panelUnsupportedReason("2.0.400")).toMatch(/older than/);
    expect(panelUnsupportedReason("1.9.999")).toMatch(/older than/);
  });

  it("says why when the version is missing or unreadable", () => {
    expect(panelUnsupportedReason(null)).toBe("'claude --version' did not run");
    expect(panelUnsupportedReason("dev build")).toBe(
      "could not read Claude Code's version from 'dev build'",
    );
    expect(panelUnsupportedReason("2.1")).toMatch(/could not read/);
  });

  it("is the version the pinned engine declarations were written by", () => {
    const pinned = readFileSync(
      join(pluginSourceDir(), "types", "claude-code", "index.d.ts"),
      "utf8",
    ).split("\n")[0];
    expect(pinned).toBe(
      `// Written by Claude Code ${PANEL_MIN_CLAUDE_VERSION}.`,
    );
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
    ).toEqual({
      installed: true,
      enabled: false,
      version: "1.2.3",
      panel: false,
    });
  });

  it("says the panel is installed when the folder Claude Code loads has hooks.json", () => {
    const withHooks = mkdtempSync(join(tmpdir(), "clocktopus-plugin-"));
    mkdirSync(join(withHooks, "hooks"));
    writeFileSync(join(withHooks, "hooks", "hooks.json"), "{}");
    const without = mkdtempSync(join(tmpdir(), "clocktopus-plugin-"));
    const read = (entry: object) =>
      readClaudePlugin(
        list(
          JSON.stringify([{ id: CLAUDE_PLUGIN_ID, version: "1", ...entry }]),
        ),
      )?.panel;

    expect(read({ installPath: withHooks })).toBe(true);
    expect(read({ installPath: without })).toBe(false);
    expect(read({ installPath: withHooks, readFromFolder: without })).toBe(
      false,
    );
    expect(read({ installPath: without, readFromFolder: withHooks })).toBe(
      true,
    );
  });

  it("says not installed when the list lacks it", () => {
    expect(readClaudePlugin(list("[]"))).toEqual({
      installed: false,
      enabled: false,
      version: null,
      panel: false,
    });
  });

  it("returns null when the list can't be read", () => {
    expect(readClaudePlugin(list("", false))).toBeNull();
    expect(readClaudePlugin(list("not json"))).toBeNull();
  });
});
