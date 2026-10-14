import { describe, expect, it } from "vitest";

import {
  extractTaskKey,
  extractTaskKeyFromPullRequest,
  findMergeCommitTaskKeyReference,
  findTaskKeyReference,
  isTicketKey,
  normalizeTaskKey,
} from "./task-key";

/** A commit subject arriving from a webhook: only its scope is a reference. */
const fromCommit = (text: string | null | undefined) =>
  extractTaskKey(text, "webhook");

/** A note a person typed on a manual entry: an inline `#tag` counts too. */
const fromNote = (text: string | null | undefined) =>
  extractTaskKey(text, "manual");

describe("extractTaskKey", () => {
  describe("the two notations agree", () => {
    // `#` is notation, not identity. A commit scope and a hand-written tag
    // must land on the same task row.
    it("resolves feat(#22) and #22 to the same key", () => {
      expect(fromCommit("feat(#22): fix logout")).toBe("22");
      expect(fromNote("worked on #22")).toBe("22");
    });

    it("resolves every spelling of BLA-123 to one key", () => {
      expect(fromCommit("feat(bla-123): add filter")).toBe("BLA-123");
      expect(fromCommit("fix(BLA-123): patch")).toBe("BLA-123");
      expect(fromCommit("feat(#bla-123): add filter")).toBe("BLA-123");
      expect(fromNote("pairing on #BLA-123")).toBe("BLA-123");
      expect(fromNote("pairing on #bla-123")).toBe("BLA-123");
    });
  });

  describe("conventional commit scope", () => {
    it("extracts and uppercases the scope", () => {
      expect(fromCommit("chore(task-9): tidy")).toBe("TASK-9");
    });

    it("keeps parity with the old regex for non-ticket scopes", () => {
      expect(fromCommit("feat(blog): announce release")).toBe("BLOG");
    });

    it("only matches on the first line", () => {
      expect(fromCommit("chore: tidy\n\nfeat(BLA-1): body line")).toBe(null);
    });

    it("reads the scope from a multi-line commit message", () => {
      expect(fromCommit("feat(BLA-7): subject\n\nLonger body here.")).toBe(
        "BLA-7",
      );
    });

    it("is honoured for every source", () => {
      expect(extractTaskKey("feat(BLA-3): x", "manual")).toBe("BLA-3");
      expect(extractTaskKey("feat(BLA-3): x", "webhook")).toBe("BLA-3");
      expect(extractTaskKey("feat(BLA-3): x", "sys-adjustment")).toBe("BLA-3");
    });

    it("ignores a scope that normalises to nothing and falls through", () => {
      expect(fromNote("feat(#): see #BLA-9")).toBe("BLA-9");
      // Nothing to fall through to when the text is machine-written.
      expect(fromCommit("feat(#): see #BLA-9")).toBe(null);
    });
  });

  describe("inline hash tag (user-typed descriptions only)", () => {
    it("matches a purely numeric key", () => {
      expect(fromNote("closes #22")).toBe("22");
      expect(fromNote("#22")).toBe("22");
    });

    it("stops at sentence punctuation", () => {
      expect(fromNote("finished #BLA-123.")).toBe("BLA-123");
      expect(fromNote("did #BLA-1, then lunch")).toBe("BLA-1");
    });

    it("ignores a hash inside a URL or mid-token", () => {
      expect(fromNote("read example.com/page#section")).toBe(null);
      expect(fromNote("colour was ##")).toBe(null);
    });

    it("matches anywhere in the text, not just the first line", () => {
      // People write notes over several lines and tag where it reads best.
      expect(fromNote("standup notes\nthen worked #BLA-5")).toBe("BLA-5");
    });

    it.each([
      "fix: colour tweak\n\nheader is now #ff0000",
      "fix: tweak layout\n\nSee discussion in #general",
      "refactor: cleanup\n\n- see #99 for context",
    ])("never reads a commit body, whose #s are not tasks: %j", (message) => {
      // These arrive from the webhook, where the tag pattern does not run at
      // all — `#ff0000` is a colour and `#general` a channel, not tasks.
      expect(fromCommit(message)).toBe(null);
    });

    it.each(["webhook", "sys-adjustment"] as const)(
      "is ignored for %s descriptions",
      (source) => {
        // A `#` in machine-written text is a PR, an issue, a colour, a channel
        // — never a task somebody tagged on purpose.
        expect(extractTaskKey("closes #22", source)).toBe(null);
        expect(extractTaskKey("bumped contrast to #ff0000", source)).toBe(null);
        expect(extractTaskKey('Revert "thing" (see #BLA-9)', source)).toBe(
          null,
        );
      },
    );
  });

  describe("merge commits (PR numbers are not tasks)", () => {
    // Real subjects from this repository's history. A third of its commits are
    // merges, so a miss here would attribute a third of all backfilled time to
    // pull request numbers.
    it.each([
      "Merge pull request #170 from blastin-dev/allanclempe/bla-314-manual-entry",
      "Merge pull request #99 from blastin-dev/allanclempe/bla-310-webhooks",
      "Merge branch 'develop' into allanclempe/bla-414-stripe",
      "Merge remote-tracking branch 'origin/develop'",
      "Merged in feature/thing (pull request #42)",
    ])("returns null for %j", (subject) => {
      expect(fromCommit(subject)).toBe(null);
      // Also excluded when a user pastes one into a manual entry.
      expect(fromNote(subject)).toBe(null);
    });

    it("ignores a merge commit's branch name even when it contains a ticket", () => {
      // `bla-193` appears in the branch, but the merge is not work on it.
      expect(
        fromCommit(
          "Merge pull request #173 from blastin-dev/allanclempe/bla-193-archive",
        ),
      ).toBe(null);
    });
  });

  describe("squash-merge subjects", () => {
    it("prefers the conventional scope over the trailing PR number", () => {
      expect(fromCommit("feat(BLA-1): add filter (#170)")).toBe("BLA-1");
    });

    it("does not treat a parenthesised PR number as a task", () => {
      // `(#66)` — the `#` follows `(`, not whitespace, so it is not a tag.
      // Real subject from this repository's history. Asserted on the note path
      // too: the webhook path would return null on source alone, which would
      // hide a regression in the tag boundary itself.
      const subject = "Allanclempe/bla 206 authenticated cli clock in (#66)";
      expect(fromCommit(subject)).toBe(null);
      expect(fromNote(subject)).toBe(null);
    });
  });

  describe("precedence and multiplicity", () => {
    it("prefers the scope when both are present", () => {
      expect(fromNote("feat(BLA-1): also touches #BLA-2")).toBe("BLA-1");
    });

    it("takes the first tag when several are present", () => {
      expect(fromNote("did #BLA-1 and #BLA-2")).toBe("BLA-1");
    });
  });

  describe("no reference", () => {
    it.each([
      ["plain prose with no reference", null],
      ["", null],
      ["   ", null],
      ["#", null],
    ])("returns null for %j", (input, expected) => {
      // The note path is the permissive one — null here implies null anywhere.
      expect(fromNote(input)).toBe(expected);
    });

    it("returns null for nullish input", () => {
      expect(fromNote(null)).toBe(null);
      expect(fromNote(undefined)).toBe(null);
    });
  });
});

describe("normalizeTaskKey", () => {
  it("strips the hash notation", () => {
    expect(normalizeTaskKey("#22")).toBe("22");
    expect(normalizeTaskKey("##22")).toBe("22");
  });

  it("uppercases", () => {
    expect(normalizeTaskKey("bla-123")).toBe("BLA-123");
  });

  it("trims surrounding whitespace and trailing separators", () => {
    expect(normalizeTaskKey("  BLA-123  ")).toBe("BLA-123");
    expect(normalizeTaskKey("BLA-")).toBe("BLA");
    expect(normalizeTaskKey("BLA_")).toBe("BLA");
  });

  it("returns null when nothing usable remains", () => {
    expect(normalizeTaskKey("#")).toBe(null);
    expect(normalizeTaskKey("---")).toBe(null);
    expect(normalizeTaskKey("")).toBe(null);
    expect(normalizeTaskKey(null)).toBe(null);
    expect(normalizeTaskKey(undefined)).toBe(null);
  });
});

describe("extractTaskKeyFromPullRequest", () => {
  it("takes the key from the branch when it names one", () => {
    expect(
      extractTaskKeyFromPullRequest({
        sourceBranch: "acme/abc-12-add-export",
        title: "feat(abc-99): add export",
      }),
    ).toBe("ABC-12");
  });

  it("falls back to the title's scope for a branch with no key", () => {
    expect(
      extractTaskKeyFromPullRequest({
        sourceBranch: "ccr-8bf3884b-0tgp9n",
        title: "feat(abc-12): derive each ticket's stage",
      }),
    ).toBe("ABC-12");
  });

  it("ignores a title scope that is not shaped like a ticket key", () => {
    for (const title of [
      "chore(ci): run releases one at a time",
      "fix(deps): clear the audit advisories",
      "feat(2024): yearly report",
    ]) {
      expect(
        extractTaskKeyFromPullRequest({ sourceBranch: "chore/ci", title }),
      ).toBeNull();
    }
  });

  it("ignores a title with no scope", () => {
    expect(
      extractTaskKeyFromPullRequest({
        sourceBranch: "fix-typo",
        title: "Fix typo ABC-12",
      }),
    ).toBeNull();
  });
});

describe("findTaskKeyReference", () => {
  const spanOf = (text: string, source: "manual" | "webhook" = "webhook") => {
    const ref = findTaskKeyReference(text, source);
    return ref && { key: ref.key, text: text.slice(ref.start, ref.end) };
  };

  it("bounds a conventional-commit scope's contents", () => {
    expect(spanOf("feat(bla-123): add filter")).toEqual({
      key: "BLA-123",
      text: "bla-123",
    });
    expect(spanOf("fix(#BLA-9): patch")).toEqual({
      key: "BLA-9",
      text: "#BLA-9",
    });
  });

  it("bounds a manual entry's tag with its #", () => {
    expect(spanOf("pairing on #bla-12.", "manual")).toEqual({
      key: "BLA-12",
      text: "#bla-12",
    });
    expect(spanOf("#BLA-12 review", "manual")).toEqual({
      key: "BLA-12",
      text: "#BLA-12",
    });
  });

  it("finds nothing in a merge commit, whose task is its pull request's", () => {
    expect(
      spanOf(
        "Merge pull request #322 from acme-co/dana/bla-744-run-e2e\n\nfeat(bla-744): run e2e",
      ),
    ).toBeNull();
  });

  it("finds nothing extractTaskKey would not", () => {
    expect(spanOf("worked on #BLA-12")).toBeNull();
    expect(spanOf("Merge pull request #170 from acme-co/feature")).toBeNull();
    expect(spanOf("feat(#): nothing", "manual")).toBeNull();
  });
});

describe("findMergeCommitTaskKeyReference", () => {
  const spanOf = (text: string) => {
    const ref = findMergeCommitTaskKeyReference(text);
    return ref && { key: ref.key, text: text.slice(ref.start, ref.end) };
  };

  it("bounds the key in a GitHub merge's source branch", () => {
    expect(
      spanOf(
        "Merge pull request #322 from acme-co/dana/bla-744-run-e2e\n\nfeat(bla-744): run e2e",
      ),
    ).toEqual({ key: "BLA-744", text: "bla-744" });
  });

  it("bounds the key in a Bitbucket merge's source branch", () => {
    expect(
      spanOf("Merged in feature/ACME-7-export (pull request #12)\n\nExport"),
    ).toEqual({ key: "ACME-7", text: "ACME-7" });
  });

  it("falls back to the title's scope when the branch names no key", () => {
    expect(
      spanOf(
        "Merge pull request #12 from acme-co/fix-typo\n\nfix(ACME-9): fix typo",
      ),
    ).toEqual({ key: "ACME-9", text: "ACME-9" });
  });

  it("ignores a title scope that is not shaped like a ticket key", () => {
    expect(
      spanOf("Merge pull request #12 from acme-co/fix-ci\n\nchore(ci): retry"),
    ).toBeNull();
  });

  it("finds nothing in a commit that is not a pull request merge", () => {
    expect(spanOf("feat(bla-12): add filter")).toBeNull();
    expect(spanOf("Merge branch 'develop' into dana/bla-12-x")).toBeNull();
  });
});

describe("isTicketKey", () => {
  it("accepts a prefix and a number", () => {
    expect(isTicketKey("BLA-12")).toBe(true);
    expect(isTicketKey("ACME2-7")).toBe(true);
  });

  it("rejects a commit scope that is not shaped like a ticket", () => {
    expect(isTicketKey("RELEASE")).toBe(false);
    expect(isTicketKey("WEB UI")).toBe(false);
    expect(isTicketKey("5")).toBe(false);
  });
});
