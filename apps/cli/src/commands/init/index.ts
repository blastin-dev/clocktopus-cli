import { spawnSync } from "node:child_process";
import type { RepoStatusResponse } from "@repo/cli-contract/repository-status";
import { OnboardingStateSchema } from "@repo/cli-contract/onboarding";
import { RepoStatusSchema } from "@repo/cli-contract/repository-status";
import { UserSchema } from "@repo/cli-contract/user";

import type {
  Checkout,
  InitDeps,
  InitOptions,
  InitState,
  InitStep,
} from "./types.js";
import { surveyAgents } from "../../lib/agents.js";
import { ApiError, get, post, put } from "../../lib/api.js";
import { sleep } from "../../lib/auth.js";
import { isLoggedIn } from "../../lib/config.js";
import { isGitRepository } from "../../lib/git.js";
import {
  connectGithubApp,
  listenForManualSwitch,
} from "../../lib/github-app-connect.js";
import { createPrompter } from "../../lib/prompt.js";
import { runAgentSetup } from "../agent/setup.js";
import { runLogin } from "../login.js";
import { runAgentsStep } from "./agents.js";
import { readCheckout } from "./checkout.js";
import { runEmailStep } from "./email.js";
import { runProjectStep } from "./project.js";
import { runRepositoryStep } from "./repository.js";
import { INIT_STEPS, InitCancelledError } from "./types.js";
import { runVerifyStep } from "./verify.js";
import { runYouStep } from "./you.js";

function parseSteps(values: string[] | undefined): InitStep[] {
  const requested = (values ?? []).flatMap((value) =>
    value
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
  const unknown = requested.filter(
    (step) => !INIT_STEPS.some((known) => known === step),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown step: ${unknown.join(", ")}. Steps: ${INIT_STEPS.join(", ")}.`,
    );
  }
  return INIT_STEPS.filter((step) => requested.includes(step));
}

// `--skip` names the steps left out; `--only` leaves out every other one.
export function parseSkippedSteps(
  skip: string[] | undefined,
  only?: string[],
): Set<InitStep> {
  const skipped = new Set(parseSteps(skip));
  if (only?.length) {
    const kept = parseSteps(only);
    for (const step of INIT_STEPS) if (!kept.includes(step)) skipped.add(step);
  }
  return skipped;
}

async function fetchStatus(
  deps: InitDeps,
  checkout: Checkout,
): Promise<RepoStatusResponse | null> {
  if (!checkout.remote) return null;
  const query = new URLSearchParams({ repositoryUrl: checkout.remote });
  if (checkout.gitEmail) query.set("authorEmail", checkout.gitEmail);
  return RepoStatusSchema.parse(
    await deps.api.get(`/api/agent/repo-status?${query.toString()}`),
  );
}

// You, organisation and project, repository, git email, agents, verify, then
// the first-run gate is closed. Each step can be skipped, and every question
// has a flag.
export async function runInit(
  options: InitOptions,
  deps: InitDeps,
  checkout: Checkout,
): Promise<void> {
  const skipped = parseSkippedSteps(options.skip, options.only);
  const state: InitState = {
    organizationId: null,
    projectName: null,
    connectedBy: null,
  };

  let onboarding = OnboardingStateSchema.parse(
    await deps.api.get("/api/onboarding"),
  );

  if (!checkout.remote) {
    deps.log(
      "⚠ No 'origin' remote here, so no repository is connected. Run 'clocktopus init'\n" +
        "  inside a checkout to connect one.\n",
    );
  }

  if (!skipped.has("you")) {
    await runYouStep(deps, options, checkout, onboarding);
  }

  let status = await fetchStatus(deps, checkout);

  // The web's gate needs an organisation, so this step runs even when skipped
  // while there is none.
  if (!skipped.has("project") || onboarding.organizations.length === 0) {
    await runProjectStep(deps, options, checkout, onboarding, status, state);
    onboarding = OnboardingStateSchema.parse(
      await deps.api.get("/api/onboarding"),
    );
    status = await fetchStatus(deps, checkout);
  }

  if (status && !skipped.has("repository")) {
    await runRepositoryStep(deps, options, checkout, status, state);
    status = await fetchStatus(deps, checkout);
  }

  if (status && !skipped.has("email")) {
    const gitEmail = await runEmailStep(
      deps,
      options,
      checkout,
      status,
      (next) => fetchStatus(deps, next),
    );
    if (gitEmail !== checkout.gitEmail) checkout = { ...checkout, gitEmail };
  }

  if (!skipped.has("agents")) {
    await runAgentsStep(deps, options);
  }

  if (status && !skipped.has("verify")) {
    status = await fetchStatus(deps, checkout);
    if (status) await runVerifyStep(deps, options, checkout, status, state);
  }

  if (onboarding.onboardingCompleted) return;
  if (onboarding.organizations.length === 0) {
    deps.log(
      "\n⚠ Setup is not complete: you need an organisation. Run 'clocktopus init --new-organization <name>'.",
    );
    return;
  }
  await deps.api.post("/api/onboarding/complete", {
    ...(checkout.remote ? {} : { tracksManually: true }),
  });
  deps.log("\n✓ Setup complete — the web app now opens on your dashboard.");
}

function runCommand(
  command: string,
  args: string[],
  options: { inherit?: boolean } = {},
) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

// Signed out, or with a session the server no longer accepts, runs the device
// flow first.
async function ensureSignedIn(): Promise<boolean> {
  if (isLoggedIn()) {
    try {
      UserSchema.parse(await get("/api/auth/me"));
      return true;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
  }
  const login = await runLogin();
  if (!login.ok) console.error(`\n${login.message}`);
  console.log("");
  return login.ok;
}

export async function initCommand(options: InitOptions): Promise<void> {
  if (!isGitRepository()) {
    console.error(
      "✗ This folder is not a git repository. Run 'clocktopus init' from inside\n" +
        "  a checkout of the repository you work in.",
    );
    process.exit(1);
  }

  try {
    if (!(await ensureSignedIn())) process.exit(1);

    const deps: InitDeps = {
      api: {
        get: (path) => get(path),
        post: (path, body) => post(path, body),
        put: (path, body) => put(path, body),
      },
      prompt: createPrompter({
        interactive: !options.yes && process.stdin.isTTY === true,
      }),
      log: (line = "") => console.log(line),
      run: runCommand,
      sleep,
      now: () => new Date(),
      connectGithubApp,
      listenForManualSwitch: () => listenForManualSwitch(),
      runAgentSetup,
      surveyAgents,
    };
    await runInit(options, deps, readCheckout(deps));
  } catch (error) {
    if (error instanceof InitCancelledError) {
      console.error("\n✗ Setup cancelled — the steps already done are kept.");
      process.exit(130);
    }
    if (error instanceof ApiError && error.status === 401) {
      console.error("Session expired. Run 'clocktopus login' again.");
    } else {
      console.error(
        `\n✗ ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    process.exit(1);
  }
}
