import type { RepoStatusResponse } from "@repo/cli-contract/repository-status";
import { z } from "zod";

import type { Checkout, InitDeps, InitOptions } from "./types.js";
import { ApiError } from "../../lib/api.js";

type AuthorEmail = NonNullable<RepoStatusResponse["authorEmail"]>;

export type EmailDecision =
  | { action: "none"; line: string }
  | { action: "offer_tracking"; email: string; line: string };

// Whether the checkout's `user.email` credits its commits to the caller, and
// what to do when it does not.
export function decideEmailStep(input: {
  gitEmail: string | null;
  authorEmail: AuthorEmail | null | undefined;
}): EmailDecision {
  if (!input.gitEmail) {
    return {
      action: "none",
      line:
        "✗ Git email     this checkout has no user.email — set one with\n" +
        "      git config user.email you@example.com",
    };
  }
  const email = input.gitEmail;
  if (!input.authorEmail) {
    return {
      action: "none",
      line: `⚠ Git email     ${email} — this server cannot compare it with your addresses`,
    };
  }
  switch (input.authorEmail.status) {
    case "sign_in":
      return {
        action: "none",
        line: `✓ Git email     ${email} is your sign-in email`,
      };
    case "tracked":
      return {
        action: "none",
        line: `✓ Git email     ${email} is one of your commit addresses`,
      };
    case "pending":
      return {
        action: "none",
        line: `⚠ Git email     ${email} is waiting for you to open the link sent to it`,
      };
    case "untracked":
      return {
        action: "offer_tracking",
        email,
        line: `✗ Git email     ${email} is neither your sign-in email nor a commit address, so its commits reach nobody`,
      };
  }
}

type EmailAction = "track" | "change" | "leave";

// The first choice is the answer on Enter.
export function emailChoices(
  decision: EmailDecision,
  gitEmail: string | null,
): Array<{ label: string; value: EmailAction }> {
  const change = {
    label: "Use a different email in this repository",
    value: "change" as const,
  };
  if (decision.action === "offer_tracking") {
    return [
      { label: `Track ${decision.email} as yours`, value: "track" },
      change,
      { label: "Leave it", value: "leave" },
    ];
  }
  if (!gitEmail) {
    return [
      { label: "Set an email for this repository", value: "change" },
      { label: "Leave it unset", value: "leave" },
    ];
  }
  return [{ label: `Keep ${gitEmail}`, value: "leave" }, change];
}

async function trackEmail(deps: InitDeps, email: string): Promise<void> {
  try {
    await deps.api.post("/api/commit-addresses", { email });
    deps.log(
      `✓ Git email     sent a confirmation link to ${email}; its commits count once you open it`,
    );
  } catch (error) {
    // The server refuses an address already confirmed or already waiting.
    if (error instanceof ApiError) {
      deps.log(`✗ Git email     ${error.message}`);
      return;
    }
    throw error;
  }
}

// Sets `user.email` in this repository only, never globally. Null when nothing
// changed.
async function changeGitEmail(deps: InitDeps): Promise<string | null> {
  for (;;) {
    const answer = await deps.prompt.text(
      "Email for commits in this repository (empty to keep it)",
      "",
    );
    if (!answer) return null;
    if (!z.string().email().safeParse(answer).success) {
      deps.log(`✗ ${answer} is not an email address`);
      continue;
    }
    const result = deps.run("git", ["config", "user.email", answer]);
    if (!result.ok) {
      deps.log(`✗ Git email     git config failed: ${result.stderr.trim()}`);
      return null;
    }
    return answer;
  }
}

// Returns the `user.email` the checkout has once the step is done.
export async function runEmailStep(
  deps: InitDeps,
  options: InitOptions,
  checkout: Checkout,
  status: RepoStatusResponse,
  refetch: (checkout: Checkout) => Promise<RepoStatusResponse | null>,
): Promise<string | null> {
  const decision = decideEmailStep({
    gitEmail: checkout.gitEmail,
    authorEmail: status.authorEmail,
  });
  deps.log(decision.line);

  const matched = status.authorEmail?.githubMatched ?? [];
  if (matched.length > 0) {
    deps.log(
      `  GitHub matched ${matched.join(", ")} to your account on this repository's commits.\n` +
        "  Add them under Settings → Commit addresses to credit commits that arrive without your login.",
    );
  }

  // A flag or a run off a terminal only ever answers the tracking question.
  if (options.trackEmail !== undefined || !deps.prompt.interactive) {
    if (decision.action !== "offer_tracking") return checkout.gitEmail;
    const track =
      options.trackEmail ??
      (await deps.prompt.confirm(`Track ${decision.email} as yours?`, true));
    if (track) await trackEmail(deps, decision.email);
    return checkout.gitEmail;
  }

  const action = await deps.prompt.choose(
    "Which email should commits in this repository carry?",
    emailChoices(decision, checkout.gitEmail),
    0,
  );
  if (action === "track" && decision.action === "offer_tracking") {
    await trackEmail(deps, decision.email);
  }
  if (action !== "change") return checkout.gitEmail;

  const gitEmail = await changeGitEmail(deps);
  if (!gitEmail) return checkout.gitEmail;

  const next = await refetch({ ...checkout, gitEmail });
  const changed = decideEmailStep({
    gitEmail,
    authorEmail: next?.authorEmail,
  });
  deps.log(changed.line);
  if (
    changed.action === "offer_tracking" &&
    (await deps.prompt.confirm(`Track ${changed.email} as yours?`, true))
  ) {
    await trackEmail(deps, changed.email);
  }
  return gitEmail;
}
