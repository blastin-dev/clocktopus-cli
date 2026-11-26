// One tree in place of Herdr's Spaces and Agents lists: machine (once another one
// has spaces), repository, worktree or branch (one space each), then its tabs with
// their agents' status. A tab row is the way into a session.

/* global localStorage -- Herdr gives each mod copy its own */

import { h_flex, ScrollHandle, v_flex } from "gpui-base";
import { div, svg, View } from "gpui-kit";
import {
  agents,
  checking,
  exec,
  layout,
  openOverlay,
  panes,
  run,
  setAgentOrder,
  spaces,
  theme,
} from "herdr";

import { group, label, repoOf } from "./model.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, as Herdr's Spaces list does.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);

// A place git couldn't answer for (a machine away) is asked again after this.
const RETRY = 30000;
const ICONS = "mods/workspace-chrome";
// The avatar colours Herdr's Spaces list uses.
const MARK = ["#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a"];
const markOf = (name) =>
  MARK[
    [...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) %
      MARK.length
  ];
const RANK = { blocked: 3, done: 2, working: 1, idle: 0 };
const urgent = (list) =>
  list.reduce((a, b) => ((RANK[b] ?? -1) > (RANK[a] ?? -1) ? b : a), null);

export default class Repos extends View {
  init(_props, cx) {
    this.git = {}; // where() -> repoOf() or null (not a repo); absent until git answers
    this.failed = {}; // where() -> when git last couldn't answer
    this.scroll = ScrollHandle.new();
    try {
      this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    } catch {
      this.folded = new Set();
    }
    if (checking()) return;
    this.look(cx);
    cx.timer.every(1500, (cx) => this.look(cx));
  }

  // Asks git about places it hasn't seen: a folder's repository never changes.
  look(cx) {
    if (this.busy) return;
    const ps = panes(),
      now = Date.now();
    const due = [...new Set(spaces().map((s) => where(s, ps)))].filter((k) =>
      k in this.failed ? now - this.failed[k] > RETRY : !(k in this.git),
    );
    if (!due.length) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      for (const k of due) {
        const [on, cwd] = JSON.parse(k);
        // An empty place is the machine's home, which Herdr's names call "~".
        if (!cwd) {
          this.git[k] = null;
          continue;
        }
        try {
          const r = await exec(
            "git",
            [
              "rev-parse",
              "--path-format=absolute",
              "--show-toplevel",
              "--git-common-dir",
              "--git-dir",
            ],
            { cwd, on, timeout: 5000 },
          );
          if (r.code === 0) {
            this.git[k] = repoOf(on, r.stdout);
            delete this.failed[k];
          } else if (/not a git repository/i.test(r.stderr)) {
            this.git[k] = null;
            delete this.failed[k];
          } else this.fail(k, now);
        } catch {
          this.fail(k, now);
        }
      }
      this.busy = false;
      cx.notify();
    });
  }

  // A place git couldn't answer for stays unknown, so group() files it under
  // Herdr's name for it rather than under Other.
  fail(k, now) {
    this.failed[k] = now;
  }

  fold(key, cx) {
    if (this.folded.has(key)) this.folded.delete(key);
    else this.folded.add(key);
    try {
      localStorage.setItem("folded", JSON.stringify([...this.folded]));
    } catch {
      // Folding still works for this run when the copy's storage can't be written.
    }
    cx.notify();
  }

  showTab(s, c) {
    if (!s.active) run("space.select", { id: s.id });
    run("tab.select", { id: c.id });
  }

  machineRow(m, t) {
    return h_flex()
      .id(`m-${m ?? "local"}`)
      .h(26)
      .flex_none()
      .px(8)
      .gap(7)
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .child(
        svg(`${ICONS}/${m ? "server" : "monitor"}.svg`)
          .size(13)
          .flex_none(),
      )
      .child(
        div()
          .flex_1()
          .truncate()
          .child(m ?? "This computer"),
      )
      .child(
        div()
          .id(`m-new-${m ?? "local"}`)
          .flex_none()
          .px(4)
          .rounded(4)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("New space")
          .on_click(() => run("space.new", { machine: m ?? "" }))
          .child("+"),
      );
  }

  repoRow(r, t) {
    const folded = this.folded.has(r.key);
    const status = urgent(r.spaces.map((x) => x.s.status));
    return h_flex()
      .id(`r-${r.key}`)
      .h(28)
      .mt(6)
      .flex_none()
      .px(8)
      .gap(8)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .when(Boolean(r.top), (el) => el.tooltip(r.top))
      .on_click((_e, cx) => this.fold(r.key, cx))
      .child(
        h_flex()
          .size(18)
          .flex_none()
          .rounded(5)
          .items_center()
          .justify_center()
          .text_size(10.5)
          .font_bold()
          .when(r.repo, (el) =>
            el
              .bg(markOf(r.name))
              .text_color("#ffffff")
              .child([...r.name][0]?.toUpperCase() ?? "?"),
          )
          .when(!r.repo, (el) =>
            el.text_color(t.dim).child(svg(`${ICONS}/folder.svg`).size(13)),
          ),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .font_semibold()
          .text_color(t.foreground)
          .child(r.name),
      )
      .when(folded && status && status !== "idle", (el) =>
        el.child(this.dot(status, t)),
      )
      .when(Boolean(r.repo), (el) =>
        el.child(
          div()
            .id(`r-new-${r.key}`)
            .size(20)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(5)
            .text_color(t.dim)
            .hover((s) => s.bg(t.raised).text_color(t.foreground))
            .tooltip("New worktree")
            .on_click((_e, cx) => {
              cx.stop_propagation();
              openOverlay({
                mod: "worktree",
                kind: "dialog",
                width: 440,
                height: 260,
                props: {
                  space: r.spaces[0].s.id,
                  action: "new",
                  ...(r.top ? { folder: r.top } : {}),
                },
              });
            })
            .child(svg(`${ICONS}/plus.svg`).size(12)),
        ),
      )
      .child(
        svg(`${ICONS}/chevron-${folded ? "right" : "down"}.svg`)
          .size(11)
          .flex_none()
          .text_color(t.dim),
      );
  }

  spaceRow({ s, g, branch }, t) {
    // A space someone named keeps its name; otherwise its branch, then Herdr's name.
    const name = s.named ? s.name : branch || s.name;
    return h_flex()
      .id(`s-${s.id}`)
      .h(26)
      .flex_none()
      .pl(16)
      .pr(8)
      .gap(7)
      .items_center()
      .rounded(7)
      .text_size(12.5)
      .text_color(s.active ? t.foreground : t.muted)
      .hover((el) => el.bg(t.hover))
      .tooltip(
        g
          ? `${g.top}${s.named && branch ? ` · ${branch}` : ""}`
          : s.folder || "~",
      )
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", () =>
        openOverlay({
          mod: "menu",
          kind: "popup",
          width: 200,
          height: 260,
          props: { tab: "space", target: { id: s.id } },
        }),
      )
      .child(
        svg(`${ICONS}/${g ? "git-branch" : "folder"}.svg`)
          .size(12)
          .flex_none()
          .text_color(t.dim),
      )
      .child(div().flex_1().min_w(0).truncate().child(name));
  }

  tabRow(s, c, lead, t) {
    const on = s.active && c.active;
    return h_flex()
      .id(`t-${c.id}`)
      .h(26)
      .flex_none()
      .pl(36)
      .pr(8)
      .gap(7)
      .items_center()
      .rounded(7)
      .text_size(12.5)
      .text_color(on ? t.foreground : t.muted)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((x) => x.bg(t.hover)))
      .on_click(() => this.showTab(s, c))
      .on_mouse_down("right", () =>
        openOverlay({
          mod: "menu",
          kind: "popup",
          width: 200,
          props: { tab: "tab", target: { id: c.id, space: s.id } },
        }),
      )
      .child(
        h_flex()
          .w(12)
          .flex_none()
          .justify_center()
          .child(this.dot(c.status, t)),
      )
      .child(div().flex_1().min_w(0).truncate().child(label(c, lead)));
  }

  dot(status, t) {
    if (status === "working")
      return svg(`${ICONS}/spinner.svg`)
        .size(11)
        .spin(900)
        .text_color(t.working);
    if (status === "blocked" || status === "done")
      return div().size(7).rounded(4).bg(t[status]);
    if (status === "idle")
      return div().size(7).rounded(4).border_1().border_color(t.idle);
    return div().size(4).rounded(2).bg(t.dim);
  }

  railCell({ s, branch }, r, t) {
    return h_flex()
      .id(`rail-${s.id}`)
      .flex_none()
      .justify_center()
      .child(
        h_flex()
          .relative()
          .w(32)
          .h(26)
          .rounded(6)
          .justify_center()
          .items_center()
          .when(s.active, (el) => el.bg(t.selected))
          .when(!s.active, (el) => el.hover((x) => x.bg(t.hover)))
          .tooltip(`${r.name} · ${s.named ? s.name : branch || s.name}`)
          .on_click(() => run("space.select", { id: s.id }))
          .child(
            h_flex()
              .size(16)
              .rounded(4)
              .items_center()
              .justify_center()
              .text_size(9.5)
              .font_bold()
              .bg(r.repo ? markOf(r.name) : t.raised)
              .text_color(r.repo ? "#ffffff" : t.muted)
              .child([...r.name][0]?.toUpperCase() ?? "?"),
          )
          .when(s.status && s.status !== "idle", (el) =>
            el.child(
              div().absolute().right(3).top(3).child(this.dot(s.status, t)),
            ),
          ),
      );
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const sp = spaces(),
      ps = panes(),
      all = agents();
    const tree = group(sp, ps, (s) => this.git[where(s, ps)]);
    const several = tree.length > 1 || tree.some((m) => m.machine);
    const rows = [];
    const order = [];
    let activeAt = -1;
    for (const m of tree) {
      if (several && !collapsed) rows.push(this.machineRow(m.machine, t));
      for (const r of m.repos) {
        if (!collapsed) rows.push(this.repoRow(r, t));
        for (const x of r.spaces) {
          if (collapsed) {
            if (x.s.active) activeAt = rows.length;
            rows.push(this.railCell(x, r, t));
            continue;
          }
          if (this.folded.has(r.key)) continue;
          rows.push(this.spaceRow(x, t));
          for (const c of x.s.tabs ?? []) {
            const lead =
              ps.find((p) => p.tab === c.id && p.program?.agent) ??
              ps.find((p) => p.tab === c.id);
            if (x.s.active && c.active) activeAt = rows.length;
            rows.push(this.tabRow(x.s, c, lead, t));
            for (const a of all) if (a.tab === c.id) order.push(a.address);
          }
        }
      }
    }
    setAgentOrder(order);
    if (activeAt !== this.activeAt) {
      this.activeAt = activeAt;
      if (activeAt >= 0) this.scroll.scroll_to_item(activeAt);
    }
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .child(
        h_flex()
          .h(31)
          .pl(16)
          .pr(10)
          .flex_none()
          .items_center()
          .justify_between()
          .text_size(11.5)
          .text_color(t.dim)
          .when(collapsed, (el) => el.pl(0).pr(0).justify_center())
          .when(!collapsed, (el) => el.child("Repositories"))
          .child(
            div()
              .id("space-new")
              .size(26)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(6)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .tooltip("New space")
              .on_click(() => run("space.new"))
              .child(svg(`${ICONS}/plus.svg`).size(14)),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .px(collapsed ? 0 : 8)
          .pb(14)
          .gap(1)
          .overflow_y_scrollbar()
          .track_scroll(this.scroll)
          .children(rows),
      );
  }
}
