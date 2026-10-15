import { AgentStatusSchema } from "@repo/cli-contract/agent";
import { differenceInMilliseconds, parseISO } from "date-fns";

import { readLastRun } from "../../lib/agent-hook-state.js";
import { isConfigParseError, surveyAgents } from "../../lib/agents.js";
import { ApiError, get } from "../../lib/api.js";
import { CLAUDE_PLUGIN_ID, readClaudePlugin } from "../../lib/claude-plugin.js";
import {
  describeContentFlags,
  findContentFlagsOn,
} from "../../lib/claude-settings.js";
import { isLoggedIn } from "../../lib/config.js";
import { formatAgo, labelled, microUsdToDisplay } from "../../lib/format.js";

// Reports from what the server received, because local config can be correct while
// nothing arrives. The hook and metrics lanes are reported separately so a session
// with a repository and no spend is not mistaken for cheap work.

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function statusCommand(): Promise<void> {
  if (!isLoggedIn()) {
    console.error("Not logged in. Run 'clocktopus login' first.");
    process.exit(1);
  }

  let status;
  try {
    status = await get("/api/agent/status").then((data) =>
      AgentStatusSchema.parse(data),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      console.error("Session expired. Run 'clocktopus login' again.");
    } else {
      console.error(
        `Failed to fetch agent status: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
    process.exit(1);
  }

  const hookAge = ageOf(status.hookLane.lastSessionStartedAt);
  const metricsAge = ageOf(status.metricsLane.lastExportReceivedAt);

  console.log("\nAgent telemetry\n");
  console.log(labelled("Receiver", status.endpoint));

  console.log("\nLanes (what the receiver has stored)\n");

  console.log(
    labelled(
      "Hook lane",
      `${mark(hookAge)}  ${formatAgo(status.hookLane.lastSessionStartedAt)}`,
      14,
    ),
  );
  if (status.hookLane.repositoryUrl || status.hookLane.cwd) {
    const where = status.hookLane.repositoryUrl ?? status.hookLane.cwd;
    const branch = status.hookLane.gitBranch
      ? ` @ ${status.hookLane.gitBranch}`
      : "";
    console.log(labelled("", `${where}${branch}`, 14));
  }
  if (status.hookLane.attributed === false) {
    console.log(
      labelled("", "this repository is not attached to a project", 14),
    );
  }

  console.log(
    labelled(
      "Spend lane",
      `${mark(metricsAge)}  ${formatAgo(status.metricsLane.lastExportReceivedAt)}`,
      14,
    ),
  );
  if (status.metricsLane.lastModel) {
    console.log(labelled("", status.metricsLane.lastModel, 14));
  }

  console.log("\nLast 7 days\n");
  console.log(labelled("Sessions", String(status.window.sessions)));
  console.log(labelled("Spend", microUsdToDisplay(status.window.costMicroUsd)));
  // No cause is named: the count cannot tell which repository-level reason applies,
  // and `agent doctor` run in the checkout can.
  if (status.window.unattributedSessions > 0) {
    console.log(
      labelled(
        "Unattributed",
        `${status.window.unattributedSessions} session(s) with no project`,
      ),
    );
  }

  const local = readLocalSummary();
  if (local.length > 0) {
    console.log("\nThis machine\n");
    for (const line of local) console.log(line);
  }

  for (const diagnosis of diagnose({
    hookAge,
    metricsAge,
    unattributedSessions: status.window.unattributedSessions,
    sessions: status.window.sessions,
    expectsSpend: expectsSpend(),
  })) {
    console.log(`\n${diagnosis}`);
  }

  const contentCallout = contentFlagCallout(
    usesClaude() ? findContentFlagsOn() : { found: [], unreadable: [] },
  );
  if (contentCallout) console.log(`\n${contentCallout}`);
}

function usesClaude(): boolean {
  return surveyAgents().some(
    (entry) =>
      entry.agent.id === "claude" && (entry.installed || entry.configured),
  );
}

export function contentFlagCallout({
  found,
  unreadable,
}: ReturnType<typeof findContentFlagsOn>): string | null {
  const lines: string[] = [];
  if (found.length > 0) {
    lines.push(
      "⚠ Claude Code is set to export session content to Clocktopus:",
      `  ${describeContentFlags(found)}.`,
      "  Unset these or set them to 0, then run 'clocktopus agent setup'.",
    );
    if (found.some((flag) => flag.managed)) {
      lines.push(
        "  A managed settings file overrides setup: ask whoever deploys it.",
      );
    }
  }
  if (unreadable.length > 0) {
    lines.push(
      `⚠ Couldn't read Claude Code's managed settings: ${unreadable.join(", ")}.`,
      "  A content flag turned on there would not show above.",
    );
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

// True when nothing is configured either, so a fresh machine still hears about a
// silent exporter.
function expectsSpend(): boolean {
  const configured = surveyAgents().filter((entry) => entry.configured);
  return (
    configured.length === 0 ||
    configured.some((entry) => entry.agent.reportsSpend)
  );
}

function ageOf(value: string | null): number | null {
  if (!value) return null;
  try {
    return differenceInMilliseconds(new Date(), parseISO(value));
  } catch {
    return null;
  }
}

function mark(ageMs: number | null): string {
  if (ageMs === null) return "✗";
  return ageMs > STALE_AFTER_MS ? "⚠" : "✓";
}

export function diagnose(input: {
  hookAge: number | null;
  metricsAge: number | null;
  unattributedSessions: number;
  sessions: number;
  // False when every agent configured here exports no spend, as Cursor does not.
  expectsSpend: boolean;
}): string[] {
  const { hookAge, metricsAge } = input;
  const hookLive = hookAge !== null && hookAge <= STALE_AFTER_MS;
  const metricsLive = metricsAge !== null && metricsAge <= STALE_AFTER_MS;

  if (hookAge === null && metricsAge === null) {
    return [
      "✗ Nothing has ever arrived. Run 'clocktopus agent doctor' to find out\n" +
        "  where it stops.",
    ];
  }

  if (hookLive && !metricsLive && input.expectsSpend) {
    return [
      "⚠ Sessions are arriving with repository context, but no spend is.\n" +
        "  The telemetry exporter is not reaching the receiver — every session\n" +
        "  will show $0.00, which is indistinguishable from cheap work. Check\n" +
        "  the exporter config with 'clocktopus agent doctor'.",
    ];
  }

  if (metricsLive && !hookLive) {
    return [
      "⚠ Spend is arriving, but no repository context is. The SessionStart /\n" +
        "  SessionEnd hook is not running, and no telemetry stream carries path\n" +
        "  data at all — so these sessions cannot be attributed to a project.\n" +
        "  Check the hook with 'clocktopus agent doctor'.",
    ];
  }

  // Checked last: a silent hook also leaves sessions unattributed, and its callout
  // above is the one to act on.
  if (input.unattributedSessions > 0) {
    return [
      `⚠ In the last 7 days, ${input.unattributedSessions} of ${input.sessions} sessions had no project.\n` +
        '  Their spend is recorded and counted — it lands in the "Unattributed\n' +
        '  agent work" row rather than against a client.\n' +
        "\n" +
        "  A session takes its project from the repository it ran in, so the fix\n" +
        "  is a repository-to-project mapping and nothing on this machine changes\n" +
        "  it. Run 'clocktopus agent doctor' inside that checkout: it names which\n" +
        "  of the four reasons applies, and what to do about it.",
    ];
  }

  return [];
}

function readLocalSummary(): string[] {
  const lines: string[] = [];

  // Includes installed but unconfigured agents, which the server-side lanes cannot see.
  const survey = surveyAgents().filter(
    (entry) => entry.installed || entry.configured || entry.unreadable,
  );

  if (survey.length === 0) {
    lines.push(labelled("Agents", "none found on PATH"));
    return lines;
  }

  let anyConfigured = false;
  for (const entry of survey) {
    if (entry.unreadable) {
      lines.push(
        labelled(entry.agent.label, "config unreadable — see 'agent doctor'"),
      );
      continue;
    }

    if (!entry.configured) {
      lines.push(
        labelled(
          entry.agent.label,
          `not reporting — run 'clocktopus agent setup --agent ${entry.agent.id}'`,
        ),
      );
      continue;
    }

    anyConfigured = true;
    if (entry.agent.id === "claude") lines.push(claudePluginLine());
    const pending = safePendingActions(entry.agent);
    lines.push(
      labelled(
        entry.agent.label,
        pending.length > 0
          ? "configured, waiting on approval — see 'agent doctor'"
          : "configured",
      ),
    );
  }

  if (!anyConfigured) return lines;

  const lastRun = readLastRun();
  if (lastRun) {
    const outcome =
      lastRun.status === null || lastRun.status === undefined
        ? `failed — ${lastRun.error ?? "no response"}`
        : lastRun.status >= 200 && lastRun.status < 300
          ? `HTTP ${lastRun.status}`
          : `HTTP ${lastRun.status} — rejected`;
    lines.push(
      labelled(
        "Last hook",
        `${formatAgo(lastRun.at)} (${lastRun.event ?? "?"}${
          lastRun.provider ? `, ${lastRun.provider}` : ""
        }) ${outcome}`,
      ),
    );
  } else {
    lines.push(labelled("Last hook", "has not run since setup"));
  }

  return lines;
}

function claudePluginLine(): string {
  const plugin = readClaudePlugin();
  if (!plugin) return labelled("Plugin", "unknown — see 'agent doctor'");
  if (!plugin.installed) {
    return labelled(
      "Plugin",
      "not installed — run 'clocktopus agent setup --agent claude'",
    );
  }
  return labelled(
    "Plugin",
    `${CLAUDE_PLUGIN_ID} ${plugin.version ?? ""}${plugin.enabled ? "" : " (disabled)"}`.trim(),
  );
}

/** `pendingActions` reads config; a broken file must not fail `status`. */
function safePendingActions(agent: { pendingActions(): string[] }): string[] {
  try {
    return agent.pendingActions();
  } catch (error) {
    if (isConfigParseError(error)) return [];
    throw error;
  }
}
