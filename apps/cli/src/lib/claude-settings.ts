import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { contextCommandFor, isContextHookCommand } from "./context-hook.js";

// The user owns this file: never write over JSON that failed to parse, and touch only
// the keys and hook entries Clocktopus added.

export const SETTINGS_FILENAME = "settings.json";

// Claude Code's flags for exporting prompt text, response text, tool input and
// output, and whole API bodies. It reads `1`, `true`, `yes` and `on` as on (and
// `file:<dir>` for raw bodies), so setup writes `0`; the user settings `env`
// replaces a value exported in the shell, and only managed settings override it.
export const CONTENT_FLAG_KEYS = [
  "OTEL_LOG_USER_PROMPTS",
  "OTEL_LOG_ASSISTANT_RESPONSES",
  "OTEL_LOG_TOOL_DETAILS",
  "OTEL_LOG_TOOL_CONTENT",
  "OTEL_LOG_RAW_API_BODIES",
] as const;

const CONTENT_FLAG_OFF = "0";

/** Env keys `clocktopus agent setup` owns — and the only ones it removes. */
export const TELEMETRY_ENV_KEYS = [
  ...CONTENT_FLAG_KEYS,
  "CLAUDE_CODE_ENABLE_TELEMETRY",
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_METRICS_INCLUDE_SESSION_ID",
  "OTEL_METRIC_EXPORT_INTERVAL",
  "CLOCKTOPUS_INGEST_TOKEN",
  "CLOCKTOPUS_OTEL_ENDPOINT",
] as const;

// Silence shorter than one interval reads as "waiting" rather than "broken" in status.
export const METRIC_EXPORT_INTERVAL_MS = 60_000;

// Above the hook's own 4s request timeout, so a slow network leaves a recorded failure
// for `agent doctor` rather than a kill by the host.
export const HOOK_TIMEOUT_SECONDS = 10;

// Short: the context hook runs before the session starts and reads only local
// git state.
export const CONTEXT_HOOK_TIMEOUT_SECONDS = 5;

export type ClaudeSettings = Record<string, unknown>;

type HookEntry = { type?: string; command?: string; [key: string]: unknown };
type HookMatcher = {
  matcher?: string;
  hooks?: HookEntry[];
  [k: string]: unknown;
};

export class SettingsParseError extends Error {
  constructor(public readonly path: string) {
    super(
      `${path} is not valid JSON. Fix or move it, then run 'clocktopus agent setup' again.`,
    );
    this.name = "SettingsParseError";
  }
}

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

export function settingsPath(): string {
  return join(claudeConfigDir(), SETTINGS_FILENAME);
}

export function readSettings(path = settingsPath()): {
  path: string;
  exists: boolean;
  modifiedAt: Date | null;
  settings: ClaudeSettings;
} {
  if (!existsSync(path)) {
    return { path, exists: false, modifiedAt: null, settings: {} };
  }

  const raw = readFileSync(path, "utf8");
  const modifiedAt = statSync(path).mtime;

  // Some installers create an empty file.
  if (raw.trim() === "") {
    return { path, exists: true, modifiedAt, settings: {} };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SettingsParseError(path);
    }
    return {
      path,
      exists: true,
      modifiedAt,
      settings: parsed as ClaudeSettings,
    };
  } catch (error) {
    if (error instanceof SettingsParseError) throw error;
    throw new SettingsParseError(path);
  }
}

// Written to a temporary file and renamed, so a crash never leaves a truncated file.
export function writeSettings(
  settings: ClaudeSettings,
  path = settingsPath(),
): { backupPath: string | null } {
  mkdirSync(dirname(path), { recursive: true });

  let backupPath: string | null = null;
  if (existsSync(path)) {
    backupPath = `${path}.clocktopus-backup`;
    copyFileSync(path, backupPath);
  }

  const temporaryPath = `${path}.clocktopus-tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);

  return { backupPath };
}

export function buildTelemetryEnv(input: {
  token: string;
  endpoint: string;
}): Record<string, string> {
  const endpoint = input.endpoint.replace(/\/$/, "");

  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_METRICS_EXPORTER: "otlp",
    // Carries sub-agent runtime, which `claude_code.active_time.total` omits, and
    // prompt times; the receiver reads only `subagent_completed` and the time of
    // each `user_prompt` from it.
    OTEL_LOGS_EXPORTER: "otlp",
    // The receiver rejects protobuf with 415.
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${input.token}`,
    // Joins the metric stream to the hook's sessions.
    OTEL_METRICS_INCLUDE_SESSION_ID: "true",
    OTEL_METRIC_EXPORT_INTERVAL: String(METRIC_EXPORT_INTERVAL_MS),
    // Read by `agent hook`, which inherits this env from the session.
    CLOCKTOPUS_INGEST_TOKEN: input.token,
    CLOCKTOPUS_OTEL_ENDPOINT: endpoint,
    ...Object.fromEntries(
      CONTENT_FLAG_KEYS.map((key) => [key, CONTENT_FLAG_OFF]),
    ),
  };
}

export function isContentFlagOn(
  key: (typeof CONTENT_FLAG_KEYS)[number],
  value: unknown,
): boolean {
  if (typeof value !== "string") return false;
  if (key === "OTEL_LOG_RAW_API_BODIES" && value.startsWith("file:")) {
    return value.length > "file:".length;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function contentFlagsOn(
  sources: Array<{ source: string; env: Record<string, unknown> }>,
) {
  return sources.flatMap(({ source, env }) =>
    CONTENT_FLAG_KEYS.filter((key) => isContentFlagOn(key, env[key])).map(
      (key) => ({ key, value: String(env[key]), source, managed: false }),
    ),
  );
}

// The system directory of Claude Code's file-based managed settings. MDM
// profiles, registry values and server-managed settings leave no file in it.
export function managedSettingsDir(platform = process.platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  return "/etc/claude-code";
}

// In the order Claude Code merges them: `managed-settings.json`, then every
// `*.json` in `managed-settings.d/` alphabetically, hidden files skipped.
export function managedSettingsFiles(dir = managedSettingsDir()): string[] {
  const dropInDir = join(dir, "managed-settings.d");
  let dropIns: string[] = [];
  try {
    dropIns = readdirSync(dropInDir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .sort()
      .map((name) => join(dropInDir, name));
  } catch {
    // No drop-in directory, or one this user can't list.
  }
  return [join(dir, "managed-settings.json"), ...dropIns];
}

function envOf(settings: ClaudeSettings): Record<string, unknown> {
  return settings.env &&
    typeof settings.env === "object" &&
    !Array.isArray(settings.env)
    ? (settings.env as Record<string, unknown>)
    : {};
}

// Each managed file's `env` merges key by key over the files before it, so a
// flag is on only when the last file to set it turns it on. A file this user
// can't read is skipped, as Claude Code skips it.
function managedContentFlagsOn(dir: string) {
  const setBy = new Map<string, { value: unknown; source: string }>();
  const unreadable: string[] = [];
  for (const path of managedSettingsFiles(dir)) {
    let settings: ClaudeSettings;
    try {
      ({ settings } = readSettings(path));
    } catch (error) {
      if (error instanceof SettingsParseError) unreadable.push(path);
      continue;
    }
    for (const [key, value] of Object.entries(envOf(settings))) {
      setBy.set(key, { value, source: path });
    }
  }
  const found = CONTENT_FLAG_KEYS.flatMap((key) => {
    const set = setBy.get(key);
    return set && isContentFlagOn(key, set.value)
      ? [{ key, value: String(set.value), source: set.source, managed: true }]
      : [];
  });
  return { found, unreadable };
}

// The environment this CLI runs in stands in for the one Claude Code is
// launched from. A user settings file that fails to parse is reported by the
// config check instead; a managed one is listed in `unreadable`. Project
// settings are not read: Claude Code ignores a content flag set there unless
// it turns the flag off.
export function findContentFlagsOn(
  path = settingsPath(),
  environment: Record<string, unknown> = process.env,
  managedDir = managedSettingsDir(),
) {
  const sources: Parameters<typeof contentFlagsOn>[0] = [
    { source: "the environment", env: environment },
  ];
  try {
    sources.push({ source: path, env: envOf(readSettings(path).settings) });
  } catch (error) {
    if (!(error instanceof SettingsParseError)) throw error;
  }
  const managed = managedContentFlagsOn(managedDir);
  return {
    found: [...contentFlagsOn(sources), ...managed.found],
    unreadable: managed.unreadable,
  };
}

export function describeContentFlags(
  found: ReturnType<typeof findContentFlagsOn>["found"],
): string {
  return found
    .map(({ key, value, source }) => `${key}=${value} in ${source}`)
    .join("; ");
}

const HOOK_EVENTS = ["SessionStart", "SessionEnd"] as const;

// Also matches a hand-installed `claude-hook.mjs` script, so setup replaces it rather
// than adding a second hook.
function isClocktopusHook(entry: HookEntry): boolean {
  const command = typeof entry.command === "string" ? entry.command : "";
  if (/claude-hook\.mjs/.test(command)) return true;
  return /clocktopus/i.test(command) && /agent\s+hook/.test(command);
}

function asMatchers(value: unknown): HookMatcher[] {
  return Array.isArray(value) ? (value as HookMatcher[]) : [];
}

function withoutOurHooks(matchers: HookMatcher[]): HookMatcher[] {
  return (
    matchers
      .map((matcher) => ({
        ...matcher,
        hooks: (matcher.hooks ?? []).filter(
          (entry) =>
            !isClocktopusHook(entry) && !isContextHookCommand(entry.command),
        ),
      }))
      // A group left with entries belongs to the user and stays.
      .filter((matcher) => (matcher.hooks ?? []).length > 0)
  );
}

export function applyTelemetrySettings(
  settings: ClaudeSettings,
  input: { token: string; endpoint: string; hookCommand: string },
): ClaudeSettings {
  const existingEnv =
    settings.env &&
    typeof settings.env === "object" &&
    !Array.isArray(settings.env)
      ? (settings.env as Record<string, string>)
      : {};

  const existingHooks =
    settings.hooks &&
    typeof settings.hooks === "object" &&
    !Array.isArray(settings.hooks)
      ? (settings.hooks as Record<string, unknown>)
      : {};

  const hooks: Record<string, unknown> = { ...existingHooks };

  for (const event of HOOK_EVENTS) {
    // Remove-then-append so re-running setup never installs a second hook.
    hooks[event] = [
      ...withoutOurHooks(asMatchers(existingHooks[event])),
      {
        hooks: [
          {
            type: "command",
            command: input.hookCommand,
            timeout: HOOK_TIMEOUT_SECONDS,
            async: true,
          },
        ],
      },
      ...(event === "SessionStart"
        ? [
            {
              hooks: [
                {
                  type: "command",
                  command: contextCommandFor(input.hookCommand),
                  timeout: CONTEXT_HOOK_TIMEOUT_SECONDS,
                },
              ],
            },
          ]
        : []),
    ];
  }

  return {
    ...settings,
    env: { ...existingEnv, ...buildTelemetryEnv(input) },
    hooks,
  };
}

export function removeTelemetrySettings(settings: ClaudeSettings): {
  settings: ClaudeSettings;
  removedEnvKeys: string[];
  removedHooks: boolean;
} {
  const next: ClaudeSettings = { ...settings };
  const removedEnvKeys: string[] = [];

  if (next.env && typeof next.env === "object" && !Array.isArray(next.env)) {
    const env = { ...(next.env as Record<string, string>) };
    for (const key of TELEMETRY_ENV_KEYS) {
      if (key in env) {
        delete env[key];
        removedEnvKeys.push(key);
      }
    }
    if (Object.keys(env).length > 0) next.env = env;
    else delete next.env;
  }

  let removedHooks = false;
  if (
    next.hooks &&
    typeof next.hooks === "object" &&
    !Array.isArray(next.hooks)
  ) {
    const hooks = { ...(next.hooks as Record<string, unknown>) };
    for (const event of HOOK_EVENTS) {
      const before = asMatchers(hooks[event]);
      const after = withoutOurHooks(before);
      if (JSON.stringify(before) !== JSON.stringify(after)) removedHooks = true;
      if (after.length > 0) hooks[event] = after;
      else delete hooks[event];
    }
    if (Object.keys(hooks).length > 0) next.hooks = hooks;
    else delete next.hooks;
  }

  return { settings: next, removedEnvKeys, removedHooks };
}

export function readInstalledTelemetry(path = settingsPath()): {
  path: string;
  exists: boolean;
  modifiedAt: Date | null;
  env: Record<string, string>;
  hookCommands: Partial<Record<(typeof HOOK_EVENTS)[number], string>>;
} {
  const { settings, exists, modifiedAt } = readSettings(path);

  const rawEnv =
    settings.env &&
    typeof settings.env === "object" &&
    !Array.isArray(settings.env)
      ? (settings.env as Record<string, string>)
      : {};

  const env: Record<string, string> = {};
  for (const key of TELEMETRY_ENV_KEYS) {
    if (typeof rawEnv[key] === "string") env[key] = rawEnv[key];
  }

  const rawHooks =
    settings.hooks &&
    typeof settings.hooks === "object" &&
    !Array.isArray(settings.hooks)
      ? (settings.hooks as Record<string, unknown>)
      : {};

  const hookCommands: Partial<Record<(typeof HOOK_EVENTS)[number], string>> =
    {};
  for (const event of HOOK_EVENTS) {
    for (const matcher of asMatchers(rawHooks[event])) {
      const ours = (matcher.hooks ?? []).find(isClocktopusHook);
      if (ours?.command) {
        hookCommands[event] = ours.command;
        break;
      }
    }
  }

  return { path, exists, modifiedAt, env, hookCommands };
}
