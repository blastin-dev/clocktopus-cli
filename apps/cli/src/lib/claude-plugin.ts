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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
function packageRoot() {
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

const PluginManifestSchema = z.looseObject({ name: z.string() });

// Rewrites the whole plugin folder, so a file dropped from the package goes
// too, and so do the skills or the MCP server when left out. `version` follows
// the CLI, and the MCP server points at `apiUrl`.
export function buildMarketplace(input: {
  sourceDir: string;
  targetDir: string;
  version: string;
  apiUrl: string;
  skills?: boolean;
  mcp?: boolean;
}) {
  const pluginDir = join(input.targetDir, "plugins", PLUGIN_NAME);
  rmSync(pluginDir, { recursive: true, force: true });
  cpSync(input.sourceDir, pluginDir, { recursive: true });
  if (input.skills === false) {
    rmSync(join(pluginDir, "skills"), { recursive: true, force: true });
  }

  const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
  const manifest = PluginManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  writeJson(manifestPath, { ...manifest, version: input.version });
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

// Adding a marketplace that is already known, and installing a plugin that is
// already installed, both succeed, so setup can run any number of times.
export function installClaudePlugin(input: {
  version: string;
  apiUrl: string;
  skills?: boolean;
  mcp?: boolean;
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
  });

  for (const args of [
    ["plugin", "marketplace", "add", targetDir],
    ["plugin", "install", CLAUDE_PLUGIN_ID],
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
  }),
);

// Null when `claude plugin list` can't be read, as when Claude Code is missing.
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
  return {
    installed: plugin !== undefined,
    enabled: plugin?.enabled ?? false,
    version: plugin?.version ?? null,
  };
}
