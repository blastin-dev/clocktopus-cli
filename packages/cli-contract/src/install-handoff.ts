import { z } from "zod";

// What the browser's install round trip ended in, for the terminal that
// started it. `pending` until `/api/github/app/setup` records the outcome.
export const InstallHandoffOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("connected"), account: z.string() }),
  // `setup_action=request`: a GitHub organisation owner has to approve it.
  z.object({ status: z.literal("requested") }),
  z.object({
    status: z.literal("account_mismatch"),
    browserUser: z.string(),
  }),
  // `reason` is a setup failure reason, as in `github_app=error&reason=…`.
  z.object({ status: z.literal("failed"), reason: z.string() }),
]);

export type InstallHandoffOutcome = z.infer<typeof InstallHandoffOutcomeSchema>;
