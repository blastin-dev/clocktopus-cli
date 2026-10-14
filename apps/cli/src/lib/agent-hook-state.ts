import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const CACHE_DIR = join(homedir(), ".cache", "clocktopus");
const STATE_DIR = join(CACHE_DIR, "agent-sessions");

// The hook cannot print, so it leaves this receipt for `agent status` and `agent doctor`.
const LAST_RUN_FILE = join(CACHE_DIR, "agent-hook-last.json");

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
  join(STATE_DIR, `${sessionId.replace(/[^\w-]/g, "")}.sha`);

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
    mkdirSync(STATE_DIR, { recursive: true });
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
    return readdirSync(STATE_DIR)
      .filter((name) => name.endsWith(".sha"))
      .flatMap((name) => {
        try {
          const { mtimeMs } = statSync(join(STATE_DIR, name));
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

export function recordLastRun(run: HookLastRun): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(LAST_RUN_FILE, JSON.stringify(run, null, 2), "utf8");
  } catch {
    // A missing receipt degrades diagnostics; it must never fail a session.
  }
}

export function readLastRun(): HookLastRun | null {
  try {
    const parsed = LastRunSchema.safeParse(
      JSON.parse(readFileSync(LAST_RUN_FILE, "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearHookState(): void {
  try {
    rmSync(STATE_DIR, { recursive: true, force: true });
    rmSync(LAST_RUN_FILE, { force: true });
  } catch {
    // Nothing to clean up, or not ours to clean up.
  }
}
