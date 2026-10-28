import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const PACKAGE = "@blastin-dev/clocktopus-cli";
export const MISE_TOOL = `npm:${PACKAGE}`;

export type InstallMethod =
  | "mise"
  | "pnpm"
  | "bun"
  | "yarn"
  | "npm"
  | "npx"
  | "checkout"
  | "unknown";

// mise installs an npm package under `<data dir>/installs/npm-<name>/<version>`
// and puts one shim per executable in `<data dir>/shims`; group 1 is the data dir.
export const MISE_INSTALL = /^(.*)\/installs\/npm-[^/]*clocktopus-cli\//i;

// Tested in order against the real path of the running script, with `/` as the
// separator and case ignored for Windows: npx and mise unpack an npm package
// too, so they come before npm.
const LAYOUTS: Array<[InstallMethod, RegExp]> = [
  ["npx", /\/_npx\//i],
  ["mise", MISE_INSTALL],
  ["bun", /\/\.bun\/install\/global\//i],
  ["pnpm", /\/pnpm\/global\//i],
  ["yarn", /\/yarn\/(?:data\/)?global\//i],
  ["npm", /\/node_modules\/@blastin-dev\/clocktopus-cli\//i],
];

// The running CLI's script, absolute; null when node was given none.
export function runningScript(): string | null {
  return process.argv[1] ? resolve(process.argv[1]) : null;
}

export function installMethodOf(scriptPath: string): InstallMethod {
  const path = scriptPath.replaceAll("\\", "/");
  for (const [method, layout] of LAYOUTS) {
    if (layout.test(path)) {
      // A project's own `node_modules` is not a global install.
      if (method === "npm" && !isGlobalNpmPath(path)) return "unknown";
      return method;
    }
  }
  return path.includes("/node_modules/") ? "unknown" : "checkout";
}

// npm's global prefix keeps packages in `<prefix>/lib/node_modules` on Unix and
// `<prefix>/node_modules` under `%APPDATA%\npm` on Windows.
function isGlobalNpmPath(path: string) {
  return /\/(?:lib|npm)\/node_modules\/@blastin-dev\/clocktopus-cli\//i.test(
    path,
  );
}

export function currentInstallMethod(): InstallMethod {
  const script = runningScript();
  if (!script) return "unknown";
  try {
    return installMethodOf(realpathSync(script));
  } catch {
    return installMethodOf(script);
  }
}

const UPGRADABLE = ["mise", "pnpm", "bun", "yarn", "npm"] as const;
export type UpgradableMethod = (typeof UPGRADABLE)[number];

// An install `upgradeArgv` can upgrade in place, which is also one whose hooks
// `agent refresh` may point at the running script.
export function isUpgradable(
  method: InstallMethod,
): method is UpgradableMethod {
  return UPGRADABLE.some((upgradable) => upgradable === method);
}

// The argv that upgrades the CLI where `method` installed it. `bump` lets mise
// move past a version the config pins, rewriting the config.
export function upgradeArgv(
  method: UpgradableMethod,
  options: { bump?: boolean } = {},
): string[] {
  const latest = `${PACKAGE}@latest`;
  switch (method) {
    case "mise":
      return [
        "mise",
        "upgrade",
        MISE_TOOL,
        ...(options.bump ? ["--bump"] : []),
      ];
    case "pnpm":
      return ["pnpm", "add", "-g", latest];
    case "bun":
      return ["bun", "add", "-g", latest];
    case "yarn":
      return ["yarn", "global", "add", latest];
    case "npm":
      return ["npm", "install", "-g", latest];
  }
}
