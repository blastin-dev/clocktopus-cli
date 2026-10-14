import { z } from "zod";

import { InstallHandoffOutcomeSchema } from "./install-handoff";
import { TimestampSchema } from "./timestamp";

// `POST /api/github/app/handoffs`: `installPath` is opened in the browser.
export const GithubInstallHandoffSchema = z.object({
  token: z.string(),
  installPath: z.string(),
  expiresAt: TimestampSchema,
});

// `GET /api/github/app/handoffs/{token}`. An outcome the CLI does not know
// reads as still pending.
export const GithubInstallHandoffStatusSchema = z.object({
  outcome: InstallHandoffOutcomeSchema.catch({ status: "pending" }),
  terminalUser: z.string(),
  expiresAt: TimestampSchema,
});
