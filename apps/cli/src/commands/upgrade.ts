import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import type { SpawnSyncOptions } from "node:child_process";
import { confirm, isCancel } from "@clack/prompts";
import {
  CLI_LATEST_HEADER,
  CLI_NPM_UPGRADE_COMMAND,
  CLI_VERSION_HEADER,
  isCliVersionBelow,
} from "@repo/cli-contract/cli-version";
import { z } from "zod";

import type { InstallMethod, UpgradableMethod } from "../lib/install-method.js";
import { cliVersion } from "../lib/claude-plugin.js";
import {
  getApiUrl,
  getLatestVersion,
  rememberLatestVersion,
} from "../lib/config.js";
import {
  currentInstallMethod,
  isUpgradable,
  MISE_TOOL,
  runningScript,
  upgradeArgv,
} from "../lib/install-method.js";

const LOOKUP_TIMEOUT_MS = 5000;

// npm, pnpm and yarn are `.cmd` shims on Windows, which Node runs only through
// a shell; node itself needs none, and its path can hold spaces.
const shellFor = (command: string) =>
  process.platform === "win32" && command !== process.execPath;

// Where no install can be upgraded in place, what to do instead.
const NOT_UPGRADABLE: Record<
  Exclude<InstallMethod, UpgradableMethod>,
  string
> = {
  npx: "This CLI runs through npx, which fetches the version you name each time: run `npx @blastin-dev/clocktopus-cli@latest`.",
  checkout:
    "This CLI runs from a source checkout: pull and rebuild it (`pnpm --filter @blastin-dev/clocktopus-cli build`).",
  unknown: `Could not tell how this CLI was installed. Upgrade it with the tool that installed it, such as \`${CLI_NPM_UPGRADE_COMMAND}\`, then run \`clocktopus agent refresh\`.`,
};

export async function upgradeCommand(options: {
  yes?: boolean;
  bump?: boolean;
}): Promise<void> {
  const method = currentInstallMethod();
  if (!isUpgradable(method)) {
    console.error(NOT_UPGRADABLE[method]);
    process.exit(1);
  }
  const argv = upgradeArgv(method, { bump: options.bump });

  const current = cliVersion();
  const latest = (await lookUpLatest()) ?? getLatestVersion() ?? null;
  if (latest && !isCliVersionBelow(current, latest) && !options.bump) {
    console.log(`Clocktopus CLI ${current} is the latest.`);
    return;
  }

  const command = argv.join(" ");
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.error(
        `Would run: ${command}\nPass --yes to upgrade without a terminal.`,
      );
      process.exit(1);
    }
    const accepted = await confirm({
      message: `Upgrade Clocktopus CLI ${current} → ${latest ?? "the latest"} with ${command}?`,
    });
    if (isCancel(accepted) || !accepted) {
      console.log("Not upgraded.");
      return;
    }
  }

  const install = run(argv, [], { stdio: "inherit" });
  if (install.error || install.status !== 0) {
    console.error(
      `\n✗ ${command} ${install.error ? `could not run: ${install.error.message}` : "failed"}.`,
    );
    if (method === "npm") {
      console.error(
        "  On EACCES, point npm's global prefix at a folder you own rather than using sudo:\n  https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally",
      );
    }
    process.exit(1);
  }

  const binary = installedBinary(method);
  const upgraded = versionOf(binary);
  if (upgraded === null || upgraded === current) {
    console.log(`\nClocktopus CLI is still ${current}.`);
    const pin = method === "mise" ? misePin() : null;
    if (pin) {
      console.log(
        `${pin.path} pins ${MISE_TOOL} to ${pin.requested}. Run \`clocktopus upgrade --bump\` to move past it and update that file.`,
      );
    }
    return;
  }

  console.log(`\nClocktopus CLI ${current} → ${upgraded}`);
  // The new version's own refresh: this process still runs the old code.
  run(binary, ["agent", "refresh"], { stdio: "inherit" });
}

// The newest version the server names, which it sends on every answer, a
// refusal included; null when it can't be reached.
async function lookUpLatest(): Promise<string | null> {
  try {
    const response = await fetch(`${getApiUrl()}/api/auth/me`, {
      headers: { [CLI_VERSION_HEADER]: cliVersion() },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    const latest = response.headers.get(CLI_LATEST_HEADER);
    rememberLatestVersion(latest);
    return latest?.trim() || null;
  } catch {
    return null;
  }
}

// The executable the upgrade installed. npm, bun and yarn replace the package
// in place, so this script is it; pnpm and mise keep each version in its own
// folder, so they are asked.
function installedBinary(method: UpgradableMethod): string[] {
  const script = runningScript();
  if (method === "mise") {
    const which = output(["mise", "which", "clocktopus"]);
    if (which) return [which];
  }
  if (method === "pnpm") {
    const bin = output(["pnpm", "bin", "-g"]);
    if (bin) return [join(bin, "clocktopus")];
  }
  return script ? [process.execPath, script] : ["clocktopus"];
}

function versionOf(binary: string[]) {
  return (
    /\d+\.\d+\.\d+\S*/.exec(output([...binary, "--version"]) ?? "")?.[0] ?? null
  );
}

const MiseCurrentSchema = z.array(
  z.object({
    requested_version: z.string().optional(),
    source: z.object({ path: z.string() }).optional(),
  }),
);

// The version a mise config pins the CLI to, and the file; null when it asks
// for `latest` or mise can't say.
function misePin() {
  const text = output(["mise", "ls", "--current", "--json", MISE_TOOL]);
  if (!text) return null;
  try {
    const entry = MiseCurrentSchema.parse(JSON.parse(text))[0];
    if (!entry?.requested_version || entry.requested_version === "latest") {
      return null;
    }
    return {
      requested: entry.requested_version,
      path: entry.source?.path ?? "a mise config",
    };
  } catch {
    return null;
  }
}

function run(argv: string[], args: string[], options: SpawnSyncOptions) {
  const [command = "", ...rest] = argv;
  return spawnSync(command, [...rest, ...args], {
    ...options,
    shell: shellFor(command),
  });
}

function output(argv: string[]) {
  const [command = "", ...args] = argv;
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      shell: shellFor(command),
    }).trim();
  } catch {
    return null;
  }
}
