# Work through a goal

The session that reads this works through the goal unattended, task by task:
it hands each open task, in the goal's order, to a background subagent that
carries it to an open pull request stacked on the one before, so its main
thread stays free to answer the user and steer.

Only one task is in progress at a time. Clocktopus gives a session's spend
to the task it was last tied to with `link_session`, and a subagent's spend
is reported under its parent session, so two subagents running at once would
bill the same task.

## 1. Read the goal

Call `plan_goal` with the goal's `ref` as `goalId` and the project's
`organizationId` as `orgId`. It returns the goal's tasks as `done`, `open` (in
the goal's order) and `cancelled`, each with its stage, `flags`, cost, `kind`
and `refined` mark. `next_task` with the same `goalId` gives each open task's
`claimed`.

Skip each open task someone else has already started (`claimed`, on a branch
or pull request that isn't the user's), and say which. When the tracker's MCP
tools are available, read the open tasks there too, for their descriptions.

## 2. Check they are ready

List the open tasks in order, each by key and title. For each one not
`refined`, give your view in a few words: ready anyway (straightforward from
its title, its summary from `get_task` or its tracker description, and a quick
look at the code), or needs thinking first, naming the open question. Refined
is not required.

When every open task is refined or clearly ready, start without waiting.
Otherwise ask once whether to go ahead, to refine some first (the refine
skill), or to skip some. A skipped task stays in the goal.

## 3. One stack, in one worktree

Create one git worktree for the run, so the user's checkout stays free, and
create every task's branch in it, named as step 4 of [`SKILL.md`](SKILL.md)
describes.

- The first task's branch starts from the up-to-date trunk (the branch the
  repository's pull requests target), or from the top of the user's own open
  stack for this goal (their open pull request for an earlier task of it).
- Each next task's branch starts from the previous task's branch, and its
  pull request targets that branch, so each pull request shows only its own
  task. Push the previous branch before creating the next one.

The main thread owns the stack; a subagent only opens its own pull request,
with `--base` set to the branch its task's branch starts from: the trunk or
the top of the user's open stack for the first task, the previous task's
branch for every later one. On GitHub, once a task's pull request is open, the
main thread joins it to the stack with `gh stack link --base <trunk> <pull
request numbers, bottom first>` (the `github/gh-stack` extension; install it
with `gh extension install github/gh-stack` when `gh stack` is missing),
listing every pull request in the stack so far, the user's own open ones the
run started from included. `link` works on GitHub alone, so stale local `gh
stack` state in the worktree can't push old heads, and it leaves pull requests
already in the stack where they are. Always pass `--base`: without it, `link`
puts the stack on the repository's default branch, which need not be the
trunk. On other hosts, each pull request's base branch is what stacks it, and
step 4's base check is the whole of linking.

Clocktopus follows a stack: a stacked pull request that merges into the branch
below marks its task `merged`, which finishes it for the goal, so a stack
merges from the bottom up.

## 4. Run each task in a background subagent

The main thread hands each task to a new subagent: the `Agent` tool with
`run_in_background` in Claude Code, `spawn_agent` in Codex (with multi-agent
enabled), the `task` tool in OpenCode. For each task, in order:

1. Call `link_session` with the task's key, as step 3 of
   [`SKILL.md`](SKILL.md) describes, so the spend from then on, the
   subagent's included, counts toward that task.
2. Start the subagent in the run's worktree. Its prompt names the task's key
   and title, its branch, the branch to stack it on, the goal's other tasks
   in order, and the repository's instructions for commits and checks. It asks
   the subagent to carry the task to an open pull request as start-work's run
   mode does (read the task, check the code, do the work, run the checks,
   commit with the key in the scope, push, open the pull request with
   `--base <the branch to stack it on>`, update a Clocktopus task's summary to
   what it delivers, review it with the review-work skill), without calling
   `link_session` or any `gh stack` command itself, and to stop and report
   rather than guess when a decision is open.
3. While it runs, answer the user, and wait for its notification (`wait` in
   Codex) rather than polling. A subagent the harness can only run in the
   foreground, such as OpenCode's `task`, holds the main thread until it
   reports.
4. When it reports, check that its pull request is open, its checks pass and
   its review is posted, and that `gh pr view <number> --json baseRefName`
   names the branch it was told to stack on;
   `gh pr edit <number> --base <branch>` fixes one that doesn't. Then link it
   into the stack as step 3 describes. A task counts as finished only once
   its pull request is in the stack. Tell the user in one line which task
   finished, with its pull request and what the review left on it, and
   which starts next, and go on with a new subagent. Never start a task's
   subagent while another is still running.

When the harness has no subagents, the session works each task itself, in
the same order.

## 5. When to stop

A task's subagent stops and reports back, and the main thread asks the user,
when:

- the task leaves a decision open that neither it nor the code settles;
- checks (types, tests, lint) fail and it can't make them pass;
- the work would go beyond a pull request: merging, deploying, applying a
  migration, closing a task in its tracker, or changing another task's scope.

Once the user answers, resume that task with a new subagent on the same
branch. When the repository's instructions reserve commits or pushes for the
user, stop at the end of each task instead.

## 6. When nothing is open

When the goal has no open task left to start, say so, and list the run's pull
requests in stack order, bottom first, to review and merge from the bottom up.
`get_ticket_flow` with their keys gives each one's pull requests and cost.
