import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { contextCommandFor, isContextHookCommand } from "./context-hook.js";
import { MCP_SERVER_NAME, mcpServerUrl } from "./mcp-server.js";

// `config.toml` is hand-annotated and a TOML round trip drops comments, so only the
// tables in `OWNED_TABLES` are spliced textually and `writeCodexConfig` refuses the
// write if anything outside them changed.

export const CODEX_CONFIG_FILENAME = "config.toml";
export const CODEX_HOOKS_FILENAME = "hooks.json";

// Codex's log exporter POSTs to the literal URL, so this is appended on write and
// stripped on read.
export const CODEX_LOGS_PATH = "/v1/logs";

// Seconds. Codex clamps SessionEnd to 3 and warns on every session start when it is
// set higher.
export const CODEX_HOOK_TIMEOUT_SECONDS = { SessionStart: 10, SessionEnd: 3 };

const HOOK_EVENTS = ["SessionStart", "SessionEnd"] as const;

export const HOOK_EVENT_COUNT = HOOK_EVENTS.length;
type HookEvent = (typeof HOOK_EVENTS)[number];

type TomlTable = Record<string, unknown>;

export class CodexConfigParseError extends Error {
  constructor(
    public readonly path: string,
    detail: string,
  ) {
    super(
      `${path} is not valid ${path.endsWith(".json") ? "JSON" : "TOML"} (${detail}). Fix or move it, then run 'clocktopus agent setup' again.`,
    );
    this.name = "CodexConfigParseError";
  }
}

export function codexConfigDir(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

export function codexConfigPath(): string {
  return join(codexConfigDir(), CODEX_CONFIG_FILENAME);
}

export function codexHooksPath(): string {
  return join(codexConfigDir(), CODEX_HOOKS_FILENAME);
}

export function readCodexConfig(path = codexConfigPath()): {
  path: string;
  exists: boolean;
  modifiedAt: Date | null;
  text: string;
  config: TomlTable;
} {
  if (!existsSync(path)) {
    return { path, exists: false, modifiedAt: null, text: "", config: {} };
  }

  const text = readFileSync(path, "utf8");
  const modifiedAt = statSync(path).mtime;

  try {
    const parsed = parseToml(text) as TomlTable;
    return { path, exists: true, modifiedAt, text, config: parsed };
  } catch (error) {
    throw new CodexConfigParseError(
      path,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export function parseCodexConfigText(text: string): TomlTable {
  return parseToml(text) as TomlTable;
}

function asTable(value: unknown): TomlTable {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as TomlTable)
    : {};
}

/** The `[otel]` keys `clocktopus agent setup` owns — and the only ones it removes. */
const OWNED_OTEL_KEYS = ["exporter", "log_user_prompt"] as const;

export function buildCodexOtel(input: {
  token: string;
  endpoint: string;
}): TomlTable {
  const endpoint = `${input.endpoint.replace(/\/$/, "")}${CODEX_LOGS_PATH}`;

  return {
    // Codex defaults to `binary`, which the receiver rejects with 415.
    exporter: {
      "otlp-http": {
        endpoint,
        protocol: "json",
        headers: { Authorization: `Bearer ${input.token}` },
      },
    },
    // Does not cover tool output; the receiver's allowlist is what keeps content out.
    log_user_prompt: false,
  };
}

// Dotted paths of the tables setup writes.
const OWNED_TABLES = [["otel"], ["mcp_servers", MCP_SERVER_NAME]] as const;

export function spliceOtelSection(
  text: string,
  otel: TomlTable | null,
): string {
  return spliceTable(text, ["otel"], otel);
}

// Detects the region by table headers only; `writeCodexConfig` refuses anything this
// misreads.
function spliceTable(
  text: string,
  path: readonly string[],
  table: TomlTable | null,
): string {
  const rendered =
    table && Object.keys(table).length > 0
      ? stringifyToml(
          path.reduceRight<TomlTable>(
            (inner, key) => ({ [key]: inner }),
            table,
          ),
        ).trimEnd()
      : null;

  const lines = text.split("\n");
  const dotted = path.map((key) => `\\s*${key}\\s*`).join("\\.");
  const ourHeader = new RegExp(`^\\s*\\[${dotted}(\\]|\\.)`);
  const isOurHeader = (line: string) => ourHeader.test(line);
  const isAnyHeader = (line: string) => /^\s*\[/.test(line);

  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (start === -1) {
      if (isOurHeader(line)) start = i;
      continue;
    }
    if (isAnyHeader(line) && !isOurHeader(line)) {
      end = i;
      break;
    }
  }

  if (start === -1) {
    if (!rendered) return text;
    const body = text.trimEnd();
    return body ? `${body}\n\n${rendered}\n` : `${rendered}\n`;
  }

  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const middle = rendered ? rendered.split("\n") : [];

  // Collapses blank lines so repeated add/remove cycles cannot pile them up.
  if (!rendered) {
    while (before.length > 0 && before[before.length - 1]?.trim() === "")
      before.pop();
    if (before.length > 0 && after.length > 0) before.push("");
  }

  return `${[...before, ...middle, ...after].join("\n").trimEnd()}\n`;
}

// Refuses the write if anything outside `OWNED_TABLES` differs after re-parsing.
export function writeCodexConfig(input: {
  path?: string;
  previousText: string;
  previousConfig: TomlTable;
  nextText: string;
}): { backupPath: string | null } {
  const path = input.path ?? codexConfigPath();

  let nextConfig: TomlTable;
  try {
    nextConfig = parseToml(input.nextText) as TomlTable;
  } catch (error) {
    throw new Error(
      `Refusing to write ${path}: the edit did not produce valid TOML (${
        error instanceof Error ? error.message : "unknown error"
      }). Nothing was changed.`,
    );
  }

  const previous = withoutOwnedTables(input.previousConfig);
  const next = withoutOwnedTables(nextConfig);
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      throw new Error(
        `Refusing to write ${path}: editing [otel] and [mcp_servers.${MCP_SERVER_NAME}] would have changed [${key}] as well. ` +
          "Nothing was changed — please add those sections by hand, or move the file aside.",
      );
    }
  }

  mkdirSync(dirname(path), { recursive: true });

  let backupPath: string | null = null;
  if (existsSync(path)) {
    backupPath = `${path}.clocktopus-backup`;
    copyFileSync(path, backupPath);
  }

  // Rename so a crash midway never leaves a truncated config.
  const temporaryPath = `${path}.clocktopus-tmp`;
  writeFileSync(temporaryPath, input.nextText, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);

  return { backupPath };
}

function withoutOwnedTables(config: TomlTable): TomlTable {
  const copy: TomlTable = structuredClone(config);
  for (const path of OWNED_TABLES) {
    const parent = path
      .slice(0, -1)
      .reduce<TomlTable>((table, key) => asTable(table[key]), copy);
    delete parent[path[path.length - 1]!];
  }
  // An emptied `[mcp_servers]` reads the same as an absent one.
  if (Object.keys(asTable(copy.mcp_servers)).length === 0) {
    delete copy.mcp_servers;
  }
  return copy;
}

export function readCodexTelemetry(path = codexConfigPath()): {
  path: string;
  exists: boolean;
  modifiedAt: Date | null;
  token: string | null;
  /** The receiver base, without `CODEX_LOGS_PATH`. */
  endpoint: string | null;
  protocol: string | null;
  logUserPrompt: boolean | null;
} {
  const { exists, modifiedAt, config } = readCodexConfig(path);

  const otel = asTable(config.otel);
  const http = asTable(asTable(otel.exporter)["otlp-http"]);
  const headers = asTable(http.headers);

  const authorization =
    typeof headers.Authorization === "string"
      ? headers.Authorization
      : typeof headers.authorization === "string"
        ? headers.authorization
        : null;

  const rawEndpoint = typeof http.endpoint === "string" ? http.endpoint : null;

  return {
    path,
    exists,
    modifiedAt,
    token: authorization?.replace(/^Bearer\s+/i, "").trim() || null,
    endpoint: rawEndpoint
      ? rawEndpoint.replace(new RegExp(`${CODEX_LOGS_PATH}/?$`), "")
      : null,
    protocol: typeof http.protocol === "string" ? http.protocol : null,
    logUserPrompt:
      typeof otel.log_user_prompt === "boolean" ? otel.log_user_prompt : null,
  };
}

export function applyCodexOtel(
  current: { text: string; config: TomlTable },
  input: { token: string; endpoint: string },
): string {
  const merged: TomlTable = {
    ...asTable(current.config.otel),
    ...buildCodexOtel(input),
  };
  return spliceOtelSection(current.text, merged);
}

export function removeCodexOtel(current: { text: string; config: TomlTable }): {
  nextText: string;
  removedKeys: string[];
} {
  const otel = { ...asTable(current.config.otel) };
  const removedKeys: string[] = [];

  for (const key of OWNED_OTEL_KEYS) {
    if (key in otel) {
      delete otel[key];
      removedKeys.push(key);
    }
  }

  return {
    nextText: spliceOtelSection(
      current.text,
      Object.keys(otel).length > 0 ? otel : null,
    ),
    removedKeys,
  };
}

// Codex signs in to a remote server over OAuth by default, so the URL is all it needs.
export function applyCodexMcp(
  current: { text: string; config: TomlTable },
  input: { apiUrl: string },
): string {
  const existing = asTable(
    asTable(current.config.mcp_servers)[MCP_SERVER_NAME],
  );
  return spliceTable(current.text, OWNED_TABLES[1], {
    ...existing,
    url: mcpServerUrl(input.apiUrl),
  });
}

export function removeCodexMcp(current: { text: string; config: TomlTable }): {
  nextText: string;
  removed: boolean;
} {
  const removed = MCP_SERVER_NAME in asTable(current.config.mcp_servers);
  return {
    nextText: removed
      ? spliceTable(current.text, OWNED_TABLES[1], null)
      : current.text,
    removed,
  };
}

export function readCodexMcpUrl(config: TomlTable): string | null {
  const url = asTable(asTable(config.mcp_servers)[MCP_SERVER_NAME]).url;
  return typeof url === "string" ? url : null;
}

type HookEntry = { type?: string; command?: string; [key: string]: unknown };
type MatcherGroup = { hooks?: HookEntry[]; [key: string]: unknown };

export function readCodexHooks(path = codexHooksPath()): {
  path: string;
  exists: boolean;
  modifiedAt: Date | null;
  file: Record<string, unknown>;
  commands: Partial<Record<HookEvent, string>>;
  contextCommand: string | null;
} {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      modifiedAt: null,
      file: {},
      commands: {},
      contextCommand: null,
    };
  }

  const raw = readFileSync(path, "utf8");
  const modifiedAt = statSync(path).mtime;

  let file: Record<string, unknown> = {};
  if (raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("expected an object");
      }
      file = parsed as Record<string, unknown>;
    } catch (error) {
      throw new CodexConfigParseError(
        path,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  const hooks = asTable(file.hooks);
  const commands: Partial<Record<HookEvent, string>> = {};
  for (const event of HOOK_EVENTS) {
    for (const group of asGroups(hooks[event])) {
      const ours = (group.hooks ?? []).find(isClocktopusHook);
      if (ours?.command) {
        commands[event] = ours.command;
        break;
      }
    }
  }
  const contextCommand =
    asGroups(hooks.SessionStart)
      .flatMap((group) => group.hooks ?? [])
      .find((entry) => isContextHookCommand(entry.command))?.command ?? null;

  return { path, exists: true, modifiedAt, file, commands, contextCommand };
}

function isClocktopusHook(entry: HookEntry): boolean {
  const command = typeof entry.command === "string" ? entry.command : "";
  return /clocktopus/i.test(command) && /agent\s+hook/.test(command);
}

function asGroups(value: unknown): MatcherGroup[] {
  return Array.isArray(value) ? (value as MatcherGroup[]) : [];
}

function withoutOurHooks(groups: MatcherGroup[]): MatcherGroup[] {
  return groups
    .map((group) => ({
      ...group,
      hooks: (group.hooks ?? []).filter(
        (entry) =>
          !isClocktopusHook(entry) && !isContextHookCommand(entry.command),
      ),
    }))
    .filter((group) => (group.hooks ?? []).length > 0);
}

export function applyCodexHooks(
  file: Record<string, unknown>,
  input: { hookCommand: string },
): Record<string, unknown> {
  const existing = asTable(file.hooks);
  const hooks: Record<string, unknown> = { ...existing };

  for (const event of HOOK_EVENTS) {
    // Remove-then-append so re-running setup never installs a second hook.
    hooks[event] = [
      ...withoutOurHooks(asGroups(existing[event])),
      {
        hooks: [
          {
            type: "command",
            command: input.hookCommand,
            timeout: CODEX_HOOK_TIMEOUT_SECONDS[event],
            // No `async` key: see `hostRunsHooksAsync` in `agents.ts`.
          },
        ],
      },
      // Codex adds a SessionStart hook's stdout to the session's context.
      ...(event === "SessionStart"
        ? [
            {
              hooks: [
                {
                  type: "command",
                  command: contextCommandFor(input.hookCommand),
                  timeout: CODEX_HOOK_TIMEOUT_SECONDS.SessionStart,
                },
              ],
            },
          ]
        : []),
    ];
  }

  return {
    // Codex shows this when it asks the user to trust the file.
    description:
      typeof file.description === "string" && file.description
        ? file.description
        : "Clocktopus agent telemetry",
    ...file,
    hooks,
  };
}

export function removeCodexHooks(file: Record<string, unknown>): {
  file: Record<string, unknown>;
  removed: boolean;
} {
  const existing = asTable(file.hooks);
  const hooks: Record<string, unknown> = { ...existing };
  let removed = false;

  for (const event of HOOK_EVENTS) {
    const before = asGroups(existing[event]);
    const after = withoutOurHooks(before);
    if (JSON.stringify(before) !== JSON.stringify(after)) removed = true;
    if (after.length > 0) hooks[event] = after;
    else delete hooks[event];
  }

  const next = { ...file };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;

  return { file: next, removed };
}

export function writeCodexHooks(
  file: Record<string, unknown>,
  path = codexHooksPath(),
): { backupPath: string | null } {
  mkdirSync(dirname(path), { recursive: true });

  let backupPath: string | null = null;
  if (existsSync(path)) {
    backupPath = `${path}.clocktopus-backup`;
    copyFileSync(path, backupPath);
  }

  const temporaryPath = `${path}.clocktopus-tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);

  return { backupPath };
}

// Codex records trust per hook entry under `[hooks.state]`, keyed
// `<path>:<snake_case event>:<group>:<index>`, so partial trust is possible.
export function readCodexHookTrust(path = codexConfigPath()): {
  trusted: HookEvent[];
  untrusted: HookEvent[];
} {
  let config: TomlTable;
  try {
    ({ config } = readCodexConfig(path));
  } catch {
    return { trusted: [], untrusted: [...HOOK_EVENTS] };
  }

  const state = asTable(asTable(config.hooks).state);
  const prefix = `${codexHooksPath()}:`;
  const trusted = new Set<HookEvent>();

  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith(prefix)) continue;

    // Codex 0.148 omits `enabled`, so only an explicit `false` counts as untrusted.
    const entry = asTable(value);
    if (entry.enabled === false || typeof entry.trusted_hash !== "string")
      continue;

    // Sliced by prefix length because the path can contain a colon.
    const event = key.slice(prefix.length).split(":")[0];
    const match = HOOK_EVENTS.find(
      (candidate) => toSnakeCase(candidate) === event,
    );
    if (match) trusted.add(match);
  }

  return {
    trusted: HOOK_EVENTS.filter((event) => trusted.has(event)),
    untrusted: HOOK_EVENTS.filter((event) => !trusted.has(event)),
  };
}

function toSnakeCase(event: HookEvent): string {
  return event.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}
