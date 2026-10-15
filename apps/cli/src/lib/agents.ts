import { execFileSync } from "node:child_process";

import type { HookDryRun } from "./hook-request.js";
import {
  applyTelemetrySettings,
  readInstalledTelemetry,
  readSettings,
  removeTelemetrySettings,
  SettingsParseError,
  settingsPath,
  writeSettings,
} from "./claude-settings.js";
import {
  applyCodexHooks,
  applyCodexMcp,
  CodexConfigParseError,
  codexConfigPath,
  codexCredentialsPath,
  codexHooksPath,
  HOOK_EVENT_COUNT,
  parseCodexConfigText,
  readCodexConfig,
  readCodexCredentials,
  readCodexHooks,
  readCodexHookTrust,
  readCodexLogExporter,
  readCodexMcpUrl,
  removeCodexCredentials,
  removeCodexHooks,
  removeCodexMcp,
  removeCodexOtel,
  writeCodexConfig,
  writeCodexCredentials,
  writeCodexHooks,
} from "./codex-config.js";
import { reportCodexSpend } from "./codex-spend.js";
import {
  applyCursorHooks,
  applyCursorMcp,
  CursorConfigParseError,
  cursorCredentialsPath,
  cursorHooksPath,
  cursorMcpPath,
  readCursorContextCommand,
  readCursorCredentials,
  readCursorHookCommands,
  readCursorJson,
  readCursorMcpUrl,
  removeCursorCredentials,
  removeCursorHooks,
  removeCursorMcp,
  writeCursorCredentials,
  writeCursorJson,
} from "./cursor-config.js";
import { MCP_SERVER_NAME } from "./mcp-server.js";
import {
  applyOpencodeMcp,
  buildOpencodePlugin,
  OPENCODE_PLUGIN_VERSION,
  opencodeConfigPath,
  opencodePluginApiFor,
  opencodePluginPath,
  readOpencodeConfig,
  readOpencodeMcpUrl,
  readOpencodePlugin,
  removeOpencodeMcp,
  removeOpencodePlugin,
  splitCommandLine,
  writeOpencodeConfig,
  writeOpencodePlugin,
} from "./opencode-config.js";

export type AgentId = "claude" | "codex" | "opencode" | "cursor";

// What `agent setup` lets the user choose. Telemetry and the session hooks are
// always installed: the hook is the only source of a session's repository.
export const AGENT_COMPONENTS = ["mcp", "skills"] as const;
export type AgentComponent = (typeof AGENT_COMPONENTS)[number];

/** How the ingested session is labelled — must match `AgentProvider` in core. */
export type AgentProviderId =
  | "claude_code"
  | "codex_cli"
  | "opencode"
  | "cursor";

export type AgentTelemetryState = {
  token: string | null;
  endpoint: string | null;
  /** Per-event, because a half-installed hook pair degrades silently. */
  hookCommands: Partial<Record<"SessionStart" | "SessionEnd", string>>;
  // Lanes the receiver reads from this agent that its configuration does not send; a
  // non-empty list means the install silently under-reports.
  missingLanes: string[];
  /** Newest mtime across the agent's config files, for the restart check. */
  modifiedAt: Date | null;
  /** Files we would write, whether or not they exist yet. */
  paths: string[];
  // The Clocktopus MCP server's URL in the agent's own config; undefined where the
  // Claude plugin carries it instead.
  mcpUrl?: string | null;
  // The installed `agent context` hook; undefined where it is not read back.
  contextCommand?: string | null;
};

export type AgentAdapter = {
  id: AgentId;
  label: string;
  provider: AgentProviderId;
  binary: string;
  // Other executables whose presence also means the agent is installed.
  otherBinaries?: string[];
  // False where the agent exports no spend from this machine, so `agent status` does
  // not expect any.
  reportsSpend: boolean;
  // False means `agent hook` backgrounds itself — see `commands/agent/hook.ts`.
  hostRunsHooksAsync: boolean;
  // True when SessionEnd can fire more than once per session, so `agent hook` keeps the
  // session's state file instead of deleting it.
  hostRepeatsSessionEnd: boolean;
  // How the user signs this agent in to the Clocktopus MCP server.
  mcpSignIn: string;
  // True where `agent setup` installs the skills into `~/.agents/skills`.
  usesSharedSkills: boolean;
  // True where the host adds a SessionStart hook's stdout to the session, so
  // `agent context` is installed beside the telemetry hook.
  runsContextHook: boolean;
  paths(): string[];
  read(): AgentTelemetryState;
  // `mcp: false` leaves the agent's MCP entry as it is. Claude Code ignores it:
  // its MCP server rides in the plugin.
  apply(input: {
    token: string;
    endpoint: string;
    hookCommand: string;
    apiUrl: string;
    mcp: boolean;
  }): {
    backupPaths: string[];
    // Steps that failed without undoing the rest.
    warnings?: string[];
  };
  remove(): { removed: string[] };
  // Empty when the agent is ready apart from a restart.
  pendingActions(): string[];
  // Null when current. Defined where the integration is generated source, or where an
  // older setup left configuration this CLI no longer writes.
  staleReason?(): string | null;
  // Sends the session's spend from `agent hook`, for an agent that does not export it.
  // Never throws.
  reportSpend?(input: {
    endpoint: string;
    token: string;
    sessionId: string;
    transcriptPath: string | null;
    dryRun: HookDryRun | null;
  }): Promise<void>;
};

export function isConfigParseError(error: unknown): error is Error {
  return (
    error instanceof SettingsParseError ||
    error instanceof CodexConfigParseError ||
    error instanceof CursorConfigParseError
  );
}

// The first agent's token on the machine, so a newly installed agent reuses it.
export function findMachineTelemetry(survey: AgentSurvey[]) {
  for (const entry of survey) {
    try {
      const { token, endpoint } = entry.agent.read();
      if (token) return { token, endpoint };
    } catch (error) {
      if (!isConfigParseError(error)) throw error;
    }
  }
  return null;
}

const claudeAdapter: AgentAdapter = {
  id: "claude",
  label: "Claude Code",
  provider: "claude_code",
  binary: "claude",
  reportsSpend: true,
  hostRunsHooksAsync: true,
  hostRepeatsSessionEnd: false,
  mcpSignIn: "/mcp in Claude Code",
  usesSharedSkills: false,
  runsContextHook: true,

  paths: () => [settingsPath()],

  read() {
    const installed = readInstalledTelemetry();
    return {
      token: installed.env.CLOCKTOPUS_INGEST_TOKEN ?? null,
      endpoint: installed.env.CLOCKTOPUS_OTEL_ENDPOINT ?? null,
      hookCommands: installed.hookCommands,
      // Sub-agent runtime arrives on the logs lane.
      missingLanes:
        installed.env.OTEL_LOGS_EXPORTER === "otlp"
          ? []
          : ["sub-agent runtime"],
      modifiedAt: installed.modifiedAt,
      paths: [installed.path],
    };
  },

  apply(input) {
    const current = readSettings();
    const next = applyTelemetrySettings(current.settings, input);
    const { backupPath } = writeSettings(next, current.path);
    return { backupPaths: backupPath ? [backupPath] : [] };
  },

  remove() {
    const current = readSettings();
    if (!current.exists) return { removed: [] };

    const result = removeTelemetrySettings(current.settings);
    if (result.removedEnvKeys.length === 0 && !result.removedHooks)
      return { removed: [] };

    writeSettings(result.settings, current.path);
    return {
      removed: [
        ...result.removedEnvKeys,
        ...(result.removedHooks ? ["SessionStart/SessionEnd hooks"] : []),
      ],
    };
  },

  pendingActions: () => [],
};

const codexAdapter: AgentAdapter = {
  id: "codex",
  label: "Codex CLI",
  provider: "codex_cli",
  binary: "codex",
  reportsSpend: true,
  hostRunsHooksAsync: false,
  hostRepeatsSessionEnd: false,
  mcpSignIn: `codex mcp login ${MCP_SERVER_NAME}`,
  usesSharedSkills: true,
  runsContextHook: true,

  paths: () => [codexConfigPath(), codexHooksPath(), codexCredentialsPath()],

  read() {
    const credentials = readCodexCredentials();
    const config = readCodexConfig();
    const hooks = readCodexHooks();

    return {
      token: credentials.token,
      endpoint: credentials.endpoint,
      hookCommands: hooks.commands,
      missingLanes: [],
      modifiedAt: newest([
        credentials.modifiedAt,
        config.modifiedAt,
        hooks.modifiedAt,
      ]),
      paths: [credentials.path, config.path, hooks.path],
      mcpUrl: readCodexMcpUrl(config.config),
      contextCommand: hooks.contextCommand,
    };
  },

  apply(input) {
    const backupPaths: string[] = [];

    writeCodexCredentials(input);

    // One write for both tables, so the backup is the file as the user left it.
    const config = readCodexConfig();
    const withoutExporter = removeCodexOtel(config).nextText;
    const nextText = input.mcp
      ? applyCodexMcp(
          {
            text: withoutExporter,
            config: parseCodexConfigText(withoutExporter),
          },
          input,
        )
      : withoutExporter;
    if (nextText !== config.text) {
      const written = writeCodexConfig({
        path: config.path,
        previousText: config.text,
        previousConfig: config.config,
        nextText,
      });
      if (written.backupPath) backupPaths.push(written.backupPath);
    }

    const hooks = readCodexHooks();
    const nextHooks = applyCodexHooks(hooks.file, input);
    const hooksWritten = writeCodexHooks(nextHooks, hooks.path);
    if (hooksWritten.backupPath) backupPaths.push(hooksWritten.backupPath);

    return { backupPaths };
  },

  remove() {
    const removed: string[] = [];

    const config = readCodexConfig();
    if (config.exists) {
      const otel = removeCodexOtel(config);
      const mcp = removeCodexMcp({
        text: otel.nextText,
        config: parseCodexConfigText(otel.nextText),
      });
      if (otel.removedKeys.length > 0 || mcp.removed) {
        writeCodexConfig({
          path: config.path,
          previousText: config.text,
          previousConfig: config.config,
          nextText: mcp.nextText,
        });
        removed.push(...otel.removedKeys.map((key) => `otel.${key}`));
        if (mcp.removed) removed.push(`mcp_servers.${MCP_SERVER_NAME}`);
      }
    }

    const hooks = readCodexHooks();
    if (hooks.exists) {
      const result = removeCodexHooks(hooks.file);
      if (result.removed) {
        writeCodexHooks(result.file, hooks.path);
        removed.push("SessionStart/SessionEnd hooks");
      }
    }

    if (removeCodexCredentials()) removed.push(codexCredentialsPath());
    return { removed };
  },

  staleReason() {
    if (!readCodexLogExporter(readCodexConfig().config).ours) return null;
    return (
      "an older setup left Codex's own log exporter in [otel] of config.toml; " +
      "it sends tool output to the receiver, which discards it"
    );
  },

  reportSpend: reportCodexSpend,

  pendingActions() {
    // Codex runs an unapproved hook only after a prompt in its own TUI, which this CLI
    // cannot answer.
    if (!readCodexHooks().exists) return [];

    const { untrusted } = readCodexHookTrust();
    if (untrusted.length === 0) return [];

    const missing =
      untrusted.length === HOOK_EVENT_COUNT
        ? "its hooks"
        : `its ${untrusted.join(" and ")} hook`;

    return [
      "Start Codex once and answer 'Trust all and continue' when it asks\n" +
        `  about ${missing}. Until then Clocktopus records neither the spend nor\n` +
        "  the repository of a Codex session — it will not run an unapproved hook.",
    ];
  },
};

const opencodeAdapter: AgentAdapter = {
  id: "opencode",
  label: "OpenCode",
  provider: "opencode",
  binary: "opencode",
  reportsSpend: true,
  // The plugin does not await the hook it starts.
  hostRunsHooksAsync: true,
  // The plugin maps the end of every turn to SessionEnd.
  hostRepeatsSessionEnd: true,
  mcpSignIn: `opencode mcp auth ${MCP_SERVER_NAME}`,
  usesSharedSkills: true,
  // OpenCode has no hook whose output reaches the session; `link_session` finds
  // its session without the id.
  runsContextHook: false,

  paths: () => [opencodePluginPath(), opencodeConfigPath()],

  read() {
    const plugin = readOpencodePlugin();
    return {
      mcpUrl: readOpencodeMcpUrlSafely(),
      token: plugin.config?.token ?? null,
      endpoint: plugin.config?.endpoint ?? null,
      // One plugin file installs both events or neither.
      hookCommands: plugin.config
        ? {
            SessionStart: plugin.config.hookArgv.join(" "),
            SessionEnd: plugin.config.hookArgv.join(" "),
          }
        : {},
      missingLanes: [],
      modifiedAt: plugin.modifiedAt,
      paths: [plugin.path, opencodeConfigPath()],
    };
  },

  apply(input) {
    const api = installedOpencodePluginApi() ?? 2;
    const { backupPath } = writeOpencodePlugin(
      buildOpencodePlugin(
        {
          endpoint: input.endpoint,
          token: input.token,
          hookArgv: splitCommandLine(input.hookCommand),
        },
        api,
      ),
    );
    const backupPaths = backupPath ? [backupPath] : [];
    if (!input.mcp) return { backupPaths };

    // Telemetry is already installed, so an `opencode.json` that cannot be read
    // costs only the MCP server.
    try {
      const current = readOpencodeConfig();
      const written = writeOpencodeConfig(
        applyOpencodeMcp(current.config, { apiUrl: input.apiUrl, api }),
        current.path,
      );
      if (written.backupPath) backupPaths.push(written.backupPath);
      return { backupPaths };
    } catch (error) {
      return {
        backupPaths,
        warnings: [
          `MCP server not added: ${error instanceof Error ? error.message : "unknown error"}`,
        ],
      };
    }
  },

  remove() {
    const removed = removeOpencodePlugin() ? ["the Clocktopus plugin"] : [];
    try {
      const current = readOpencodeConfig();
      const next = removeOpencodeMcp(current.config);
      if (next.removed.length > 0) {
        writeOpencodeConfig(next.config, current.path);
        removed.push(...next.removed);
      }
    } catch {
      // An `opencode.json` that cannot be read holds no entry setup wrote.
    }
    return { removed };
  },

  pendingActions: () => [],

  staleReason() {
    const plugin = readOpencodePlugin();
    if (!plugin.exists || !plugin.config) return null;

    const installedApi = installedOpencodePluginApi();
    if (installedApi !== null && installedApi !== plugin.api) {
      return (
        `the installed plugin is written for OpenCode ${plugin.api}, ` +
        `which OpenCode ${installedApi} refuses to load`
      );
    }

    if (plugin.version === OPENCODE_PLUGIN_VERSION) return null;

    return (
      `the installed plugin was generated by an older CLI ` +
      `(generation ${plugin.version ?? "unstamped"}, current is ` +
      `${OPENCODE_PLUGIN_VERSION})`
    );
  },
};

const cursorAdapter: AgentAdapter = {
  id: "cursor",
  label: "Cursor",
  provider: "cursor",
  binary: "cursor-agent",
  // The IDE's shell command; `cursor-agent` is its CLI.
  otherBinaries: ["cursor"],
  // Cursor exports spend only from its servers, to team admins.
  reportsSpend: false,
  // Cursor waits for a hook to exit.
  hostRunsHooksAsync: false,
  hostRepeatsSessionEnd: false,
  mcpSignIn: `Cursor Settings → MCP, or cursor-agent mcp login ${MCP_SERVER_NAME}`,
  usesSharedSkills: true,
  // Through the `additional_context` of the JSON `agent context` prints.
  runsContextHook: true,

  paths: () => [cursorHooksPath(), cursorMcpPath(), cursorCredentialsPath()],

  read() {
    const hooks = readCursorJson(cursorHooksPath());
    const credentials = readCursorCredentials();
    return {
      token: credentials.credentials?.token ?? null,
      endpoint: credentials.credentials?.endpoint ?? null,
      hookCommands: readCursorHookCommands(hooks.file),
      missingLanes: [],
      modifiedAt: newest([hooks.modifiedAt, credentials.modifiedAt]),
      paths: [hooks.path, cursorMcpPath(), credentials.path],
      mcpUrl: readCursorMcpUrlSafely(),
      contextCommand: readCursorContextCommand(hooks.file),
    };
  },

  apply(input) {
    writeCursorCredentials(input);

    const hooks = readCursorJson(cursorHooksPath());
    const written = writeCursorJson(
      applyCursorHooks(hooks.file, input),
      hooks.path,
    );
    const backupPaths = written.backupPath ? [written.backupPath] : [];
    if (!input.mcp) return { backupPaths };

    // The hooks are already installed, so an `mcp.json` that cannot be read costs
    // only the MCP server.
    try {
      const mcp = readCursorJson(cursorMcpPath());
      const mcpWritten = writeCursorJson(
        applyCursorMcp(mcp.file, input),
        mcp.path,
      );
      if (mcpWritten.backupPath) backupPaths.push(mcpWritten.backupPath);
      return { backupPaths };
    } catch (error) {
      return {
        backupPaths,
        warnings: [
          `MCP server not added: ${error instanceof Error ? error.message : "unknown error"}`,
        ],
      };
    }
  },

  remove() {
    const removed: string[] = [];

    const hooks = readCursorJson(cursorHooksPath());
    if (hooks.exists) {
      const result = removeCursorHooks(hooks.file);
      if (result.removed) {
        writeCursorJson(result.file, hooks.path);
        removed.push("sessionStart/sessionEnd hooks");
      }
    }

    try {
      const mcp = readCursorJson(cursorMcpPath());
      const result = removeCursorMcp(mcp.file);
      if (result.removed) {
        writeCursorJson(result.file, mcp.path);
        removed.push(`mcpServers.${MCP_SERVER_NAME}`);
      }
    } catch {
      // An `mcp.json` that cannot be read holds no entry setup wrote.
    }

    if (removeCursorCredentials()) removed.push(cursorCredentialsPath());
    return { removed };
  },

  pendingActions: () => [],
};

export const AGENTS: readonly AgentAdapter[] = [
  claudeAdapter,
  codexAdapter,
  opencodeAdapter,
  cursorAdapter,
];

export type AgentSurvey = {
  agent: AgentAdapter;
  /** `null` when the binary is not on PATH. */
  version: string | null;
  installed: boolean;
  /** True once our token is written into this agent's config. */
  configured: boolean;
  /** Set when the agent's config exists but could not be parsed. */
  unreadable: string | null;
};

// Detects by `--version` rather than by config directory, because `~/.claude` and
// `~/.codex` outlive an uninstall.
export function surveyAgents(): AgentSurvey[] {
  return AGENTS.map((agent) => {
    const version = [agent.binary, ...(agent.otherBinaries ?? [])].reduce<
      string | null
    >((found, binary) => found ?? detectVersion(binary), null);

    let configured = false;
    let unreadable: string | null = null;
    try {
      configured = agent.read().token !== null;
    } catch (error) {
      if (isConfigParseError(error)) unreadable = error.message;
      else throw error;
    }

    return {
      agent,
      version,
      installed: version !== null,
      configured,
      unreadable,
    };
  });
}

function detectVersion(binary: string): string | null {
  try {
    const output = execFileSync(binary, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return (
      /\d+\.\d+\.\d+/.exec(output)?.[0] ?? output.trim().split("\n")[0] ?? null
    );
  } catch {
    return null;
  }
}

function installedOpencodePluginApi() {
  return opencodePluginApiFor(detectVersion(opencodeAdapter.binary));
}

function readCursorMcpUrlSafely(): string | null {
  try {
    return readCursorMcpUrl(readCursorJson(cursorMcpPath()).file);
  } catch {
    return null;
  }
}

function readOpencodeMcpUrlSafely(): string | null {
  try {
    return readOpencodeMcpUrl(
      readOpencodeConfig().config,
      installedOpencodePluginApi() ?? 2,
    );
  } catch {
    return null;
  }
}

function newest(dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>(
    (latest, date) => (date && (!latest || date > latest) ? date : latest),
    null,
  );
}
