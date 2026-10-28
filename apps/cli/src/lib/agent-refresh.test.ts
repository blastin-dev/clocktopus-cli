import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentAdapter, AgentTelemetryState } from "./agents.js";
import type { ClaudeRunner } from "./claude-plugin.js";
import { refreshAgentSetup, refreshIfUpgraded } from "./agent-refresh.js";
import {
  buildMarketplace,
  CLAUDE_PLUGIN_ID,
  cliVersion,
  marketplaceDir,
  pluginSourceDir,
  readMarketplacePlugin,
} from "./claude-plugin.js";

const { setLastRunVersion, state, spawn } = vi.hoisted(() => ({
  setLastRunVersion: vi.fn(),
  spawn: vi.fn(() => ({ unref: () => {} })),
  state: {
    lastRunVersion: undefined as string | undefined,
    configuredAt: undefined as string | undefined,
    method: "npm",
  },
}));
vi.mock("./config.js", () => ({
  getApiUrl: () => "https://clocktopus.example.test",
  getAgentConfig: () => ({ configuredAt: state.configuredAt }),
  getLastRunVersion: () => state.lastRunVersion,
  setLastRunVersion,
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn,
}));
vi.mock("./install-method.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./install-method.js")>()),
  currentInstallMethod: () => state.method,
}));

const previousHome = process.env.HOME;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "clocktopus-refresh-"));
  process.env.HOME = home;
  setLastRunVersion.mockClear();
  spawn.mockClear();
  Object.assign(state, {
    lastRunVersion: undefined,
    configuredAt: undefined,
    method: "npm",
  });
});

afterEach(() => {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

function adapter(
  state: Partial<AgentTelemetryState>,
  overrides: Partial<AgentAdapter> = {},
) {
  return {
    id: "codex",
    label: "Codex CLI",
    provider: "codex_cli",
    read: () => ({
      token: null,
      endpoint: null,
      hookCommands: {},
      missingLanes: [],
      modifiedAt: null,
      paths: [],
      ...state,
    }),
    apply: vi.fn(() => ({ backupPaths: [] })),
    ...overrides,
  } as unknown as AgentAdapter & { apply: ReturnType<typeof vi.fn> };
}

const configured = {
  token: "ctop_agt_testtoken",
  endpoint: "https://otel.example.test",
  hookCommands: {
    SessionStart: "clocktopus agent hook --provider codex_cli",
    SessionEnd: "clocktopus agent hook --provider codex_cli",
  },
  mcpUrl: "https://staging.example.test/api/mcp",
};

// `claude plugin list` names the plugin when `plugin` is given; every other
// command succeeds.
function claude(plugin?: { enabled: boolean }) {
  const calls: string[][] = [];
  const run: ClaudeRunner = (args) => {
    calls.push(args);
    if (args.join(" ") === "plugin list --json") {
      return {
        ok: true,
        output: JSON.stringify(
          plugin ? [{ id: CLAUDE_PLUGIN_ID, ...plugin, version: "0.8.0" }] : [],
        ),
      };
    }
    if (args[0] === "--version") return { ok: true, output: "2.1.400" };
    return { ok: true, output: "" };
  };
  return { run, calls };
}

describe("refreshAgentSetup", () => {
  it("rewrites a stale agent with its own token, endpoint, hook and MCP server", () => {
    const codex = adapter(configured, { staleReason: () => "old plugin" });

    refreshAgentSetup({ agents: [codex], run: claude().run });

    expect(codex.apply).toHaveBeenCalledWith({
      token: configured.token,
      endpoint: configured.endpoint,
      hookCommand: configured.hookCommands.SessionStart,
      apiUrl: "https://staging.example.test",
      mcp: true,
    });
    expect(setLastRunVersion).toHaveBeenCalledWith(cliVersion());
  });

  it("leaves a current agent, and one setup never configured, untouched", () => {
    const current = adapter(configured);
    const never = adapter({}, { staleReason: () => "old plugin" });

    refreshAgentSetup({ agents: [current, never], run: claude().run });

    expect(current.apply).not.toHaveBeenCalled();
    expect(never.apply).not.toHaveBeenCalled();
  });

  it("rebuilds an installed plugin with the components it had, keeping it disabled", () => {
    buildMarketplace({
      sourceDir: pluginSourceDir(),
      targetDir: marketplaceDir(),
      version: "0.8.0",
      apiUrl: "https://staging.example.test",
      skills: false,
      panel: false,
    });
    const { run, calls } = claude({ enabled: false });

    const report = refreshAgentSetup({ agents: [], run });

    expect(readMarketplacePlugin()).toEqual({
      version: cliVersion(),
      skills: false,
      panel: false,
      apiUrl: "https://staging.example.test",
    });
    expect(calls).toContainEqual(["plugin", "update", CLAUDE_PLUGIN_ID]);
    expect(calls).toContainEqual(["plugin", "disable", CLAUDE_PLUGIN_ID]);
    expect(report.lines).toEqual([
      `Claude plugin: ${CLAUDE_PLUGIN_ID} ${cliVersion()}`,
    ]);
  });

  it("leaves a plugin newer than this CLI alone", () => {
    buildMarketplace({
      sourceDir: pluginSourceDir(),
      targetDir: marketplaceDir(),
      version: "99.0.0",
      apiUrl: "https://staging.example.test",
    });
    const { run, calls } = claude({ enabled: true });

    refreshAgentSetup({ agents: [], run });

    expect(readMarketplacePlugin()?.version).toBe("99.0.0");
    expect(calls).toEqual([["plugin", "list", "--json"]]);
  });

  it("installs no plugin Claude Code doesn't have", () => {
    const { run, calls } = claude();

    refreshAgentSetup({ agents: [], run });

    expect(readMarketplacePlugin()).toBeNull();
    expect(calls).toEqual([["plugin", "list", "--json"]]);
  });

  it("updates the shared skills, adding new ones, only where setup installed them", () => {
    const skills = join(home, ".agents", "skills");

    expect(refreshAgentSetup({ agents: [], run: claude().run }).lines).toEqual(
      [],
    );

    mkdirSync(join(skills, "clocktopus-refine"), { recursive: true });
    writeFileSync(join(skills, "clocktopus-refine", "SKILL.md"), "old");
    const report = refreshAgentSetup({ agents: [], run: claude().run });

    expect(report.lines).toEqual([
      expect.stringMatching(/^Skills: .*clocktopus-start-work/),
    ]);
  });

  it("stands aside while another refresh holds the lock", () => {
    mkdirSync(join(home, ".clocktopus"), { recursive: true });
    writeFileSync(join(home, ".clocktopus", "refresh.lock"), "");
    const codex = adapter(configured, { staleReason: () => "old plugin" });

    expect(refreshAgentSetup({ agents: [codex], run: claude().run })).toEqual({
      status: "busy",
      lines: ["Another refresh is running."],
    });
    expect(codex.apply).not.toHaveBeenCalled();
  });
});

describe("refreshIfUpgraded", () => {
  it("refreshes in the background, with --env, once a newer version runs", () => {
    state.lastRunVersion = "0.0.1";

    expect(refreshIfUpgraded("staging")).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["--env", "staging", "agent", "refresh"]),
      expect.objectContaining({ detached: true }),
    );
    // The refresh records the version itself, once it has run.
    expect(setLastRunVersion).not.toHaveBeenCalled();
  });

  it("refreshes an install that predates the recorded version, once setup ran", () => {
    state.configuredAt = "2026-10-01T09:00:00.000Z";
    expect(refreshIfUpgraded()).toBe(true);
  });

  it("only records the version where setup never ran", () => {
    expect(refreshIfUpgraded()).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(setLastRunVersion).toHaveBeenCalledWith(cliVersion());
  });

  it("does nothing when an older or the same version runs", () => {
    state.lastRunVersion = "99.0.0";
    expect(refreshIfUpgraded()).toBe(false);
    state.lastRunVersion = cliVersion();
    expect(refreshIfUpgraded()).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["npx", "checkout", "unknown"])(
    "leaves the setup alone when the CLI runs from %s",
    (method) => {
      state.method = method;
      state.lastRunVersion = "0.0.1";
      expect(refreshIfUpgraded()).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    },
  );
});
