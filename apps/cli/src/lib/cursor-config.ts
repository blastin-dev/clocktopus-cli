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

import type { AgentCredentials } from "./credentials-file.js";
import { contextCommandFor, isContextHookCommand } from "./context-hook.js";
import {
  readCredentialsFile,
  removeCredentialsFile,
  writeCredentialsFile,
} from "./credentials-file.js";
import { MCP_SERVER_NAME, mcpServerUrl } from "./mcp-server.js";

// Cursor runs a hook with no environment from its config, so the token lives in a
// file Clocktopus owns rather than in `hooks.json`. Cursor exports no spend from the
// user's machine: these files carry session hooks and the MCP server only.

export const CURSOR_HOOKS_FILENAME = "hooks.json";
export const CURSOR_MCP_FILENAME = "mcp.json";
export const CURSOR_CREDENTIALS_FILENAME = "clocktopus.json";

// Seconds. Cursor waits for a hook to exit; `agent hook` detaches itself at once.
export const CURSOR_HOOK_TIMEOUT_SECONDS = 10;

// Short: `agent context` runs before the session starts and reads only local git state.
export const CURSOR_CONTEXT_HOOK_TIMEOUT_SECONDS = 5;

// Cursor's event names, mapped to the ones the receiver and `agent doctor` use.
const HOOK_EVENTS = {
  SessionStart: "sessionStart",
  SessionEnd: "sessionEnd",
} as const;
type HookEvent = keyof typeof HOOK_EVENTS;

type JsonObject = Record<string, unknown>;
type HookEntry = { command?: unknown; [key: string]: unknown };

export class CursorConfigParseError extends Error {
  constructor(
    public readonly path: string,
    detail: string,
  ) {
    super(
      `${path} is not valid JSON (${detail}). Fix or move it, then run 'clocktopus agent setup' again.`,
    );
    this.name = "CursorConfigParseError";
  }
}

export function cursorConfigDir(): string {
  return join(homedir(), ".cursor");
}

export function cursorHooksPath(): string {
  return join(cursorConfigDir(), CURSOR_HOOKS_FILENAME);
}

export function cursorMcpPath(): string {
  return join(cursorConfigDir(), CURSOR_MCP_FILENAME);
}

export function cursorCredentialsPath(): string {
  return join(cursorConfigDir(), CURSOR_CREDENTIALS_FILENAME);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asEntries(value: unknown): HookEntry[] {
  return Array.isArray(value) ? (value as HookEntry[]) : [];
}

export function readCursorJson(path: string): {
  path: string;
  exists: boolean;
  modifiedAt: Date | null;
  file: JsonObject;
} {
  if (!existsSync(path)) {
    return { path, exists: false, modifiedAt: null, file: {} };
  }

  const raw = readFileSync(path, "utf8");
  const modifiedAt = statSync(path).mtime;
  if (raw.trim() === "") return { path, exists: true, modifiedAt, file: {} };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected an object");
    }
    return { path, exists: true, modifiedAt, file: parsed as JsonObject };
  } catch (error) {
    throw new CursorConfigParseError(
      path,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

// Written to a temporary file and renamed, so a crash never leaves a truncated file.
export function writeCursorJson(
  file: JsonObject,
  path: string,
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

function isClocktopusHook(entry: HookEntry): boolean {
  const command = typeof entry.command === "string" ? entry.command : "";
  return /clocktopus/i.test(command) && /agent\s+hook/.test(command);
}

function isOurs(entry: HookEntry): boolean {
  return isClocktopusHook(entry) || isContextHookCommand(entry.command);
}

export function readCursorContextCommand(file: JsonObject): string | null {
  const ours = asEntries(asObject(file.hooks)[HOOK_EVENTS.SessionStart]).find(
    (entry) => isContextHookCommand(entry.command),
  );
  return typeof ours?.command === "string" ? ours.command : null;
}

export function readCursorHookCommands(
  file: JsonObject,
): Partial<Record<HookEvent, string>> {
  const hooks = asObject(file.hooks);
  const commands: Partial<Record<HookEvent, string>> = {};
  for (const [event, cursorEvent] of Object.entries(HOOK_EVENTS)) {
    const ours = asEntries(hooks[cursorEvent]).find(isClocktopusHook);
    if (typeof ours?.command === "string") {
      commands[event as HookEvent] = ours.command;
    }
  }
  return commands;
}

export function applyCursorHooks(
  file: JsonObject,
  input: { hookCommand: string },
): JsonObject {
  const existing = asObject(file.hooks);
  const hooks: JsonObject = { ...existing };

  for (const cursorEvent of Object.values(HOOK_EVENTS)) {
    // Remove-then-append so re-running setup never installs a second hook.
    hooks[cursorEvent] = [
      ...asEntries(existing[cursorEvent]).filter((entry) => !isOurs(entry)),
      { command: input.hookCommand, timeout: CURSOR_HOOK_TIMEOUT_SECONDS },
      // Its `additional_context` is how the session learns its task and id.
      ...(cursorEvent === HOOK_EVENTS.SessionStart
        ? [
            {
              command: contextCommandFor(input.hookCommand),
              timeout: CURSOR_CONTEXT_HOOK_TIMEOUT_SECONDS,
            },
          ]
        : []),
    ];
  }

  return { version: 1, ...file, hooks };
}

export function removeCursorHooks(file: JsonObject): {
  file: JsonObject;
  removed: boolean;
} {
  const existing = asObject(file.hooks);
  const hooks: JsonObject = { ...existing };
  let removed = false;

  for (const cursorEvent of Object.values(HOOK_EVENTS)) {
    const before = asEntries(existing[cursorEvent]);
    const after = before.filter((entry) => !isOurs(entry));
    if (after.length !== before.length) removed = true;
    if (after.length > 0) hooks[cursorEvent] = after;
    else delete hooks[cursorEvent];
  }

  const next = { ...file };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;

  return { file: next, removed };
}

export function readCursorMcpUrl(file: JsonObject): string | null {
  const server = asObject(asObject(file.mcpServers)[MCP_SERVER_NAME]);
  return typeof server.url === "string" ? server.url : null;
}

// Cursor signs in to a remote server over OAuth on first use, so the URL is all it
// needs.
export function applyCursorMcp(
  file: JsonObject,
  input: { apiUrl: string },
): JsonObject {
  const servers = asObject(file.mcpServers);
  return {
    ...file,
    mcpServers: {
      ...servers,
      [MCP_SERVER_NAME]: {
        ...asObject(servers[MCP_SERVER_NAME]),
        url: mcpServerUrl(input.apiUrl),
      },
    },
  };
}

export function removeCursorMcp(file: JsonObject): {
  file: JsonObject;
  removed: boolean;
} {
  const servers = { ...asObject(file.mcpServers) };
  if (!(MCP_SERVER_NAME in servers)) return { file, removed: false };
  delete servers[MCP_SERVER_NAME];
  return { file: { ...file, mcpServers: servers }, removed: true };
}

export function readCursorCredentials(path = cursorCredentialsPath()) {
  return readCredentialsFile(path);
}

export function writeCursorCredentials(
  credentials: AgentCredentials,
  path = cursorCredentialsPath(),
): void {
  writeCredentialsFile(credentials, path);
}

export function removeCursorCredentials(
  path = cursorCredentialsPath(),
): boolean {
  return removeCredentialsFile(path);
}
