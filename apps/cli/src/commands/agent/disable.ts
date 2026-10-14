import { clearHookState } from "../../lib/agent-hook-state.js";
import { removeAgentSkills } from "../../lib/agent-skills.js";
import { isConfigParseError, surveyAgents } from "../../lib/agents.js";
import { ApiError, request } from "../../lib/api.js";
import { removeClaudePlugin } from "../../lib/claude-plugin.js";
import {
  clearAgentConfig,
  getAgentConfig,
  isLoggedIn,
} from "../../lib/config.js";

// `--revoke` is opt-in because the token may still be in use on another machine.
// Without `--agent`, uninstalled agents are cleaned too, since their config outlives
// them.
export async function disableCommand(options: {
  revoke?: boolean;
  agent?: string[];
}): Promise<void> {
  const survey = surveyAgents();

  const requested = (options.agent ?? []).flatMap((value) =>
    value.split(",").map((part) => part.trim().toLowerCase()),
  );

  if (requested.length > 0) {
    const unknown = requested.filter(
      (id) => !survey.some((entry) => entry.agent.id === id),
    );
    if (unknown.length > 0) {
      console.error(
        `Unknown agent: ${unknown.join(", ")}. Valid ids: ${survey
          .map((entry) => entry.agent.id)
          .join(", ")}.`,
      );
      process.exit(1);
    }
  }

  const targets =
    requested.length > 0
      ? survey.filter((entry) => requested.includes(entry.agent.id))
      : survey;

  const cleaned: Array<{ label: string; removed: string[] }> = [];

  for (const entry of targets) {
    try {
      const { removed } = entry.agent.remove();
      if (entry.agent.id === "claude") removed.push(...removeClaudePlugin());
      if (removed.length > 0)
        cleaned.push({ label: entry.agent.label, removed });
    } catch (error) {
      if (isConfigParseError(error)) {
        console.error(`✗ ${error.message}`);
        process.exit(1);
      }
      // A failure on one agent must not leave the others reporting.
      console.error(
        `✗ ${entry.agent.label}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  // The shared skills go with the last agent that loads them.
  const stillSharing = survey.some(
    (entry) =>
      entry.agent.usesSharedSkills &&
      !targets.includes(entry) &&
      entry.configured,
  );
  if (!stillSharing && targets.some((entry) => entry.agent.usesSharedSkills)) {
    const removed = removeAgentSkills();
    if (removed.length > 0) {
      cleaned.push({ label: "Shared skills", removed });
    }
  }

  const agent = getAgentConfig();

  // A partial clean leaves another agent here holding the token, which revoking would
  // silently break.
  const partial = requested.length > 0 && requested.length < survey.length;
  if (options.revoke && partial) {
    console.log(
      "⚠ --revoke was ignored: it kills the token everywhere, and this run only\n" +
        "  cleaned some of the agents on this machine. Re-run without --agent to\n" +
        "  remove all of them, then revoke.",
    );
  } else if (options.revoke) {
    await revokeToken(agent);
  }

  if (!partial) {
    clearAgentConfig();
    clearHookState();
  }

  if (cleaned.length === 0) {
    console.log("Nothing to remove — agent telemetry was not configured here.");
    return;
  }

  for (const { label, removed } of cleaned) {
    console.log(`✓ ${label}: removed ${removed.join(", ")}.`);
  }

  if (!options.revoke || partial) {
    console.log(
      "\nThe ingest token is still valid. Revoke it with\n" +
        "  clocktopus agent disable --revoke",
    );
  }

  console.log(
    `\nRestart ${cleaned
      .map((c) => c.label)
      .join(" and ")} to stop the current session reporting.`,
  );
}

async function revokeToken(agent: {
  tokenId?: string;
  tokenPrefix?: string;
}): Promise<void> {
  if (!agent.tokenId) {
    console.log(
      "⚠ No token id on record, so nothing was revoked. This machine's token\n" +
        "  was minted by an older version or on another machine — revoke it\n" +
        "  from the dashboard instead.",
    );
    return;
  }

  if (!isLoggedIn()) {
    console.log(
      "⚠ Not logged in, so the token could not be revoked. Run 'clocktopus\n" +
        "  login' and try again — the local configuration was still removed.",
    );
    return;
  }

  try {
    await request(
      `/api/agent/ingest-token?tokenId=${encodeURIComponent(agent.tokenId)}`,
      { method: "DELETE" },
    );
    console.log(`✓ Revoked ${agent.tokenPrefix ?? "the ingest token"}.`);
  } catch (error) {
    console.error(
      `✗ Could not revoke the token: ${
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "unknown error"
      }`,
    );
    console.error("  The local configuration was still removed.");
  }
}
