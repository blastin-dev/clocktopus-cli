import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import type { AgentId, AgentProviderId } from "./agents.js";
import { readInstalledTelemetry, settingsPath } from "./claude-settings.js";
import { codexConfigPath, readCodexTelemetry } from "./codex-config.js";
import {
  cursorCredentialsPath,
  readCursorCredentials,
} from "./cursor-config.js";
import { opencodePluginPath, readOpencodePlugin } from "./opencode-config.js";

// Claude Code applies `settings.json` `env` over the inherited shell environment, so the
// environment wins; the source is reported so `doctor` can name the file that is winning.
// Codex, OpenCode and Cursor inject nothing into the hook's environment, so their
// config file is the source.

export type CredentialSource = "environment" | "settings" | "none";

export type ResolvedAgentCredentials = {
  token: string | null;
  endpoint: string | null;
  tokenSource: CredentialSource;
  endpointSource: CredentialSource;
  /** The file `settings` refers to, so `doctor` can name it. */
  sourcePath: string;
};

export function resolveAgentCredentials(
  agent: AgentId = "claude",
): ResolvedAgentCredentials {
  const envToken = process.env.CLOCKTOPUS_INGEST_TOKEN?.trim();
  const envEndpoint = process.env.CLOCKTOPUS_OTEL_ENDPOINT?.trim();

  let fileToken: string | undefined;
  let fileEndpoint: string | undefined;
  try {
    if (agent === "codex") {
      const codex = readCodexTelemetry();
      fileToken = codex.token ?? undefined;
      fileEndpoint = codex.endpoint ?? undefined;
    } else if (agent === "opencode") {
      const plugin = readOpencodePlugin();
      fileToken = plugin.config?.token ?? undefined;
      fileEndpoint = plugin.config?.endpoint ?? undefined;
    } else if (agent === "cursor") {
      const { credentials } = readCursorCredentials();
      fileToken = credentials?.token;
      fileEndpoint = credentials?.endpoint;
    } else {
      const installed = readInstalledTelemetry();
      fileToken = installed.env.CLOCKTOPUS_INGEST_TOKEN;
      fileEndpoint = installed.env.CLOCKTOPUS_OTEL_ENDPOINT;
    }
  } catch {
    // Must not throw: the hook calls this every session. `setup` and `doctor` report
    // malformed files.
  }

  return {
    token: envToken || fileToken || null,
    endpoint: (envEndpoint || fileEndpoint || null)?.replace(/\/$/, "") ?? null,
    tokenSource: envToken ? "environment" : fileToken ? "settings" : "none",
    endpointSource: envEndpoint
      ? "environment"
      : fileEndpoint
        ? "settings"
        : "none",
    sourcePath:
      agent === "codex"
        ? codexConfigPath()
        : agent === "opencode"
          ? opencodePluginPath()
          : agent === "cursor"
            ? cursorCredentialsPath()
            : settingsPath(),
  };
}

export function maskToken(token: string): string {
  return token.length <= 15 ? "…" : `${token.slice(0, 15)}…`;
}

// Shell files whose exports `settings.json` `env` would shadow.
const SHELL_FILES = [
  ".bashrc",
  ".bash_profile",
  ".zshrc",
  ".zshenv",
  ".profile",
  ".config/fish/config.fish",
];

export function findShadowedExports(cwd = process.cwd()): Array<{
  path: string;
  keys: string[];
}> {
  const candidates = [
    ...SHELL_FILES.map((file) => join(homedir(), file)),
    join(cwd, ".envrc"),
  ];

  const found: Array<{ path: string; keys: string[] }> = [];

  for (const path of candidates) {
    let contents: string;
    try {
      if (!existsSync(path)) continue;
      contents = readFileSync(path, "utf8");
    } catch {
      continue;
    }

    const keys = [
      "CLOCKTOPUS_INGEST_TOKEN",
      "CLOCKTOPUS_OTEL_ENDPOINT",
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "OTEL_EXPORTER_OTLP_HEADERS",
      "CLAUDE_CODE_ENABLE_TELEMETRY",
    ].filter((key) =>
      new RegExp(`^\\s*(export\\s+)?${key}=`, "m").test(contents),
    );

    if (keys.length > 0) found.push({ path, keys });
  }

  return found;
}

// Uses the bare name only when `clocktopus` on PATH resolves to this executable, because
// hooks run with a PATH that can differ from the interactive shell's. `--provider` is
// baked in because the hook payload does not name the agent.
export function resolveHookCommand(provider: AgentProviderId): {
  command: string;
  usesAbsolutePath: boolean;
  binaryPath: string | null;
} {
  const script = process.argv[1] ? resolve(process.argv[1]) : null;

  const quote = (value: string) =>
    /[\s"']/.test(value) ? `"${value}"` : value;

  const args = `agent hook --provider ${provider}`;

  if (script && resolvesOnPath("clocktopus", script)) {
    return {
      command: `clocktopus ${args}`,
      usesAbsolutePath: false,
      binaryPath: script,
    };
  }

  if (script) {
    // `node <script>` because a checkout may not have the executable bit.
    return {
      command: `${quote(process.execPath)} ${quote(script)} ${args}`,
      usesAbsolutePath: true,
      binaryPath: script,
    };
  }

  return {
    command: `clocktopus ${args}`,
    usesAbsolutePath: false,
    binaryPath: null,
  };
}

function resolvesOnPath(name: string, expected: string): boolean {
  const searchPath = process.env.PATH;
  if (!searchPath) return false;

  let expectedReal: string;
  try {
    expectedReal = realpathSync(expected);
  } catch {
    return false;
  }

  for (const dir of searchPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (realpathSync(candidate) === expectedReal) return true;
      // The first `clocktopus` on PATH shadows any later match.
      return false;
    } catch {
      continue;
    }
  }

  return false;
}
