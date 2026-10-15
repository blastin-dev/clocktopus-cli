import type { RepoStatusResponse } from "@repo/cli-contract/repository-status";
import { RepoDeliveriesSchema } from "@repo/cli-contract/repository-status";
import { describe, expect, it, vi } from "vitest";

import type { Prompter } from "../../lib/prompt.js";
import type { Checkout, InitDeps, InitState } from "./types.js";
import { ApiError } from "../../lib/api.js";
import { createPrompter, parseChoice, parseYesNo } from "../../lib/prompt.js";
import { runAgentsStep } from "./agents.js";
import { parseRemote, readCheckout } from "./checkout.js";
import { decideEmailStep, runEmailStep } from "./email.js";
import { parseSkippedSteps, runInit } from "./index.js";
import { findLinkedProject, runProjectStep } from "./project.js";
import {
  confirmManualHook,
  decideConnectMode,
  ghHookArgs,
  interpretPing,
  runRepositoryStep,
} from "./repository.js";
import { InitCancelledError } from "./types.js";
import {
  findOwnRepositoryHooks,
  interpretDeliveries,
  isVerified,
  runTestPush,
  verifyLanes,
} from "./verify.js";
import { parseWorkingHours } from "./you.js";

const REMOTE = "git@github.com:acme-co/acme-portal.git";

const CHECKOUT: Checkout = {
  remote: REMOTE,
  repository: parseRemote(REMOTE),
  gitEmail: "dev@home.test",
  osTimezone: "Europe/Lisbon",
  ghInstalled: true,
};

const ORGANIZATION = {
  id: "org_1",
  name: "Acme",
  slug: "acme",
  role: "owner",
};

function onboarding(overrides: Record<string, unknown> = {}) {
  return {
    preferencesConfirmed: false,
    onboardingCompleted: false,
    preferences: null,
    organizations: [ORGANIZATION],
    ...overrides,
  };
}

function repoStatus(
  overrides: Partial<RepoStatusResponse> = {},
): RepoStatusResponse {
  return {
    repository: {
      provider: "github",
      ownerRepo: "acme-co/acme-portal",
      displayUrl: "https://github.com/acme-co/acme-portal",
    },
    attribution: {
      reason: "no_matching_project",
      projectId: null,
      projectNames: [],
    },
    commitLane: {
      status: "no_secret",
      lastCommitAt: null,
      hasWebhookSecret: false,
      coverage: {
        status: "not_covered",
        nextAction: "connect",
        appInstallAccount: "acme-co",
        connection: null,
      },
    },
    ready: false,
    webhookUrl: "https://hooks.example.test/user_1",
    linkedProjects: [],
    deliveringStreams: [],
    lastPullRequestAt: null,
    authorEmail: {
      email: "dev@home.test",
      status: "untracked",
      commits: 0,
      credited: 0,
      lastReceivedAt: null,
      githubMatched: [],
    },
    ...overrides,
  };
}

// Answers each GET by path prefix; records every write.
function fakeDeps(routes: Record<string, () => unknown>) {
  const writes: Array<{ method: string; path: string; body: unknown }> = [];
  const lines: string[] = [];
  const answer = (path: string) => {
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => path.startsWith(prefix));
    if (!key) throw new Error(`Unexpected GET ${path}`);
    return routes[key]!();
  };
  const run = vi.fn<InitDeps["run"]>(() => ({
    ok: true,
    stdout: "",
    stderr: "",
  }));
  const deps: InitDeps = {
    api: {
      get: async (path) => answer(path),
      post: async (path, body) => {
        writes.push({ method: "POST", path, body });
        if (path === "/api/organizations") {
          return { organization: { id: "org_new", name: "New", slug: "new" } };
        }
        if (path.endsWith("/projects")) return { project: { id: "p_new" } };
        if (path.endsWith("/webhook-secrets")) {
          return {
            webhookSecret: {
              id: "secret_new",
              secret: "s3cret",
              secretPrefix: "whsec_s3c",
            },
            webhookUrl: "https://hooks.example.test/user_1",
          };
        }
        return { success: true };
      },
      put: async (path, body) => {
        writes.push({ method: "PUT", path, body });
        return { success: true };
      },
    },
    prompt: createPrompter({ interactive: false }),
    log: (line = "") => lines.push(line),
    run,
    sleep: async () => {},
    now: () => new Date("2026-10-09T10:00:00Z"),
    connectGithubApp: vi.fn(),
    listenForManualSwitch: () => ({
      signal: new AbortController().signal,
      stop: () => {},
    }),
    runAgentSetup: vi.fn(async () => ({
      status: "configured" as const,
      agents: ["claude"],
      receiverAccepted: true,
    })),
    surveyAgents: () => [],
  };
  return { deps, writes, lines, run };
}

function freshState(): InitState {
  return { organizationId: null, projectName: null, connectedBy: null };
}

describe("parseRemote", () => {
  it.each([
    ["git@github.com:acme-co/acme-portal.git", "github", "acme-co/acme-portal"],
    ["https://github.com/acme-co/acme-portal", "github", "acme-co/acme-portal"],
    [
      "https://github.com/acme-co/acme-portal.git/",
      "github",
      "acme-co/acme-portal",
    ],
    [
      "ssh://git@github.com:22/Acme-Co/AcmePortal.git",
      "github",
      "Acme-Co/AcmePortal",
    ],
    [
      "https://dev@bitbucket.org/acme-co/acme-portal.git",
      "bitbucket",
      "acme-co/acme-portal",
    ],
    [
      "git@bitbucket.org:acme-co/acme-portal.git",
      "bitbucket",
      "acme-co/acme-portal",
    ],
  ])("reads %s", (url, provider, ownerRepo) => {
    expect(parseRemote(url)).toMatchObject({ provider, ownerRepo });
  });

  it.each([
    null,
    "git@git.internal:team/app.git",
    "https://gitlab.com/acme-co/acme-portal.git",
    "https://github.com/acme-co",
  ])("rejects %s", (url) => {
    expect(parseRemote(url)).toBeNull();
  });
});

describe("readCheckout", () => {
  it("drops the credentials from the origin remote, keeping its repository", () => {
    const checkout = readCheckout({
      run: (command, args) =>
        command === "git" && args.join(" ") === "remote get-url origin"
          ? {
              ok: true,
              stdout:
                "https://jordan:ghp_fake0token1@github.com/acme-co/acme-portal.git\n",
              stderr: "",
            }
          : { ok: false, stdout: "", stderr: "" },
    });

    expect(checkout.remote).toBe("https://github.com/acme-co/acme-portal.git");
    expect(checkout.repository).toMatchObject({
      provider: "github",
      ownerRepo: "acme-co/acme-portal",
    });
  });
});

describe("parseWorkingHours", () => {
  it("reads whole hours, decimals and clock times", () => {
    expect(parseWorkingHours("9-17")).toEqual([9, 17]);
    expect(parseWorkingHours("8.5-17")).toEqual([8.5, 17]);
    expect(parseWorkingHours("08:30 - 17:15")).toEqual([8.5, 17.25]);
  });

  it("refuses a day that ends before it starts or leaves the clock", () => {
    expect(parseWorkingHours("17-9")).toBeNull();
    expect(parseWorkingHours("9-25")).toBeNull();
    expect(parseWorkingHours("nine to five")).toBeNull();
  });
});

describe("prompt answers", () => {
  it("reads yes and no, keeping the fallback for anything else", () => {
    expect(parseYesNo("", true)).toBe(true);
    expect(parseYesNo("n", true)).toBe(false);
    expect(parseYesNo("YES", false)).toBe(true);
    expect(parseYesNo("maybe", false)).toBe(false);
  });

  it("picks by number or label", () => {
    const choices = [
      { label: "App", value: "app" },
      { label: "Manual", value: "manual" },
    ];
    expect(parseChoice("2", choices, 0)).toBe("manual");
    expect(parseChoice("app", choices, 1)).toBe("app");
    expect(parseChoice("", choices, 1)).toBe("manual");
    expect(parseChoice("7", choices, 0)).toBeUndefined();
  });

  it("answers every question with its fallback off a terminal", async () => {
    const prompt = createPrompter({ interactive: false });
    expect(await prompt.confirm("Push?", false)).toBe(false);
    expect(await prompt.text("Name", "acme-portal")).toBe("acme-portal");
    expect(
      await prompt.choose(
        "How?",
        [
          { label: "A", value: 1 },
          { label: "B", value: 2 },
        ],
        1,
      ),
    ).toBe(2);
  });
});

describe("parseSkippedSteps", () => {
  it("accepts repeated and comma-separated steps", () => {
    expect([...parseSkippedSteps(["you,agents", "verify"])]).toEqual([
      "you",
      "agents",
      "verify",
    ]);
  });

  it("skips every step --only leaves out", () => {
    expect([...parseSkippedSteps(undefined, ["verify"])]).toEqual([
      "you",
      "project",
      "repository",
      "email",
      "agents",
    ]);
  });

  it("refuses a step it does not know", () => {
    expect(() => parseSkippedSteps(undefined, ["billing"])).toThrow(
      "Unknown step",
    );
    expect(() => parseSkippedSteps(["billing"])).toThrow("Unknown step");
  });
});

describe("organisation and project step", () => {
  it("prefers the linked project in the organisation the flag names", () => {
    const linked = [
      {
        id: "p1",
        name: "Portal",
        organizationId: "org_1",
        organizationName: "Acme",
      },
      {
        id: "p2",
        name: "Portal",
        organizationId: "org_2",
        organizationName: "Beta",
      },
    ];
    const organizations = [
      ORGANIZATION,
      { id: "org_2", name: "Beta", slug: "beta", role: "member" },
    ];
    expect(findLinkedProject(linked, organizations, "beta")?.id).toBe("p2");
    expect(findLinkedProject(linked, organizations, undefined)?.id).toBe("p1");
  });

  it("skips the step for a repository a teammate already attached, and creates nothing", async () => {
    const { deps, writes, lines } = fakeDeps({});
    const state = freshState();

    await runProjectStep(
      deps,
      { newProject: "Duplicate" },
      CHECKOUT,
      onboarding({ organizations: [{ ...ORGANIZATION, role: "member" }] }),
      repoStatus({
        linkedProjects: [
          {
            id: "p1",
            name: "Acme Portal",
            organizationId: "org_1",
            organizationName: "Acme",
          },
        ],
      }),
      state,
    );

    expect(writes).toEqual([]);
    expect(state).toMatchObject({
      organizationId: "org_1",
      projectName: "Acme Portal",
    });
    expect(lines.join("\n")).toContain("already in Acme Portal (Acme)");
  });

  it("creates the project named by the flag with the repository attached", async () => {
    const { deps, writes } = fakeDeps({
      "/api/organizations/org_1/projects": () => ({
        projects: [{ id: "p_other", name: "Other" }],
      }),
    });

    await runProjectStep(
      deps,
      { newProject: "Acme Portal" },
      CHECKOUT,
      onboarding(),
      repoStatus(),
      freshState(),
    );

    expect(writes).toEqual([
      {
        method: "POST",
        path: "/api/organizations/org_1/projects",
        body: { name: "Acme Portal", repositoryUrls: [REMOTE] },
      },
    ]);
  });

  it("tells a plain member to ask an admin instead of creating a project", async () => {
    const { deps, writes, lines } = fakeDeps({});

    await runProjectStep(
      deps,
      {},
      CHECKOUT,
      onboarding({ organizations: [{ ...ORGANIZATION, role: "member" }] }),
      repoStatus(),
      freshState(),
    );

    expect(writes).toEqual([]);
    expect(lines.join("\n")).toContain("only owners and admins");
  });

  it("refuses to invent an organisation off a terminal", async () => {
    const { deps } = fakeDeps({});

    await expect(
      runProjectStep(
        deps,
        {},
        CHECKOUT,
        onboarding({ organizations: [] }),
        repoStatus(),
        freshState(),
      ),
    ).rejects.toThrow("--new-organization");
  });

  it("reports a repository another project already links", async () => {
    const { deps, lines } = fakeDeps({
      "/api/organizations/org_1/projects": () => ({ projects: [] }),
    });
    deps.api.post = async () => {
      throw new ApiError(
        409,
        "Conflict",
        "Another project links acme-co/acme-portal",
      );
    };

    await runProjectStep(
      deps,
      {},
      CHECKOUT,
      onboarding(),
      repoStatus(),
      freshState(),
    );

    expect(lines.join("\n")).toContain("Another project links");
  });
});

describe("decideConnectMode", () => {
  const base = {
    provider: "github" as const,
    nextAction: "connect" as const,
    flag: undefined,
    ghInstalled: true,
  };

  it("asks when nothing covers a GitHub repository", () => {
    expect(decideConnectMode(base)).toBe("ask");
  });

  it("asks when the installation leaves the repository out of its selection", () => {
    expect(decideConnectMode({ ...base, nextAction: "add_to_selection" })).toBe(
      "ask",
    );
  });

  it("adds no second connection to a covered repository unless a flag asks", () => {
    expect(decideConnectMode({ ...base, nextAction: "push" })).toBe("covered");
    expect(decideConnectMode({ ...base, nextAction: "attach_project" })).toBe(
      "covered",
    );
    expect(decideConnectMode({ ...base, nextAction: "push", flag: "gh" })).toBe(
      "gh",
    );
  });

  it("leaves a connection that only needs checking alone", () => {
    expect(decideConnectMode({ ...base, nextAction: "check_webhook" })).toBe(
      "pending",
    );
    expect(decideConnectMode({ ...base, nextAction: "check_selection" })).toBe(
      "pending",
    );
  });

  it("falls back to the manual hook without gh, and on Bitbucket", () => {
    expect(decideConnectMode({ ...base, flag: "gh", ghInstalled: false })).toBe(
      "manual",
    );
    expect(
      decideConnectMode({ ...base, provider: "bitbucket", flag: "app" }),
    ).toBe("manual");
  });

  it("subscribes the gh hook to pushes, pull requests and reviews", () => {
    const args = ghHookArgs({
      ownerRepo: "acme-co/acme-portal",
      url: "https://hooks.example.test/user_1",
      secret: "s3cret",
    });
    expect(args.slice(0, 2)).toEqual([
      "api",
      "repos/acme-co/acme-portal/hooks",
    ]);
    expect(args).toEqual(
      expect.arrayContaining([
        "events[]=push",
        "events[]=pull_request",
        "events[]=pull_request_review",
        "config[secret]=s3cret",
      ]),
    );
  });
});

describe("repository step", () => {
  const ownState = () => ({ ...freshState(), organizationId: "org_1" });
  const createdSecrets = (writes: Array<{ path: string }>) =>
    writes.filter((write) => write.path.endsWith("/webhook-secrets"));

  it("adds no hook once the App is installed and names the step left", async () => {
    const { deps, writes } = fakeDeps({});
    vi.mocked(deps.connectGithubApp).mockResolvedValue({
      status: "installed",
      nextAction: "add_to_selection",
      connection: {
        kind: "app_installation",
        label: "dana",
        organizationId: "org_1",
        connectedByName: "Dana Admin",
        connectedByCaller: true,
        lastDeliveryAt: null,
      },
    });
    const state = ownState();

    await runRepositoryStep(
      deps,
      { connect: "app", yes: true },
      CHECKOUT,
      repoStatus(),
      state,
    );

    expect(createdSecrets(writes)).toEqual([]);
    expect(state.connectedBy).toBe("app");
  });

  it("adds no hook unattended while a GitHub owner's approval may still arrive", async () => {
    const { deps, writes } = fakeDeps({});
    vi.mocked(deps.connectGithubApp).mockResolvedValue({
      status: "pending_approval",
    });

    await runRepositoryStep(
      deps,
      { connect: "app", yes: true },
      CHECKOUT,
      repoStatus(),
      ownState(),
    );

    expect(createdSecrets(writes)).toEqual([]);
  });

  it("falls back to a hook unattended when the install failed", async () => {
    const { deps, writes } = fakeDeps({
      "/api/agent/repo-deliveries": () => ({
        commit: null,
        ingestion: [],
        failures: [],
      }),
    });
    vi.mocked(deps.connectGithubApp).mockResolvedValue({
      status: "failed",
      reason: "github",
    });

    await runRepositoryStep(
      deps,
      { connect: "app", yes: true },
      CHECKOUT,
      repoStatus(),
      ownState(),
    );

    expect(createdSecrets(writes)).toHaveLength(1);
  });

  it("leaves a personal installation that waits for a project alone", async () => {
    const { deps, lines } = fakeDeps({});

    await runRepositoryStep(
      deps,
      {},
      CHECKOUT,
      repoStatus({
        commitLane: {
          status: "no_delivery",
          lastCommitAt: null,
          hasWebhookSecret: true,
          coverage: {
            status: "covered",
            nextAction: "attach_project",
            appInstallAccount: "acme-co",
            connection: {
              kind: "app_installation",
              label: "dana",
              organizationId: "org_1",
              connectedByName: "Dana Admin",
              connectedByCaller: true,
              lastDeliveryAt: null,
            },
          },
        },
      }),
      ownState(),
    );

    expect(deps.connectGithubApp).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("once a project attaches it");
  });
});

describe("agents step", () => {
  it("goes straight to agent setup's own picker on a terminal", async () => {
    const { deps } = fakeDeps({});
    const confirm = vi.fn();
    deps.prompt = { ...deps.prompt, interactive: true, confirm };
    deps.surveyAgents = () => [
      {
        agent: { id: "claude", label: "Claude Code" },
        installed: true,
        configured: false,
      },
    ];

    await runAgentsStep(deps, {});

    expect(confirm).not.toHaveBeenCalled();
    expect(deps.runAgentSetup).toHaveBeenCalledWith({
      agent: undefined,
      component: undefined,
      showRepoStatus: false,
    });
  });

  it("configures every installed agent and component off a terminal without asking", async () => {
    const { deps } = fakeDeps({});
    deps.surveyAgents = () => [
      {
        agent: { id: "claude", label: "Claude Code" },
        installed: true,
        configured: false,
      },
    ];

    await runAgentsStep(deps, {});

    expect(deps.runAgentSetup).toHaveBeenCalledWith({
      agent: ["claude"],
      component: ["mcp", "skills"],
      showRepoStatus: false,
    });
  });

  it("cancels init when the picker is cancelled", async () => {
    const { deps } = fakeDeps({});
    deps.prompt = { ...deps.prompt, interactive: true };
    deps.surveyAgents = () => [
      {
        agent: { id: "claude", label: "Claude Code" },
        installed: true,
        configured: false,
      },
    ];
    deps.runAgentSetup = vi.fn(async () => ({ status: "cancelled" as const }));

    await expect(runAgentsStep(deps, {})).rejects.toBeInstanceOf(
      InitCancelledError,
    );
  });
});

describe("confirmManualHook", () => {
  const SINCE = new Date("2026-10-09T09:59:30Z");

  function ping(overrides: Record<string, unknown> = {}) {
    return {
      secretId: "secret_new",
      targetType: "repository",
      target: "acme-co/acme-portal",
      events: ["push", "pull_request", "pull_request_review"],
      missingEvents: [],
      contentType: "json",
      receivedAt: "2026-10-09T10:00:02Z",
      ...overrides,
    };
  }

  function deliveries(overrides: Record<string, unknown> = {}) {
    return {
      pings: [],
      commit: null,
      ingestion: [],
      failures: [],
      ...overrides,
    };
  }

  // A clock that advances one poll interval per sleep.
  function withClock(deps: InitDeps) {
    let now = new Date("2026-10-09T10:00:00Z").getTime();
    deps.now = () => new Date(now);
    deps.sleep = async (ms) => {
      now += ms;
    };
  }

  function confirm(deps: InitDeps, repository = CHECKOUT.repository!) {
    return confirmManualHook(deps, {
      repository,
      remote: REMOTE,
      secretId: "secret_new",
      since: SINCE,
      timeoutMs: 60_000,
    });
  }

  it("waits for the ping and confirms the webhook on the repository", async () => {
    let polls = 0;
    const { deps, lines } = fakeDeps({
      "/api/agent/repo-deliveries": () =>
        ++polls < 3 ? deliveries() : deliveries({ pings: [ping()] }),
    });
    withClock(deps);

    const result = await confirm(deps);

    expect(polls).toBe(3);
    expect(result.status).toBe("confirmed");
    expect(lines).toContain(
      "✓ Webhook       GitHub confirmed it on acme-co/acme-portal",
    );
  });

  it("asks for the deliveries since the secret was made", async () => {
    const paths: string[] = [];
    const { deps } = fakeDeps({});
    deps.api.get = async (path) => {
      paths.push(path);
      return deliveries({ pings: [ping()] });
    };

    await confirm(deps);

    expect(paths[0]).toContain(
      `since=${encodeURIComponent(SINCE.toISOString())}`,
    );
  });

  it("names the events the webhook leaves unticked", async () => {
    const { deps, lines } = fakeDeps({
      "/api/agent/repo-deliveries": () =>
        deliveries({
          pings: [
            ping({
              targetType: "organization",
              target: "acme-co",
              events: ["push"],
              missingEvents: ["pull_request", "pull_request_review"],
            }),
          ],
        }),
    });

    const result = await confirm(deps);

    expect(result.status).toBe("missing_events");
    expect(lines[1]).toBe(
      "⚠ Webhook       seen on the acme-co organisation, missing: Pull requests, Pull request reviews",
    );
  });

  it("reports a ping whose signature matched no secret", async () => {
    const { deps, lines } = fakeDeps({
      "/api/agent/repo-deliveries": () =>
        deliveries({
          failures: [
            {
              reason: "invalid_signature",
              verified: false,
              eventType: "ping",
              detail: null,
              lastSeenAt: "2026-10-09T10:00:02Z",
            },
          ],
        }),
    });

    const result = await confirm(deps);

    expect(result).toEqual({ status: "failed", reason: "invalid_signature" });
    expect(lines.at(-1)).toMatch(
      /^✗ Webhook {7}GitHub reached Clocktopus, but no secret matched/,
    );
  });

  it("prefers the new secret's ping over another one's", () => {
    const result = interpretPing(
      RepoDeliveriesSchema.parse(
        deliveries({
          pings: [
            ping({ secretId: "secret_old", missingEvents: ["push"] }),
            ping(),
          ],
        }),
      ),
      "secret_new",
    );

    expect(result?.status).toBe("confirmed");
  });

  it("gives up after the timeout and points at GitHub's Recent Deliveries", async () => {
    const { deps, lines } = fakeDeps({
      "/api/agent/repo-deliveries": () => deliveries(),
    });
    withClock(deps);

    const result = await confirm(deps);

    expect(result.status).toBe("timed_out");
    expect(lines.join("\n")).toContain("Recent Deliveries");
  });

  it("does not wait on a server that reports no pings", async () => {
    const { deps } = fakeDeps({
      "/api/agent/repo-deliveries": () => ({
        commit: null,
        ingestion: [],
        failures: [],
      }),
    });

    expect((await confirm(deps)).status).toBe("not_checked");
  });

  it("skips straight to the first-push check on Bitbucket", async () => {
    const { deps, lines } = fakeDeps({});

    const result = await confirm(
      deps,
      parseRemote("git@bitbucket.org:acme-co/acme-portal.git")!,
    );

    expect(result.status).toBe("not_checked");
    expect(lines[0]).toContain("Bitbucket sends nothing until the first push");
  });
});

describe("decideEmailStep", () => {
  const authorEmail = repoStatus().authorEmail;

  it("offers to track an address that credits nobody", () => {
    expect(
      decideEmailStep({ gitEmail: "dev@home.test", authorEmail }),
    ).toMatchObject({
      action: "offer_tracking",
      email: "dev@home.test",
    });
  });

  it("is satisfied by the sign-in email or a tracked address", () => {
    for (const status of ["sign_in", "tracked"] as const) {
      expect(
        decideEmailStep({
          gitEmail: "dev@home.test",
          authorEmail: authorEmail && { ...authorEmail, status },
        }).action,
      ).toBe("none");
    }
  });

  it("tells a checkout without user.email how to set one", () => {
    expect(decideEmailStep({ gitEmail: null, authorEmail }).line).toContain(
      "git config user.email",
    );
  });
});

describe("email step", () => {
  // A terminal that picks `choice` and types `typed`, in order; returns the
  // choices it was offered.
  function interactive(
    deps: InitDeps,
    choice: string,
    typed: string[],
    confirmAnswer = true,
  ) {
    const offered: unknown[] = [];
    const choose: Prompter["choose"] = async (_question, choices) => {
      offered.push(choices);
      const picked = choices.find((option) => option.value === choice);
      if (!picked) throw new Error(`No choice ${choice}`);
      return picked.value;
    };
    deps.prompt = {
      interactive: true,
      confirm: vi.fn(async () => confirmAnswer),
      text: vi.fn(async () => typed.shift() ?? ""),
      choose,
    };
    return offered;
  }

  it("sets a different email in this repository and checks it", async () => {
    const { deps, run, lines, writes } = fakeDeps({});
    interactive(deps, "change", ["not-an-email", "me@work.test"]);
    const refetch = vi.fn(async (checkout: Checkout) =>
      repoStatus({
        authorEmail: {
          ...repoStatus().authorEmail!,
          email: checkout.gitEmail!,
          status: "tracked",
        },
      }),
    );

    const gitEmail = await runEmailStep(
      deps,
      {},
      CHECKOUT,
      repoStatus(),
      refetch,
    );

    expect(gitEmail).toBe("me@work.test");
    expect(run).toHaveBeenCalledWith("git", [
      "config",
      "user.email",
      "me@work.test",
    ]);
    expect(lines).toContain("✗ not-an-email is not an email address");
    expect(refetch).toHaveBeenCalledWith({
      ...CHECKOUT,
      gitEmail: "me@work.test",
    });
    expect(lines.at(-1)).toContain(
      "me@work.test is one of your commit addresses",
    );
    expect(writes).toEqual([]);
  });

  it("offers to track a new email that credits nobody", async () => {
    const { deps, writes } = fakeDeps({});
    interactive(deps, "change", ["me@work.test"]);

    await runEmailStep(deps, {}, CHECKOUT, repoStatus(), async (checkout) =>
      repoStatus({
        authorEmail: {
          ...repoStatus().authorEmail!,
          email: checkout.gitEmail!,
        },
      }),
    );

    expect(writes).toEqual([
      {
        method: "POST",
        path: "/api/commit-addresses",
        body: { email: "me@work.test" },
      },
    ]);
  });

  it("keeps the email when nothing is typed", async () => {
    const { deps, run } = fakeDeps({});
    interactive(deps, "change", []);

    const gitEmail = await runEmailStep(
      deps,
      {},
      CHECKOUT,
      repoStatus(),
      vi.fn(),
    );

    expect(gitEmail).toBe(CHECKOUT.gitEmail);
    expect(run).not.toHaveBeenCalled();
  });

  it("offers a change even for an email that is already yours", async () => {
    const { deps } = fakeDeps({});
    const offered = interactive(deps, "leave", []);
    const tracked = repoStatus({
      authorEmail: { ...repoStatus().authorEmail!, status: "tracked" },
    });

    await runEmailStep(deps, {}, CHECKOUT, tracked, vi.fn());

    expect(offered).toEqual([
      [
        { label: "Keep dev@home.test", value: "leave" },
        {
          label: "Use a different email in this repository",
          value: "change",
        },
      ],
    ]);
  });
});

describe("test push", () => {
  // Git answering by subcommand; anything unlisted succeeds with no output.
  function git(
    deps: InitDeps,
    answers: Record<string, Partial<{ ok: boolean; stdout: string }>>,
  ) {
    const run = vi.fn<InitDeps["run"]>((_command, args) => ({
      ok: true,
      stdout: "",
      stderr: "",
      ...answers[args.slice(0, 2).join(" ")],
      ...answers[args[0]!],
    }));
    deps.run = run;
    return run;
  }
  const ran = (run: ReturnType<typeof git>, subcommand: string) =>
    run.mock.calls.some(([, args]) => args[0] === subcommand);

  it("makes no commit on a branch that is behind origin", async () => {
    const { deps, lines } = fakeDeps({});
    const run = git(deps, {
      "rev-parse --abbrev-ref": { stdout: "main\n" },
      "rev-list --count": { stdout: "3\n" },
    });

    await runTestPush(deps, CHECKOUT);

    expect(ran(run, "commit")).toBe(false);
    expect(lines.join("\n")).toContain("main is 3 commits behind origin");
  });

  it("removes the empty commit again when the push is rejected", async () => {
    const { deps, lines } = fakeDeps({});
    const run = git(deps, {
      "rev-parse --abbrev-ref": { stdout: "main\n" },
      "rev-parse HEAD": { stdout: "abc1234def\n" },
      "rev-list --count": { stdout: "0\n" },
      push: { ok: false },
    });

    await runTestPush(deps, CHECKOUT);

    expect(run).toHaveBeenCalledWith("git", [
      "reset",
      "--soft",
      "abc1234def~1",
    ]);
    expect(lines.at(-1)).toContain("the empty commit was removed again");
  });

  it("pushes to a branch origin does not have yet", async () => {
    const { deps } = fakeDeps({ "/api/agent/repo-deliveries": () => ({}) });
    deps.now = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-10-09T10:00:00Z"))
      .mockReturnValueOnce(new Date("2026-10-09T10:00:00Z"))
      .mockReturnValue(new Date("2026-10-09T11:00:00Z"));
    const run = git(deps, {
      "rev-parse --abbrev-ref": { stdout: "feature\n" },
      fetch: { ok: false },
    });

    await runTestPush(deps, CHECKOUT);

    expect(ran(run, "push")).toBe(true);
    expect(ran(run, "reset")).toBe(false);
  });
});

describe("verification", () => {
  it("does not warn about an address of yours before its first commit", () => {
    const author = (overrides: { commits: number }) =>
      verifyLanes(
        repoStatus({
          authorEmail: {
            ...repoStatus().authorEmail!,
            status: "tracked",
            ...overrides,
          },
        }),
        [],
      ).find((check) => check.label === "Author");

    expect(author({ commits: 0 })?.ok).toBe(true);
    expect(author({ commits: 2 })?.ok).toBe("warn");
  });

  it("never calls a repository verified from its configuration alone", () => {
    const configured = repoStatus({
      ready: true,
      authorEmail: {
        ...repoStatus().authorEmail!,
        status: "tracked",
        credited: 0,
      },
    });
    expect(isVerified(configured)).toBe(false);
    expect(
      isVerified({
        ...configured,
        authorEmail: { ...configured.authorEmail!, credited: 1 },
      }),
    ).toBe(true);
  });

  const SHA = "c".repeat(40);
  const empty = { commit: null, ingestion: [], failures: [] };

  it("keeps waiting until something about the push arrives", () => {
    expect(interpretDeliveries(empty, SHA).done).toBe(false);
  });

  it("reports the booking of the pushed commit", () => {
    const result = interpretDeliveries(
      {
        ...empty,
        ingestion: [
          {
            commitSha: SHA,
            commitAuthorEmail: "dev@home.test",
            workDate: "2026-10-09",
            status: "skipped_locked",
            lockReason: "manual_lock",
          },
        ],
      },
      SHA,
    );
    expect(result.done).toBe(true);
    expect(result.lines[0]).toContain("the day is locked");
  });

  it("prints the fix for a delivery failure", () => {
    const result = interpretDeliveries(
      {
        ...empty,
        failures: [
          {
            reason: "invalid_signature",
            verified: false,
            detail: null,
            lastSeenAt: "2026-10-09T10:00:00Z",
          },
        ],
      },
      SHA,
    );
    expect(result.lines[0]).toContain("paste the secret again");
  });

  it("names the author of a commit that arrived but was credited to nobody", () => {
    const result = interpretDeliveries(
      {
        ...empty,
        commit: { sha: SHA, authorEmail: "dev@laptop.test", authorLogin: null },
      },
      SHA,
    );
    expect(result.lines[0]).toContain("dev@laptop.test");
  });

  it("finds only the caller's own webhook among the repository's hooks", () => {
    const hooks = JSON.stringify([
      { id: 1, config: { url: "https://hooks.example.test/user_1" } },
      { id: 2, config: { url: "https://hooks.example.test/user_2" } },
      { id: 3, config: {} },
    ]);
    expect(
      findOwnRepositoryHooks(hooks, "https://hooks.example.test/user_1"),
    ).toEqual([1]);
    expect(findOwnRepositoryHooks("not json", "x")).toEqual([]);
  });
});

describe("runInit", () => {
  it("runs end to end from flags alone, without pushing or touching repository hooks", async () => {
    let status = repoStatus();
    let completed = false;
    const { deps, writes, run, lines } = fakeDeps({
      "/api/onboarding": () => onboarding({ onboardingCompleted: completed }),
      "/api/agent/repo-status": () => status,
      "/api/organizations/org_1/projects": () => ({ projects: [] }),
    });
    const post = deps.api.post;
    deps.api.post = async (path, body) => {
      if (path.endsWith("/projects")) {
        status = repoStatus({
          attribution: {
            reason: "attributed",
            projectId: "p_new",
            projectNames: ["Acme Portal"],
          },
          linkedProjects: [
            {
              id: "p_new",
              name: "Acme Portal",
              organizationId: "org_1",
              organizationName: "Acme",
            },
          ],
        });
      }
      if (path === "/api/onboarding/complete") completed = true;
      return post(path, body);
    };

    await runInit(
      {
        timezone: "America/Sao_Paulo",
        hours: "8-16",
        newProject: "Acme Portal",
        connect: "skip",
        trackEmail: true,
        skip: ["agents"],
      },
      deps,
      CHECKOUT,
    );

    expect(writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "PUT /api/onboarding/preferences",
      "POST /api/organizations/org_1/projects",
      "POST /api/commit-addresses",
      "POST /api/onboarding/complete",
    ]);
    expect(writes[0]?.body).toEqual({
      timezone: "America/Sao_Paulo",
      workingHoursEnabled: true,
      workingHours: [8, 16],
      preferencesConfirmed: true,
      autoLockAfterDays: 7,
    });
    expect(run).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Not verified yet");
    expect(lines.join("\n")).not.toContain("All set");
  });

  it("leaves a completed setup's gate alone", async () => {
    const { deps, writes } = fakeDeps({
      "/api/onboarding": () =>
        onboarding({
          onboardingCompleted: true,
          preferencesConfirmed: true,
          preferences: {
            timezone: "Europe/Lisbon",
            workDayStartTime: "09:00:00",
            workDayEndTime: "17:00:00",
            workingHoursEnabled: true,
          },
        }),
    });

    await runInit({ skip: ["project", "agents"] }, deps, {
      ...CHECKOUT,
      remote: null,
      repository: null,
    });

    expect(writes).toEqual([]);
  });
});
