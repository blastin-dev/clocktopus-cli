import { subDays } from "date-fns";

import type { PendingCodexSpend } from "./codex-rollout.js";
import type { HookDryRun } from "./hook-request.js";
import {
  CODEX_SPEND_CURSOR_MAX_AGE_DAYS,
  readCodexSpendCursor,
  writeCodexSpendCursor,
} from "./agent-hook-state.js";
import { readCodexConfig, readCodexLogExporter } from "./codex-config.js";
import {
  codexSpendCursorBefore,
  findCodexRollout,
  pendingCodexSpend,
  readCodexRollout,
} from "./codex-rollout.js";
import { noteHookDryRun, postHookRequest } from "./hook-request.js";

// Codex's spend leaves the machine as the GenAI spans the receiver reads from the
// OpenCode plugin (`normalizeGenAiTraces` in core): token counts, model and session
// id, nothing else from the rollout. No price: Codex reports none.

const nano = (date: Date) => `${date.getTime()}000000`;

const attribute = (key: string, value: string | number) =>
  typeof value === "number"
    ? { key, value: { intValue: String(value) } }
    : { key, value: { stringValue: value } };

export function buildCodexSpendTraces(input: {
  sessionId: string;
  cliVersion: string | null;
  spend: Pick<PendingCodexSpend, "usage" | "turns">;
}) {
  const shared = [
    attribute("gen_ai.client.session_id", input.sessionId),
    attribute("gen_ai.client.name", "codex"),
  ];

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attribute("service.name", "codex"),
            ...(input.cliVersion
              ? [attribute("service.version", input.cliVersion)]
              : []),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "clocktopus.codex" },
            spans: [
              // One per completed turn: the receiver takes active time from the
              // duration of each session span.
              ...input.spend.turns.map((turn) => ({
                name: "gen_ai.client.session",
                startTimeUnixNano: nano(turn.startedAt),
                endTimeUnixNano: nano(turn.endedAt),
                attributes: shared,
              })),
              // The receiver fingerprints usage by session, model and these bounds, so
              // a retried report of the same lines is stored once.
              ...input.spend.usage.map((usage) => ({
                name: "gen_ai.client.generation",
                startTimeUnixNano: nano(usage.startedAt),
                endTimeUnixNano: nano(usage.endedAt),
                attributes: [
                  ...shared,
                  ...(usage.model
                    ? [attribute("gen_ai.request.model", usage.model)]
                    : []),
                  attribute("gen_ai.usage.input_tokens", usage.tokens.input),
                  attribute("gen_ai.usage.output_tokens", usage.tokens.output),
                  attribute(
                    "gen_ai.usage.cache_read_input_tokens",
                    usage.tokens.cacheRead,
                  ),
                  attribute(
                    "gen_ai.usage.cache_creation_input_tokens",
                    usage.tokens.cacheCreation,
                  ),
                ],
              })),
            ],
          },
        ],
      },
    ],
  };
}

// Never throws. The cursor moves only once the receiver accepts the report, so a
// failed one is retried by the session's next hook; a dry run never moves it.
export async function reportCodexSpend(input: {
  endpoint: string;
  token: string;
  sessionId: string;
  transcriptPath: string | null;
  dryRun: HookDryRun | null;
}): Promise<void> {
  const { dryRun } = input;
  try {
    const path = findCodexRollout(input.sessionId, input.transcriptPath);
    if (!path) return;

    const rollout = await readCodexRollout(path);
    if (rollout.sessionId !== input.sessionId) return;

    const pending = pendingCodexSpend(
      rollout,
      readCodexSpendCursor(input.sessionId) ??
        codexSpendCursorBefore(
          rollout,
          subDays(new Date(), CODEX_SPEND_CURSOR_MAX_AGE_DAYS),
        ),
    );

    // Codex's own exporter is still sending this session's spend: marking it reported
    // keeps it from being sent twice once setup removes the exporter.
    if (readCodexLogExporter(readCodexConfig().config).ours) {
      noteHookDryRun(
        dryRun,
        "Codex spend: Codex's own log exporter still sends it, so the hook does not",
      );
      if (!dryRun) writeCodexSpendCursor(input.sessionId, pending.cursor);
      return;
    }

    if (pending.usage.length === 0 && pending.turns.length === 0) {
      noteHookDryRun(dryRun, "Codex spend: nothing new since the last report");
      if (!dryRun) writeCodexSpendCursor(input.sessionId, pending.cursor);
      return;
    }

    const body = buildCodexSpendTraces({
      sessionId: input.sessionId,
      cliVersion: rollout.cliVersion,
      spend: pending,
    });

    const { status } = await postHookRequest({
      endpoint: input.endpoint,
      path: "/v1/traces",
      token: input.token,
      body,
      dryRun,
    });
    if (!dryRun && status !== null && status >= 200 && status < 300) {
      writeCodexSpendCursor(input.sessionId, pending.cursor);
    }
  } catch {
    // Telemetry must never break the session it measures.
  }
}
