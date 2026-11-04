---
name: register-ticket
description: "Records Linear or Jira tickets in Clocktopus under their own keys, so the commits, pull requests and agent spend on them count towards them, even before or without the tracker's webhook. Checks first that the repository is linked to a Clocktopus project and that each ticket's prefix belongs to it, and otherwise does nothing, so any workflow can call it in any repository. Use right after a skill or workflow creates or changes a ticket in a tracker, or when the user asks to register, track or import a ticket in Clocktopus."
argument-hint: "<ticket key> [more keys]"
---

# Register a tracker ticket

Another skill or workflow, often a repository's own, has just created or
changed tickets in Linear or Jira, or the user named some. Record each in
Clocktopus under its own key, then hand back to whatever called this: it
starts no work, and switches no branch.

Signing in, the session id, reading the repository's context and registering
a ticket work as [setup.md](setup.md) describes.

## 1. Check that Clocktopus tracks this repository

Read the repository's context as setup.md describes. Stop without
registering anything when:

- the checkout has no `origin` remote;
- `status` is anything but `ok` or `choose_organization`;
- a workflow, not the user, called this skill, and the Clocktopus MCP tools
  aren't available, need signing in, or answer `choose_organization`: asking
  would stall it.

Stopped, say so in one line when the user invoked this skill, and say nothing
when a workflow did, then carry on with it.

## 2. Keep the keys that belong to the project

For each key, take its prefix (`BLA` for `BLA-12`). Leave a key out when:

- the prefix is the project's `taskKeyPrefix`: it is already a Clocktopus
  task;
- no `trackerKeyPrefixes` entry has that `prefix`: the ticket belongs to no
  tracker the project declares.

Say which keys were left out, and why, in one line.

## 3. Register them

Register each remaining key as setup.md describes, reading the ticket through
the tracker's MCP tools. When the workflow goes on to work on one of them in
this session, also call `link_session` with its key, the `repositoryUrl` and
the session's `agentSessionId` and `agent`.

## 4. Reply

One line per registered key: its key and title. Then carry on with the
workflow that called this skill.

## Don't

- Don't create tickets or tasks: the caller does that.
- Don't create or switch a branch, or start the work.
- Don't stop the calling workflow because a ticket couldn't be registered.
