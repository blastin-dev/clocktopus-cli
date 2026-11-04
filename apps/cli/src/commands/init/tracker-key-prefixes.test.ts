import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Prompter } from "../../lib/prompt.js";
import type { InitDeps, InitState } from "./types.js";
import { createPrompter } from "../../lib/prompt.js";
import {
  findCheckoutKeyPrefixes,
  MIN_PREFIX_USES,
  runTrackerKeyPrefixStep,
} from "./tracker-key-prefixes.js";

const SUBJECTS = [
  "feat(bla-12): add invoices",
  "fix(BLA-13): round totals",
  "chore(ci): pin node",
  "feat(ops-4): page on failures",
  "Merge pull request #7 from acme-co/ops-5-alerts",
  "feat(v2-1): try the new layout",
  "docs: readme",
].join("\n");

const BRANCHES = [
  "main",
  "dana/bla-14-export",
  "origin/ap-3-portal",
  "origin/ops-6-retries",
  "dependabot/npm_and_yarn/lodash-4",
  "release/2",
].join("\n");

function git(args: string[]) {
  if (args[0] === "log") return { ok: true, stdout: SUBJECTS, stderr: "" };
  if (args[0] === "for-each-ref") {
    return { ok: true, stdout: BRANCHES, stderr: "" };
  }
  return { ok: false, stdout: "", stderr: "" };
}

const ORGANIZATION = { id: "org_1", name: "Acme", slug: "acme", role: "owner" };

function onboarding(role = "owner") {
  return {
    preferencesConfirmed: true,
    onboardingCompleted: false,
    preferences: null,
    organizations: [{ ...ORGANIZATION, role }],
  };
}

function state(): InitState {
  return {
    organizationId: "org_1",
    projectId: "p_1",
    projectName: "Acme Portal",
    connectedBy: null,
  };
}

// `taken` maps a prefix to the project that already uses it.
function fakeDeps(taken: Record<string, string>, prompt?: Prompter) {
  const lines: string[] = [];
  const posts: Array<{ path: string; body: unknown }> = [];
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    posts.push({ path, body });
    const prefixes = z.array(z.string()).parse(body.prefixes);
    return {
      taskKeyPrefix: "AP",
      trackerKeyPrefixes: [],
      declared: prefixes.filter((p) => !taken[p] && p !== "AP"),
      refused: prefixes.flatMap((p) =>
        taken[p] ? [{ prefix: p, usedBy: taken[p] }] : [],
      ),
    };
  });
  const deps: InitDeps = {
    api: { get: vi.fn(), post, put: vi.fn() },
    prompt: prompt ?? createPrompter({ interactive: false }),
    log: (line = "") => lines.push(line),
    run: (_command, args) => git(args),
    sleep: async () => {},
    now: () => new Date("2026-10-09T10:00:00Z"),
    connectGithubApp: vi.fn(),
    listenForManualSwitch: () => ({
      signal: new AbortController().signal,
      stop: () => {},
    }),
    runAgentSetup: vi.fn(),
    surveyAgents: () => [],
  };
  return { deps, lines, posts };
}

describe("findCheckoutKeyPrefixes", () => {
  it("reads ticket-shaped commit scopes and branch names, most used first", () => {
    expect(
      findCheckoutKeyPrefixes({ run: (_command, args) => git(args) }),
    ).toEqual(["BLA", "OPS"]);
  });

  it("leaves out a prefix fewer than MIN_PREFIX_USES commits and branches carry", () => {
    const found = findCheckoutKeyPrefixes({
      run: (_command, args) => git(args),
    });

    expect(MIN_PREFIX_USES).toBe(2);
    expect(found).not.toContain("AP");
    expect(found).not.toContain("V2");
  });

  it("counts a commit scope and a branch name together", () => {
    const run = (_command: string, args: string[]) => {
      if (args[0] === "log") {
        return { ok: true, stdout: "feat(zed-1): add search", stderr: "" };
      }
      if (args[0] === "for-each-ref") {
        return { ok: true, stdout: "dana/zed-2-filters", stderr: "" };
      }
      return { ok: false, stdout: "", stderr: "" };
    };

    expect(findCheckoutKeyPrefixes({ run })).toEqual(["ZED"]);
  });

  it("finds nothing outside a repository", () => {
    expect(
      findCheckoutKeyPrefixes({
        run: () => ({ ok: false, stdout: "", stderr: "" }),
      }),
    ).toEqual([]);
  });
});

describe("runTrackerKeyPrefixStep", () => {
  it("declares the prefixes found without asking and prints them", async () => {
    const { deps, lines, posts } = fakeDeps({});

    await runTrackerKeyPrefixStep(deps, onboarding(), state());

    expect(posts).toEqual([
      {
        path: "/api/organizations/org_1/projects/p_1/tracker-key-prefixes",
        body: { prefixes: ["BLA", "OPS"] },
      },
    ]);
    expect(lines).toEqual(["✓ Tracker key prefixes: BLA, OPS"]);
  });

  it("skips a prefix another project uses when nobody can answer", async () => {
    const { deps, lines, posts } = fakeDeps({ OPS: "Acme Ops" });

    await runTrackerKeyPrefixStep(deps, onboarding(), state());

    expect(posts).toHaveLength(1);
    expect(lines).toEqual(["✓ Tracker key prefixes: BLA"]);
  });

  it("asks on a clash, naming the project, and declares the prefix typed instead", async () => {
    const questions: string[] = [];
    // Picks "Type another prefix".
    const prompt: Prompter = {
      interactive: true,
      confirm: async () => false,
      text: async () => "opx",
      choose: async (question, choices) => {
        questions.push(question);
        return choices[1]!.value;
      },
    };
    const { deps, lines, posts } = fakeDeps({ OPS: "Acme Ops" }, prompt);

    await runTrackerKeyPrefixStep(deps, onboarding(), state());

    expect(questions).toEqual([
      "OPS is used by Acme Ops. What should Acme Portal declare instead?",
    ]);
    expect(posts[1]?.body).toEqual({ prefixes: ["OPX"] });
    expect(lines).toEqual(["✓ Tracker key prefixes: BLA, OPX"]);
  });

  it("leaves declaring to an owner or admin", async () => {
    const { deps, lines, posts } = fakeDeps({});

    await runTrackerKeyPrefixStep(deps, onboarding("member"), state());

    expect(posts).toEqual([]);
    expect(lines[0]).toContain("an owner or admin of Acme declares them");
  });
});
