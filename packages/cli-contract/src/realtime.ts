import { z } from "zod";

import { TimestampSchema } from "./timestamp";

export const RealtimeTopicSchema = z.enum([
  "time-entries",
  "clock-signals",
  "agent-sessions",
  "pull-requests",
  "ingestion-log",
  "setup-state",
  "github-app",
  "subscription",
  "tasks",
]);
export type RealtimeTopic = z.infer<typeof RealtimeTopicSchema>;

// A hint that something changed, never the data: the client refetches, so a
// duplicated, reordered or lost message costs at most one extra request.
export const RealtimeMessageSchema = z.object({
  v: z.literal(1),
  topic: RealtimeTopicSchema,
});
export type RealtimeMessage = z.infer<typeof RealtimeMessageSchema>;

export const USER_NAMESPACE = "user";
export const ORGANIZATION_NAMESPACE = "org";

export const userChannel = (userId: string) => `/${USER_NAMESPACE}/${userId}`;

export const organizationChannel = (organizationId: string) =>
  `/${ORGANIZATION_NAMESPACE}/${organizationId}`;

// What a client needs to open the socket: the Events API's hosts and a token
// that `subscribe` accepts until `expiresAt` (five minutes), for the user's
// channel and each of `organizationIds`' channels.
export const RealtimeConnectionSchema = z.object({
  httpHost: z.string(),
  realtimeHost: z.string(),
  userId: z.string(),
  organizationIds: z.array(z.string()),
  token: z.string(),
  expiresAt: TimestampSchema,
});
export type RealtimeConnection = z.infer<typeof RealtimeConnectionSchema>;

// `GET /api/realtime/connection`: null on a stage with no Events API.
export const RealtimeConnectionResponseSchema = z.object({
  connection: RealtimeConnectionSchema.nullable(),
});
