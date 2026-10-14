import { describe, expect, it } from "vitest";

import { buildReflogArgs, parseReflogCommits } from "./declared-commits.js";

const STARTED_AT = "2026-08-20T05:35:45.728Z";
const SHA = "418a320a048f839f2200106fbcffbb6f7683d135";

const reflog = (...lines: string[]) => lines.join("\n");

describe("buildReflogArgs", () => {
  it("bounds the read at the session start exactly", () => {
    expect(buildReflogArgs({ startedAt: STARTED_AT })).toContain(
      `--since=${STARTED_AT}`,
    );
  });

  /**
   * No backward grace. Both stamps come from one machine clock, and SessionStart fires
   * before the agent can act, so a grace could only admit a commit made *before* the
   * session — as `declared`, which outranks the time window and is permanent.
   */
  it("admits nothing committed before the session started", () => {
    const args = buildReflogArgs({ startedAt: STARTED_AT })!;
    const since = args
      .find((arg) => arg.startsWith("--since="))!
      .replace("--since=", "");

    expect(new Date(since).getTime()).toBe(new Date(STARTED_AT).getTime());
  });

  /** The sweep runs hours late; a session that died owns nothing committed since. */
  it("takes an upper bound, for the sweep", () => {
    const args = buildReflogArgs({
      startedAt: STARTED_AT,
      until: "2026-08-20T11:56:30.103Z",
    });

    expect(args).toContain("--until=2026-08-20T11:56:30.103Z");
  });

  /**
   * A working tree with a file called `HEAD` otherwise makes git refuse the read
   * outright — "ambiguous argument 'HEAD': both revision and filename".
   */
  it("separates the revision from any path of the same name", () => {
    expect(buildReflogArgs({ startedAt: STARTED_AT })!.at(-1)).toBe("--");
  });

  it("omits the upper bound for a live SessionEnd", () => {
    const args = buildReflogArgs({ startedAt: STARTED_AT })!;
    expect(args.some((arg) => arg.startsWith("--until="))).toBe(false);
  });

  /**
   * Declaring nothing is the deliberate answer. Without a lower bound the reflog is
   * the checkout's entire history, and a `declared` link outranks the time window, so
   * over-declaring is the one mistake that cannot be undone later.
   */
  it("refuses to read at all when the session start was never recorded", () => {
    expect(buildReflogArgs({})).toBeNull();
    expect(buildReflogArgs({ startedAt: "not a date" })).toBeNull();
  });
});

describe("parseReflogCommits", () => {
  it("takes the commits this checkout authored", () => {
    const shas = parseReflogCommits(
      reflog(
        `${SHA} commit: fix(bla-597): read the reflog`,
        "cd72bebc2ce64099f27f28e251be57cb53189328 commit (merge): merge the release branch",
      ),
    );

    expect(shas).toEqual([SHA, "cd72bebc2ce64099f27f28e251be57cb53189328"]);
  });

  it("takes a revert and a cherry-pick, which always author here", () => {
    const shas = parseReflogCommits(
      reflog(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa revert: Revert "feat: c2"',
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cherry-pick: feat: c3",
      ),
    );

    expect(shas).toHaveLength(2);
  });

  /**
   * Parent count looks like it would separate a merge you made from one you
   * fast-forwarded onto, and does not: a plain `git pull` on a repository that merges
   * its pull requests lands on a two-parent commit somebody else wrote. So merges are
   * excluded, and a conflicted one is still caught as `commit (merge)`.
   */
  it("ignores a clean merge rather than risk claiming a pulled one", () => {
    const shas = parseReflogCommits(
      reflog(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa merge side: Merge made by the 'ort' strategy.",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb pull: Fast-forward",
      ),
    );

    expect(shas).toEqual([]);
  });

  /**
   * The whole point. A pull or a merge is one reflog entry however much history it
   * brings — the range that replaced this declared 118 commits for one such merge.
   */
  it("ignores history that merely arrived in the checkout", () => {
    const shas = parseReflogCommits(
      reflog(
        "4257246e3860ef8d834e4e4efbb7ed0da648ad23 pull: Fast-forward",
        "9f0ae840a64bae586d8e816124278ee0212ad0cc merge develop: Merge made by the 'ort' strategy.",
        "64d934042b0568a7acded2b059148dbc8f36ac83 checkout: moving from develop to a-branch",
        "6f59f8ad63a21000406480c17e766ea0706dff70 reset: moving to HEAD~1",
      ),
    );

    expect(shas).toEqual([]);
  });

  /**
   * A rebase writes new objects, but replaying a branch would declare work authored
   * long before the session. Excluded; the pushed SHAs fall to the time-window rule.
   */
  it("ignores rebase replays", () => {
    const shas = parseReflogCommits(
      reflog(
        "64d934042b0568a7acded2b059148dbc8f36ac83 rebase (start): checkout develop",
        "cd72bebc2ce64099f27f28e251be57cb53189328 rebase (pick): fix(bla-595): bound the range",
        "cd72bebc2ce64099f27f28e251be57cb53189328 rebase (finish): returning to a-branch",
      ),
    );

    expect(shas).toEqual([]);
  });

  it("keeps an amend, whose old and new SHAs are both reflog commits", () => {
    const shas = parseReflogCommits(
      reflog(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa commit (amend): fix(bla-597): reworded",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb commit: fix(bla-597): original",
      ),
    );

    // Only the amended SHA is ever pushed; the original simply joins to nothing.
    expect(shas).toHaveLength(2);
  });

  it("keeps an initial commit", () => {
    expect(parseReflogCommits(`${SHA} commit (initial): base`)).toEqual([SHA]);
  });

  it("survives a subject containing the field separator", () => {
    const shas = parseReflogCommits(
      `${SHA} commit: fix(bla-597): read HEAD, then the reflog`,
    );

    expect(shas).toEqual([SHA]);
  });

  it("does not repeat a SHA HEAD returned to", () => {
    const shas = parseReflogCommits(
      reflog(`${SHA} commit: one`, `${SHA} commit (amend): one, reworded`),
    );

    expect(shas).toEqual([SHA]);
  });

  it("returns nothing for an empty or unreadable reflog", () => {
    expect(parseReflogCommits("")).toEqual([]);
    expect(parseReflogCommits(undefined)).toEqual([]);
    expect(parseReflogCommits("not a reflog line")).toEqual([]);
  });

  it("caps what one session may declare", () => {
    const lines = Array.from(
      { length: 250 },
      (_, i) => `${i.toString(16).padStart(40, "0")} commit: commit ${i}`,
    );

    expect(parseReflogCommits(reflog(...lines))).toHaveLength(200);
  });
});

/**
 * The sweep's upper bound is the state file's mtime, which is only a record of "last
 * activity" on a host that rewrites the file as the session goes. Everywhere else the
 * file is written once at SessionStart, so `until` equals `startedAt` and the window
 * collapses onto a point — which is why `sweptCommits` refuses to read it at all for
 * those hosts rather than relying on this shape.
 */
describe("the window a sweep would ask for", () => {
  it("collapses to a point when until is the session start", () => {
    const args = buildReflogArgs({
      startedAt: STARTED_AT,
      until: STARTED_AT,
    })!;

    const since = args.find((a) => a.startsWith("--since="))!.slice(8);
    const until = args.find((a) => a.startsWith("--until="))!.slice(8);

    expect(new Date(since).getTime()).toBe(new Date(until).getTime());
  });
});
