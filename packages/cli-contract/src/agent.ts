import { z } from "zod";

import { TimestampSchema } from "./timestamp";

// The server supplies the receiver endpoint because its URL differs per stage.

// `POST /api/agent/ingest-token`.
export const IngestTokenSchema = z.object({
  tokenId: z.string(),
  // Plaintext, returned exactly once: the server stores only a hash.
  token: z.string(),
  tokenPrefix: z.string(),
  endpoint: z.string(),
});
export type IngestTokenResponse = z.infer<typeof IngestTokenSchema>;

// `GET /api/agent/ingest-token`.
export const AgentEndpointSchema = z.object({
  endpoint: z.string(),
});

// `GET /api/agent/status`.
export const AgentStatusSchema = z.object({
  endpoint: z.string(),
  window: z.object({
    since: TimestampSchema,
    sessions: z.number(),
    unattributedSessions: z.number(),
    costMicroUsd: z.number(),
  }),
  hookLane: z.object({
    lastSessionStartedAt: TimestampSchema.nullable(),
    repositoryUrl: z.string().nullable(),
    gitBranch: z.string().nullable(),
    cwd: z.string().nullable(),
    attributed: z.boolean().nullable(),
  }),
  metricsLane: z.object({
    lastExportReceivedAt: TimestampSchema.nullable(),
    lastModel: z.string().nullable(),
  }),
  tokens: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      tokenPrefix: z.string(),
      lastUsedAt: TimestampSchema.nullable(),
      usageCount: z.number(),
      createdAt: TimestampSchema,
    }),
  ),
});
export type AgentStatusResponse = z.infer<typeof AgentStatusSchema>;

// `POST /v1/verify` on the OTLP receiver: `userId` owns the ingest token.
export const ReceiverVerifySchema = z.object({
  ok: z.literal(true),
  userId: z.string(),
});
