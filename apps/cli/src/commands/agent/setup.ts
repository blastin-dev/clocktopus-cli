import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { cancel, isCancel, log, multiselect } from "@clack/prompts";
import {
  AgentEndpointSchema,
  IngestTokenSchema,
} from "@repo/cli-contract/agent";
import { UserSchema } from "@repo/cli-contract/user";

import type { AgentComponent, AgentSurvey } from "../../lib/agents.js";
import {
  findShadowedExports,
  maskToken,
  resolveHookCommand,
} from "../../lib/agent-config.js";
import { verifyReceiver } from "../../lib/agent-receiver.js";
import { agentSkillsDir, installAgentSkills } from "../../lib/agent-skills.js";
import {
  AGENT_COMPONENTS,
  findMachineTelemetry,
  surveyAgents,
} from "../../lib/agents.js";
import { ApiError, get, post } from "../../lib/api.js";
import {
  CLAUDE_PLUGIN_ID,
  cliVersion,
  installClaudePlugin,
} from "../../lib/claude-plugin.js";
import { getApiUrl, isLoggedIn, setAgentConfig } from "../../lib/config.js";
import { contextCommandFor } from "../../lib/context-hook.js";
import { labelled } from "../../lib/format.js";
import { mcpServerUrl } from "../../lib/mcp-server.js";
import { fetchRepoStatus, renderRepoBlock } from "../../lib/repo-guidance.js";

export type AgentSetupOptions = {
  name?: string;
  force?: boolean;
  agent?: string[];
  component?: string[];
  // `init` prints the repository's lanes itself, after every step.
  showRepoStatus?: boolean;
};

export type AgentSetupResult =
  | { status: "configured"; agents: string[]; receiverAccepted: boolean }
  | { status: "none_installed" }
  | { status: "nothing_selected" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

// Each agent's settings go only into that agent's own config, so `agent doctor` can say
// which value is in force. Re-running keeps the existing token unless `--force`.
export async function setupCommand(options: AgentSetupOptions): Promise<void> {
  const result = await runAgentSetup(options);
  switch (result.status) {
    case "none_installed": {
      const survey = surveyAgents();
      console.error("No supported coding agent found on PATH.");
      console.error(
        `\nClocktopus can track: ${survey
          .map((entry) => `${entry.agent.label} (${entry.agent.binary})`)
          .join(", ")}.`,
      );
      console.error(
        "Install one, or re-run with --agent <id> if yours lives somewhere PATH\ncannot see.",
      );
      process.exit(1);
      break;
    }
    case "failed":
      console.error(result.message);
      process.exit(1);
      break;
    case "nothing_selected":
      console.log("Nothing selected — no configuration was changed.");
      break;
    case "cancelled":
      cancel("Setup cancelled — no configuration was changed.");
      break;
    case "configured":
      console.log("\nThen confirm it end to end:  clocktopus agent status");
      break;
  }
}

// `setupCommand` without the exits, so `init` can run it as one of its steps.
export async function runAgentSetup(
  options: AgentSetupOptions,
): Promise<AgentSetupResult> {
  if (!isLoggedIn()) {
    return {
      status: "failed",
      message: "Not logged in. Run 'clocktopus login' first.",
    };
  }

  const survey = surveyAgents();

  const unreadable = survey.filter((entry) => entry.unreadable);
  if (unreadable.length > 0) {
    return {
      status: "failed",
      message: unreadable.map((entry) => `✗ ${entry.unreadable}`).join("\n"),
    };
  }

  const installed = survey.filter((entry) => entry.installed);
  if (installed.length === 0) return { status: "none_installed" };

  const selection = await selectAgents(survey, installed, options.agent);
  if (selection.status !== "selected") return selection;
  const selected = selection.values;
  if (selected.length === 0) return { status: "nothing_selected" };

  const componentSelection = await selectComponents(options.component);
  if (componentSelection.status !== "selected") return componentSelection;
  const mcp = componentSelection.values.includes("mcp");
  const skills = componentSelection.values.includes("skills");

  let email: string | null = null;
  let userId: string;
  let endpoint: string;

  try {
    const [user, endpointResponse] = await Promise.all([
      get("/api/auth/me").then((data) => UserSchema.parse(data)),
      get("/api/agent/ingest-token").then((data) =>
        AgentEndpointSchema.parse(data),
      ),
    ]);
    email = user.user.email;
    userId = user.user.id;
    endpoint = endpointResponse.endpoint;
  } catch (error) {
    return {
      status: "failed",
      message: describeApiFailure(error, "Failed to reach Clocktopus"),
    };
  }

  // One token per machine: every mint leaves another live token on the account.
  let token = options.force
    ? null
    : (findMachineTelemetry(survey)?.token ?? null);
  let tokenId: string | null = null;
  let minted = false;

  if (token) {
    const check = await verifyReceiver(endpoint, token);
    if (!check.ok) {
      console.log(
        check.reason === "invalid_token"
          ? "Existing token was rejected by the receiver — minting a replacement."
          : "Could not confirm the existing token — minting a replacement.",
      );
      token = null;
    } else if (check.userId !== null && check.userId !== userId) {
      console.log(
        `The token on this machine reports to another Clocktopus account — minting one for ${email}.`,
      );
      token = null;
    }
  }

  if (!token) {
    try {
      const response = await post("/api/agent/ingest-token", {
        name: options.name ?? hostname(),
      }).then((data) => IngestTokenSchema.parse(data));

      token = response.token;
      tokenId = response.tokenId;
      endpoint = response.endpoint;
      minted = true;
    } catch (error) {
      return {
        status: "failed",
        message: describeApiFailure(error, "Failed to mint an ingest token"),
      };
    }
  }

  const configured: Array<{
    entry: AgentSurvey;
    hookCommand: string;
    hookUsesAbsolutePath: boolean;
    backupPaths: string[];
    warnings: string[];
  }> = [];

  const apiUrl = getApiUrl();
  for (const entry of selected) {
    const hook = resolveHookCommand(entry.agent.provider);

    try {
      const { backupPaths, warnings = [] } = entry.agent.apply({
        token,
        endpoint,
        hookCommand: hook.command,
        apiUrl,
        mcp,
      });
      configured.push({
        entry,
        hookCommand: hook.command,
        hookUsesAbsolutePath: hook.usesAbsolutePath,
        backupPaths,
        warnings,
      });
    } catch (error) {
      // One agent failing must not strand the others half-configured.
      console.error(
        `✗ ${entry.agent.label}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  if (configured.length === 0) {
    return { status: "failed", message: "\nNothing was configured." };
  }

  setAgentConfig({
    tokenId: tokenId ?? undefined,
    tokenPrefix: maskToken(token),
    endpoint,
    configuredAt: new Date().toISOString(),
  });

  const check = await verifyReceiver(endpoint, token);

  console.log("\nClocktopus agent telemetry\n");
  if (email) console.log(labelled("Account", email));
  console.log(labelled("Receiver", endpoint));
  console.log(
    labelled(
      "Token",
      `${maskToken(token)}${minted ? "  (new)" : "  (reused)"}`,
    ),
  );

  for (const { entry, hookCommand, backupPaths, warnings } of configured) {
    console.log(`\n${entry.agent.label} ${entry.version ?? ""}`.trimEnd());
    for (const path of entry.agent.paths()) {
      console.log(labelled("Config", path));
    }
    console.log(labelled("Hook", `${hookCommand}  (SessionStart, SessionEnd)`));
    if (entry.agent.runsContextHook) {
      console.log(
        labelled("", `${contextCommandFor(hookCommand)}  (SessionStart)`),
      );
    }
    for (const backup of backupPaths) console.log(labelled("Backup", backup));
    if (entry.agent.id === "claude") {
      if (mcp || skills) {
        for (const line of setUpClaudePlugin(entry.installed, { mcp, skills }))
          console.log(line);
      }
    } else if (mcp && warnings.length === 0) {
      console.log(labelled("MCP server", mcpServerUrl(apiUrl)));
      console.log(labelled("", `Sign in once with: ${entry.agent.mcpSignIn}`));
    }
    for (const warning of warnings) console.log(labelled("", `✗ ${warning}`));
  }

  const sharing = skills
    ? configured.filter(({ entry }) => entry.agent.usesSharedSkills)
    : [];
  if (sharing.length > 0) {
    console.log(
      `\nSkills for ${labelList(sharing.map(({ entry }) => entry.agent.label))}`,
    );
    for (const line of setUpSharedSkills()) console.log(line);
  }

  console.log("");
  console.log(
    check.ok
      ? "✓ The receiver accepted this token."
      : `✗ The receiver did not accept this token (${describeCheck(check)}).`,
  );

  // Sessions are attributed only if the repository maps to a project, which this
  // machine's config cannot fix.
  if (options.showRepoStatus !== false) {
    const repoStatus = await fetchRepoStatus();
    if (repoStatus) {
      for (const line of renderRepoBlock(repoStatus)) console.log(line);
    }
  }

  for (const warning of collectWarnings(configured)) {
    console.log(`\n${warning}`);
  }

  console.log(
    `\nRestart ${labelList(configured.map((c) => c.entry.agent.label))} — the exporter and the hook\nread their configuration once, at process start.`,
  );

  for (const { entry } of configured) {
    for (const action of entry.agent.pendingActions()) {
      console.log(`\n→ ${entry.agent.label}: ${action}`);
    }
  }

  return {
    status: "configured",
    agents: configured.map(({ entry }) => entry.agent.id),
    receiverAccepted: check.ok,
  };
}

// Telemetry and hooks above do not depend on the skills, so a failure here is
// reported and setup carries on.
function setUpSharedSkills(): string[] {
  try {
    const names = installAgentSkills();
    return [
      labelled("Installed", `${names.join(", ")} in ${agentSkillsDir()}`),
    ];
  } catch (error) {
    return [
      labelled(
        "Installed",
        `✗ ${error instanceof Error ? error.message : "unknown error"}`,
      ),
    ];
  }
}

// Skills and the MCP server ride in the plugin; telemetry and hooks above do
// not depend on it, so a failure here is reported and setup carries on.
function setUpClaudePlugin(
  claudeOnPath: boolean,
  include: { mcp: boolean; skills: boolean },
): string[] {
  if (!claudeOnPath) {
    return [
      labelled(
        "Plugin",
        "skipped — 'claude' is not on PATH; re-run setup once it is",
      ),
    ];
  }
  const version = cliVersion();
  const result = installClaudePlugin({
    version,
    apiUrl: getApiUrl(),
    ...include,
  });
  if (!result.ok) return [labelled("Plugin", `✗ ${result.reason}`)];
  const carries = [
    ...(include.skills ? ["skills"] : []),
    ...(include.mcp ? ["MCP server"] : []),
  ].join(" and ");
  return [
    labelled("Plugin", `${CLAUDE_PLUGIN_ID} ${version}  (${carries})`),
    ...(include.mcp
      ? [labelled("", "Sign in to its MCP server with /mcp in Claude Code")]
      : []),
  ];
}

type Selection<T> =
  | { status: "selected"; values: T[] }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

// Prompts only in a TTY without `--agent`.
async function selectAgents(
  survey: AgentSurvey[],
  installed: AgentSurvey[],
  requested: string[] | undefined,
): Promise<Selection<AgentSurvey>> {
  if (requested && requested.length > 0) {
    const ids = requested.flatMap((value) =>
      value.split(",").map((part) => part.trim().toLowerCase()),
    );
    const chosen = survey.filter((entry) => ids.includes(entry.agent.id));

    const unknown = ids.filter(
      (id) => !survey.some((entry) => entry.agent.id === id),
    );
    if (unknown.length > 0) {
      return {
        status: "failed",
        message: `Unknown agent: ${unknown.join(", ")}. Valid ids: ${survey
          .map((entry) => entry.agent.id)
          .join(", ")}.`,
      };
    }

    // Not filtered by `installed`: the agent picks up the config once it is on PATH.
    for (const entry of chosen) {
      if (!entry.installed) {
        console.log(
          `⚠ ${entry.agent.label} was not found on PATH — configuring it anyway.`,
        );
      }
    }
    return { status: "selected", values: chosen };
  }

  if (!process.stdin.isTTY) {
    console.log(
      `Configuring every agent found: ${labelList(
        installed.map((entry) => entry.agent.label),
      )}.\nPass --agent <id> to narrow it.`,
    );
    return { status: "selected", values: installed };
  }

  // Agents missing from PATH stay selectable: they pick the config up once installed.
  const ids = await multiselect({
    message: "Which agents should report to Clocktopus?",
    options: survey.map((entry) => ({
      value: entry.agent.id,
      label: entry.agent.label,
      hint: [
        entry.installed ? entry.version : "not on PATH",
        entry.configured ? "already configured" : null,
      ]
        .filter(Boolean)
        .join(", "),
    })),
    initialValues: installed.map((entry) => entry.agent.id),
    required: false,
  });
  if (isCancel(ids)) return { status: "cancelled" };
  return {
    status: "selected",
    values: survey.filter((entry) => ids.includes(entry.agent.id)),
  };
}

// Every component unless narrowed by `--component` or the prompt.
async function selectComponents(
  requested: string[] | undefined,
): Promise<Selection<AgentComponent>> {
  if (requested && requested.length > 0) {
    const names = requested.flatMap((value) =>
      value.split(",").map((part) => part.trim().toLowerCase()),
    );
    if (names.includes("none")) return { status: "selected", values: [] };
    const unknown = names.filter(
      (name) => !AGENT_COMPONENTS.some((component) => component === name),
    );
    if (unknown.length > 0) {
      return {
        status: "failed",
        message: `Unknown component: ${unknown.join(", ")}. Valid: ${AGENT_COMPONENTS.join(", ")}, none.`,
      };
    }
    return {
      status: "selected",
      values: AGENT_COMPONENTS.filter((component) => names.includes(component)),
    };
  }

  if (!process.stdin.isTTY) {
    return { status: "selected", values: [...AGENT_COMPONENTS] };
  }

  log.info(
    "Telemetry and the session hooks are always installed. The hook tells\n" +
      "Clocktopus which repository a session worked in; without it, spend\n" +
      "cannot be counted towards a project or task.",
  );
  const components = await multiselect<AgentComponent>({
    message: "What else should setup install?",
    options: [
      {
        value: "mcp",
        label: "MCP server",
        hint: "lets the agent read and update Clocktopus tasks and goals",
      },
      {
        value: "skills",
        label: "Skills",
        hint: "create-task, start-work, refine and create-goal",
      },
    ],
    initialValues: [...AGENT_COMPONENTS],
    required: false,
  });
  return isCancel(components)
    ? { status: "cancelled" }
    : { status: "selected", values: components };
}

function collectWarnings(
  configured: Array<{
    entry: AgentSurvey;
    hookUsesAbsolutePath: boolean;
  }>,
): string[] {
  const warnings: string[] = [];

  // Only Claude Code applies config `env` over the inherited environment.
  if (configured.some(({ entry }) => entry.agent.id === "claude")) {
    const shadowed = findShadowedExports();
    if (shadowed.length > 0) {
      const lines = shadowed
        .map(({ path, keys }) => `    ${path} — ${keys.join(", ")}`)
        .join("\n");
      warnings.push(
        `⚠ These files export the same variables:\n${lines}\n` +
          "  settings.json is applied over the inherited environment, so those\n" +
          "  exports are now ignored inside Claude Code. Remove them — two\n" +
          "  sources that disagree is how spend ends up on the wrong account.",
      );
    }
  }

  const versioned = new Set<string>();
  for (const { entry } of configured) {
    for (const path of entry.agent.paths()) {
      const dir = dirname(path);
      if (existsSync(join(dir, ".git"))) versioned.add(dir);
    }
  }
  for (const dir of versioned) {
    warnings.push(
      `⚠ ${dir} is a git repository, and its config now holds your ingest\n` +
        "  token in plaintext. Ignore the file, or revoke with\n" +
        "  'clocktopus agent disable --revoke' if it gets committed.",
    );
  }

  const absolute = configured.filter((c) => c.hookUsesAbsolutePath);
  if (absolute.length > 0) {
    warnings.push(
      "⚠ 'clocktopus' is not on PATH as this executable, so the hook was\n" +
        "  installed with an absolute path. Reinstalling the CLI elsewhere will\n" +
        "  break it — re-run 'clocktopus agent setup' if that happens.",
    );
  }

  return warnings;
}

function labelList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function describeCheck(
  check: Exclude<Awaited<ReturnType<typeof verifyReceiver>>, { ok: true }>,
): string {
  switch (check.reason) {
    case "invalid_token":
      return "401 — token unknown or revoked";
    case "unexpected_status":
      return `HTTP ${check.status}`;
    case "unreachable":
      return check.message;
  }
}

function describeApiFailure(error: unknown, prefix: string): string {
  if (error instanceof ApiError && error.status === 401) {
    return "Session expired. Run 'clocktopus login' again.";
  }
  return `${prefix}: ${error instanceof Error ? error.message : "unknown error"}`;
}
