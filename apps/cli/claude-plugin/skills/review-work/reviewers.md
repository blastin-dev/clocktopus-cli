# Reaching the reviewers

Each reviewer is a subagent started through this session's own harness, so it
runs on the account the session already uses. Take the first route that works
for each one. A route that errors, times out or comes back empty is no
review: try the next one.

When the harness gives this session no way to start a subagent (no `Agent`
tool in Claude Code, no `delegate_task` in T3 Code, no `spawn_agent` in
Codex), neither reviewer is reachable: step 3 of [`SKILL.md`](SKILL.md) says
what to do then.

## First reviewer: GPT Sol, high effort

- **T3 Code:** `orchestrator_capabilities` names the latest Sol (pass
  `search: "sol"` when it isn't listed). Start it with `delegate_task`,
  `role: "review"`, `mode: "async"`.
- **Codex:** a subagent on the latest Sol at high reasoning effort.
- **Claude Code:** a custom subagent set up to run Sol, when the user has one.
- **Fallback, the latest Claude Sonnet at high effort:** in Claude Code, the
  `Agent` tool with `model: "sonnet"`, `effort: "high"` and
  `run_in_background: true`; in T3 Code, `delegate_task` with the Sonnet
  `orchestrator_capabilities` finds with `search: "sonnet"`. Where neither
  route exists, a background subagent on whatever model the harness gives it.

## Second reviewer: Claude Fable, medium effort

Keep the same reviewer for every round and follow it up, so it keeps what it
read.

- **Claude Code:** the `Agent` tool with `model: "fable"`, `effort: "medium"`
  and `run_in_background: true`. Each later round is a `SendMessage` to its
  id.
- **T3 Code:** `delegate_task` with the latest Fable, and a new
  `clientRequestId` each round.
- **When Fable is out of reach:** a subagent on a model from another family
  than the first reviewer's; failing that, a fresh subagent on the first
  reviewer's model, which reads the open findings without the first pass's
  reasoning.
