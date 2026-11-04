import { z } from "zod";

import { DateOnlySchema } from "./timestamp";

// The routes `clocktopus init` calls.

// `GET /api/onboarding`.
export const OnboardingStateSchema = z.object({
  preferencesConfirmed: z.boolean(),
  onboardingCompleted: z.boolean(),
  preferences: z
    .object({
      timezone: z.string(),
      workDayStartTime: z.string(),
      workDayEndTime: z.string(),
      workingHoursEnabled: z.boolean(),
      // Null disables the auto-lock.
      autoLockAfterDays: z.number().nullable().optional(),
    })
    .nullable(),
  organizations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      role: z.string(),
    }),
  ),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

// `POST /api/organizations`.
export const CreatedOrganizationSchema = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
});

// `GET /api/organizations/{organizationId}/projects`.
export const ManageableProjectsSchema = z.object({
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
});

// `POST /api/organizations/{organizationId}/projects`.
export const CreatedProjectSchema = z.object({
  project: z.object({ id: z.string() }),
  // What linking the project's repositories labelled and attributed.
  labels: z
    .object({
      entriesLabelled: z.number(),
      entriesSkippedNoSubscription: z.number(),
      pullRequestsLabelled: z.number(),
      agentSessionsAttributed: z.number(),
    })
    .optional(),
});

// `POST /api/organizations/{organizationId}/projects/{projectId}/tracker-key-prefixes`:
// `declared` are the sent prefixes the project now declares, `refused` the
// ones another project uses, with that project's name. The project's own task
// key prefix is in neither.
export const DeclaredTrackerKeyPrefixesSchema = z.object({
  taskKeyPrefix: z.string(),
  trackerKeyPrefixes: z.array(z.string()),
  declared: z.array(z.string()),
  refused: z.array(z.object({ prefix: z.string(), usedBy: z.string() })),
});

// `GET /api/organizations/{organizationId}/projects/{projectId}/repositories/preview`:
// how much of the caller's unassigned time attaching the repository files
// under the project.
export const RepositoryPreviewSchema = z.object({
  preview: z.object({
    entries: z.number(),
    seconds: z.number(),
    firstDay: DateOnlySchema.nullable(),
    lastDay: DateOnlySchema.nullable(),
    lockedEntries: z.number(),
  }),
});

// `POST /api/organizations/{organizationId}/webhook-secrets`.
export const CreatedWebhookSecretSchema = z.object({
  webhookSecret: z.object({
    id: z.string(),
    // Plaintext, returned exactly once.
    secret: z.string(),
    secretPrefix: z.string(),
    name: z.string().nullable().optional(),
  }),
  webhookUrl: z.string(),
});
