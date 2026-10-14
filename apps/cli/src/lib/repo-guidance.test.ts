import type { RepoStatusResponse } from "@repo/cli-contract/repository-status";
import { RepoStatusSchema } from "@repo/cli-contract/repository-status";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commitLaneCheck, repoStatusPath } from "./repo-guidance.js";

type Coverage = NonNullable<RepoStatusResponse["commitLane"]["coverage"]>;
type Connection = NonNullable<Coverage["connection"]>;

const TEAM_APP: Connection = {
  kind: "app_installation",
  label: "acme-co",
  organizationId: "org-acme",
  connectedByName: "Dana Admin",
  connectedByCaller: false,
  lastDeliveryAt: null,
};

const TEAM_HOOK: Connection = {
  kind: "webhook",
  label: "Acme pushes",
  organizationId: "org-acme",
  connectedByName: "Dana Admin",
  connectedByCaller: false,
  lastDeliveryAt: null,
};

function coverage(
  status: Coverage["status"],
  nextAction: Coverage["nextAction"],
  connection: Connection | null,
): Coverage {
  return { status, nextAction, connection, appInstallAccount: "acme-co" };
}

function status(
  commitLane: Partial<RepoStatusResponse["commitLane"]>,
  overrides: Partial<RepoStatusResponse> = {},
): RepoStatusResponse {
  return {
    repository: {
      provider: "github",
      ownerRepo: "acme-co/acme-portal",
      displayUrl: "https://github.com/acme-co/acme-portal",
    },
    attribution: {
      reason: "attributed",
      projectId: "project_1",
      projectNames: ["Acme Portal"],
    },
    commitLane: {
      status: "no_delivery",
      lastCommitAt: null,
      hasWebhookSecret: true,
      ...commitLane,
    },
    ready: false,
    webhookUrl: "https://hooks.example.test/user_1",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CLOCKTOPUS_API_URL = "https://app.example.test";
});

afterEach(() => {
  delete process.env.CLOCKTOPUS_API_URL;
});

describe("commitLaneCheck", () => {
  it("tells a teammate the team's installation covers the repository", () => {
    const check = commitLaneCheck(
      status({ coverage: coverage("covered", "push", TEAM_APP) }),
    );

    expect(check.ok).toBe("warn");
    expect(check.detail).toContain(
      "the GitHub App on acme-co (installed by Dana Admin) covers it",
    );
    expect(check.fix).toContain("Nothing to set up");
    expect(check.fix).not.toContain("webhook");
  });

  it("names the connection a delivering repository arrives through", () => {
    const check = commitLaneCheck(
      status({
        status: "delivering",
        lastCommitAt: new Date().toISOString(),
        coverage: coverage("covered", "push", TEAM_HOOK),
      }),
    );

    expect(check.ok).toBe(true);
    expect(check.detail).toContain('via Dana Admin\'s webhook "Acme pushes"');
  });

  it("waits for a project before a personal installation's hook exists", () => {
    const check = commitLaneCheck(
      status({
        coverage: coverage("covered", "attach_project", {
          ...TEAM_APP,
          connectedByCaller: true,
        }),
      }),
    );

    expect(check.detail).toContain("(installed by you)");
    expect(check.fix).toContain("once a project attaches it");
  });

  it("asks before connecting when the team's webhook has not delivered from this repository", () => {
    const check = commitLaneCheck(
      status({
        coverage: coverage("unconfirmed", "check_webhook", TEAM_HOOK),
      }),
    );

    expect(check.ok).toBe("warn");
    expect(check.detail).toContain(
      "has not delivered from this repository yet",
    );
    expect(check.fix).toContain("nothing to set up");
    expect(check.fix).toContain("One connection covers the whole team");
  });

  it("reports a webhook GitHub pinged from the repository as waiting for a push", () => {
    const check = commitLaneCheck(
      status({
        coverage: coverage("covered", "push", {
          ...TEAM_HOOK,
          ping: {
            targetType: "repository",
            target: "acme-co/acme-portal",
            events: ["push", "pull_request"],
            missingEvents: ["pull_request_review"],
            contentType: "json",
            receivedAt: new Date().toISOString(),
          },
        }),
      }),
    );

    expect(check.ok).toBe("warn");
    expect(check.detail).toContain(
      "GitHub confirmed it on acme-co/acme-portal",
    );
    expect(check.fix).toContain("It does not send Pull request reviews");
  });

  it("fails a pinged webhook that does not send pushes", () => {
    const check = commitLaneCheck(
      status({
        coverage: coverage("unconfirmed", "check_webhook", {
          ...TEAM_HOOK,
          ping: {
            targetType: "organization",
            target: "acme-co",
            events: ["pull_request"],
            missingEvents: ["push", "pull_request_review"],
            contentType: "json",
            receivedAt: new Date().toISOString(),
          },
        }),
      }),
    );

    expect(check.ok).toBe(false);
    expect(check.detail).toContain(
      "is on the acme-co organisation, but does not send Pushes",
    );
  });

  it("sends a teammate to the installer when the repository is not selected", () => {
    const check = commitLaneCheck(
      status({
        coverage: coverage("not_selected", "add_to_selection", TEAM_APP),
      }),
    );

    expect(check.ok).toBe(false);
    expect(check.detail).toContain("does not include acme-co/acme-portal");
    expect(check.fix).toContain("Ask Dana Admin to add it");
  });

  it("explains how to connect only when nothing covers the repository", () => {
    const check = commitLaneCheck(
      status({
        status: "no_secret",
        hasWebhookSecret: false,
        coverage: coverage("not_covered", "connect", null),
      }),
    );

    expect(check.ok).toBe(false);
    expect(check.fix).toContain("Install the GitHub App on acme-co");
    expect(check.fix).toContain("https://hooks.example.test/user_1");
    expect(check.fix).toContain("One connection covers the whole team");
    expect(check.fix).not.toContain("each teammate");
  });

  it("offers only a webhook when the server says the App cannot cover the repository", () => {
    const check = commitLaneCheck(
      status({
        status: "no_secret",
        hasWebhookSecret: false,
        coverage: {
          ...coverage("not_covered", "connect", null),
          appInstallAccount: null,
        },
      }),
    );

    expect(check.fix).not.toContain("GitHub App");
    expect(check.fix).toContain("Add a push webhook");
  });

  it("tells a teammate an installation's selection could not be read", () => {
    const check = commitLaneCheck(
      status({
        coverage: coverage("unconfirmed", "check_selection", TEAM_APP),
      }),
    );

    expect(check.ok).toBe("warn");
    expect(check.detail).toContain("could not read which repositories");
  });

  it("does not ask an older server's teammate to add their own webhook", () => {
    const check = commitLaneCheck(
      status({ status: "no_secret", hasWebhookSecret: false }),
    );

    expect(check.fix).toContain("If your team's GitHub App or webhook covers");
    expect(check.fix).not.toContain("each teammate");
  });
});

describe("RepoStatusSchema", () => {
  it("reads a coverage shape it does not know as absent", () => {
    const parsed = RepoStatusSchema.parse({
      ...status({}),
      commitLane: {
        status: "no_delivery",
        lastCommitAt: null,
        hasWebhookSecret: true,
        coverage: { status: "pinged", connection: null },
      },
    });

    expect(parsed.commitLane.coverage).toBeUndefined();
  });
});

describe("repoStatusPath", () => {
  it("sends origin as repositoryUrl and every remote as repositoryUrls", () => {
    const path = repoStatusPath([
      "git@github.com:jordan/acme-portal.git",
      "git@github.com:acme-co/acme-portal.git",
    ]);

    const query = new URL(path ?? "", "https://clocktopus.test").searchParams;
    expect(query.get("repositoryUrl")).toBe(
      "git@github.com:jordan/acme-portal.git",
    );
    expect(query.getAll("repositoryUrls")).toEqual([
      "git@github.com:jordan/acme-portal.git",
      "git@github.com:acme-co/acme-portal.git",
    ]);
  });

  it("asks nothing for a checkout with no remotes", () => {
    expect(repoStatusPath([])).toBeNull();
  });
});
