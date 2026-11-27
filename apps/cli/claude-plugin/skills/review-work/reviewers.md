# Seating the council

The council has one seat per provider, each on that provider's flagship at
high effort:

| Seat      | Model                  |
| --------- | ---------------------- |
| Anthropic | the latest Claude Opus |
| OpenAI    | the latest GPT Sol     |
| Google    | the latest Gemini Neon |

Take the first route that works for each seat. A route that errors, times
out, reports a usage limit or missing credits, or comes back empty is no
review: try the next one, and when none is left, the seat is empty. Never
fill an empty seat with another model.

## Routes

A harness subagent comes first, because it runs on the account the session
already uses. A headless CLI is the route to a provider the harness can't
reach. In every command, `<model>` is an id exactly as the CLI's model list
prints it, and `brief.md` and `schema.json` are the files the last section
describes.

**Anthropic**

- **Claude Code:** the `Agent` tool with `model: "opus"` and
  `effort: "high"`, in the background (`run_in_background: true` where the
  tool takes it). Each later round is a `SendMessage` to its id.
- **T3 Code:** `delegate_task` with the Opus `orchestrator_capabilities`
  finds (`search: "opus"`), `role: "review"`, `mode: "async"`.
- **Codex:** a subagent on the latest Opus, when Codex offers one.
- **Headless, Claude Code CLI:** the answer is the output's
  `structured_output`, and its `session_id` resumes it.

  ```sh
  claude -p --model opus --effort high --permission-mode plan \
    --output-format json --json-schema "$(cat schema.json)" "$(cat brief.md)"
  # later rounds: the same, plus --resume <session_id>
  ```

**OpenAI**

- **Codex:** a subagent on the latest Sol at high reasoning effort.
- **T3 Code:** `delegate_task` with the Sol `orchestrator_capabilities` finds
  (`search: "sol"`).
- **Claude Code:** a custom subagent set up to run Sol, when the `Agent`
  tool lists one.
- **Headless, Codex CLI:** `codex debug models` lists the models the account
  can use; a ChatGPT account may not offer Sol. `out.json` gets the answer,
  and the `thread.started` event on stdout gives the `thread_id`.

  ```sh
  codex exec -s read-only -m <model> -c model_reasoning_effort=high \
    --output-schema schema.json --json -o out.json "$(cat brief.md)"
  # later rounds: resume takes no -s, so the sandbox goes in -c
  codex exec resume -m <model> -c model_reasoning_effort=high \
    -c sandbox_mode='"read-only"' --output-schema schema.json --json \
    -o out.json <thread_id> "$(cat brief.md)"
  ```

- **Headless, OpenCode:** `opencode models` lists the ids
  (`opencode/<name>`); OpenCode's own models bill its credits. `run` has no
  schema flag, so the brief carries the schema. `--agent plan` denies the
  edit tool but still allows bash, so the reviewer runs in a detached
  worktree of its own in a fresh temporary directory, added with the
  repository's hooks off, moved to each round's commit and removed once the
  review ends. The worktree keeps its files apart, not its git state: its
  brief forbids any git command that writes (stash, commit, branch, reset,
  push), and after each of its rounds the session checks that
  `git stash list` and `git for-each-ref` are unchanged. With `--format json` it prints events: the
  answer is the last text part, and each event's `sessionID` resumes it.

  ```sh
  brief=/absolute/path/to/brief.md # each later round's brief, by its path
  wt="$(mktemp -d)/review"
  git -c core.hooksPath=/dev/null worktree add --detach "$wt" HEAD
  (cd "$wt" && opencode run --agent plan --format json -m '<model>#high' \
    "$(cat "$brief")")
  echo "$wt"
  # A later call has none of these variables, and `git -C ""` runs in the
  # current checkout, so later rounds name the path echo printed above.
  # Later rounds: move it to the round's commit and drop stray files, then
  # the same run plus --session <sessionID>.
  git -C /tmp/tmp.XXXX/review -c core.hooksPath=/dev/null \
    checkout --force --detach <sha>
  git -C /tmp/tmp.XXXX/review clean -fdx
  # once the review ends:
  git worktree remove --force /tmp/tmp.XXXX/review
  ```

**Google**

- **T3 Code:** `delegate_task` with the Gemini `orchestrator_capabilities`
  finds (`search: "gemini"`).
- **Headless, Antigravity:** `agy models` lists the ids, effort included
  (`gemini-4-neon-high`). The brief is attached to `-p` with `=`, or `-p`
  takes the next flag as its prompt. Leave out `--mode plan`: it writes a
  plan file instead of answering. `--sandbox` hides a linked worktree's git
  directory, so `--add-dir` names it. The answer is the output's
  `structured_output`, and its `conversation_id` resumes it.

  ```sh
  agy --model <model> --sandbox \
    --add-dir "$(git rev-parse --path-format=absolute --git-common-dir)" \
    --output-format json --json-schema schema.json -p="$(cat brief.md)"
  # later rounds: the same, plus --conversation <conversation_id>
  ```

Run each headless call in the background (`run_in_background: true` on
Claude Code's `Bash`), from the checkout's root (OpenCode from its own
worktree), with a timeout of ten
minutes. Keep `brief.md`, `schema.json` and each reviewer's output outside
the checkout and apart from each other's, so no reviewer reads another's
answer and nothing lands in a commit.

## Probing a seat

A CLI on the `PATH` can still be signed out, over its limit or out of
credits. Before the first round, probe each headless route with a one-line
prompt (`Reply with exactly: ok`) at low effort, in parallel, and take the
seat only when it answers. A probe that fails names the reason the review
body gives for the empty seat.

## The reviewer's answer

Ask every reviewer for the same JSON, so the ledger merges without guessing.
Give a headless CLI this schema; give a subagent, and OpenCode, the same
shape in its brief. It is written for OpenAI's strict structured outputs:
every object closes with `additionalProperties: false` and requires every
property, so an empty string stands for a field with nothing to say.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["score", "scoreReason", "findings", "positions", "doneWell"],
  "properties": {
    "score": { "type": "integer", "minimum": 0, "maximum": 10 },
    "scoreReason": { "type": "string" },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "file",
          "line",
          "claim",
          "case",
          "fix",
          "confidence",
          "confidenceReason"
        ],
        "properties": {
          "file": { "type": "string" },
          "line": { "type": "integer" },
          "claim": { "type": "string" },
          "case": { "type": "string" },
          "fix": { "type": "string" },
          "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
          "confidenceReason": { "type": "string" }
        }
      }
    },
    "positions": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "verdict", "evidence", "fix"],
        "properties": {
          "id": { "type": "string" },
          "verdict": {
            "type": "string",
            "enum": ["real", "not real", "decision"]
          },
          "evidence": { "type": "string" },
          "fix": { "type": "string" }
        }
      }
    },
    "doneWell": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["file", "line", "what"],
        "properties": {
          "file": { "type": "string" },
          "line": { "type": "integer" },
          "what": { "type": "string" }
        }
      }
    }
  }
}
```

In round 1 `positions` is empty. In a later round `findings` holds only
problems in the latest fixes, and `doneWell` is empty. A finding carries no
id: the session gives each one its id when it enters the ledger.
