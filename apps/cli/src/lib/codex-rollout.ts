import { createReadStream, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { isBefore, isValid, parseISO, subMilliseconds } from "date-fns";
import { z } from "zod";

import { codexConfigDir } from "./codex-config.js";

// Codex appends every item of a session to its rollout file,
// `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<start>-<session id>.jsonl`, prompts and
// tool output included. Only the line kinds in `RolloutLineSchema` are read, and a
// line is parsed only when it names one of them in `LINE_MARKERS`.

// How many day directories the search walks back, newest first, when the hook payload
// names no file. A resumed session keeps the file of the day it started.
const MAX_DAY_DIRECTORIES = 62;

const LINE_MARKERS = [
  '"type":"session_meta"',
  '"type":"turn_context"',
  '"type":"token_count"',
  '"type":"task_complete"',
];

const tokenCount = z.number().int().nonnegative().catch(0);

// `input_tokens` includes `cached_input_tokens`, and `output_tokens` includes
// `reasoning_output_tokens`, so the reasoning count is not read.
const TokenUsageSchema = z.object({
  input_tokens: tokenCount,
  cached_input_tokens: tokenCount,
  cache_write_input_tokens: tokenCount,
  output_tokens: tokenCount,
});

type TokenUsage = z.infer<typeof TokenUsageSchema>;

const RolloutLineSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_meta"),
    // `id` on Codex releases older than `session_id`.
    payload: z.object({
      session_id: z.string().optional(),
      id: z.string().optional(),
      cli_version: z.string().max(50).optional(),
    }),
  }),
  z.object({
    type: z.literal("turn_context"),
    payload: z.object({ model: z.string().min(1).max(200) }),
  }),
  z.object({
    type: z.literal("event_msg"),
    timestamp: z.string(),
    payload: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("token_count"),
        // Null on a rate-limit update that carries no usage.
        info: z
          .object({
            total_token_usage: TokenUsageSchema,
            last_token_usage: TokenUsageSchema.optional(),
          })
          .nullable(),
      }),
      z.object({
        type: z.literal("task_complete"),
        duration_ms: z.number().int().nonnegative(),
      }),
    ]),
  }),
]);

const SESSION_ID_PATTERN = /^[\w-]+$/;

// `transcriptPath` is Codex's own pointer to the file, and is used only when it names
// this session's rollout.
export function findCodexRollout(
  sessionId: string,
  transcriptPath: string | null,
  sessionsDir = join(codexConfigDir(), "sessions"),
): string | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;
  const isOurs = (name: string) =>
    name.startsWith("rollout-") && name.endsWith(`-${sessionId}.jsonl`);

  if (transcriptPath && isOurs(basename(transcriptPath))) {
    if (existsSync(transcriptPath)) return transcriptPath;
  }

  const newestFirst = (dir: string) => {
    try {
      return readdirSync(dir)
        .filter((name) => /^\d+$/.test(name))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  };

  let searched = 0;
  for (const year of newestFirst(sessionsDir)) {
    for (const month of newestFirst(join(sessionsDir, year))) {
      for (const day of newestFirst(join(sessionsDir, year, month))) {
        if (searched++ >= MAX_DAY_DIRECTORIES) return null;
        const dir = join(sessionsDir, year, month, day);
        try {
          const match = readdirSync(dir).find(isOurs);
          if (match) return join(dir, match);
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

export async function readCodexRollout(path: string) {
  let sessionId: string | null = null;
  let cliVersion: string | null = null;
  let model: string | null = null;
  const tokenCounts: {
    at: Date;
    model: string | null;
    total: TokenUsage;
    last: TokenUsage | null;
  }[] = [];
  const turns: { at: Date; durationMs: number }[] = [];

  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!LINE_MARKERS.some((marker) => line.includes(marker))) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = RolloutLineSchema.safeParse(raw);
    if (!parsed.success) continue;
    const entry = parsed.data;

    if (entry.type === "session_meta") {
      sessionId ??= entry.payload.session_id ?? entry.payload.id ?? null;
      cliVersion ??= entry.payload.cli_version ?? null;
      continue;
    }

    if (entry.type === "turn_context") {
      model = entry.payload.model;
      continue;
    }

    const at = parseISO(entry.timestamp);
    if (!isValid(at)) continue;

    if (entry.payload.type === "token_count") {
      if (!entry.payload.info) continue;
      tokenCounts.push({
        at,
        model,
        total: entry.payload.info.total_token_usage,
        last: entry.payload.info.last_token_usage ?? null,
      });
      continue;
    }

    turns.push({ at, durationMs: entry.payload.duration_ms });
  }

  return { sessionId, cliVersion, tokenCounts, turns };
}

export type CodexRollout = Awaited<ReturnType<typeof readCodexRollout>>;

// How many `token_count` and `task_complete` lines of the rollout are already
// reported; the file only grows.
export const CodexSpendCursorSchema = z.object({
  tokenCounts: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
});

export type CodexSpendCursor = z.infer<typeof CodexSpendCursorSchema>;

// The cursor for a session with none stored: every line before `cutoff` counts as
// already reported. Rollout lines are in time order.
export function codexSpendCursorBefore(
  rollout: CodexRollout,
  cutoff: Date,
): CodexSpendCursor {
  const before = (entries: { at: Date }[]) => {
    const index = entries.findIndex((entry) => !isBefore(entry.at, cutoff));
    return index === -1 ? entries.length : index;
  };
  return {
    tokenCounts: before(rollout.tokenCounts),
    turns: before(rollout.turns),
  };
}

function difference(after: TokenUsage, before: TokenUsage): TokenUsage {
  const grew = (field: keyof TokenUsage) =>
    Math.max(0, after[field] - before[field]);
  return {
    input_tokens: grew("input_tokens"),
    cached_input_tokens: grew("cached_input_tokens"),
    cache_write_input_tokens: grew("cache_write_input_tokens"),
    output_tokens: grew("output_tokens"),
  };
}

const ZERO: TokenUsage = {
  input_tokens: 0,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: 0,
};

// What the rollout holds past `cursor`. The receiver adds every report it gets, so
// usage is the growth of the cumulative `total_token_usage`, split by the model of
// the turn it grew in. The first total less its own `last_token_usage` is usage the
// session carried in when it started, and is not counted.
export function pendingCodexSpend(
  rollout: CodexRollout,
  cursor: CodexSpendCursor,
) {
  const byModel = new Map<
    string,
    {
      model: string | null;
      tokens: {
        input: number;
        output: number;
        cacheRead: number;
        cacheCreation: number;
      };
      startedAt: Date;
      endedAt: Date;
    }
  >();

  const first = rollout.tokenCounts[0];
  let previous = first?.last ? difference(first.total, first.last) : ZERO;

  rollout.tokenCounts.forEach((entry, index) => {
    const delta = difference(entry.total, previous);
    previous = entry.total;
    if (index < cursor.tokenCounts) return;

    const key = entry.model ?? "";
    const bucket = byModel.get(key) ?? {
      model: entry.model,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      startedAt: entry.at,
      endedAt: entry.at,
    };
    bucket.tokens.input += Math.max(
      0,
      delta.input_tokens - delta.cached_input_tokens,
    );
    bucket.tokens.cacheRead += delta.cached_input_tokens;
    bucket.tokens.cacheCreation += delta.cache_write_input_tokens;
    bucket.tokens.output += delta.output_tokens;
    bucket.endedAt = entry.at;
    byModel.set(key, bucket);
  });

  const usage = [...byModel.values()].filter(
    ({ tokens }) =>
      tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation >
      0,
  );

  const turns = rollout.turns.slice(cursor.turns).map((turn) => ({
    startedAt: subMilliseconds(turn.at, turn.durationMs),
    endedAt: turn.at,
  }));

  return {
    usage,
    turns,
    cursor: {
      tokenCounts: rollout.tokenCounts.length,
      turns: rollout.turns.length,
    },
  };
}

export type PendingCodexSpend = ReturnType<typeof pendingCodexSpend>;
