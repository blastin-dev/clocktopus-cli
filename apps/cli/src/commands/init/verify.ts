import type {
  RepoDeliveriesResponse,
  RepoStatusResponse,
} from "@repo/cli-contract/repository-status";
import { RepoDeliveriesSchema } from "@repo/cli-contract/repository-status";
import { differenceInMilliseconds, subSeconds } from "date-fns";
import { z } from "zod";

import type { RepoCheck } from "../../lib/repo-guidance.js";
import type { Checkout, InitDeps, InitOptions, InitState } from "./types.js";
import { ApiError } from "../../lib/api.js";
import { formatAgo } from "../../lib/format.js";
import { attributionCheck, commitLaneCheck } from "../../lib/repo-guidance.js";
import {
  eventLabels,
  MISSING_EVENTS_FIX,
  pingTargetLabel,
} from "../../lib/webhook-ping.js";

export const DELIVERY_POLL_INTERVAL_MS = 3000;
export const DELIVERY_POLL_TIMEOUT_MS = 2 * 60 * 1000;
const TEST_COMMIT_MESSAGE = "chore: check Clocktopus delivery";

function authorCheck(status: RepoStatusResponse): RepoCheck | null {
  const author = status.authorEmail;
  if (!author) return null;
  if (author.credited > 0) {
    return {
      label: "Author",
      ok: true,
      detail: `${author.credited} commit${author.credited === 1 ? "" : "s"} from ${author.email} credited to you`,
    };
  }
  if (author.status === "untracked") {
    return {
      label: "Author",
      ok: false,
      detail: `${author.email} is not one of your addresses`,
      fix: "Its commits arrive, but nobody is credited. Track it under Settings → Commit addresses.",
    };
  }
  if (author.status === "pending") {
    return {
      label: "Author",
      ok: "warn",
      detail: `${author.email} is waiting for you to open its confirmation link`,
    };
  }
  // Yours with nothing arrived is the expected state before a first push; the
  // test push is what proves crediting.
  if (author.commits === 0) {
    return {
      label: "Author",
      ok: true,
      detail: `${author.email} is yours; no commit from it has arrived yet`,
    };
  }
  return {
    label: "Author",
    ok: "warn",
    detail: `${author.commits} commit${author.commits === 1 ? "" : "s"} from ${author.email} arrived, none credited to you yet`,
  };
}

function pullRequestCheck(status: RepoStatusResponse): RepoCheck {
  const ping = status.commitLane.coverage?.connection?.ping;
  const missing = (ping?.missingEvents ?? []).filter(
    (event) => event !== "push",
  );
  if (ping && missing.length > 0) {
    return {
      label: "Pull requests",
      ok: false,
      detail: `the webhook on ${pingTargetLabel(ping)} does not send ${eventLabels(missing)}`,
      fix: MISSING_EVENTS_FIX,
    };
  }
  if (status.lastPullRequestAt) {
    return {
      label: "Pull requests",
      ok: true,
      detail: `last event received ${formatAgo(status.lastPullRequestAt)}`,
    };
  }
  const coverage = status.commitLane.coverage;
  if (coverage?.status === "covered" || coverage?.status === "unconfirmed") {
    return {
      label: "Pull requests",
      ok: "warn",
      detail: "none received yet; they arrive through the same connection",
    };
  }
  return {
    label: "Pull requests",
    ok: false,
    detail: "nothing connects this repository",
  };
}

function agentsCheck(
  agents: ReturnType<InitDeps["surveyAgents"]>,
): RepoCheck | null {
  const installed = agents.filter((entry) => entry.installed);
  if (installed.length === 0) return null;
  const configured = installed.filter((entry) => entry.configured);
  if (configured.length === 0) {
    return {
      label: "Agents",
      ok: false,
      detail: "none report to Clocktopus",
      fix: "Run 'clocktopus agent setup'.",
    };
  }
  return {
    label: "Agents",
    ok: configured.length === installed.length ? true : "warn",
    detail: `${configured.map((entry) => entry.agent.label).join(", ")} configured; 'clocktopus agent status' shows what arrived`,
  };
}

// Attribution (project and author), commits, pull requests and agents, each
// from what the server received rather than from configuration.
export function verifyLanes(
  status: RepoStatusResponse,
  agents: ReturnType<InitDeps["surveyAgents"]>,
): RepoCheck[] {
  return [
    attributionCheck(status),
    authorCheck(status),
    commitLaneCheck(status),
    pullRequestCheck(status),
    agentsCheck(agents),
  ].filter((check): check is RepoCheck => check !== null);
}

// Only proven end to end: the repository maps to a project, its commits are
// arriving, and at least one of them was credited to the caller.
export function isVerified(status: RepoStatusResponse): boolean {
  return status.ready && (status.authorEmail?.credited ?? 0) > 0;
}

export function deliversTwice(status: RepoStatusResponse): boolean {
  const kinds = new Set(status.deliveringStreams?.map((stream) => stream.kind));
  return kinds.has("app_installation") && kinds.has("webhook");
}

function renderChecks(checks: RepoCheck[]): string[] {
  return checks.flatMap((check) => {
    const symbol = check.ok === true ? "✓" : check.ok === "warn" ? "⚠" : "✗";
    const line = `  ${symbol} ${check.label.padEnd(14)}${check.detail}`;
    return check.ok !== true && check.fix
      ? [line, `      ${check.fix}`]
      : [line];
  });
}

export const FAILURE_FIXES: Record<string, string> = {
  missing_signature:
    "the delivery carried no signature — set the webhook's secret",
  invalid_signature:
    "no secret matched the delivery's signature — paste the secret again, or create a new one",
  invalid_json:
    "the body was not JSON — set the content type to application/json",
  invalid_payload:
    "the payload was not a push or pull request — check the webhook's events",
  unknown_provider: "the request came from neither GitHub nor Bitbucket",
};

const INGESTION_OUTCOMES: Record<string, { ok: boolean; text: string }> = {
  entry_created: { ok: true, text: "received and booked to you" },
  force_push_collapsed: {
    ok: true,
    text: "received; a force push folded it into the day's entry",
  },
  force_push_ignored: {
    ok: true,
    text: "received; force pushes are ignored by your preferences",
  },
  skipped_locked: {
    ok: false,
    text: "received, but the day is locked — unlock it on the Time screen",
  },
  skipped_no_subscription: {
    ok: false,
    text: "received, but the organisation's subscription is not active",
  },
};

// What the deliveries since a test push say. `done` once the commit was
// booked, refused, or reached the ledger without being booked to the caller.
export function interpretDeliveries(
  deliveries: RepoDeliveriesResponse,
  sha: string,
): { done: boolean; lines: string[] } {
  const booked = deliveries.ingestion.find(
    (row) => sha.startsWith(row.commitSha) || row.commitSha.startsWith(sha),
  );
  if (booked) {
    const outcome = INGESTION_OUTCOMES[booked.status] ?? {
      ok: false,
      text: `received with status ${booked.status}`,
    };
    return {
      done: true,
      lines: [
        `  ${outcome.ok ? "✓" : "✗"} Test push      ${outcome.text} (${booked.workDate})`,
      ],
    };
  }

  if (deliveries.failures.length > 0) {
    return {
      done: true,
      lines: deliveries.failures.map(
        (failure) =>
          `  ✗ Test push      ${FAILURE_FIXES[failure.reason] ?? failure.reason}${failure.detail ? ` (${failure.detail})` : ""}`,
      ),
    };
  }

  if (deliveries.commit) {
    return {
      done: true,
      lines: [
        `  ✗ Test push      arrived, but was not credited to you: its author is ${deliveries.commit.authorEmail}`,
        "      Track that address under Settings → Commit addresses, or set git config user.email to one of yours.",
      ],
    };
  }

  return { done: false, lines: [] };
}

function currentBranch(deps: InitDeps): string | null {
  const result = deps.run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = result.stdout.trim();
  return result.ok && branch && branch !== "HEAD" ? branch : null;
}

// An empty commit pushed to the current branch, then the deliveries polled
// until they say what became of it.
// Commits on origin's copy of the branch that this checkout lacks, which would
// reject the push. Zero when the branch is not on origin yet, or origin cannot
// be reached; the push reports that itself.
function commitsBehindOrigin(deps: InitDeps, branch: string): number {
  if (!deps.run("git", ["fetch", "--quiet", "origin", branch]).ok) return 0;
  const behind = deps.run("git", ["rev-list", "--count", "HEAD..FETCH_HEAD"]);
  return behind.ok ? Number(behind.stdout.trim()) || 0 : 0;
}

export async function runTestPush(
  deps: InitDeps,
  checkout: Checkout,
): Promise<void> {
  const branch = currentBranch(deps);
  if (!branch) {
    deps.log("  ✗ Test push      skipped — check out a branch first");
    return;
  }
  const behind = commitsBehindOrigin(deps, branch);
  if (behind > 0) {
    deps.log(
      `  ✗ Test push      skipped — ${branch} is ${behind} commit${behind === 1 ? "" : "s"} behind origin.\n` +
        "      Pull, then run 'clocktopus init --only verify --test-push'.",
    );
    return;
  }
  const since = subSeconds(deps.now(), 5);
  const commit = deps.run("git", [
    "commit",
    "--allow-empty",
    "--no-verify",
    "-m",
    TEST_COMMIT_MESSAGE,
  ]);
  if (!commit.ok) {
    deps.log(`  ✗ Test push      git commit failed: ${commit.stderr.trim()}`);
    return;
  }
  const sha = deps.run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const push = deps.run("git", ["push", "origin", `HEAD:${branch}`], {
    inherit: true,
  });
  if (!push.ok) {
    // The commit is empty, so a soft reset to its parent loses nothing; it is
    // skipped if HEAD has moved since.
    const head = deps.run("git", ["rev-parse", "HEAD"]).stdout.trim();
    const undone =
      head === sha && deps.run("git", ["reset", "--soft", `${sha}~1`]).ok;
    deps.log(
      undone
        ? "  ✗ Test push      git push failed; the empty commit was removed again"
        : `  ✗ Test push      git push failed; the empty commit ${sha.slice(0, 7)} stays local`,
    );
    return;
  }

  deps.log(`  Waiting for ${sha.slice(0, 7)} to reach Clocktopus…`);
  const path =
    `/api/agent/repo-deliveries?repositoryUrl=${encodeURIComponent(checkout.remote ?? "")}` +
    `&since=${encodeURIComponent(since.toISOString())}&sha=${sha}`;
  const started = deps.now();
  while (
    differenceInMilliseconds(deps.now(), started) < DELIVERY_POLL_TIMEOUT_MS
  ) {
    await deps.sleep(DELIVERY_POLL_INTERVAL_MS);
    let deliveries: RepoDeliveriesResponse;
    try {
      deliveries = RepoDeliveriesSchema.parse(await deps.api.get(path));
    } catch (error) {
      // A refused login stays refused; anything else is retried.
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        deps.log(
          "  ✗ Test push      Clocktopus refused the check. Run 'clocktopus login' and try again.",
        );
        return;
      }
      continue;
    }
    const result = interpretDeliveries(deliveries, sha);
    if (result.done) {
      for (const line of result.lines) deps.log(line);
      return;
    }
  }
  deps.log(
    `  ✗ Test push      nothing arrived within ${DELIVERY_POLL_TIMEOUT_MS / 60_000} minutes. Check the webhook's\n` +
      "      Recent Deliveries on GitHub (or Bitbucket's request history) for the response.",
  );
}

const GithubHooksSchema = z.array(
  z.object({
    id: z.number(),
    config: z.object({ url: z.string().optional() }),
  }),
);

// The caller's own webhook URL on the repository, which their `gh` login can
// remove; a teammate's hook is theirs to remove.
export function findOwnRepositoryHooks(
  hooksJson: string,
  webhookUrl: string,
): number[] {
  try {
    return GithubHooksSchema.parse(JSON.parse(hooksJson))
      .filter((hook) => hook.config.url === webhookUrl)
      .map((hook) => hook.id);
  } catch {
    return [];
  }
}

async function offerOldHookRemoval(
  deps: InitDeps,
  options: InitOptions,
  checkout: Checkout,
  status: RepoStatusResponse,
): Promise<void> {
  deps.log(
    "  ⚠ Delivering through both the GitHub App and a repository webhook. Each push\n" +
      "      arrives twice; the App alone is enough.",
  );
  const repository = checkout.repository;
  if (!checkout.ghInstalled || repository?.provider !== "github") return;

  const listed = deps.run("gh", ["api", `repos/${repository.ownerRepo}/hooks`]);
  const hookIds = listed.ok
    ? findOwnRepositoryHooks(listed.stdout, status.webhookUrl)
    : [];
  if (hookIds.length === 0) return;

  const remove =
    options.deleteOldHook ??
    (await deps.prompt.confirm(
      `Delete your old webhook on ${repository.ownerRepo} with gh?`,
      false,
    ));
  if (!remove) return;
  for (const id of hookIds) {
    const deleted = deps.run("gh", [
      "api",
      "--method",
      "DELETE",
      `repos/${repository.ownerRepo}/hooks/${id}`,
    ]);
    deps.log(
      deleted.ok
        ? `  ✓ Removed the repository webhook ${id}`
        : `  ✗ Could not remove webhook ${id}: ${deleted.stderr.trim()}`,
    );
  }
}

export async function runVerifyStep(
  deps: InitDeps,
  options: InitOptions,
  checkout: Checkout,
  status: RepoStatusResponse,
  state: InitState,
): Promise<void> {
  deps.log(
    `\nRepository  ${status.repository?.displayUrl ?? checkout.remote}\n`,
  );
  for (const line of renderChecks(verifyLanes(status, deps.surveyAgents()))) {
    deps.log(line);
  }

  if (deliversTwice(status)) {
    await offerOldHookRemoval(deps, options, checkout, status);
  }

  if (isVerified(status)) {
    deps.log(
      `\n✓ All set: commits from this checkout reach ${status.attribution.projectNames[0] ?? "its project"} and are credited to you.`,
    );
    return;
  }

  deps.log(
    "\nNot verified yet: nothing has arrived that proves the whole chain.",
  );
  // A push proves the hook end to end; the App's own install already did.
  const offer =
    state.connectedBy === "manual" ||
    status.commitLane.status !== "delivering" ||
    (status.authorEmail?.credited ?? 0) === 0;
  if (!offer || status.attribution.reason !== "attributed") return;

  const push =
    options.testPush ??
    (await deps.prompt.confirm(
      "Make an empty commit and push it to check the whole chain?",
      false,
    ));
  if (push) await runTestPush(deps, checkout);
}
