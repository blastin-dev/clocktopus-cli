import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isVersionBelow } from "@repo/cli-contract/cli-version";
import { z } from "zod";

import { MCP_SERVER_NAME, mcpServerUrl } from "./mcp-server.js";

const PACKAGE_NAME = "@blastin-dev/clocktopus-cli";
const MARKETPLACE_NAME = "clocktopus";
const PLUGIN_NAME = "clocktopus";
export const CLAUDE_PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

// The repository is private, so Claude Code cannot add a marketplace from it.
// The plugin ships in this package instead and is installed from a folder in
// the user's home, which Claude Code loads in place.
export function marketplaceDir() {
  return join(homedir(), ".clocktopus", "claude-marketplace");
}

// The package root holds `claude-plugin/` beside `dist/`, whether this runs
// from `dist/bin` or from `src/lib`.
export function packageRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const { name } = z
        .object({ name: z.string().optional() })
        .parse(JSON.parse(readFileSync(manifest, "utf8")));
      if (name === PACKAGE_NAME) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${PACKAGE_NAME} root not found`);
    dir = parent;
  }
}

export function cliVersion() {
  const { version } = z
    .object({ version: z.string() })
    .parse(
      JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")),
    );
  return version;
}

export function pluginSourceDir() {
  return join(packageRoot(), "claude-plugin");
}

const PluginManifestSchema = z.looseObject({
  name: z.string(),
  types: z.string().optional(),
});

// The Claude Code version the hooks module is type-checked and tested
// against, which the first line of `types/claude-code/index.d.ts` names (a
// test holds the two equal). Function hooks are early access and change between
// releases, so an older Claude Code doesn't get the panel.
export const PANEL_MIN_CLAUDE_VERSION = "2.1.310";

// Why the panel can't be installed with this Claude Code, or null when it can.
// `version` is the output of `claude --version`, null when it didn't run.
export function panelUnsupportedReason(version: string | null) {
  if (version === null) return "'claude --version' did not run";
  const found = /\d+\.\d+\.\d+/.exec(version)?.[0];
  const isBelow = found
    ? isVersionBelow(found, PANEL_MIN_CLAUDE_VERSION)
    : null;
  if (isBelow === null) {
    return `could not read Claude Code's version from '${version.trim()}'`;
  }
  return isBelow
    ? `Claude Code ${found} is older than ${PANEL_MIN_CLAUDE_VERSION}`
    : null;
}

// What `buildMarketplace` leaves out of `claude-plugin/`. `development`
// type-checks the hooks module in this repository and nothing reads it at run
// time, so `files` in package.json leaves it out of the package too
// (`claude-plugin.test.ts` holds the two equal). `panel` is what only the
// session panel reads: the hooks module, its tests and the state contract
// `plugin.json` names under `types`.
export const PLUGIN_PARTS = {
  development: ["tsconfig.json", join("types", "claude-code")],
  panel: ["hooks", "tests", "types"],
};

// Rewrites the whole plugin folder, so a file dropped from the package goes
// too, and so do the skills, the MCP server or the panel when left out.
// `version` follows the CLI, and the MCP server points at `apiUrl`.
export function buildMarketplace(input: {
  sourceDir: string;
  targetDir: string;
  version: string;
  apiUrl: string;
  skills?: boolean;
  mcp?: boolean;
  panel?: boolean;
}) {
  const pluginDir = marketplacePluginDir(input.targetDir);
  rmSync(pluginDir, { recursive: true, force: true });
  cpSync(input.sourceDir, pluginDir, {
    recursive: true,
    filter: (source) =>
      !PLUGIN_PARTS.development.includes(relative(input.sourceDir, source)),
  });
  if (input.skills === false) {
    rmSync(join(pluginDir, "skills"), { recursive: true, force: true });
  }
  if (input.panel === false) {
    for (const name of PLUGIN_PARTS.panel) {
      rmSync(join(pluginDir, name), { recursive: true, force: true });
    }
  }

  const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
  const { types, ...manifest } = PluginManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  writeJson(manifestPath, {
    ...manifest,
    ...(input.panel === false ? {} : { types }),
    version: input.version,
  });
  if (input.mcp !== false) {
    writeJson(join(pluginDir, ".mcp.json"), {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: "http",
          url: mcpServerUrl(input.apiUrl),
        },
      },
    });
  }
  writeJson(join(input.targetDir, ".claude-plugin", "marketplace.json"), {
    name: MARKETPLACE_NAME,
    owner: { name: "Clocktopus", url: "https://clocktopus.app" },
    description: "The Clocktopus plugin, installed by the Clocktopus CLI.",
    plugins: [
      {
        name: PLUGIN_NAME,
        source: `./plugins/${PLUGIN_NAME}`,
        description:
          "Note tasks for later, start work through to a pull request, refine tasks until an agent can take them, and break goals into tasks, through the Clocktopus MCP server.",
      },
    ],
  });
  return { pluginDir };
}

export function marketplacePluginDir(targetDir = marketplaceDir()) {
  return join(targetDir, "plugins", PLUGIN_NAME);
}

const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.object({ url: z.string() })),
});

// What the last `buildMarketplace` put in the folder, so `agent refresh` can
// write the same again; null when there is no folder. `apiUrl` is null without
// the MCP server.
export function readMarketplacePlugin(targetDir = marketplaceDir()) {
  const pluginDir = marketplacePluginDir(targetDir);
  const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return null;
  const { version } = z
    .object({ version: z.string().optional() })
    .catch({})
    .parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const mcpPath = join(pluginDir, ".mcp.json");
  const mcpUrl = existsSync(mcpPath)
    ? McpConfigSchema.safeParse(JSON.parse(readFileSync(mcpPath, "utf8"))).data
        ?.mcpServers[MCP_SERVER_NAME]?.url
    : undefined;
  return {
    version: version ?? null,
    skills: existsSync(join(pluginDir, "skills")),
    panel: existsSync(join(pluginDir, "hooks", "hooks.json")),
    apiUrl: mcpUrl ? mcpUrl.replace(/\/api\/mcp\/?$/, "") : null,
  };
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export type ClaudeRunner = (args: string[]) => {
  ok: boolean;
  output: string;
};

export const runClaude: ClaudeRunner = (args) => {
  try {
    const output = execFileSync("claude", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { ok: true, output };
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : "";
    return {
      ok: false,
      output:
        stderr.trim() ||
        (error instanceof Error ? error.message : "claude failed"),
    };
  }
};

// Adding a marketplace that is already known, installing a plugin that is
// already installed, and updating one that is current all succeed, so setup can
// run any number of times. `install` leaves an installed plugin at its cached
// version, so only `update` moves it to the version just written to the folder.
export function installClaudePlugin(input: {
  version: string;
  apiUrl: string;
  skills?: boolean;
  mcp?: boolean;
  panel?: boolean;
  run?: ClaudeRunner;
  sourceDir?: string;
  targetDir?: string;
}) {
  const run = input.run ?? runClaude;
  const targetDir = input.targetDir ?? marketplaceDir();
  const { pluginDir } = buildMarketplace({
    sourceDir: input.sourceDir ?? pluginSourceDir(),
    targetDir,
    version: input.version,
    apiUrl: input.apiUrl,
    skills: input.skills,
    mcp: input.mcp,
    panel: input.panel,
  });

  for (const args of [
    ["plugin", "marketplace", "add", targetDir],
    ["plugin", "install", CLAUDE_PLUGIN_ID],
    ["plugin", "update", CLAUDE_PLUGIN_ID],
  ]) {
    const result = run(args);
    if (!result.ok) {
      return {
        ok: false as const,
        reason: `claude ${args.join(" ")} failed: ${result.output}`,
      };
    }
  }
  return { ok: true as const, pluginDir };
}

// Best effort: a plugin or marketplace already gone is not an error.
export function removeClaudePlugin(
  input: { run?: ClaudeRunner; targetDir?: string } = {},
) {
  const run = input.run ?? runClaude;
  const targetDir = input.targetDir ?? marketplaceDir();
  const removed: string[] = [];
  if (run(["plugin", "uninstall", CLAUDE_PLUGIN_ID]).ok) {
    removed.push(`plugin ${CLAUDE_PLUGIN_ID}`);
  }
  if (run(["plugin", "marketplace", "remove", MARKETPLACE_NAME]).ok) {
    removed.push(`marketplace ${MARKETPLACE_NAME}`);
  }
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
    removed.push(targetDir);
  }
  return removed;
}

const PluginListSchema = z.array(
  z.looseObject({
    id: z.string(),
    version: z.string().optional(),
    enabled: z.boolean().optional(),
    installPath: z.string().optional(),
    readFromFolder: z.string().optional(),
  }),
);

// Null when `claude plugin list` can't be read, as when Claude Code is missing.
// `panel` says whether the copy Claude Code loads carries the hooks module: the
// folder it reads in place when it names one, else its cache.
export function readClaudePlugin(run: ClaudeRunner = runClaude) {
  const result = run(["plugin", "list", "--json"]);
  if (!result.ok) return null;
  const parsed = PluginListSchema.safeParse(
    (() => {
      try {
        return JSON.parse(result.output);
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success) return null;
  const plugin = parsed.data.find((entry) => entry.id === CLAUDE_PLUGIN_ID);
  const loadedFrom = plugin?.readFromFolder ?? plugin?.installPath;
  return {
    installed: plugin !== undefined,
    enabled: plugin?.enabled ?? false,
    version: plugin?.version ?? null,
    panel:
      loadedFrom !== undefined &&
      existsSync(join(loadedFrom, "hooks", "hooks.json")),
  };
}
