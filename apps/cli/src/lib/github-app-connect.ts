import type { RepoStatusResponse } from "@repo/cli-contract/repository-status";
import {
  GithubInstallHandoffSchema,
  GithubInstallHandoffStatusSchema,
} from "@repo/cli-contract/github-app";
import { RepoStatusSchema } from "@repo/cli-contract/repository-status";
import { differenceInMilliseconds, parseISO } from "date-fns";

import { ApiError, get, post } from "./api.js";
import { getApiUrl } from "./config.js";

type Coverage = NonNullable<RepoStatusResponse["commitLane"]["coverage"]>;
type Connection = NonNullable<Coverage["connection"]>;

export type ConnectGithubAppOutcome =
  // `connection` delivers the repository's pushes.
  | { status: "connected"; connection: Connection }
  // The installation went in, but pushes need `nextAction` first.
  | {
      status: "installed";
      nextAction: Extract<
        Coverage["nextAction"],
        "attach_project" | "check_selection" | "add_to_selection"
      >;
      connection: Connection;
    }
  // The App went on `account`, but the repository belongs to `owner`.
  | { status: "wrong_account"; account: string; owner: string }
  // `setup_action=request`: a GitHub organisation owner has to approve it.
  | { status: "pending_approval" }
  | { status: "account_mismatch"; browserUser: string; terminalUser: string }
  // `reason` is the web app's setup failure reason (`github_app=error&reason=…`).
  | { status: "failed"; reason: string }
  | { status: "unavailable" }
  // `installed`: the browser finished the install, but no coverage showed up.
  | { status: "timed_out"; installed: boolean }
  | { status: "switch_to_manual" };

const POLL_INTERVAL_MS = 3000;

type Dependencies = {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => Date;
};

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

// The GitHub account the App has to go on: the one that owns the repository.
function installAccount(status: RepoStatusResponse | null): string | null {
  const owner = status?.repository?.ownerRepo.split("/")[0];
  return status?.commitLane.coverage?.appInstallAccount ?? owner ?? null;
}

function printInstallLink(
  url: string,
  canSwitch: boolean,
  account: string | null,
) {
  console.log("Open this link to install the Clocktopus GitHub App:\n");
  console.log(`  ${url}\n`);
  if (account) {
    console.log(
      `This repository belongs to ${account}. The App covers it only when installed on ${account};\n` +
        `if it lives on another account, ${canSwitch ? "press m and " : ""}connect a webhook instead.\n`,
    );
  }
  console.log(
    canSwitch
      ? "Waiting for GitHub… (press m to connect a webhook by hand instead)"
      : "Waiting for GitHub…",
  );
}

// Installs the GitHub App through the browser, which is bound to this CLI's
// account by a handoff token, then waits until an installation covers
// `repositoryUrl`. Aborting `signal` gives up in favour of the manual webhook.
export async function connectGithubApp(options: {
  organizationId: string;
  repositoryUrl: string;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  openUrl?: (url: string) => void | Promise<void>;
  dependencies?: Partial<Dependencies>;
}): Promise<ConnectGithubAppOutcome> {
  const deps: Dependencies = {
    get: (path) => get(path),
    post: (path, body) => post(path, body),
    sleep: abortableSleep,
    now: () => new Date(),
    ...options.dependencies,
  };
  const { signal } = options;

  let handoff;
  try {
    handoff = GithubInstallHandoffSchema.parse(
      await deps.post("/api/github/app/handoffs", {
        organizationId: options.organizationId,
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { status: "unavailable" };
    }
    throw error;
  }

  const repoStatusPath = `/api/agent/repo-status?repositoryUrl=${encodeURIComponent(options.repositoryUrl)}`;
  const fetchRepoStatus = () =>
    deps
      .get(repoStatusPath)
      .then((data) => RepoStatusSchema.parse(data))
      .catch(() => null);

  const base = getApiUrl().replace(/\/$/, "");
  const installUrl = `${base}${handoff.installPath}`;
  if (options.openUrl) await options.openUrl(installUrl);
  else {
    printInstallLink(
      installUrl,
      signal !== undefined,
      installAccount(await fetchRepoStatus()),
    );
  }

  // Past the handoff's expiry the browser can no longer finish the install.
  const startedAt = deps.now();
  const untilExpiry = differenceInMilliseconds(
    parseISO(handoff.expiresAt),
    startedAt,
  );
  const timeoutMs = Math.min(options.timeoutMs ?? untilExpiry, untilExpiry);
  const handoffPath = `/api/github/app/handoffs/${encodeURIComponent(handoff.token)}`;
  let installed = false;

  for (;;) {
    if (signal?.aborted) return { status: "switch_to_manual" };

    // A failed poll is retried on the next tick rather than ending the wait.
    const [handoffStatus, repoStatus] = await Promise.all([
      deps
        .get(handoffPath)
        .then((data) => GithubInstallHandoffStatusSchema.parse(data))
        .catch(() => null),
      fetchRepoStatus(),
    ]);
    if (signal?.aborted) return { status: "switch_to_manual" };

    const outcome = handoffStatus?.outcome;
    if (outcome?.status === "connected") installed = true;

    const coverage = repoStatus?.commitLane.coverage;
    const connection = coverage?.connection;
    // An installation in the handoff's organisation counts even when the
    // browser never reaches setup; anything else only once setup reports the
    // install, so an existing connection cannot pass for it.
    const ours =
      connection?.kind === "app_installation" &&
      connection.organizationId === options.organizationId;
    if (coverage && connection && (ours || installed)) {
      if (coverage.status === "covered" && coverage.nextAction === "push") {
        return { status: "connected", connection };
      }
      if (ours && installed) {
        switch (coverage.nextAction) {
          case "attach_project":
          case "check_selection":
          case "add_to_selection":
            return {
              status: "installed",
              nextAction: coverage.nextAction,
              connection,
            };
        }
      }
    }

    // An installation on another account never covers the repository, so
    // waiting for coverage would only run out the clock.
    const owner = installAccount(repoStatus);
    if (
      outcome?.status === "connected" &&
      owner &&
      outcome.account.toLowerCase() !== owner.toLowerCase()
    ) {
      return { status: "wrong_account", account: outcome.account, owner };
    }

    switch (outcome?.status) {
      case "requested":
        return { status: "pending_approval" };
      case "account_mismatch":
        return {
          status: "account_mismatch",
          browserUser: outcome.browserUser,
          terminalUser: handoffStatus?.terminalUser ?? "",
        };
      case "failed":
        return outcome.reason === "unavailable"
          ? { status: "unavailable" }
          : { status: "failed", reason: outcome.reason };
    }

    if (differenceInMilliseconds(deps.now(), startedAt) >= timeoutMs) {
      return { status: "timed_out", installed };
    }
    await deps.sleep(options.intervalMs ?? POLL_INTERVAL_MS, signal);
  }
}

const FAILURES: Record<string, string> = {
  "already-connected":
    "Someone has already connected that GitHub account to Clocktopus.",
  "connected-elsewhere":
    "That GitHub account is already connected to another Clocktopus organisation.",
  "no-organization": "This account has no Clocktopus organisation yet.",
  "handoff-expired": "The install link expired before GitHub came back.",
};

const INSTALLED_NEXT_STEPS: Record<
  Extract<ConnectGithubAppOutcome, { status: "installed" }>["nextAction"],
  string
> = {
  attach_project:
    "but it hooks a repository only once a project in your organisation attaches it.\n" +
    "Attach this repository to a project, or connect a webhook by hand instead.",
  check_selection:
    "but Clocktopus could not read which repositories it can see.\n" +
    "Make sure this one is selected under Change repositories on GitHub, or connect a webhook by hand instead.",
  add_to_selection:
    "but this repository is not among its repositories.\n" +
    "Add it under Change repositories on GitHub, or connect a webhook by hand instead.",
};

// What the terminal says about each outcome; each one short of `connected`
// offers the manual webhook.
export function describeGithubAppOutcome(
  outcome: ConnectGithubAppOutcome,
): string {
  switch (outcome.status) {
    case "connected":
      return outcome.connection.kind === "app_installation"
        ? `GitHub is connected: the app on ${outcome.connection.label} covers this repository.`
        : `This repository is already connected: its pushes reach Clocktopus through the webhook ${outcome.connection.label}.`;
    case "installed":
      return `The app on ${outcome.connection.label} is installed, ${INSTALLED_NEXT_STEPS[outcome.nextAction]}`;
    case "wrong_account":
      return (
        `The app is on ${outcome.account}, and this repository belongs to ${outcome.owner}, so the app cannot deliver its pushes.\n` +
        `A webhook connects it without moving the app, which would disconnect ${outcome.account}'s repositories.`
      );
    case "pending_approval":
      return (
        "Waiting for your GitHub admin: installing on that organisation needs one of its owners to approve it.\n" +
        "The repositories appear once they do. Until then, you can connect a webhook by hand instead."
      );
    case "account_mismatch":
      return (
        `The browser is signed in as ${outcome.browserUser}, this terminal as ${outcome.terminalUser}. Nothing was linked.\n` +
        "Sign in to the same account in both and run this again, or connect a webhook by hand instead."
      );
    case "failed":
      return (
        `${FAILURES[outcome.reason] ?? "GitHub could not be connected."} The browser shows the details.\n` +
        "You can connect a webhook by hand instead."
      );
    case "unavailable":
      return "This Clocktopus has no GitHub App configured. Connect a webhook by hand instead.";
    case "timed_out":
      return outcome.installed
        ? "The app was installed, but nothing covers this repository yet. Check its repository selection on GitHub, or connect a webhook by hand instead."
        : "Gave up waiting for GitHub. Run this again, or connect a webhook by hand instead.";
    case "switch_to_manual":
      return "Switching to a webhook you connect by hand.";
  }
}

// Aborts the returned signal when `m` is pressed on an interactive terminal;
// Ctrl-C still interrupts. `stop` restores the terminal.
export function listenForManualSwitch(
  input: NodeJS.ReadStream = process.stdin,
) {
  const controller = new AbortController();
  if (!input.isTTY) return { signal: controller.signal, stop: () => {} };

  const onData = (chunk: Buffer) => {
    const pressed = chunk.toString();
    if (pressed === "\u0003") {
      stop();
      process.kill(process.pid, "SIGINT");
      return;
    }
    if (pressed.toLowerCase() === "m") controller.abort();
  };
  function stop() {
    input.off("data", onData);
    input.setRawMode(false);
    input.pause();
  }

  input.setRawMode(true);
  input.resume();
  input.on("data", onData);
  return { signal: controller.signal, stop };
}
