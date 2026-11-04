# A goal from a tracker ticket

The user named a Linear or Jira ticket (`BLA-12`): its prefix isn't the
project's `taskKeyPrefix`. The ticket is the ask; the goal breaks it down into
sub-tasks of the ticket, each one pull request, tracked in the tracker. The
ticket itself is never one of the goal's tasks: no code delivers it on its own,
so `next_task` would hand it out and the goal would never close.

When the tracker's MCP tools aren't available, say so and ask the user to
describe the work instead; carry on from step 2 of [SKILL.md](SKILL.md).

## 1. Read the ticket

Through the tracker's MCP tools, read the ticket, its sub-tasks and its linked
issues: each one's key, title, description, link, issue type or labels, and the
tracker's own id. Linked issues only inform the draft.

## 2. Draft the goal from it

- **Title:** the outcome the ticket asks for, in one line, as step 2 of SKILL.md
  describes.
- **Outcome:** from the ticket's acceptance criteria or description; left out
  when it gives none.

Then the tasks, in the order to work them:

- **Each existing sub-task** is a task as it is, under its own key: reused,
  never split further or rewritten.
- **The work no sub-task covers** is drafted as step 2 of SKILL.md describes,
  each as a new sub-task of the ticket.

Search for each drafted task as SKILL.md describes.

## 3. Confirm once

Show the goal, then its tasks: each existing sub-task by its key, each new one
by its title, all to be sub-tasks of the ticket. Create nothing until the user
confirms.

## 4. Create it

1. Create each new task in the tracker as a sub-task of the ticket, with its
   title, summary and kind, through the tracker's MCP tools.
2. Register each of the goal's tasks, new and existing, with `register_ticket`
   as setup.md describes, each one straight after it is created.
3. Call `create_goal` with `repositoryUrl`, the `title` and the `outcome`.
4. Call `set_goal_tasks` with the goal's `id` as `goalId` and every task in
   `tasks`, in the confirmed order.

Then reply as step 5 of SKILL.md describes.
