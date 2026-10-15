import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findCodexRollout,
  pendingCodexSpend,
  readCodexRollout,
} from "./codex-rollout";

// Built from a Codex 0.162.1 `codex exec` rollout (one turn, one tool call), with
// every id, path and piece of content invented.
const FIXTURE = join(
  import.meta.dirname,
  "__fixtures__",
  "codex-0.162.1-rollout.jsonl",
);
const SESSION_ID = "0e5d7c1a-4b2f-7a90-9c3e-5f1b2d8a6e47";

let dir: string;
let rollout: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "clocktopus-codex-rollout-"));
  rollout = join(dir, `rollout-2026-10-14T09-12-04-${SESSION_ID}.jsonl`);
  copyFileSync(FIXTURE, rollout);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function line(timestamp: string, type: string, payload: unknown): string {
  return `${JSON.stringify({ timestamp, type, payload })}\n`;
}

function usage(input: number, cached: number, output: number) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: input + output,
  };
}

// A second turn, as a resumed session appends it, on another model.
function appendTurn(totals: { input: number; cached: number; output: number }) {
  appendFileSync(
    rollout,
    line("2026-10-14T10:00:00.000Z", "turn_context", {
      model: "gpt-5.6-terra",
      cwd: "/home/dana/work/acme-portal",
    }) +
      line("2026-10-14T10:00:05.000Z", "event_msg", {
        type: "token_count",
        info: {
          total_token_usage: usage(totals.input, totals.cached, totals.output),
          last_token_usage: usage(
            totals.input - 27081,
            totals.cached - 24064,
            totals.output - 113,
          ),
        },
      }) +
      line("2026-10-14T10:00:06.000Z", "event_msg", {
        type: "task_complete",
        duration_ms: 6000,
      }),
  );
}

describe("readCodexRollout", () => {
  it("reads the session id, the model, the cumulative totals and the turns", async () => {
    const read = await readCodexRollout(rollout);

    expect(read.sessionId).toBe(SESSION_ID);
    expect(read.cliVersion).toBe("0.162.1");
    expect(read.tokenCounts.map((entry) => entry.model)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-sol",
    ]);
    expect(read.tokenCounts.map((entry) => entry.total)).toEqual([
      {
        input_tokens: 13495,
        cached_input_tokens: 11008,
        cache_write_input_tokens: 0,
        output_tokens: 52,
      },
      {
        input_tokens: 27081,
        cached_input_tokens: 24064,
        cache_write_input_tokens: 0,
        output_tokens: 113,
      },
    ]);
    expect(read.turns).toEqual([
      { at: new Date("2026-10-14T09:12:09.360Z"), durationMs: 4648 },
    ]);
  });

  it("keeps no text from the file but the model and version", async () => {
    const serialised = JSON.stringify(await readCodexRollout(rollout));

    expect(serialised).not.toMatch(/CLOCKTOPUS-FIXTURE/);
    expect(serialised).not.toContain("acme-portal");
    expect(serialised).not.toContain("999999");
  });

  it("skips lines that are not JSON", async () => {
    appendFileSync(rollout, '{"type":"token_count", truncated\n');
    const read = await readCodexRollout(rollout);

    expect(read.tokenCounts).toHaveLength(2);
  });
});

describe("pendingCodexSpend", () => {
  it("reports the session's usage net of the cached prefix, and its turns", async () => {
    const pending = pendingCodexSpend(await readCodexRollout(rollout), {
      tokenCounts: 0,
      turns: 0,
    });

    // 27081 input tokens, of which 24064 were cached; output includes the 54
    // reasoning tokens.
    expect(pending.usage).toEqual([
      {
        model: "gpt-5.6-sol",
        tokens: {
          input: 3017,
          output: 113,
          cacheRead: 24064,
          cacheCreation: 0,
        },
        startedAt: new Date("2026-10-14T09:12:07.642Z"),
        endedAt: new Date("2026-10-14T09:12:09.354Z"),
      },
    ]);
    expect(pending.turns).toEqual([
      {
        startedAt: new Date("2026-10-14T09:12:04.712Z"),
        endedAt: new Date("2026-10-14T09:12:09.360Z"),
      },
    ]);
    expect(pending.cursor).toEqual({ tokenCounts: 2, turns: 1 });
  });

  it("reports nothing again from the cursor it returned", async () => {
    const read = await readCodexRollout(rollout);
    const first = pendingCodexSpend(read, { tokenCounts: 0, turns: 0 });

    expect(pendingCodexSpend(read, first.cursor)).toMatchObject({
      usage: [],
      turns: [],
      cursor: first.cursor,
    });
  });

  it("reports only the growth of a resumed session, on the model it grew on", async () => {
    const first = pendingCodexSpend(await readCodexRollout(rollout), {
      tokenCounts: 0,
      turns: 0,
    });
    appendTurn({ input: 40000, cached: 30000, output: 200 });

    const second = pendingCodexSpend(
      await readCodexRollout(rollout),
      first.cursor,
    );

    expect(second.usage).toEqual([
      {
        model: "gpt-5.6-terra",
        tokens: {
          input: 40000 - 27081 - (30000 - 24064),
          output: 200 - 113,
          cacheRead: 30000 - 24064,
          cacheCreation: 0,
        },
        startedAt: new Date("2026-10-14T10:00:05.000Z"),
        endedAt: new Date("2026-10-14T10:00:05.000Z"),
      },
    ]);
    expect(second.turns).toEqual([
      {
        startedAt: new Date("2026-10-14T10:00:00.000Z"),
        endedAt: new Date("2026-10-14T10:00:06.000Z"),
      },
    ]);
  });

  it("adds up to the session's total however the reports are split", async () => {
    appendTurn({ input: 40000, cached: 30000, output: 200 });
    const read = await readCodexRollout(rollout);

    const none = { tokenCounts: 0, turns: 0 };

    const whole = pendingCodexSpend(read, none);
    const earlier = pendingCodexSpend(
      { ...read, tokenCounts: read.tokenCounts.slice(0, 1) },
      none,
    );
    const later = pendingCodexSpend(read, earlier.cursor);

    const sum = (reports: (typeof whole)["usage"][]) =>
      reports
        .flat()
        .reduce(
          (total, { tokens }) =>
            total + tokens.input + tokens.output + tokens.cacheRead,
          0,
        );

    expect(sum([earlier.usage, later.usage])).toBe(sum([whole.usage]));
    expect(sum([whole.usage])).toBe(40000 + 200);
  });

  it("does not count usage the session carried in when it started", async () => {
    writeFileSync(
      rollout,
      line("2026-10-14T09:00:00.000Z", "session_meta", {
        session_id: SESSION_ID,
      }) +
        line("2026-10-14T09:00:05.000Z", "event_msg", {
          type: "token_count",
          info: {
            total_token_usage: usage(50000, 40000, 900),
            last_token_usage: usage(1000, 800, 10),
          },
        }),
    );

    const pending = pendingCodexSpend(await readCodexRollout(rollout), {
      tokenCounts: 0,
      turns: 0,
    });

    expect(pending.usage[0]!.tokens).toEqual({
      input: 200,
      output: 10,
      cacheRead: 800,
      cacheCreation: 0,
    });
  });
});

describe("findCodexRollout", () => {
  const sessions = () => join(dir, "sessions");

  it("uses the transcript path Codex sends when it names this session", () => {
    expect(findCodexRollout(SESSION_ID, rollout, sessions())).toBe(rollout);
  });

  it("finds the file under the sessions folder by its session id", () => {
    const day = join(sessions(), "2026", "10", "13");
    mkdirSync(day, { recursive: true });
    mkdirSync(join(sessions(), "2026", "10", "14"), { recursive: true });
    const stored = join(day, `rollout-2026-10-13T23-59-01-${SESSION_ID}.jsonl`);
    copyFileSync(FIXTURE, stored);

    expect(findCodexRollout(SESSION_ID, null, sessions())).toBe(stored);
  });

  it("ignores a transcript path that names another file", () => {
    const other = join(dir, "notes.jsonl");
    writeFileSync(other, "");

    expect(findCodexRollout(SESSION_ID, other, sessions())).toBeNull();
  });

  it("refuses a session id that could leave the folder", () => {
    expect(findCodexRollout("../../etc", null, sessions())).toBeNull();
  });
});
