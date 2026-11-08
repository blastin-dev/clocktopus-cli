import { z } from "zod";

import { TimestampSchema } from "./timestamp";

export const PullRequestStatusSchema = z.enum([
  "open",
  "draft",
  "merged",
  "closed",
]);
export type PullRequestStatus = z.infer<typeof PullRequestStatusSchema>;

// A draft is an open pull request with `isDraft`; a provider keeps the flag on
// one merged or closed as a draft, which then reads by its state.
export function pullRequestStatus(input: {
  state: "open" | "merged" | "closed";
  isDraft: boolean;
}): PullRequestStatus {
  return input.state === "open" && input.isDraft ? "draft" : input.state;
}

// A pull request carrying a task's key, as the task panels list it.
export const TaskPullRequestSchema = z.object({
  // `github` or `bitbucket`.
  provider: z.string(),
  // Lowercase `owner/repo`.
  repository: z.string(),
  number: z.number(),
  title: z.string(),
  // The pull request's page at its provider.
  url: z.string(),
  status: PullRequestStatusSchema,
  openedAt: TimestampSchema,
});
export type TaskPullRequest = z.infer<typeof TaskPullRequestSchema>;
