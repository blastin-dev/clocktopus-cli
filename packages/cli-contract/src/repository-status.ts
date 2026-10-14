import { z } from "zod";

import { DateOnlySchema, TimestampSchema } from "./timestamp";

// `covered`: an installation on the repository's owner (on a personal GitHub
// account, with the repository in its selection), a webhook that has delivered
// from it, or a webhook GitHub pinged from it (or its organisation) with `push`
// among its events. `unconfirmed`: any other webhook, or a personal
// installation whose selection GitHub did not return. `not_selected`: a
// personal installation on the owner that leaves it out.
export const RepositoryCoverageStatusSchema = z.enum([
  "covered",
  "unconfirmed",
  "not_selected",
  "not_covered",
]);
export type RepositoryCoverageStatus = z.infer<
  typeof RepositoryCoverageStatusSchema
>;

// What the member does next. `attach_project` comes with `covered`: a personal
// installation hooks only the repositories its organisation's projects attach.
export const RepositoryNextActionSchema = z.enum([
  "push",
  "attach_project",
  "check_selection",
  "check_webhook",
  "add_to_selection",
  "connect",
]);
export type RepositoryNextAction = z.infer<typeof RepositoryNextActionSchema>;

export const RepositoryConnectionKindSchema = z.enum([
  "app_installation",
  "webhook",
]);

// How the checkout's `user.email` compares with what credits a commit to the
// caller, as `decideAuthorEmailReadiness` in `@repo/core` decides it.
export const AuthorEmailStatusSchema = z.enum([
  "sign_in",
  "tracked",
  "pending",
  "untracked",
]);
export type AuthorEmailStatus = z.infer<typeof AuthorEmailStatusSchema>;

// What GitHub's ping said about a webhook. `missingEvents` are GitHub event
// names (`push`, `pull_request`, `pull_request_review`).
export const WebhookPingSchema = z.object({
  targetType: z.enum(["repository", "organization"]),
  target: z.string(),
  events: z.array(z.string()),
  missingEvents: z.array(z.string()),
  contentType: z.string().nullable(),
  receivedAt: TimestampSchema,
});

const RepositoryCoverageSchema = z.object({
  status: RepositoryCoverageStatusSchema,
  nextAction: RepositoryNextActionSchema,
  appInstallAccount: z.string().nullable(),
  connection: z
    .object({
      kind: RepositoryConnectionKindSchema,
      label: z.string(),
      // Null for a webhook.
      accountType: z.string().nullable().optional(),
      organizationId: z.string(),
      organizationName: z.string().optional(),
      connectedByName: z.string(),
      connectedByCaller: z.boolean(),
      lastDeliveryAt: TimestampSchema.nullable(),
      // Absent from servers older than the CLI.
      ping: WebhookPingSchema.nullable().optional().catch(undefined),
    })
    .nullable(),
});

const AuthorEmailSchema = z.object({
  email: z.string(),
  status: AuthorEmailStatusSchema,
  // Commits from the address this repository delivered within the server's
  // look-back window, and how many of them were booked to the caller.
  commits: z.number(),
  credited: z.number(),
  lastReceivedAt: TimestampSchema.nullable(),
  // Untracked addresses GitHub matched to the caller's account.
  githubMatched: z.array(z.string()),
});

// `GET /api/agent/repo-status`.
export const RepoStatusSchema = z.object({
  repository: z
    .object({
      provider: z.string(),
      ownerRepo: z.string(),
      displayUrl: z.string(),
    })
    .nullable(),
  attribution: z.object({
    reason: z.enum([
      "attributed",
      "no_repository",
      "unsupported_remote",
      "no_matching_project",
      "ambiguous_project",
    ]),
    projectId: z.string().nullable(),
    projectNames: z.array(z.string()),
  }),
  commitLane: z.object({
    status: z.enum(["delivering", "no_secret", "no_delivery"]),
    lastCommitAt: TimestampSchema.nullable(),
    // Any connection in the organisation, not necessarily on this repository.
    hasWebhookSecret: z.boolean(),
    // Absent when the server does not send it, or sends a shape this CLI does
    // not know; null for an unsupported remote.
    coverage: RepositoryCoverageSchema.nullable().optional().catch(undefined),
  }),
  ready: z.boolean(),
  webhookUrl: z.string(),
  // The fields below are absent from servers older than `clocktopus init`.
  // Every project in the caller's organisations that attaches the repository.
  linkedProjects: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        organizationId: z.string(),
        organizationName: z.string(),
      }),
    )
    .optional(),
  deliveringStreams: z
    .array(
      z.object({
        kind: RepositoryConnectionKindSchema,
        lastDeliveryAt: TimestampSchema,
      }),
    )
    .optional()
    .catch(undefined),
  lastPullRequestAt: TimestampSchema.nullable().optional(),
  // Null unless the request sent `authorEmail`.
  authorEmail: AuthorEmailSchema.nullable().optional().catch(undefined),
});
export type RepoStatusResponse = z.infer<typeof RepoStatusSchema>;

// `GET /api/agent/repo-deliveries`.
export const RepoDeliveriesSchema = z.object({
  // Absent from servers older than the ping check.
  pings: z
    .array(WebhookPingSchema.extend({ secretId: z.string() }))
    .optional()
    .catch(undefined),
  commit: z
    .object({
      sha: z.string(),
      authorEmail: z.string(),
      authorLogin: z.string().nullable(),
    })
    .nullable(),
  ingestion: z.array(
    z.object({
      commitSha: z.string(),
      commitAuthorEmail: z.string(),
      workDate: DateOnlySchema,
      status: z.string(),
      lockReason: z.string().nullable(),
    }),
  ),
  failures: z.array(
    z.object({
      reason: z.string(),
      verified: z.boolean(),
      eventType: z.string().nullable().optional(),
      detail: z.string().nullable(),
      lastSeenAt: TimestampSchema,
    }),
  ),
});
export type RepoDeliveriesResponse = z.infer<typeof RepoDeliveriesSchema>;
