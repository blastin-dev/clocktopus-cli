import { execSync } from "node:child_process";
import { UserSchema } from "@repo/cli-contract/user";
import { isAfter, parseISO } from "date-fns";

import type { AgentSurvey } from "../../lib/agents.js";
import {
  findShadowedExports,
  maskToken,
  resolveAgentCredentials,
} from "../../lib/agent-config.js";
import { readLastRun } from "../../lib/agent-hook-state.js";
import { verifyReceiver } from "../../lib/agent-receiver.js";
import { readAgentSkills } from "../../lib/agent-skills.js";
import { isConfigParseError, surveyAgents } from "../../lib/agents.js";
import { get } from "../../lib/api.js";
import {
  CLAUDE_PLUGIN_ID,
  cliVersion,
  readClaudePlugin,
} from "../../lib/claude-plugin.js";
import { getApiUrl, isLoggedIn } from "../../lib/config.js";
import { formatAgo } from "../../lib/format.js";
import { mcpServerUrl } from "../../lib/mcp-server.js";
import { fetchRepoStatus, repoChecks } from "../../lib/repo-guidance.js";

// Checks run in pipeline order (configuration, hook, network), so the first failure is
// the one to fix and later ones are usually its consequences.

type Check = {
  label: string;
  ok: boolean | "warn";
  detail: string;
  // Only shown when the check did not pass.
  fix?: string;
};

export async function doctorCommand(): Promise<void> {
  const sections: Array<{ title: string; checks: Check[] }> = [];

  sections.push({
    title: "This machine",
    checks: [
      {
        label: "Logged in",
        ok: isLoggedIn(),
        detail: isLoggedIn() ? "yes" : "no",
        fix: "clocktopus login",
      },
    ],
  });

  // Null when signed out or unreachable, which skips the token-owner check.
  const user = isLoggedIn()
    ? await get("/api/auth/me")
        .then((data) => UserSchema.parse(data).user)
        .catch(() => null)
    : null;

  const survey = surveyAgents();
  const relevant = survey.filter(
    (entry) => entry.installed || entry.configured || entry.unreadable,
  );

  if (relevant.length === 0) {
    sections[0]!.checks.push({
      label: "Agents",
      ok: false,
      detail: `none of ${survey.map((e) => e.agent.binary).join(", ")} found on PATH`,
      fix: "Install a supported agent, then run 'clocktopus agent setup'",
    });
  }

  for (const entry of relevant) {
    sections.push({
      title: `${entry.agent.label}${entry.version ? ` ${entry.version}` : ""}`,
      checks: await agentChecks(entry, user),
    });
  }

  const tail: Check[] = [];
  const repoStatus = await fetchRepoStatus();
  if (repoStatus) tail.push(...repoChecks(repoStatus));
  tail.push(checkLastHookRun());
  sections.push({ title: "Repository and delivery", checks: tail });

  report(sections);
}

async function agentChecks(
  entry: AgentSurvey,
  user: { id: string; email: string } | null,
): Promise<Check[]> {
  const checks: Check[] = [];

  if (entry.unreadable) {
    return [
      {
        label: "Config",
        ok: false,
        detail: "could not be parsed",
        fix: entry.unreadable,
      },
    ];
  }

  checks.push({
    label: "Installed",
    ok: entry.installed ? true : "warn",
    detail: entry.installed
      ? `${entry.agent.binary} ${entry.version ?? ""}`.trim()
      : `${entry.agent.binary} is not on PATH`,
    fix: "Config here is harmless, but nothing will report until it is installed",
  });

  let state;
  try {
    state = entry.agent.read();
  } catch (error) {
    if (!isConfigParseError(error)) throw error;
    return [
      {
        label: "Config",
        ok: false,
        detail: "could not be parsed",
        fix: error.message,
      },
    ];
  }

  checks.push({
    label: "Config",
    ok: state.token !== null,
    detail:
      state.token !== null
        ? `${state.paths.join(", ")} (modified ${formatAgo(
            state.modifiedAt?.toISOString() ?? null,
          )})`
        : `not configured in ${state.paths.join(", ")}`,
    fix: `clocktopus agent setup --agent ${entry.agent.id}`,
  });

  // A missing lane passes every other check here, so it gets its own.
  if (state.token !== null) {
    checks.push({
      label: "Signals",
      ok: state.missingLanes.length === 0,
      detail:
        state.missingLanes.length === 0
          ? "every signal the receiver reads is configured"
          : `not being sent: ${state.missingLanes.join(", ")}`,
      fix: `clocktopus agent setup --agent ${entry.agent.id} — this configuration predates it`,
    });
  }

  // SessionStart records the start SHA and time; SessionEnd declares the commits.
  const hookStart = state.hookCommands.SessionStart;
  const hookEnd = state.hookCommands.SessionEnd;
  checks.push({
    label: "Hooks installed",
    ok: Boolean(hookStart && hookEnd),
    detail:
      hookStart && hookEnd
        ? `SessionStart, SessionEnd → ${hookStart}`
        : `missing ${[!hookStart && "SessionStart", !hookEnd && "SessionEnd"]
            .filter(Boolean)
            .join(", ")}`,
    fix: `clocktopus agent setup --agent ${entry.agent.id}`,
  });

  if (hookStart) checks.push(checkHookRuns(hookStart));

  // A warning, not a failure: an older generated plugin still reports.
  const stale = entry.agent.staleReason?.() ?? null;
  if (stale) {
    checks.push({
      label: "Generated config",
      ok: "warn",
      detail: stale,
      fix: `clocktopus agent setup --agent ${entry.agent.id}`,
    });
  }

  for (const action of entry.agent.pendingActions()) {
    checks.push({
      label: "Hooks enabled",
      ok: "warn",
      detail: "installed but not yet approved by the agent",
      fix: action,
    });
  }

  const credentials = resolveAgentCredentials(entry.agent.id);
  checks.push({
    label: "Token in force",
    ok: credentials.token !== null,
    detail: credentials.token
      ? `${maskToken(credentials.token)} (from ${
          credentials.tokenSource === "settings"
            ? credentials.sourcePath
            : credentials.tokenSource
        })`
      : "none resolved",
    fix: `clocktopus agent setup --agent ${entry.agent.id}`,
  });

  if (credentials.token && credentials.endpoint) {
    const check = await verifyReceiver(credentials.endpoint, credentials.token);
    checks.push({
      label: "Receiver",
      ok: check.ok,
      detail: check.ok
        ? `${credentials.endpoint} accepted the token`
        : check.reason === "invalid_token"
          ? `${credentials.endpoint} rejected the token (401)`
          : check.reason === "unexpected_status"
            ? `${credentials.endpoint} answered HTTP ${check.status}`
            : `${credentials.endpoint} unreachable — ${check.message}`,
      fix:
        check.ok || check.reason !== "invalid_token"
          ? "Check the endpoint is reachable from this network"
          : "clocktopus agent setup --force  (mints a replacement token)",
    });
    if (check.ok && check.userId !== null && user) {
      checks.push({
        label: "Token owner",
        ok: check.userId === user.id,
        detail:
          check.userId === user.id
            ? `reports to ${user.email}, the account you are logged in as`
            : `reports to another Clocktopus account than ${user.email}`,
        fix: "clocktopus agent setup  (mints a token for the account you are logged in as)",
      });
    }
  }

  // Only Claude Code applies config `env` over the inherited environment.
  if (entry.agent.id === "claude") {
    checks.push(checkShadowedExports());
    checks.push(checkClaudePlugin());
  }

  if (state.contextCommand !== undefined) {
    checks.push({
      label: "Context hook",
      ok: state.contextCommand !== null,
      detail: state.contextCommand
        ? `SessionStart → ${state.contextCommand}`
        : "missing — sessions are not told which task their branch carries",
      fix: `clocktopus agent setup --agent ${entry.agent.id}`,
    });
  }

  if (state.mcpUrl !== undefined) {
    checks.push(checkMcpServer(entry, state.mcpUrl));
  }
  if (entry.agent.usesSharedSkills) checks.push(checkSharedSkills(entry));

  checks.push(checkRestartNeeded(entry, state.modifiedAt));

  return checks;
}

// Empty stdin makes the hook a no-op, so this proves the installed command resolves
// without sending anything.
function checkHookRuns(command: string): Check {
  try {
    execSync(command, {
      input: "",
      timeout: 15_000,
      stdio: ["pipe", "ignore", "ignore"],
    });
    return {
      label: "Hook executes",
      ok: true,
      detail: "command resolved and ran",
    };
  } catch (error) {
    return {
      label: "Hook executes",
      ok: false,
      detail: `'${command}' failed — ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`,
      fix: "clocktopus agent setup  (rewrites the hook with a resolvable path)",
    };
  }
}

// The plugin carries skills and the MCP server; cost tracking does not depend
// on it.
function checkClaudePlugin(): Check {
  const plugin = readClaudePlugin();
  const fix = "Re-run 'clocktopus agent setup --agent claude'";
  if (!plugin) {
    return {
      label: "Plugin",
      ok: "warn",
      detail: "could not read 'claude plugin list'",
      fix,
    };
  }
  if (!plugin.installed) {
    return { label: "Plugin", ok: "warn", detail: "not installed", fix };
  }
  const current = cliVersion();
  if (!plugin.enabled) {
    return {
      label: "Plugin",
      ok: "warn",
      detail: `${CLAUDE_PLUGIN_ID} is disabled`,
      fix: `claude plugin enable ${CLAUDE_PLUGIN_ID}`,
    };
  }
  return plugin.version === current
    ? { label: "Plugin", ok: true, detail: `${CLAUDE_PLUGIN_ID} ${current}` }
    : {
        label: "Plugin",
        ok: "warn",
        detail: `${CLAUDE_PLUGIN_ID} ${plugin.version ?? "?"}, CLI ${current}`,
        fix,
      };
}

// Signing in happens inside the agent, so only the entry itself is checked.
function checkMcpServer(entry: AgentSurvey, url: string | null): Check {
  const expected = mcpServerUrl(getApiUrl());
  const fix = `clocktopus agent setup --agent ${entry.agent.id} --component mcp`;
  if (url === null) {
    return { label: "MCP server", ok: "warn", detail: "not configured", fix };
  }
  return url === expected
    ? {
        label: "MCP server",
        ok: true,
        detail: `${url} (sign in once with '${entry.agent.mcpSignIn}')`,
      }
    : {
        label: "MCP server",
        ok: "warn",
        detail: `${url}, but this CLI uses ${expected}`,
        fix,
      };
}

function checkSharedSkills(entry: AgentSurvey): Check {
  const fix = `clocktopus agent setup --agent ${entry.agent.id} --component skills`;
  let skills;
  try {
    skills = readAgentSkills();
  } catch (error) {
    return {
      label: "Skills",
      ok: "warn",
      detail: `could not be read — ${error instanceof Error ? error.message : "unknown error"}`,
      fix,
    };
  }
  if (skills.missing.length > 0) {
    return {
      label: "Skills",
      ok: "warn",
      detail: `missing from ${skills.dir}: ${skills.missing.join(", ")}`,
      fix,
    };
  }
  if (skills.outdated.length > 0) {
    return {
      label: "Skills",
      ok: "warn",
      detail: `older than this CLI: ${skills.outdated.join(", ")}`,
      fix,
    };
  }
  return {
    label: "Skills",
    ok: true,
    detail: `${skills.installed.join(", ")} in ${skills.dir}`,
  };
}

function checkShadowedExports(): Check {
  const shadowed = findShadowedExports();

  if (shadowed.length === 0) {
    return {
      label: "Config conflicts",
      ok: true,
      detail: "settings.json is the only source",
    };
  }

  return {
    label: "Config conflicts",
    ok: "warn",
    detail: shadowed
      .map(({ path, keys }) => `${path} exports ${keys.join(", ")}`)
      .join("; "),
    fix:
      "settings.json is applied over the inherited environment, so these are\n" +
      "      ignored inside Claude Code. Remove them — two sources that\n" +
      "      disagree is how spend lands on the wrong account.",
  };
}

// Agents read their configuration once at process start. Only compared when this agent
// wrote the shared last-run receipt.
function checkRestartNeeded(
  entry: AgentSurvey,
  configModifiedAt: Date | null,
): Check {
  const lastRun = readLastRun();
  const ranThisAgent = lastRun?.provider === entry.agent.provider;

  if (!configModifiedAt || !lastRun?.at || !ranThisAgent) {
    return {
      label: "Restart",
      ok: "warn",
      detail: `${entry.agent.label} has not run a hook since this configuration was written`,
      fix: `Restart ${entry.agent.label}, then run 'clocktopus agent status'`,
    };
  }

  const ranAfterConfig = isAfter(parseISO(lastRun.at), configModifiedAt);

  return {
    label: "Restart",
    ok: ranAfterConfig ? true : "warn",
    detail: ranAfterConfig
      ? "a session has run since the last configuration change"
      : "the config changed after the last session started",
    fix: `Restart ${entry.agent.label} so the exporter and hook pick up the new values`,
  };
}

function checkLastHookRun(): Check {
  const lastRun = readLastRun();

  if (!lastRun) {
    return {
      label: "Last hook run",
      ok: "warn",
      detail: "no record — no hook has run on this machine",
      fix: "Restart your agent and start a session",
    };
  }

  const failed =
    lastRun.status === null ||
    lastRun.status === undefined ||
    lastRun.status < 200 ||
    lastRun.status >= 300;

  const who = lastRun.provider ? ` (${lastRun.provider})` : "";

  return {
    label: "Last hook run",
    ok: !failed,
    detail: failed
      ? `${formatAgo(lastRun.at)}${who} — ${lastRun.status ? `HTTP ${lastRun.status}` : (lastRun.error ?? "no response")}`
      : `${formatAgo(lastRun.at)}${who} — HTTP ${lastRun.status}`,
    fix:
      lastRun.status === 401
        ? "clocktopus agent setup --force  (the token was rejected)"
        : "Check network access to the receiver",
  };
}

function report(sections: Array<{ title: string; checks: Check[] }>): void {
  console.log("\nAgent telemetry diagnosis");

  for (const section of sections) {
    if (section.checks.length === 0) continue;
    console.log(`\n${section.title}\n`);

    for (const check of section.checks) {
      const symbol = check.ok === true ? "✓" : check.ok === "warn" ? "⚠" : "✗";
      console.log(`  ${symbol} ${check.label.padEnd(18)}${check.detail}`);
      if (check.ok !== true && check.fix) {
        console.log(`    → ${check.fix}`);
      }
    }
  }

  const all = sections.flatMap((section) => section.checks);
  const failures = all.filter((check) => check.ok === false).length;
  const warnings = all.filter((check) => check.ok === "warn").length;

  console.log("");
  if (failures === 0 && warnings === 0) {
    console.log(
      "Everything checks out. 'clocktopus agent status' shows what has arrived.",
    );
  } else {
    console.log(
      `${failures} failing, ${warnings} to review. Fix the first failure above —\n` +
        "the later ones are usually consequences of it.",
    );
  }

  if (failures > 0) process.exitCode = 1;
}
