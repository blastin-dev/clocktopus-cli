import { createRequire } from "node:module";
import { Command } from "commander";
import { z } from "zod";

import type { InitOptions } from "./commands/init/types.js";
import type { Environment } from "./lib/config.js";
import { contextCommand } from "./commands/agent/context.js";
import { disableCommand } from "./commands/agent/disable.js";
import { doctorCommand } from "./commands/agent/doctor.js";
import { hookCommand } from "./commands/agent/hook.js";
import { refreshCommand } from "./commands/agent/refresh.js";
import { setupCommand } from "./commands/agent/setup.js";
import { statusCommand } from "./commands/agent/status.js";
import {
  clockInCommand,
  clockOutCommand,
  clockStatusCommand,
} from "./commands/clock.js";
import { initCommand } from "./commands/init/index.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { whoamiCommand } from "./commands/whoami.js";
import { refreshIfUpgraded } from "./lib/agent-refresh.js";
import { ENVIRONMENTS, setRuntimeEnvironment } from "./lib/config.js";

const require = createRequire(import.meta.url);
const parsedJson = z
  .object({ version: z.string() })
  .safeParse(require("../../package.json"));

const version = parsedJson.success ? parsedJson.data.version : "0.0.0";

// Commands that refresh what `agent setup` installed themselves, or must not be
// held up: the hooks print to the agent, and `agent hook` refreshes on its own.
const REFRESHES_ITSELF = new Set([
  "init",
  "agent setup",
  "agent disable",
  "agent refresh",
  "agent hook",
  "agent context",
  "upgrade",
]);

/** Lets `--agent` be repeated as well as comma-separated. */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

const program = new Command();

program
  .name("clocktopus")
  .description("CLI for Clocktopus time tracking")
  .version(version)
  .option("-e, --env <environment>", "Use environment (dev, staging or prod)")
  .hook("preAction", (thisCommand, actionCommand) => {
    const opts = thisCommand.opts();
    if (opts.env) {
      if (!(opts.env in ENVIRONMENTS)) {
        console.error(
          `Invalid environment: ${opts.env}. Use 'dev', 'staging' or 'prod'.`,
        );
        process.exit(1);
      }
      setRuntimeEnvironment(opts.env as Environment);
    }
    const name = [
      actionCommand.parent?.parent ? actionCommand.parent.name() : null,
      actionCommand.name(),
    ]
      .filter(Boolean)
      .join(" ");
    if (
      !REFRESHES_ITSELF.has(name) &&
      refreshIfUpgraded(opts.env) &&
      process.stderr.isTTY
    ) {
      console.error(
        `Clocktopus CLI ${version}: bringing what 'agent setup' installed up to date in the background.`,
      );
    }
  });

program
  .command("login")
  .description("Authenticate with Clocktopus using device authorization")
  .action(loginCommand);

program
  .command("init")
  .description(
    "Set up this checkout: you, the project, the repository connection, your git email and agents, then verify",
  )
  .option("-y, --yes", "Take every default without asking")
  .option(
    "--skip <steps>",
    "Skip steps: you, project, repository, email, agents, verify. Repeatable or comma-separated.",
    collect,
  )
  .option(
    "--only <steps>",
    "Run only these steps, such as --only verify --test-push. Repeatable or comma-separated.",
    collect,
  )
  .option("--timezone <tz>", "Your timezone (default: this machine's)")
  .option("--hours <start-end>", "Your usual day, such as 9-17 or 08:30-17:00")
  .option("--working-hours", "You work set hours (the default)")
  .option("--no-working-hours", "Your hours vary")
  .option("--organization <name>", "Use this organisation (id, slug or name)")
  .option("--new-organization <name>", "Create an organisation with this name")
  .option(
    "--project <name>",
    "Attach the repository to this project (id or name)",
  )
  .option("--new-project <name>", "Create a project with this name")
  .option(
    "--connect <how>",
    "Connect the repository with: app, gh, manual or skip",
  )
  .option(
    "--track-email",
    "Track this checkout's git email if it is not yours yet",
  )
  .option("--no-track-email", "Do not track this checkout's git email")
  .option(
    "-a, --agent <ids>",
    "Configure only these agents (claude, codex, opencode, cursor). Repeatable or comma-separated.",
    collect,
  )
  .option(
    "-c, --component <names>",
    "Install only these besides telemetry and hooks (mcp, skills, panel, or none; panel needs mcp). Repeatable or comma-separated.",
    collect,
  )
  .option("--test-push", "Push an empty commit to verify delivery")
  .option(
    "--delete-old-hook",
    "Delete your repository webhook when the GitHub App also delivers",
  )
  .action((options: InitOptions) => initCommand(options));

program
  .command("upgrade")
  .description(
    "Upgrade the CLI with whatever installed it (mise, npm, pnpm, bun or yarn), then refresh what 'agent setup' installed",
  )
  .option("-y, --yes", "Upgrade without asking")
  .option(
    "--bump",
    "Under mise, move past a pinned version and update the config",
  )
  .action((options: { yes?: boolean; bump?: boolean }) =>
    upgradeCommand(options),
  );

program
  .command("logout")
  .description("Log out and clear stored credentials")
  .action(logoutCommand);

program
  .command("whoami")
  .description("Display the currently logged in user")
  .action(whoamiCommand);

const clock = program
  .command("clock")
  .description("Record clock-in and clock-out signals");

clock
  .command("in")
  .description("Record clock-in for today (optionally backdated)")
  .option(
    "--ago <duration>",
    "Backdate by a duration relative to now (e.g. 45m, 1h, 1h30m)",
  )
  .option(
    "--at <time>",
    "Backdate to an absolute time in your timezone (HH:mm or HH:mm:ss)",
  )
  .action((options: { ago?: string; at?: string }) => clockInCommand(options));

clock
  .command("out")
  .description("Record clock-out for today (optionally backdated)")
  .option(
    "--ago <duration>",
    "Backdate by a duration relative to now (e.g. 45m, 1h, 1h30m)",
  )
  .option(
    "--at <time>",
    "Backdate to an absolute time in your timezone (HH:mm or HH:mm:ss)",
  )
  .action((options: { ago?: string; at?: string }) => clockOutCommand(options));

clock
  .command("status")
  .description("Show clock signals for a specific date")
  .option("-d, --date <date>", "Date in YYYY-MM-DD format (default: today)")
  .action(clockStatusCommand);

const agent = program
  .command("agent")
  .description("Track AI agent spend from this machine");

agent
  .command("setup")
  .description(
    "Point your coding agents at Clocktopus and install the session hooks",
  )
  .option("--name <name>", "Label for this machine's ingest token")
  .option(
    "--force",
    "Mint a replacement token instead of reusing the existing one",
  )
  .option(
    "-a, --agent <ids>",
    "Configure only these agents (claude, codex, opencode, cursor). Repeatable or comma-separated.",
    collect,
  )
  .option(
    "-c, --component <names>",
    "Install only these besides telemetry and hooks (mcp, skills, panel, or none; panel needs mcp). Repeatable or comma-separated.",
    collect,
  )
  .action(
    (options: {
      name?: string;
      force?: boolean;
      agent?: string[];
      component?: string[];
    }) => setupCommand(options),
  );

agent
  .command("status")
  .description("Show what the receiver has actually received")
  .action(statusCommand);

agent
  .command("doctor")
  .description("Check every link in the telemetry chain and report failures")
  .action(doctorCommand);

agent
  .command("disable")
  .description("Remove this machine's telemetry configuration")
  .option("--revoke", "Also revoke the ingest token, everywhere")
  .option(
    "-a, --agent <ids>",
    "Remove only these agents (claude, codex, opencode, cursor). Repeatable or comma-separated.",
    collect,
  )
  .action((options: { revoke?: boolean; agent?: string[] }) =>
    disableCommand(options),
  );

agent
  .command("refresh")
  .description(
    "Bring what 'agent setup' installed up to this CLI's version, changing nothing else",
  )
  .option("--quiet", "Print nothing")
  .action((options: { quiet?: boolean }) => refreshCommand(options));

// Hidden: invoked by an agent, never by a person.
agent
  .command("context", { hidden: true })
  .description("Internal: SessionStart hook that names the branch's task")
  .option("--provider <provider>", "Which agent installed this hook")
  .action((options: { provider?: string }) => contextCommand(options));

agent
  .command("hook", { hidden: true })
  .description("Internal: SessionStart/SessionEnd hook")
  .option("--provider <provider>", "Which agent installed this hook")
  // Set by `detachSelf` in `commands/agent/hook.ts` on the backgrounded copy.
  .option("--detached", "Internal: this is the backgrounded copy")
  .option(
    "--dry-run [file]",
    "Print each request to stderr, or append it to <file>, instead of sending it",
  )
  .action(
    (options: {
      provider?: string;
      detached?: boolean;
      dryRun?: boolean | string;
    }) => hookCommand(options),
  );

export function run(): void {
  program.parse();
}
