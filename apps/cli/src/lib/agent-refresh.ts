import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isCliVersionBelow } from "@repo/cli-contract/cli-version";

import type { AgentAdapter } from "./agents.js";
import type { ClaudeRunner } from "./claude-plugin.js";
import { refreshedHookCommand } from "./agent-config.js";
import { hasAgentSkills, installAgentSkills } from "./agent-skills.js";
import { AGENTS } from "./agents.js";
import {
  CLAUDE_PLUGIN_ID,
  cliVersion,
  installClaudePlugin,
  panelUnsupportedReason,
  readClaudePlugin,
  readMarketplacePlugin,
  runClaude,
} from "./claude-plugin.js";
import {
  getAgentConfig,
  getApiUrl,
  getLastRunVersion,
  setLastRunVersion,
} from "./config.js";
import {
  currentInstallMethod,
  isUpgradable,
  runningScript,
} from "./install-method.js";

// `agent refresh`: brings what `agent setup` installed up to this CLI, and only
// that. An agent, the plugin and the skills are each refreshed only where setup
// left them, with the components it left; nothing is prompted for, and no
// token is minted.

// A refresh that died holding the lock frees it after this long.
const LOCK_STALE_MS = 10 * 60 * 1000;

function lockPath() {
  return join(homedir(), ".clocktopus", "refresh.lock");
}

// Null when another refresh holds the lock: two at once would rebuild the
// plugin folder under each other.
function takeLock(path = lockPath()) {
  mkdirSync(dirname(path), { recursive: true });
  try {
    closeSync(openSync(path, "wx"));
  } catch {
    try {
      if (Date.now() - statSync(path).mtimeMs < LOCK_STALE_MS) return null;
    } catch {
      return null;
    }
    rmSync(path, { force: true });
    try {
      closeSync(openSync(path, "wx"));
    } catch {
      return null;
    }
  }
  return () => rmSync(path, { force: true });
}

// `lines` has one line per thing refreshed or left out. The version is recorded
// only here, once the refresh has run, so one that never ran is tried again.
export function refreshAgentSetup(
  input: { run?: ClaudeRunner; agents?: readonly AgentAdapter[] } = {},
) {
  const release = takeLock();
  if (!release) {
    return { status: "busy" as const, lines: ["Another refresh is running."] };
  }
  try {
    const lines = [
      ...(input.agents ?? AGENTS).flatMap(refreshAgent),
      ...refreshClaudePlugin(input.run ?? runClaude),
      ...refreshSharedSkills(),
    ];
    setLastRunVersion(cliVersion());
    return { status: "refreshed" as const, lines };
  } finally {
    release();
  }
}

// An agent setup configured: its config holds Clocktopus's token and hook. It
// is written again only when its hook command moves (the mise shim, a moved
// install) or the agent's integration is stale.
function refreshAgent(agent: AgentAdapter): string[] {
  try {
    const state = agent.read();
    const installed = state.hookCommands.SessionStart;
    if (!state.token || !state.endpoint || !installed) return [];
    const hookCommand = refreshedHookCommand(agent.provider, installed);
    const stale = agent.staleReason?.() ?? null;
    if (hookCommand === installed && !stale) return [];
    const { warnings = [] } = agent.apply({
      token: state.token,
      endpoint: state.endpoint,
      hookCommand,
      apiUrl: apiUrlOf(state.mcpUrl) ?? getApiUrl(),
      mcp: Boolean(state.mcpUrl),
    });
    return [
      `${agent.label}: hooks updated (${hookCommand})`,
      ...warnings.map((warning) => `${agent.label}: ✗ ${warning}`),
    ];
  } catch (error) {
    return [`${agent.label}: ✗ ${messageOf(error)}`];
  }
}

function apiUrlOf(mcpUrl: string | null | undefined) {
  return mcpUrl ? mcpUrl.replace(/\/api\/mcp\/?$/, "") : null;
}

// Only an installed plugin, rebuilt with the components its folder carries,
// and left disabled if the user disabled it.
function refreshClaudePlugin(run: ClaudeRunner): string[] {
  try {
    const plugin = readClaudePlugin(run);
    if (!plugin?.installed) return [];
    const folder = readMarketplacePlugin();
    const version = cliVersion();
    // An older CLI's refresh leaves a newer plugin alone.
    if (!folder || !isCliVersionBelow(folder.version, version)) return [];

    let panel = folder.panel;
    const notes: string[] = [];
    if (panel) {
      const claude = run(["--version"]);
      const unsupported = panelUnsupportedReason(
        claude.ok ? claude.output : null,
      );
      if (unsupported) {
        notes.push(`Claude plugin: panel left out — ${unsupported}`);
        panel = false;
      }
    }
    const result = installClaudePlugin({
      version,
      apiUrl: folder.apiUrl ?? getApiUrl(),
      skills: folder.skills,
      mcp: folder.apiUrl !== null,
      panel,
      run,
    });
    if (!result.ok) return [`Claude plugin: ✗ ${result.reason}`];
    if (!plugin.enabled) run(["plugin", "disable", CLAUDE_PLUGIN_ID]);
    return [`Claude plugin: ${CLAUDE_PLUGIN_ID} ${version}`, ...notes];
  } catch (error) {
    return [`Claude plugin: ✗ ${messageOf(error)}`];
  }
}

function refreshSharedSkills(): string[] {
  try {
    if (!hasAgentSkills()) return [];
    return [`Skills: ${installAgentSkills().join(", ")}`];
  } catch (error) {
    return [`Skills: ✗ ${messageOf(error)}`];
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

// The first run of a version newer than the one that last ran here starts a
// refresh in its own process, so the command that noticed is not held up and a
// host tearing the hook down cannot kill it. True when one was started.
export function refreshIfUpgraded(env?: string): boolean {
  try {
    if (!isUpgradable(currentInstallMethod())) return false;
    const current = cliVersion();
    const last = getLastRunVersion();
    if (last === undefined && !getAgentConfig().configuredAt) {
      // Nothing to bring up to date: `agent setup` never ran here.
      setLastRunVersion(current);
      return false;
    }
    if (last !== undefined && !isCliVersionBelow(last, current)) return false;
    return startRefresh(env);
  } catch {
    return false;
  }
}

function startRefresh(env: string | undefined): boolean {
  const script = runningScript();
  if (!script) return false;
  try {
    spawn(
      process.execPath,
      [script, ...(env ? ["--env", env] : []), "agent", "refresh", "--quiet"],
      { detached: true, stdio: "ignore" },
    ).unref();
    return true;
  } catch {
    return false;
  }
}
