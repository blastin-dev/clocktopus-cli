// The panel's view of `get_session_panel`'s answer, as the hooks module keeps it in `$.state`;
// the answer itself is `SessionPanelSchema` (`packages/cli-contract/src/session-panel.ts`).

export type Task = {
  key: string
  title: string | null
  stage: string
  // Hours of human time entries on the task, and of agent runtime; null where the answer has none.
  hours: number | null
  agentHours: number | null
  // The task's page in the web app; null when the organisation's slug is unknown.
  pageUrl: string | null
}

export type GoalTask = Pick<Task, 'key' | 'title' | 'stage'> & { claimed: boolean }

export type Goal = {
  ref: string
  title: string
  doneCount: number
  // The goal's open tasks, in the goal's order.
  open: GoalTask[]
}

export type SessionShare = {
  key: string
  // US dollars; null when the agent reports no spend.
  costUsd: number | null
}

export type Attribution = {
  // Claude Code's session id, the one the Clocktopus hooks report.
  sessionId: string
  // Whether Clocktopus has seen the session at all.
  isKnown: boolean
  // Whether the task shown lists the session among its agent sessions, so its spend counts toward it.
  countsTowardTask: boolean
  // The task the server last tied the session to; null when it has no ties.
  currentKey: string | null
  // Null on a detached HEAD.
  branch: string | null
  // The checkout's root, `~` for the home directory; `isWorktree` for a linked worktree.
  checkout: { path: string; isWorktree: boolean } | null
  branchKey: string | null
  // US dollars, the whole session's; null as for `SessionShare.costUsd`.
  sessionCostUsd: number | null
  // ISO 8601: when the session last reported to Clocktopus.
  lastActivityAt: string | null
  shares: SessionShare[]
}

export type Cli = {
  // The CLI the hooks run (`clocktopus --version`), else the version of the plugin this session loaded.
  version: string
  // The version of the plugin this session loaded; null when its manifest names none.
  plugin: string | null
  // The newest CLI on npm, null while the server doesn't know it; the oldest the server still serves.
  latest: string | null
  minimum: string | null
  isBehind: boolean
  // The server refuses this CLI's requests.
  isUnsupported: boolean
}

export type View = {
  // False where the panel shows nothing: outside a repository Clocktopus knows, or with its
  // MCP server turned off or signed out.
  isShown: boolean
  // The task the session counts toward: `attribution.currentKey`'s, else the branch's.
  task: Task | null
  goal: Goal | null
  attribution: Attribution | null
  // Null when the server wasn't asked, or answered no `cli`.
  cli: Cli | null
  // Why no task shows (a branch naming none, a task Clocktopus hasn't seen); null when one does.
  note: string | null
  // The last refresh's failure; the rest is then what the refresh before it read.
  error: string | null
  // Milliseconds since the epoch.
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    clocktopus: {
      view: Shaped<View | null>
      isBandShown: boolean
      // Whether the pane was opened unasked once this session, so closing it keeps it closed.
      wasPaneOffered: boolean
    }
  }
}
