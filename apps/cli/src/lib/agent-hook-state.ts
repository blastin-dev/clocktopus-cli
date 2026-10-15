import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isBefore, subDays } from "date-fns";
import { z } from "zod";

import type { CodexSpendCursor } from "./codex-rollout.js";
import { CodexSpendCursorSchema } from "./codex-rollout.js";

// Functions rather than constants, so a test's `HOME` applies.
const cacheDir = () => join(homedir(), ".cache", "clocktopus");
const stateDir = () => join(cacheDir(), "agent-sessions");
// Outside `stateDir`, so `clearHookState` keeps it: a session resumed after
// `agent disable` and setup again must not report its earlier usage a second time.
const spendCursorDir = () => join(cacheDir(), "codex-spend");

// A cursor untouched this long is pruned, and a session with no cursor skips rollout
// lines older than this, so pruning never makes a resumed session repeat what it
// already reported; 90 days leaves any failed report every later hook to retry.
export const CODEX_SPEND_CURSOR_MAX_AGE_DAYS = 90;

// The hook cannot print, so it leaves this receipt for `agent status` and `agent doctor`.
const lastRunFile = () => join(cacheDir(), "agent-hook-last.json");

const LastRunSchema = z.object({
  at: z.string(),
  event: z.string().optional(),
  // One receipt file is shared by every agent.
  provider: z.string().optional(),
  sessionId: z.string().optional(),
  endpoint: z.string().optional(),
  tokenPrefix: z.string().optional(),
  /** HTTP status from the receiver, or null when the request never landed. */
  status: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  repository: z.string().nullable().optional(),
});

export type HookLastRun = z.infer<typeof LastRunSchema>;

const StartStateSchema = z.object({
  sha: z.string(),
  cwd: z.string().optional(),
  // The agent that opened the session; the sweep runs from whichever agent starts next.
  provider: z.string().optional(),
  // The session already had a real SessionEnd (see `hostRepeatsSessionEnd`), so the
  // sweep deletes the file instead of closing it again.
  closed: z.boolean().optional(),
  // ISO. Lower bound of the reflog read; absent means the session declares nothing.
  startedAt: z.string().optional(),
});

export type HookStartState = z.infer<typeof StartStateSchema>;

const stateFile = (sessionId: string) =>
  join(stateDir(), `${sessionId.replace(/[^\w-]/g, "")}.sha`);

const spendCursorFile = (sessionId: string) =>
  join(spendCursorDir(), `${sessionId.replace(/[^\w-]/g, "")}.json`);

export function writeStartState(
  sessionId: string,
  state: {
    sha: string;
    cwd: string;
    provider: string;
    closed?: boolean;
    startedAt?: string;
  },
): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    // `cwd` is stored because the sweep runs from whatever checkout the next session
    // starts in.
    writeFileSync(stateFile(sessionId), JSON.stringify(state), "utf8");
  } catch {
    // Losing the start SHA costs the exact commit list, not the session.
  }
}

export function readStartState(sessionId: string): HookStartState | undefined {
  try {
    const raw = readFileSync(stateFile(sessionId), "utf8").trim();
    if (!raw) return undefined;

    try {
      const parsed = StartStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      // A file holding a bare SHA rather than JSON.
      return { sha: raw };
    }
  } catch {
    return undefined;
  }
}

export function clearStartState(sessionId: string): void {
  try {
    rmSync(stateFile(sessionId), { force: true });
  } catch {
    // Best effort.
  }
}

export function listStartStates(): Array<{
  sessionId: string;
  ageMs: number;
  // The state file's mtime, which the sweep sends as an abandoned session's `ended_at`.
  lastActivityAt: Date;
}> {
  try {
    const now = Date.now();
    return readdirSync(stateDir())
      .filter((name) => name.endsWith(".sha"))
      .flatMap((name) => {
        try {
          const { mtimeMs } = statSync(join(stateDir(), name));
          return [
            {
              sessionId: name.replace(/\.sha$/, ""),
              ageMs: now - mtimeMs,
              lastActivityAt: new Date(mtimeMs),
            },
          ];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

// Kept after SessionEnd, because a resumed Codex session appends to the same rollout
// and must not report it again from the start. Null when the session has none.
export function readCodexSpendCursor(
  sessionId: string,
): CodexSpendCursor | null {
  try {
    const parsed = CodexSpendCursorSchema.safeParse(
      JSON.parse(readFileSync(spendCursorFile(sessionId), "utf8")),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // Missing: nothing reported yet, or pruned.
  }
  return null;
}

export function writeCodexSpendCursor(
  sessionId: string,
  cursor: CodexSpendCursor,
): void {
  try {
    mkdirSync(spendCursorDir(), { recursive: true });
    const path = spendCursorFile(sessionId);
    writeFileSync(`${path}.tmp`, JSON.stringify(cursor), "utf8");
    renameSync(`${path}.tmp`, path);
  } catch {
    // Costs a repeated report of this session's spend, not the session.
  }
  pruneCodexSpendCursors();
}

function pruneCodexSpendCursors(): void {
  try {
    const cutoff = subDays(new Date(), CODEX_SPEND_CURSOR_MAX_AGE_DAYS);
    for (const name of readdirSync(spendCursorDir())) {
      const path = join(spendCursorDir(), name);
      try {
        if (isBefore(statSync(path).mtime, cutoff)) rmSync(path);
      } catch {
        continue;
      }
    }
  } catch {
    // Best effort; the next write tries again.
  }
}

export function recordLastRun(run: HookLastRun): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(lastRunFile(), JSON.stringify(run, null, 2), "utf8");
  } catch {
    // A missing receipt degrades diagnostics; it must never fail a session.
  }
}

export function readLastRun(): HookLastRun | null {
  try {
    const parsed = LastRunSchema.safeParse(
      JSON.parse(readFileSync(lastRunFile(), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearHookState(): void {
  try {
    rmSync(stateDir(), { recursive: true, force: true });
    rmSync(lastRunFile(), { force: true });
  } catch {
    // Nothing to clean up, or not ours to clean up.
  }
}
