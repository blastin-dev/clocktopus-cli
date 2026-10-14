import type {
  RepoDeliveriesResponse,
  RepoStatusResponse,
} from "@repo/cli-contract/repository-status";
import { CLOCKTOPUS_HOOK_EVENTS } from "@repo/cli-contract/github-hook-events";
import { CreatedWebhookSecretSchema } from "@repo/cli-contract/onboarding";
import { RepoDeliveriesSchema } from "@repo/cli-contract/repository-status";
import { differenceInMilliseconds, subSeconds } from "date-fns";

import type { WebhookPing } from "../../lib/webhook-ping.js";
import type { ParsedRemote } from "./checkout.js";
import type {
  Checkout,
  ConnectMode,
  InitDeps,
  InitOptions,
  InitState,
} from "./types.js";
import { describeGithubAppOutcome } from "../../lib/github-app-connect.js";
import {
  eventLabels,
  MISSING_EVENTS_FIX,
  missingEventsConsequence,
  pingTargetLabel,
} from "../../lib/webhook-ping.js";
import { CONNECT_MODES } from "./types.js";
import { FAILURE_FIXES } from "./verify.js";

type Coverage = NonNullable<RepoStatusResponse["commitLane"]["coverage"]>;

export function parseConnectMode(
  value: string | undefined,
): ConnectMode | undefined {
  if (value === undefined) return undefined;
  const mode = CONNECT_MODES.find(
    (candidate) => candidate === value.trim().toLowerCase(),
  );
  if (!mode) {
    throw new Error(
      `Unknown --connect value "${value}". Use one of: ${CONNECT_MODES.join(", ")}.`,
    );
  }
  return mode;
}

// How to connect a repository nothing covers yet: Bitbucket has only the
// manual hook; GitHub offers the App first. Without a flag, a repository an
// existing connection covers (`covered`), or one whose connection only needs
// checking (`pending`), gets no second connection.
export function decideConnectMode(input: {
  provider: ParsedRemote["provider"];
  nextAction: Coverage["nextAction"] | null;
  flag: ConnectMode | undefined;
  ghInstalled: boolean;
}): ConnectMode | "covered" | "pending" | "ask" {
  if (input.flag === "skip") return "skip";
  if (input.flag === undefined) {
    switch (input.nextAction) {
      case "push":
      case "attach_project":
        return "covered";
      case "check_selection":
      case "check_webhook":
        return "pending";
    }
  }

  if (input.provider === "bitbucket") {
    return input.flag === undefined ? "ask" : "manual";
  }
  if (input.flag === "gh" && !input.ghInstalled) return "manual";
  return input.flag ?? "ask";
}

export function ghHookArgs(input: {
  ownerRepo: string;
  url: string;
  secret: string;
}): string[] {
  return [
    "api",
    `repos/${input.ownerRepo}/hooks`,
    "--method",
    "POST",
    "-f",
    "name=web",
    "-F",
    "active=true",
    ...CLOCKTOPUS_HOOK_EVENTS.flatMap((event) => ["-f", `events[]=${event}`]),
    "-f",
    `config[url]=${input.url}`,
    "-f",
    "config[content_type]=json",
    "-f",
    `config[secret]=${input.secret}`,
  ];
}

function manualInstructions(
  repository: ParsedRemote,
  hook: { url: string; secret: string },
): string[] {
  if (repository.provider === "bitbucket") {
    return [
      `  In Bitbucket, open ${repository.ownerRepo} → Repository settings → Webhooks → Add webhook:`,
      `    URL       ${hook.url}`,
      `    Secret    ${hook.secret}`,
      "    Triggers  Repository push; Pull request created, updated, approved,",
      "              merged and declined",
    ];
  }
  return [
    `  On GitHub, open ${repository.ownerRepo} → Settings → Webhooks → Add webhook:`,
    `    Payload URL   ${hook.url}`,
    "    Content type  application/json",
    `    Secret        ${hook.secret}`,
    "    Events        Pushes, Pull requests, Pull request reviews",
  ];
}

export const PING_POLL_INTERVAL_MS = 3000;
// GitHub pings a hook the moment it is saved, so the wait is short once the
// hook exists; off a terminal nobody confirms that, so the person adding it by
// hand gets longer.
export const PING_WAIT_MS = 2 * 60 * 1000;
export const PING_WAIT_UNATTENDED_MS = 10 * 60 * 1000;

// Failures that mean the hook reached Clocktopus but cannot be read.
const SETUP_FAILURES = new Set([
  "missing_signature",
  "invalid_signature",
  "invalid_json",
]);

export type ManualHookConfirmation =
  | { status: "confirmed"; ping: WebhookPing }
  | { status: "missing_events"; ping: WebhookPing }
  | { status: "failed"; reason: string }
  | { status: "timed_out" }
  | { status: "not_checked" };

// What the deliveries since the hook was added say about it. A ping from the
// new secret wins over one from any other, which means an older secret was
// pasted; a verified ping wins over a failure.
export function interpretPing(
  deliveries: RepoDeliveriesResponse,
  secretId: string,
): ManualHookConfirmation | null {
  const pings = deliveries.pings ?? [];
  const ping =
    pings.find((candidate) => candidate.secretId === secretId) ?? pings[0];
  if (ping) {
    return ping.missingEvents.length > 0
      ? { status: "missing_events", ping }
      : { status: "confirmed", ping };
  }
  const failure = deliveries.failures.find(
    (row) => !row.verified && SETUP_FAILURES.has(row.reason),
  );
  return failure ? { status: "failed", reason: failure.reason } : null;
}

export function describeManualHookConfirmation(
  confirmation: ManualHookConfirmation,
): string[] {
  switch (confirmation.status) {
    case "confirmed":
      return [
        `✓ Webhook       GitHub confirmed it on ${pingTargetLabel(confirmation.ping)}`,
      ];
    case "missing_events": {
      const { ping } = confirmation;
      const noPushes = ping.missingEvents.includes("push");
      return [
        `${noPushes ? "✗" : "⚠"} Webhook       seen on ${pingTargetLabel(ping)}, missing: ${eventLabels(ping.missingEvents)}`,
        `      ${missingEventsConsequence(ping.missingEvents)} ${MISSING_EVENTS_FIX}`,
      ];
    }
    case "failed":
      return [
        `✗ Webhook       GitHub reached Clocktopus, but ${FAILURE_FIXES[confirmation.reason] ?? confirmation.reason}`,
      ];
    case "timed_out":
      return [
        "⚠ Webhook       no ping from GitHub yet. Open the webhook on GitHub →",
        "      Recent Deliveries to see what Clocktopus answered.",
      ];
    case "not_checked":
      return [];
  }
}

// Waits for GitHub's ping to the hook just added, which says whether the
// secret matched and which events it sends. Bitbucket sends no ping, so its
// hook is proven by the first push, in the verify step.
export async function confirmManualHook(
  deps: InitDeps,
  input: {
    repository: ParsedRemote;
    remote: string;
    secretId: string;
    since: Date;
    timeoutMs: number;
  },
): Promise<ManualHookConfirmation> {
  if (input.repository.provider !== "github") {
    deps.log(
      "– Webhook       Bitbucket sends nothing until the first push; the check below waits for it",
    );
    return { status: "not_checked" };
  }

  deps.log("  Waiting for GitHub's ping to the new webhook…");
  const path =
    `/api/agent/repo-deliveries?repositoryUrl=${encodeURIComponent(input.remote)}` +
    `&since=${encodeURIComponent(input.since.toISOString())}`;
  const started = deps.now();
  let confirmation: ManualHookConfirmation = { status: "timed_out" };
  while (differenceInMilliseconds(deps.now(), started) < input.timeoutMs) {
    let deliveries: RepoDeliveriesResponse;
    try {
      deliveries = RepoDeliveriesSchema.parse(await deps.api.get(path));
    } catch {
      await deps.sleep(PING_POLL_INTERVAL_MS);
      continue;
    }
    // A server older than the ping check never reports one.
    if (deliveries.pings === undefined) return { status: "not_checked" };
    const found = interpretPing(deliveries, input.secretId);
    if (found) {
      confirmation = found;
      break;
    }
    await deps.sleep(PING_POLL_INTERVAL_MS);
  }

  for (const line of describeManualHookConfirmation(confirmation)) {
    deps.log(line);
  }
  return confirmation;
}

async function connectManually(
  deps: InitDeps,
  checkout: Checkout,
  repository: ParsedRemote,
  organizationId: string,
  useGh: boolean,
): Promise<void> {
  // The server's clock stamps the ping; a little slack covers a skewed one.
  const since = subSeconds(deps.now(), 30);
  const created = CreatedWebhookSecretSchema.parse(
    await deps.api.post(
      `/api/organizations/${encodeURIComponent(organizationId)}/webhook-secrets`,
      { name: `${repository.ownerRepo} (clocktopus init)`.slice(0, 100) },
    ),
  );
  const hook = {
    url: created.webhookUrl,
    secret: created.webhookSecret.secret,
  };
  const confirm = (timeoutMs: number) =>
    confirmManualHook(deps, {
      repository,
      remote: checkout.remote ?? "",
      secretId: created.webhookSecret.id,
      since,
      timeoutMs,
    });

  if (useGh && repository.provider === "github") {
    const result = deps.run(
      "gh",
      ghHookArgs({ ownerRepo: repository.ownerRepo, ...hook }),
    );
    if (result.ok) {
      deps.log(`✓ Connection    created the repository webhook with gh`);
      await confirm(PING_WAIT_MS);
      return;
    }
    deps.log(
      `✗ Connection    gh could not create the webhook: ${result.stderr.trim() || "unknown error"}`,
    );
    deps.log("  Add it by hand instead. The secret is shown only this once.");
  } else {
    deps.log("  Add this webhook. The secret is shown only this once.");
  }
  for (const line of manualInstructions(repository, hook)) deps.log(line);
  if (deps.prompt.interactive) {
    await deps.prompt.text("Press Enter once the webhook is saved", "");
  }
  await confirm(
    deps.prompt.interactive ? PING_WAIT_MS : PING_WAIT_UNATTENDED_MS,
  );
}

// Connects the repository so pushes and pull requests reach Clocktopus: the
// GitHub App when it can, a webhook (made with `gh` when asked) otherwise.
export async function runRepositoryStep(
  deps: InitDeps,
  options: InitOptions,
  checkout: Checkout,
  status: RepoStatusResponse,
  state: InitState,
): Promise<void> {
  const repository = checkout.repository;
  if (!repository || !checkout.remote) {
    deps.log(
      "⚠ Connection    only GitHub and Bitbucket remotes can be connected",
    );
    return;
  }
  const coverage = status.commitLane.coverage ?? null;
  const flag = parseConnectMode(options.connect);
  let mode = decideConnectMode({
    provider: repository.provider,
    nextAction: coverage?.nextAction ?? null,
    flag,
    ghInstalled: checkout.ghInstalled,
  });

  const label = coverage?.connection?.label ?? "your team's connection";
  if (mode === "covered") {
    deps.log(
      coverage?.nextAction === "attach_project"
        ? `⚠ Connection    the app on ${label} covers ${repository.ownerRepo} once a project attaches it (see Project above)`
        : `✓ Connection    ${label} already covers ${repository.ownerRepo}`,
    );
    return;
  }
  if (mode === "pending") {
    deps.log(
      coverage?.nextAction === "check_selection"
        ? `⚠ Connection    the app on ${label} is installed, but GitHub did not say whether it can see ${repository.ownerRepo}; make sure it is selected under Change repositories on GitHub`
        : `⚠ Connection    ${label} may cover ${repository.ownerRepo}; the check below confirms it`,
    );
    return;
  }
  if (coverage?.nextAction === "add_to_selection" && coverage.connection) {
    deps.log(
      `⚠ Connection    the app on ${coverage.connection.label} does not include ${repository.ownerRepo}; add it under Change repositories on GitHub`,
    );
  }

  const organizationId =
    state.organizationId ?? coverage?.connection?.organizationId ?? null;
  if (!organizationId) {
    deps.log("⚠ Connection    skipped — no organisation to connect it to");
    return;
  }

  if (mode === "ask") {
    const choices: Array<{ label: string; value: ConnectMode }> =
      repository.provider === "github"
        ? [
            {
              label: "Install the Clocktopus GitHub App (recommended)",
              value: "app",
            },
            ...(checkout.ghInstalled
              ? [
                  {
                    label: "Create a repository webhook with gh",
                    value: "gh" as const,
                  },
                ]
              : []),
            { label: "Add a repository webhook by hand", value: "manual" },
            { label: "Skip for now", value: "skip" },
          ]
        : [
            { label: "Add a repository webhook by hand", value: "manual" },
            { label: "Skip for now", value: "skip" },
          ];
    // Off a terminal nothing is installed or created without a flag.
    mode = deps.prompt.interactive
      ? await deps.prompt.choose(
          `How should ${repository.ownerRepo} reach Clocktopus?`,
          choices,
          0,
        )
      : "skip";
  }

  if (mode === "skip") {
    deps.log(
      `– Connection    skipped — run 'clocktopus init --connect ${repository.provider === "github" ? "app" : "manual"}' to connect ${repository.ownerRepo}`,
    );
    return;
  }

  if (mode === "app") {
    const listener = deps.listenForManualSwitch();
    let outcome;
    try {
      outcome = await deps.connectGithubApp({
        organizationId,
        repositoryUrl: checkout.remote,
        signal: listener.signal,
      });
    } finally {
      listener.stop();
    }
    deps.log(describeGithubAppOutcome(outcome));
    if (outcome.status === "connected") {
      state.connectedBy = "app";
      deps.log(`✓ Connection    the GitHub App covers ${repository.ownerRepo}`);
      return;
    }
    // The App went in and its message names the step left; a hook as well
    // would deliver every push twice.
    if (outcome.status === "installed") {
      state.connectedBy = "app";
      return;
    }
    // With an install that may still arrive, the hook is only on request.
    const appMayArrive =
      outcome.status === "pending_approval" ||
      (outcome.status === "timed_out" && outcome.installed);
    const fallBack =
      outcome.status === "switch_to_manual" ||
      (await deps.prompt.confirm(
        "Connect a webhook by hand instead?",
        !appMayArrive,
      ));
    if (!fallBack) return;
    mode =
      checkout.ghInstalled &&
      (await deps.prompt.confirm("Create it with gh?", true))
        ? "gh"
        : "manual";
  }

  await connectManually(
    deps,
    checkout,
    repository,
    organizationId,
    mode === "gh",
  );
  state.connectedBy = "manual";
}
