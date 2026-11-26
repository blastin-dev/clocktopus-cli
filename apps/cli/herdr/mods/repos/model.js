// The repos sidebar's decisions, with no Herdr imports: `apps/cli/src/lib/herdr-repos.test.ts` tests them.

const base = (path) => path.replace(/\/+$/, "").split("/").pop();

// Drops a status glyph, keeps a leading bracket or quote, as Herdr's tab bar does.
const clean = (s) =>
  (s ?? "")
    .replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "")
    .replace(/^\[ [!.] \] /, "")
    .trim();

// A tab's name as Herdr's tab bar shows it: a name the person gave stays; an unnamed
// tab, or one named after its program, follows its agent's live title.
export function label(tab, lead) {
  const prog = lead?.program?.name;
  const named = tab.named ? tab.name : (prog ?? "Terminal");
  if (!lead?.program?.agent) return named;
  const live = clean(lead.title);
  const path = /^[~/]|^[A-Za-z]:\\/.test(
    (lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""),
  );
  const telling =
    live &&
    live !== lead.terminal &&
    live !== prog &&
    !path &&
    !live.includes("@") &&
    live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : named;
}

// `git rev-parse --path-format=absolute --show-toplevel --git-common-dir --git-dir` in
// a place, as the repository it belongs to. Every worktree of a repository shares its
// common dir, so `key` groups them; a linked worktree's git dir differs from it.
// `main` is the checkout that owns the common dir: a submodule's common dir is
// `<superproject>/.git/modules/<name>` (`.git/worktrees/<wt>/modules/<name>` inside a
// superproject's worktree), so only its own checkout knows it (null elsewhere).
export function repoOf(machine, stdout) {
  const [top, common, gitDir] = stdout.split("\n");
  const linked = gitDir !== common;
  const own = common.endsWith("/.git");
  const submodule =
    !own && /\/\.git\/(worktrees\/[^/]+\/)?modules\//.test(common);
  const main = own
    ? common.slice(0, -5)
    : submodule
      ? linked
        ? null
        : top
      : common;
  return {
    key: JSON.stringify([machine ?? null, common]),
    name: own ? base(common.slice(0, -5)) : base(common).replace(/\.git$/, ""),
    top,
    main,
    linked,
  };
}

// Spaces as machine → repository → space, in Herdr's space order, each repository's
// own checkout first and spaces outside a repository last, under "Other". `gitOf(space)`
// is its repoOf(), null outside a repository, undefined while git hasn't answered:
// then it groups by Herdr's name for it, which is its repository's when nobody named it.
export function group(spaces, panes, gitOf) {
  const machines = [];
  for (const s of spaces) {
    const machine = s.machine ?? null;
    let m = machines.find((x) => x.machine === machine);
    if (!m) {
      /** @type {{ key: string, name: string, top: string | null, repo: boolean, spaces: { s: any, g: any, branch: string | null }[] }[]} */
      const repos = [];
      m = { machine, repos, other: null };
      machines.push(m);
    }
    const g = gitOf(s);
    const tabs = new Set((s.tabs ?? []).map((c) => c.id));
    const branch =
      panes.find((p) => tabs.has(p.tab) && p.branch)?.branch ??
      s.branch ??
      null;
    const row = { s, g: g ?? null, branch };
    if (g === null) {
      if (!m.other)
        m.other = {
          key: JSON.stringify([machine, null]),
          name: "Other",
          top: null,
          repo: false,
          spaces: [],
        };
      m.other.spaces.push(row);
      continue;
    }
    const key = g ? g.key : JSON.stringify([machine, `name:${s.name}`]);
    let r = m.repos.find((x) => x.key === key);
    if (!r)
      m.repos.push(
        (r = {
          key,
          name: g ? g.name : s.name,
          top: g ? g.main : null,
          repo: true,
          spaces: [],
        }),
      );
    r.spaces.push(row);
  }
  for (const m of machines) {
    for (const r of m.repos) {
      r.spaces.sort(
        (a, b) => Number(Boolean(a.g?.linked)) - Number(Boolean(b.g?.linked)),
      );
      r.top = r.spaces.find((x) => x.g?.main)?.g.main ?? r.top;
    }
    if (m.other) m.repos.push(m.other);
    delete m.other;
  }
  return machines;
}
