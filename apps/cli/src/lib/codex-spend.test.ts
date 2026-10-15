import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HookDryRun } from "./hook-request";
import { clearHookState } from "./agent-hook-state";
import { pendingCodexSpend, readCodexRollout } from "./codex-rollout";
import { buildCodexSpendTraces, reportCodexSpend } from "./codex-spend";

const FIXTURE = join(
  import.meta.dirname,
  "__fixtures__",
  "codex-0.162.1-rollout.jsonl",
);
const SESSION_ID = "0e5d7c1a-4b2f-7a90-9c3e-5f1b2d8a6e47";
const ENDPOINT = "https://otel.example.com";
const TOKEN = "ctop_agt_testtoken";

let home: string;
let rollout: string;
let requests: { url: string; body: string }[];
let status: number;
const previous = { HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME };

beforeEach(() => {
  // A few hours after the fixture's session, so its lines are recent.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T12:00:00Z") });
  home = mkdtempSync(join(tmpdir(), "clocktopus-codex-spend-"));
  process.env.HOME = home;
  process.env.CODEX_HOME = join(home, ".codex");

  const day = join(home, ".codex", "sessions", "2026", "10", "14");
  mkdirSync(day, { recursive: true });
  rollout = join(day, `rollout-2026-10-14T09-12-04-${SESSION_ID}.jsonl`);
  copyFileSync(FIXTURE, rollout);

  requests = [];
  status = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      requests.push({ url, body: init.body });
      return new Response("{}", { status });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
});

const report = (
  transcriptPath: string | null = null,
  dryRun: HookDryRun | null = null,
) =>
  reportCodexSpend({
    endpoint: ENDPOINT,
    token: TOKEN,
    sessionId: SESSION_ID,
    transcriptPath,
    dryRun,
  });

type Span = {
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: {
    key: string;
    value: { stringValue?: string; intValue?: string };
  }[];
};

function spansOf(body: string): Span[] {
  return JSON.parse(body).resourceSpans[0].scopeSpans[0].spans;
}

function attributesOf(span: Span) {
  return Object.fromEntries(
    span.attributes.map(({ key, value }) => [
      key,
      value.stringValue ?? value.intValue,
    ]),
  );
}

describe("buildCodexSpendTraces", () => {
  it("sends token counts, the model and the session id as GenAI spans", async () => {
    const read = await readCodexRollout(rollout);
    const body = buildCodexSpendTraces({
      sessionId: SESSION_ID,
      cliVersion: read.cliVersion,
      spend: pendingCodexSpend(read, { tokenCounts: 0, turns: 0 }),
    });
    const spans = body.resourceSpans[0]!.scopeSpans[0]!.spans;

    expect(spans.map((span) => span.name)).toEqual([
      "gen_ai.client.session",
      "gen_ai.client.generation",
    ]);
    expect(attributesOf(spans[1]!)).toEqual({
      "gen_ai.client.session_id": SESSION_ID,
      "gen_ai.client.name": "codex",
      "gen_ai.request.model": "gpt-5.6-sol",
      "gen_ai.usage.input_tokens": "3017",
      "gen_ai.usage.output_tokens": "113",
      "gen_ai.usage.cache_read_input_tokens": "24064",
      "gen_ai.usage.cache_creation_input_tokens": "0",
    });
    expect(spans[0]).toMatchObject({
      startTimeUnixNano: `${Date.parse("2026-10-14T09:12:04.712Z")}000000`,
      endTimeUnixNano: `${Date.parse("2026-10-14T09:12:09.360Z")}000000`,
    });
  });

  it("carries nothing a person wrote, nor any path", async () => {
    const read = await readCodexRollout(rollout);
    const body = JSON.stringify(
      buildCodexSpendTraces({
        sessionId: SESSION_ID,
        cliVersion: read.cliVersion,
        spend: pendingCodexSpend(read, { tokenCounts: 0, turns: 0 }),
      }),
    );

    expect(body).not.toMatch(/CLOCKTOPUS-FIXTURE/);
    expect(body).not.toContain("acme-portal");
    expect(body).not.toContain("/home/");
    expect(body).not.toContain("gen_ai.usage.cost");
  });
});

// Appends a turn that grew the fixture's totals by 1000 input and 20 output tokens.
function resume(timestamp: string) {
  appendFileSync(
    rollout,
    `${JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 28081,
            cached_input_tokens: 24064,
            output_tokens: 133,
          },
        },
      },
    })}\n`,
  );
}

function expectOnlyTheResumedTurn(body: string) {
  const spans = spansOf(body);
  expect(spans.map((span) => span.name)).toEqual(["gen_ai.client.generation"]);
  expect(attributesOf(spans[0]!)).toMatchObject({
    "gen_ai.usage.input_tokens": "1000",
    "gen_ai.usage.output_tokens": "20",
    "gen_ai.usage.cache_read_input_tokens": "0",
  });
}

describe("reportCodexSpend", () => {
  it("posts the session's spend to the traces lane once", async () => {
    await report();
    await report();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(`${ENDPOINT}/v1/traces`);
    const generation = spansOf(requests[0]!.body).find(
      (span) => span.name === "gen_ai.client.generation",
    )!;
    expect(attributesOf(generation)["gen_ai.usage.input_tokens"]).toBe("3017");
  });

  it("reads the file Codex names in the hook payload", async () => {
    const elsewhere = join(home, `rollout-moved-${SESSION_ID}.jsonl`);
    copyFileSync(rollout, elsewhere);
    rmSync(rollout);

    await report(elsewhere);

    expect(requests).toHaveLength(1);
  });

  it("posts only what a resumed session added", async () => {
    await report();
    resume("2026-10-14T10:00:05.000Z");
    await report();

    expect(requests).toHaveLength(2);
    expectOnlyTheResumedTurn(requests[1]!.body);
  });

  it("posts only what a resumed session added after agent disable cleared the hook state", async () => {
    await report();
    clearHookState();
    resume("2026-10-14T10:00:05.000Z");
    await report();

    expect(requests).toHaveLength(2);
    expectOnlyTheResumedTurn(requests[1]!.body);
  });

  it("posts only what a resumed session added after its cursor was pruned", async () => {
    await report();
    rmSync(join(home, ".cache", "clocktopus", "codex-spend"), {
      recursive: true,
    });
    vi.setSystemTime(new Date("2027-03-01T12:00:00Z"));
    resume("2027-03-01T11:59:00.000Z");
    await report();

    expect(requests).toHaveLength(2);
    expectOnlyTheResumedTurn(requests[1]!.body);
  });

  it("posts all of a recent session that has no cursor yet", async () => {
    vi.setSystemTime(new Date("2027-01-11T12:00:00Z"));
    await report();

    expect(requests).toHaveLength(1);
    expect(spansOf(requests[0]!.body).map((span) => span.name)).toEqual([
      "gen_ai.client.session",
      "gen_ai.client.generation",
    ]);
  });

  it("sends the same report again after the receiver refused it", async () => {
    status = 503;
    await report();
    status = 200;
    await report();

    expect(requests).toHaveLength(2);
    expect(requests[1]!.body).toBe(requests[0]!.body);
  });

  it("sends nothing while Codex's own exporter from an older setup still reports", async () => {
    writeFileSync(
      join(home, ".codex", "config.toml"),
      `[otel]
log_user_prompt = false

[otel.exporter.otlp-http]
endpoint = "${ENDPOINT}/v1/logs"
protocol = "json"

[otel.exporter.otlp-http.headers]
Authorization = "Bearer ${TOKEN}"
`,
    );
    await report();
    expect(requests).toHaveLength(0);

    // Once setup removes the exporter, what it already sent is not sent again.
    rmSync(join(home, ".codex", "config.toml"));
    await report();
    expect(requests).toHaveLength(0);
  });

  it("sends nothing for a file that belongs to another session", async () => {
    writeFileSync(
      rollout,
      readFileSync(FIXTURE, "utf8").replaceAll(
        SESSION_ID,
        "7f00aa11-2b3c-4d5e-8f90-a1b2c3d4e5f6",
      ),
    );

    await report();

    expect(requests).toHaveLength(0);
  });

  it("prints the exact report on a dry run, sends nothing and leaves the spend to report later", async () => {
    const printed = join(home, "dry-run.txt");

    await report(null, { file: printed });
    expect(requests).toHaveLength(0);
    expect(existsSync(join(home, ".cache", "clocktopus"))).toBe(false);

    await report();
    expect(requests).toHaveLength(1);
    expect(readFileSync(printed, "utf8")).toBe(
      `POST ${ENDPOINT}/v1/traces\n${requests[0]!.body}\n`,
    );
    expect(readFileSync(printed, "utf8")).not.toContain(TOKEN);
  });

  it("does nothing, and does not throw, when there is no rollout", async () => {
    rmSync(rollout);

    await expect(report()).resolves.toBeUndefined();
    expect(requests).toHaveLength(0);
  });
});
