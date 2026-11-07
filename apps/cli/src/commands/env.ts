import type { AgentComponent } from "../lib/agents.js";
import { hasAgentSkills } from "../lib/agent-skills.js";
import { findMachineTelemetry, surveyAgents } from "../lib/agents.js";
import { ApiError, get } from "../lib/api.js";
import { readMarketplacePlugin } from "../lib/claude-plugin.js";
import { describeEnvironment } from "../lib/cli-environment.js";
import {
  getAgentConfig,
  getChosenApiUrl,
  getToken,
  isLoggedIn,
  knownApiUrls,
  setAgentConfig,
  setChosenApiUrl,
  setRuntimeEnvironment,
} from "../lib/config.js";
import {
  environmentName,
  ENVIRONMENTS,
  resolveEnvironment,
} from "../lib/environment.js";
import { labelled } from "../lib/format.js";
import { runningScript } from "../lib/install-method.js";
import {
  BOARD_TOPICS,
  realtimeDir,
  restartWatcher,
} from "../lib/realtime-watch.js";
import { runAgentSetup } from "./agent/setup.js";
import { runLogin } from "./login.js";

const describe = (apiUrl: string) => `${environmentName(apiUrl)} (${apiUrl})`;

export function envCommand(options: { json?: boolean }): void {
  const current = describeEnvironment();
  if (options.json) {
    console.log(JSON.stringify(current));
    return;
  }
  const chosen = getChosenApiUrl();
  console.log(
    labelled(
      "Environment",
      `${describe(current.apiUrl)}${current.isProduction ? "" : "  — not production"}`,
    ),
  );
  if (current.apiUrl !== chosen) {
    console.log(
      labelled(
        "",
        `for this command only (${process.env.CLOCKTOPUS_API_URL ? "CLOCKTOPUS_API_URL" : "--env"}); 'env use' chose ${describe(chosen)}`,
      ),
    );
  }
  console.log(
    labelled(
      "CLI",
      `${current.cli.version}  ${current.cli.isCheckout ? `checkout ${current.cli.path ?? ""}` : current.cli.installMethod}`.trimEnd(),
    ),
  );
  console.log("");
  for (const apiUrl of knownApiUrls()) {
    const marks = [
      getToken(apiUrl) ? "signed in" : null,
      getAgentConfig(apiUrl).endpoint ? "agents set up" : null,
    ].filter(Boolean);
    console.log(
      `${apiUrl === current.apiUrl ? "▸" : " "} ${environmentName(apiUrl).padEnd(10)} ${apiUrl}${marks.length > 0 ? `  (${marks.join(", ")})` : ""}`,
    );
  }
  console.log(
    `\nSwitch with: clocktopus env use <${Object.keys(ENVIRONMENTS).join("|")}|url>`,
  );
}

// Points everything at `value` (the chosen environment when left out), with
// this CLI: the login, agent telemetry and hooks, MCP servers, the Claude
// plugin and the realtime watcher. The panels read through the CLI, so they
// follow on their next refresh.
export async function envUseCommand(value: string | undefined): Promise<void> {
  const target =
    value === undefined ? getChosenApiUrl() : resolveEnvironment(value);
  if (!target) {
    console.error(
      `Unknown environment: ${value}. Use ${Object.keys(ENVIRONMENTS).join(", ")} or an http(s) URL.`,
    );
    process.exit(1);
  }
  if (process.env.CLOCKTOPUS_API_URL) {
    console.error(
      "CLOCKTOPUS_API_URL is set, which overrides the environment for every command run with it. Unset it.",
    );
    process.exit(1);
  }

  // Nothing is written until the environment answers for a login; setup then
  // moves the agents, and any it couldn't is reported below.
  setRuntimeEnvironment(target);
  const session = await sessionOn();
  if (session.status === "unreachable") {
    console.error(
      `Couldn't reach ${describe(target)}: ${session.message}. Nothing was changed.`,
    );
    process.exit(1);
  }
  if (session.status === "signed_out") {
    if (!process.stdin.isTTY) {
      console.error(
        `Not signed in to ${describe(target)}. Run 'clocktopus --env ${target} login', then switch again.`,
      );
      process.exit(1);
    }
    console.log(`Sign in to ${describe(target)} first.\n`);
    const login = await runLogin();
    if (!login.ok) {
      console.error(`\n${login.message}`);
      process.exit(1);
    }
    console.log("");
  }

  const survey = surveyAgents();
  rememberMachineIngestToken(survey);
  const configured = survey.filter((entry) => entry.configured);
  const problems: string[] = [];
  if (configured.length > 0) {
    const component = installedComponents(configured);
    const result = await runAgentSetup({
      agent: configured.map((entry) => entry.agent.id),
      component: component.length > 0 ? component : ["none"],
      showRepoStatus: false,
    });
    // `runAgentSetup` fails only before it has written any agent's config.
    if (result.status === "failed") {
      console.error(
        `${result.message}\nThe machine stays on ${describe(getChosenApiUrl())}.`,
      );
      process.exit(1);
    }
    if (result.status === "configured") {
      const stayed = configured
        .map((entry) => entry.agent.id)
        .filter((id) => !result.agents.includes(id));
      if (stayed.length > 0) {
        problems.push(
          `✗ ${stayed.join(", ")} still point at ${describe(getChosenApiUrl())}; run 'clocktopus agent setup --agent ${stayed.join(",")}'.`,
        );
      }
      if (!result.receiverAccepted) {
        problems.push(
          "✗ The receiver did not accept the token; run 'clocktopus agent setup --force'.",
        );
      }
    }
  }

  setChosenApiUrl(target);
  console.log(`\nClocktopus now uses ${describe(target)}.`);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exitCode = 1;
  if (configured.length === 0) {
    console.log(
      "No coding agent reports to Clocktopus here; 'clocktopus agent setup' sets them up.",
    );
  }

  const script = runningScript();
  if (script) {
    const restarted = await restartWatcher({
      dir: realtimeDir(),
      topics: BOARD_TOPICS,
      argv: [script, "realtime", "watch"],
    });
    if (!restarted) {
      console.log(
        "\nThe realtime watcher didn't stop; the panels follow the new environment once it does.",
      );
    }
  }
}

async function sessionOn(): Promise<
  | { status: "signed_in" | "signed_out" }
  | { status: "unreachable"; message: string }
> {
  if (!isLoggedIn()) return { status: "signed_out" };
  try {
    await get("/api/auth/me");
    return { status: "signed_in" };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { status: "signed_out" };
    }
    return {
      status: "unreachable",
      message: error instanceof Error ? error.message : "unknown error",
    };
  }
}

// The agents' ingest token belongs to the environment whose receiver they
// report to; saved there, switching back reinstalls it instead of minting.
function rememberMachineIngestToken(
  survey: ReturnType<typeof surveyAgents>,
): void {
  const machine = findMachineTelemetry(survey);
  if (!machine?.endpoint) return;
  const endpoint = machine.endpoint.replace(/\/$/, "");
  const owner = knownApiUrls().find(
    (apiUrl) =>
      getAgentConfig(apiUrl).endpoint?.replace(/\/$/, "") === endpoint,
  );
  if (owner) setAgentConfig({ ingestToken: machine.token }, owner);
}

// What `agent setup` left here besides telemetry and hooks, so a switch
// installs the same.
function installedComponents(
  configured: ReturnType<typeof surveyAgents>,
): AgentComponent[] {
  let plugin: ReturnType<typeof readMarketplacePlugin> = null;
  try {
    plugin = readMarketplacePlugin();
  } catch {
    // An unreadable plugin folder is rebuilt only if MCP is found elsewhere.
  }
  const hasMcp =
    plugin?.apiUrl != null ||
    configured.some((entry) => {
      try {
        return Boolean(entry.agent.read().mcpUrl);
      } catch {
        return false;
      }
    });
  return [
    ...(hasMcp ? (["mcp"] as const) : []),
    ...(plugin?.skills || hasAgentSkills() ? (["skills"] as const) : []),
    ...(plugin?.panel ? (["panel"] as const) : []),
  ];
}
