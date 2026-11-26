import { describe, expect, it } from "vitest";

import { group, label, repoOf } from "../../herdr/mods/repos/model.js";

const tab = (id: string, extra = {}) => ({
  id,
  name: "1",
  named: false,
  active: false,
  status: null,
  ...extra,
});
const space = (id: string, tabs: ReturnType<typeof tab>[], extra = {}) => ({
  id,
  name: id,
  named: false,
  folder: "",
  machine: null,
  branch: null,
  status: null,
  tabs,
  ...extra,
});

// `git rev-parse --show-toplevel --git-common-dir --git-dir` output; the git dir is the
// common dir except in a linked worktree.
const rev = (top: string, common: string, gitDir = common) =>
  `${top}\n${common}\n${gitDir}\n`;

describe("repoOf", () => {
  it("names a main checkout after its folder", () => {
    expect(
      repoOf(null, rev("/src/acme-portal", "/src/acme-portal/.git")),
    ).toEqual({
      key: JSON.stringify([null, "/src/acme-portal/.git"]),
      name: "acme-portal",
      top: "/src/acme-portal",
      main: "/src/acme-portal",
      linked: false,
    });
  });

  it("gives a worktree its repository's key and name", () => {
    const main = repoOf(null, rev("/src/acme-portal", "/src/acme-portal/.git"));
    const worktree = repoOf(
      null,
      rev(
        "/src/acme-portal/.claude/worktrees/acm-7",
        "/src/acme-portal/.git",
        "/src/acme-portal/.git/worktrees/acm-7",
      ),
    );
    expect(worktree.key).toBe(main.key);
    expect(worktree.name).toBe("acme-portal");
    expect(worktree.main).toBe("/src/acme-portal");
    expect(worktree.linked).toBe(true);
  });

  it("takes a submodule's own checkout as its main one", () => {
    expect(
      repoOf(
        null,
        rev("/src/acme-portal/vendor/ui", "/src/acme-portal/.git/modules/ui"),
      ),
    ).toMatchObject({
      name: "ui",
      main: "/src/acme-portal/vendor/ui",
      linked: false,
    });
  });

  it("reads a submodule inside a superproject's worktree as its own checkout", () => {
    expect(
      repoOf(
        null,
        rev(
          "/w/acm-7/vendor/ui",
          "/src/acme-portal/.git/worktrees/acm-7/modules/ui",
        ),
      ),
    ).toMatchObject({ name: "ui", main: "/w/acm-7/vendor/ui", linked: false });
  });

  it("tells a submodule's worktree from its own checkout", () => {
    expect(
      repoOf(
        null,
        rev(
          "/w/ui-wt",
          "/src/acme-portal/.git/modules/ui",
          "/src/acme-portal/.git/modules/ui/worktrees/ui-wt",
        ),
      ),
    ).toMatchObject({ name: "ui", main: null, linked: true });
  });

  it("keeps the same repository on two machines apart", () => {
    const here = repoOf(null, rev("/src/acme-portal", "/src/acme-portal/.git"));
    const there = repoOf(
      "vps",
      rev("/src/acme-portal", "/src/acme-portal/.git"),
    );
    expect(there.key).not.toBe(here.key);
  });

  it("names a bare repository's worktree after the bare folder", () => {
    expect(
      repoOf(
        null,
        rev(
          "/src/acme/feature",
          "/src/acme.git",
          "/src/acme.git/worktrees/feature",
        ),
      ).name,
    ).toBe("acme");
  });
});

describe("group", () => {
  const portal = repoOf(null, rev("/src/acme-portal", "/src/acme-portal/.git"));
  const portalTree = repoOf(
    null,
    rev(
      "/w/acm-7",
      "/src/acme-portal/.git",
      "/src/acme-portal/.git/worktrees/acm-7",
    ),
  );
  const api = repoOf(null, rev("/src/acme-api", "/src/acme-api/.git"));

  it("puts worktrees under their repository, its own checkout first, and other folders last", () => {
    const spaces = [
      space("notes", [tab("t1")]),
      space("acm-7", [tab("t2")]),
      space("api", [tab("t3")]),
      space("portal", [tab("t4")]),
    ];
    const git: Record<string, unknown> = {
      notes: null,
      "acm-7": portalTree,
      api,
      portal,
    };
    const tree = group(spaces, [], (s: { id: string }) => git[s.id]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.repos.map((r: { name: string }) => r.name)).toEqual([
      "acme-portal",
      "acme-api",
      "Other",
    ]);
    expect(
      tree[0]?.repos[0]?.spaces.map((x: { s: { id: string } }) => x.s.id),
    ).toEqual(["portal", "acm-7"]);
  });

  it("groups a space git hasn't answered for by Herdr's name until it does", () => {
    const tree = group(
      [space("acme-portal", [tab("t1")])],
      [],
      () => undefined,
    );
    expect(tree[0]?.repos[0]).toMatchObject({
      name: "acme-portal",
      repo: true,
      top: null,
    });
  });

  it("takes a space's branch from its terminals", () => {
    const tree = group(
      [space("acm-7", [tab("t1")], { branch: "stale" })],
      [{ tab: "t1", branch: "acm-7-export" }],
      () => portalTree,
    );
    expect(tree[0]?.repos[0]?.spaces[0]?.branch).toBe("acm-7-export");
  });

  it("lists each machine's spaces apart", () => {
    const tree = group(
      [space("a", [tab("t1")]), space("b", [tab("t2")], { machine: "vps" })],
      [],
      () => null,
    );
    expect(tree.map((m: { machine: string | null }) => m.machine)).toEqual([
      null,
      "vps",
    ]);
  });
});

describe("label", () => {
  const claude = { agent: true, name: "Claude Code", key: "claude" };

  it("follows an unnamed tab's agent title", () => {
    expect(
      label(tab("t1"), {
        program: claude,
        title: "✳ Export invoices",
        terminal: "t9",
      }),
    ).toBe("Export invoices");
  });

  it("keeps a name the person gave", () => {
    expect(
      label(tab("t1", { name: "review", named: true }), {
        program: claude,
        title: "Export invoices",
      }),
    ).toBe("review");
  });

  it("names a tab without an agent after its program", () => {
    expect(
      label(tab("t1"), {
        program: { agent: false, name: "bash" },
        title: "~/src",
      }),
    ).toBe("bash");
  });
});
