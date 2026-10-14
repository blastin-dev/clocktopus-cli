import type { RepoStatusResponse } from "@repo/cli-contract/repository-status";
import { addMilliseconds } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api.js";
import {
  connectGithubApp,
  describeGithubAppOutcome,
} from "./github-app-connect.js";

type Coverage = NonNullable<RepoStatusResponse["commitLane"]["coverage"]>;

const START = new Date("2026-10-08T10:00:00Z");
const REPOSITORY = "https://github.com/acme-co/acme-portal";

const APP: NonNullable<Coverage["connection"]> = {
  kind: "app_installation",
  label: "acme-co",
  organizationId: "org-acme",
  connectedByName: "Dana Admin",
  connectedByCaller: true,
  lastDeliveryAt: null,
};

function repoStatus(coverage: Coverage | null) {
  return {
    repository: {
      provider: "github",
      ownerRepo: "acme-co/acme-portal",
      displayUrl: REPOSITORY,
    },
    attribution: {
      reason: "attributed",
      projectId: "project_1",
      projectNames: ["Acme Portal"],
    },
    commitLane: {
      status: "no_delivery",
      lastCommitAt: null,
      hasWebhookSecret: false,
      coverage,
    },
    ready: false,
    webhookUrl: "https://hooks.example.test/user_1",
  };
}

const NOT_COVERED: Coverage = {
  status: "not_covered",
  nextAction: "connect",
  appInstallAccount: "acme-co",
  connection: null,
};

function handoffStatus(outcome: Record<string, unknown>) {
  return {
    outcome,
    terminalUser: "dana@acme.test",
    expiresAt: "2026-10-08T10:15:00.000Z",
  };
}

// Each tick of the poll answers with the next pair; the last pair repeats.
// The clock advances by each sleep.
function fakeServer(
  ticks: Array<{ handoff: unknown; repo: unknown }>,
  options: { post?: () => Promise<unknown> } = {},
) {
  let tick = 0;
  let now = START;
  const sleep = vi.fn(async (ms: number) => {
    now = addMilliseconds(now, ms);
    tick = Math.min(tick + 1, ticks.length - 1);
  });
  const get = vi.fn(async (path: string) => {
    const current = ticks[tick];
    const answer = path.startsWith("/api/github/app/handoffs/")
      ? current?.handoff
      : current?.repo;
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const post = vi.fn(
    options.post ??
      (async () => ({
        token: "handoff-token",
        installPath:
          "/api/github/app/install?organization=org-acme&return=%2Fcli%2Fconnected&handoff=handoff-token",
        expiresAt: "2026-10-08T10:15:00.000Z",
      })),
  );
  return {
    dependencies: { get, post, sleep, now: () => now },
    get,
    post,
    sleep,
  };
}

beforeEach(() => {
  process.env.CLOCKTOPUS_API_URL = "https://app.example.test";
});

describe("connectGithubApp", () => {
  it("opens the install link bound to the handoff and returns once the app covers the repository", async () => {
    const server = fakeServer([
      {
        handoff: handoffStatus({ status: "pending" }),
        repo: repoStatus(NOT_COVERED),
      },
      {
        handoff: handoffStatus({ status: "connected", account: "acme-co" }),
        repo: repoStatus({
          status: "covered",
          nextAction: "push",
          appInstallAccount: null,
          connection: APP,
        }),
      },
    ]);
    const openUrl = vi.fn();

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl,
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({ status: "connected", connection: APP });
    expect(server.post).toHaveBeenCalledWith("/api/github/app/handoffs", {
      organizationId: "org-acme",
    });
    expect(openUrl).toHaveBeenCalledWith(
      "https://app.example.test/api/github/app/install?organization=org-acme&return=%2Fcli%2Fconnected&handoff=handoff-token",
    );
    expect(server.get).toHaveBeenCalledWith(
      `/api/agent/repo-status?repositoryUrl=${encodeURIComponent(REPOSITORY)}`,
    );
  });

  it("says the install waits for a GitHub organisation owner's approval", async () => {
    const server = fakeServer([
      {
        handoff: handoffStatus({ status: "requested" }),
        repo: repoStatus(NOT_COVERED),
      },
    ]);

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl: () => {},
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({ status: "pending_approval" });
    expect(describeGithubAppOutcome(outcome)).toContain("webhook by hand");
  });

  it("names both accounts when the browser is signed in as someone else", async () => {
    const server = fakeServer([
      {
        handoff: handoffStatus({
          status: "account_mismatch",
          browserUser: "erin@acme.test",
        }),
        repo: repoStatus(NOT_COVERED),
      },
    ]);

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl: () => {},
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({
      status: "account_mismatch",
      browserUser: "erin@acme.test",
      terminalUser: "dana@acme.test",
    });
    expect(describeGithubAppOutcome(outcome)).toContain(
      "The browser is signed in as erin@acme.test, this terminal as dana@acme.test",
    );
  });

  it("returns the setup failure reason", async () => {
    const server = fakeServer([
      {
        handoff: handoffStatus({
          status: "failed",
          reason: "connected-elsewhere",
        }),
        repo: repoStatus(NOT_COVERED),
      },
    ]);

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl: () => {},
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({
      status: "failed",
      reason: "connected-elsewhere",
    });
  });

  it.each([
    { status: "covered", nextAction: "attach_project", says: "attaches it" },
    {
      status: "unconfirmed",
      nextAction: "check_selection",
      says: "could not read",
    },
    {
      status: "not_selected",
      nextAction: "add_to_selection",
      says: "not among its repositories",
    },
  ] as const)(
    "reports an installation that needs $nextAction before pushes arrive",
    async ({ status, nextAction, says }) => {
      const userApp = { ...APP, label: "dana" };
      const server = fakeServer([
        {
          handoff: handoffStatus({ status: "connected", account: "dana" }),
          repo: repoStatus({
            status,
            nextAction,
            appInstallAccount: null,
            connection: userApp,
          }),
        },
      ]);

      const outcome = await connectGithubApp({
        organizationId: "org-acme",
        repositoryUrl: REPOSITORY,
        openUrl: () => {},
        dependencies: server.dependencies,
      });

      expect(outcome).toEqual({
        status: "installed",
        nextAction,
        connection: userApp,
      });
      expect(describeGithubAppOutcome(outcome)).toContain(says);
    },
  );

  it("does not count another organisation's installation as this install", async () => {
    const server = fakeServer([
      {
        handoff: handoffStatus({ status: "pending" }),
        repo: repoStatus({
          status: "covered",
          nextAction: "push",
          appInstallAccount: null,
          connection: { ...APP, organizationId: "org-other" },
        }),
      },
    ]);

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl: () => {},
      timeoutMs: 9000,
      intervalMs: 3000,
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({ status: "timed_out", installed: false });
  });

  it("stops at once when the App went on an account that does not own the repository", async () => {
    const server = fakeServer([
      {
        handoff: handoffStatus({ status: "connected", account: "Other-Org" }),
        repo: repoStatus(NOT_COVERED),
      },
    ]);

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl: () => {},
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({
      status: "wrong_account",
      account: "Other-Org",
      owner: "acme-co",
    });
    expect(server.sleep).not.toHaveBeenCalled();
    expect(describeGithubAppOutcome(outcome)).toContain(
      "cannot deliver its pushes",
    );
  });

  it("names the webhook when one covers the repository after the install", async () => {
    const webhook = { ...APP, kind: "webhook" as const, label: "acme-hook" };
    const server = fakeServer([
      {
        handoff: handoffStatus({ status: "connected", account: "acme-co" }),
        repo: repoStatus({
          status: "covered",
          nextAction: "push",
          appInstallAccount: null,
          connection: webhook,
        }),
      },
    ]);

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl: () => {},
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({ status: "connected", connection: webhook });
    expect(describeGithubAppOutcome(outcome)).toContain(
      "through the webhook acme-hook",
    );
  });

  it("keeps polling through failed requests, then times out", async () => {
    const server = fakeServer([
      {
        handoff: new Error("network down"),
        repo: new Error("network down"),
      },
      {
        handoff: handoffStatus({ status: "pending" }),
        repo: repoStatus(NOT_COVERED),
      },
    ]);

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl: () => {},
      timeoutMs: 30_000,
      intervalMs: 3000,
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({ status: "timed_out", installed: false });
    expect(server.sleep).toHaveBeenCalledTimes(10);
  });

  it("never waits past the handoff's expiry", async () => {
    const server = fakeServer([
      {
        handoff: handoffStatus({ status: "pending" }),
        repo: repoStatus(NOT_COVERED),
      },
    ]);

    await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl: () => {},
      timeoutMs: 60 * 60 * 1000,
      intervalMs: 60_000,
      dependencies: server.dependencies,
    });

    expect(server.sleep).toHaveBeenCalledTimes(15);
  });

  it("switches to the manual webhook when the signal aborts", async () => {
    const controller = new AbortController();
    const server = fakeServer([
      {
        handoff: handoffStatus({ status: "pending" }),
        repo: repoStatus(NOT_COVERED),
      },
    ]);
    server.sleep.mockImplementation(async () => controller.abort());

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl: () => {},
      signal: controller.signal,
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({ status: "switch_to_manual" });
  });

  it("reports a server without a GitHub App before opening anything", async () => {
    const server = fakeServer([], {
      post: async () => {
        throw new ApiError(409, "Conflict", "no GitHub App");
      },
    });
    const openUrl = vi.fn();

    const outcome = await connectGithubApp({
      organizationId: "org-acme",
      repositoryUrl: REPOSITORY,
      openUrl,
      dependencies: server.dependencies,
    });

    expect(outcome).toEqual({ status: "unavailable" });
    expect(openUrl).not.toHaveBeenCalled();
  });
});
