import type { EngineInterface, Register } from "claude-code";
import { atom, read, update } from "claude-code";

import type { Task, View } from "../types";
import type { LocalVersions, Row } from "./panel";
import {
  checkoutOf,
  cliRows,
  clock,
  colorOf,
  duration,
  hidden,
  isRecord,
  isRefreshingCall,
  messageOf,
  sessionRows,
  sshHostOf,
  stageOf,
  statusLine,
  text,
  totalOf,
  versionIn,
  viewOf,
  withoutCredentials,
  withSshConfig,
} from "./panel";

const PANE = "clocktopus-goal";
const PANE_TITLE = "Clocktopus";
// The server's key in the `.mcp.json` that `clocktopus agent setup` writes beside the manifest.
const MCP_SERVER = "clocktopus";
const AGENT = "claude_code";
const REFRESH_MS = 2 * 60 * 1000;
const RETRY_MS = 3 * 1000;
const MAX_RETRIES = 10;
// The SessionStart hook reports the session in the background, so the first read can come first.
const UNREPORTED_RECHECK_MS = 10 * 1000;
const MAX_UNREPORTED_RECHECKS = 3;
const CONNECTING = "connecting…";

const view = atom({ plugin: "clocktopus", key: "view" } as const, null, {
  shape: "view-6",
});
const isBandShown = atom(
  { plugin: "clocktopus", key: "isBandShown" } as const,
  false,
);
const wasPaneOffered = atom(
  { plugin: "clocktopus", key: "wasPaneOffered" } as const,
  false,
);

// `$.mcp.connect` answered `failed`: the server is listed but not connected, as when it is still
// connecting at the session's start.
class NotConnected extends Error {}

async function connect($: EngineInterface) {
  const connected = await $.mcp.connect(MCP_SERVER);
  if (connected.isConnected) return { server: connected.server, refusal: null };
  if (connected.reason === "failed") throw new NotConnected(connected.message);
  return { server: null, refusal: connected.message };
}

async function callClocktopus(
  $: EngineInterface,
  server: string,
  tool: string,
  args: Record<string, unknown>,
) {
  const result = await $.mcp.call(server, tool, args);
  const body =
    result.content.find((block) => block.type === "text")?.text ?? "";
  if (result.isError) throw new Error(body || `${tool} failed`);
  const parsed: unknown = result.structuredContent ?? JSON.parse(body);
  if (!isRecord(parsed)) throw new Error(`${tool} answered no object`);
  return parsed;
}

async function currentBranch($: EngineInterface) {
  const { exitCode, stdout } = await $.process.run(
    ["git", "symbolic-ref", "--short", "-q", "HEAD"],
    {
      timeoutMs: 2000,
    },
  );
  return exitCode === 0 ? stdout.trim() || undefined : undefined;
}

// `ssh -G <host>`'s settings per host, read once a session.
const sshConfigs = new Map<string, string>();

async function canonicalRemote($: EngineInterface, remote: string) {
  const host = sshHostOf(remote);
  if (!host) return remote;
  if (!sshConfigs.has(host)) {
    const { exitCode, stdout } = await $.process.run(["ssh", "-G", host], {
      timeoutMs: 2000,
    });
    sshConfigs.set(host, exitCode === 0 ? stdout : "");
  }
  return withSshConfig(remote, sshConfigs.get(host) ?? "");
}

async function currentCheckout($: EngineInterface) {
  const { exitCode, stdout } = await $.process.run(
    [
      "git",
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
    ],
    { timeoutMs: 2000 },
  );
  if (exitCode !== 0) return null;
  return checkoutOf(stdout, await $.env.get("HOME"));
}

// Git rewrites a checkout's HEAD file on every branch switch, whoever makes it.
async function gitHead($: EngineInterface) {
  const { exitCode, stdout } = await $.process.run(
    ["git", "rev-parse", "--absolute-git-dir"],
    { timeoutMs: 2000 },
  );
  const gitDir = stdout.trim();
  return exitCode === 0 && gitDir ? `${gitDir}/HEAD` : undefined;
}

// The CLI the hooks run, which an upgrade replaces under a running session, and the plugin this
// session loaded.
async function localVersions($: EngineInterface): Promise<LocalVersions> {
  const [installed, plugin] = await Promise.all([
    $.process
      .run(["clocktopus", "--version"], { timeoutMs: 5000 })
      .then(({ exitCode, stdout }) =>
        exitCode === 0 ? versionIn(stdout) : null,
      )
      .catch(() => null),
    $.fs
      .read(`${$.plugin.root}/.claude-plugin/plugin.json`)
      .then((manifest) => {
        const parsed: unknown = JSON.parse(manifest);
        return isRecord(parsed) ? versionIn(text(parsed.version) ?? "") : null;
      })
      .catch(() => null),
  ]);
  return { installed, plugin };
}

async function load(
  $: EngineInterface,
): Promise<Omit<View, "error" | "updatedAt">> {
  const remote = (await $.session.repo())?.remote;
  if (!remote) return hidden("not in a git repository with a remote");
  const credentialFree = withoutCredentials(remote);
  const repositoryUrl = await canonicalRemote($, credentialFree).catch(
    () => credentialFree,
  );
  const { server, refusal } = await connect($);
  if (!server) return hidden(refusal);

  const [branch, checkout, sessionId, versions] = await Promise.all([
    currentBranch($),
    currentCheckout($).catch(() => null),
    $.session.id(),
    localVersions($),
  ]);
  const cliVersion = versions.installed ?? versions.plugin;
  const panel = await callClocktopus($, server, "get_session_panel", {
    repositoryUrl,
    agentSessionId: sessionId,
    agent: AGENT,
    ...(branch ? { branch } : {}),
    ...(cliVersion ? { cliVersion } : {}),
  });
  return viewOf(
    panel,
    { sessionId, branch: branch ?? null, checkout },
    versions,
  );
}

// Set once this module has asked to open the pane; `wasPaneOffered` outlives a reload.
let isPaneOffered = false;

async function offerPane($: EngineInterface) {
  if (await read($, wasPaneOffered)) return;
  await update($, wasPaneOffered, () => true);
  await $.ui.open({ id: PANE, title: PANE_TITLE });
}

// A Button, not a Link: a terminal without OSC 8 hyperlinks draws a Link as its label and the
// URL in plain text, which wraps in a narrow pane and is then only clickable in part.
const OPENERS = [["xdg-open"], ["open"], ["cmd", "/c", "start", ""]];

async function openUrl(
  $: EngineInterface,
  url: string,
  surface: Parameters<EngineInterface["ui"]["copy"]>[0]["surface"],
) {
  for (const opener of OPENERS) {
    const opened = await $.process
      .run([...opener, url], { timeoutMs: 5000 })
      .catch(() => null);
    if (opened?.exitCode === 0) return;
  }
  const copied = await $.ui.copy({ text: url, surface });
  $.ui.toast(
    copied.isCopied ? `Couldn't open a browser; copied ${url}` : `Open ${url}`,
  );
}

let running: Promise<void> | undefined;
let isStale = false;
let retries = 0;
let unreportedRechecks = 0;

async function refreshOnce($: EngineInterface) {
  const updatedAt = await $.clock.now();
  let next: View;
  try {
    next = { ...(await load($)), error: null, updatedAt };
    retries = 0;
    if (!next.task || next.attribution?.countsTowardTask !== false) {
      unreportedRechecks = 0;
    } else if (unreportedRechecks < MAX_UNREPORTED_RECHECKS) {
      unreportedRechecks += 1;
      $.clock.after(UNREPORTED_RECHECK_MS, () => refreshLater($));
    }
  } catch (error) {
    const last = await read($, view);
    next = { ...(last ?? hidden(null)), error: messageOf(error), updatedAt };
    // A repository Clocktopus has answered for and shows nothing in stays silent when a later
    // refresh fails; a failure before any answer is shown, since nothing else says why.
    if (
      last &&
      !last.isShown &&
      last.error === null &&
      last.note !== CONNECTING
    )
      next = { ...last, updatedAt };
    else if (
      error instanceof NotConnected &&
      !last?.isShown &&
      retries < MAX_RETRIES
    ) {
      retries += 1;
      next = { ...next, note: CONNECTING, error: null };
      $.clock.after(RETRY_MS, () => refreshLater($));
    }
  }
  await update($, view, () => next);
}

// One refresh at a time; a request made meanwhile runs one more after it.
function refresh($: EngineInterface): Promise<void> {
  if (running) {
    isStale = true;
    return running;
  }
  running = (async () => {
    do {
      isStale = false;
      await refreshOnce($);
    } while (isStale);
  })().finally(() => {
    running = undefined;
  });
  return running;
}

// A refresh nothing waits on; its failure is already in the view.
const refreshLater = ($: EngineInterface) => void refresh($).catch(() => {});

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    await $.command.register({
      name: "clocktopus-panel",
      description:
        "Open or close the Clocktopus panel: this session's task, attribution, time and goal",
      argumentHint: "[refresh|band]",
      immediate: true,
    });
    $.clock.every(REFRESH_MS, () => refreshLater($));
    refreshLater($);

    return started;
  });

  // Only SessionStart can name files for the engine to watch; it raises FileChanged for them.
  on("classic.SessionStart", async ($, e, next) => {
    const result = await next(e);
    const head = await gitHead($).catch(() => undefined);
    return head
      ? { ...result, watchPaths: [...(result.watchPaths ?? []), head] }
      : result;
  });

  on("classic.FileChanged", async ($, e, next) => {
    const result = await next(e);
    if (/(^|\/)HEAD$/.test(e.file_path)) refreshLater($);
    return result;
  });

  // A worktree or another checkout: its HEAD is not watched, so the move itself refreshes.
  on("classic.CwdChanged", async ($, e, next) => {
    const result = await next(e);
    refreshLater($);
    return result;
  });

  on("command.run", { command: "clocktopus-panel" }, async ($, e) => {
    const arg = e.args.trim();
    if (arg === "band") {
      const isShown = !(await read($, isBandShown));
      await update($, isBandShown, () => isShown);
      return {
        text: isShown ? "Clocktopus band shown." : "Clocktopus band hidden.",
      };
    }
    if (arg === "refresh") {
      await refresh($);
      const current = await read($, view);
      return {
        text:
          statusLine(current) ??
          `Clocktopus: ${current?.note ?? "nothing to show"}.`,
      };
    }
    // A pane placed but behind another pane's tab, or waiting for room, is brought up instead.
    const pane = (await $.ui.panes()).find((one) => one.id === PANE);
    if (pane?.isPlaced && pane.isShown) {
      await $.ui.close({ id: PANE });
      return {};
    }
    await $.ui.open({ id: PANE, title: PANE_TITLE });
    refreshLater($);
    return {};
  });

  on("tool.call", async ($, e, next) => {
    const result = await next(e);
    if (result.deny !== undefined || result.isError) return result;
    const input: Record<string, unknown> = { ...e };
    // The call already ran: the model doesn't wait on the refresh.
    if (isRefreshingCall(e.tool, text(input.command))) refreshLater($);

    return result;
  });

  // The footer's mode labels, not `$.ui.status`: the terminal draws a plugin's status as a warning.
  on("ui.render", { component: "SessionMode" }, async ($, e, next) => {
    const current = await read($, view);
    // Only the fullscreen layout docks a pane beside the transcript; elsewhere it would take
    // the screen over. A drawing can't write state, so the open waits for a timer.
    if (
      e.viewport?.isFullscreen === true &&
      current?.isShown &&
      !isPaneOffered
    ) {
      isPaneOffered = true;
      $.clock.after(0, () => void offerPane($));
    }
    const line = statusLine(current);
    return next(
      line
        ? { ...e, props: { ...e.props, modes: [...e.props.modes, line] } }
        : e,
    );
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const current = await read($, view);
    if (
      e.props.hasSurvey ||
      !current?.isShown ||
      !current.task ||
      !(await read($, isBandShown))
    )
      return next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    const { task, goal, attribution } = current;
    const pageUrl = task.pageUrl;

    return (
      <Box flexDirection="row" gap={1} width={e.props.bodyColumns}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={colorOf(task.stage)} bold>
              {task.key}
            </Text>{" "}
            {attribution && (
              <Text
                color={attribution.countsTowardTask ? "success" : "warning"}
              >
                {attribution.countsTowardTask
                  ? "attributed"
                  : "not attributed"}{" "}
              </Text>
            )}
            {task.title ?? ""}
            {task.hours !== null && (
              <Text dimColor>{`  ·  ${duration(task.hours)} human`}</Text>
            )}
            <Text dimColor>
              {goal
                ? `  ·  ${goal.ref} ${goal.title} · ${goal.doneCount}/${totalOf(goal)} done`
                : "  ·  in no active goal"}
            </Text>
          </Text>
        </Box>
        {pageUrl && (
          <Button
            key="open"
            label="Open"
            onPress={(press) => openUrl($, pageUrl, press.surface)}
          />
        )}
        <Button
          key="goal"
          label="Goal"
          onPress={() => $.ui.open({ id: PANE, title: PANE_TITLE })}
        />
        <Button
          key="hide"
          label="Hide"
          onPress={() => update($, isBandShown, () => false)}
        />
      </Box>
    );
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e);
    const current = await read($, view);
    const task = current?.isShown ? current.task : null;
    const goal = task ? (current?.goal ?? null) : null;
    const attribution = task ? (current?.attribution ?? null) : null;
    const rows = goal?.open ?? [];
    const pageUrl = task?.pageUrl ?? null;
    const keyWidth = Math.max(
      task?.key.length ?? 0,
      ...rows.map((row) => row.key.length),
    );
    const isTaskListed = rows.some((row) => row.key === task?.key);
    const footer = current
      ? `updated ${clock(current.updatedAt)}${current.error ? ` · last refresh failed: ${current.error}` : ""}`
      : "loading…";

    const row = ({ label, value, color }: Row) => (
      <Box key={label} flexDirection="row">
        <Box width={10} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text color={color} wrap="truncate-end">
            {value}
          </Text>
        </Box>
      </Box>
    );
    const thisSession = (entry: Pick<Task, "key" | "stage" | "title">) => (
      <Box key={entry.key}>
        <Text bold wrap="truncate-end">
          ▶{" "}
          <Text color={colorOf(entry.stage)}>{entry.key.padEnd(keyWidth)}</Text>{" "}
          {stageOf(entry.stage).padEnd(13)} {entry.title ?? ""}
        </Text>
      </Box>
    );
    const time: Row[] = task
      ? [
          {
            label: "Human",
            value: task.hours === null ? "unknown" : duration(task.hours),
          },
          {
            label: "Agent",
            value:
              task.agentHours === null ? "unknown" : duration(task.agentHours),
          },
        ]
      : [];

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {!task && (
          <Text dimColor>{current?.error ?? current?.note ?? "Loading…"}</Text>
        )}
        {task && (
          <Box flexDirection="column" marginBottom={1}>
            <Box flexDirection="row" gap={2}>
              <Box flexShrink={0}>
                <Text color={colorOf(task.stage)} bold>
                  {task.key}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end">{stageOf(task.stage)}</Text>
              </Box>
              {pageUrl && (
                <Button
                  key="open"
                  label="Open"
                  onPress={(press) => openUrl($, pageUrl, press.surface)}
                />
              )}
            </Box>
            <Text wrap="wrap">{task.title ?? ""}</Text>
          </Box>
        )}
        {task && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Time on {task.key}</Text>
            {time.map(row)}
          </Box>
        )}
        {task && attribution && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>This session</Text>
            {sessionRows(attribution, task).map(row)}
          </Box>
        )}
        {task && !goal && (
          <Box flexDirection="column">
            <Text bold>Goal</Text>
            <Text dimColor>None active</Text>
          </Box>
        )}
        {task && goal && (
          <Box flexDirection="column">
            <Text bold wrap="truncate-end">
              Goal {goal.ref}
              <Text
                dimColor
              >{`  ${goal.doneCount} of ${totalOf(goal)} done`}</Text>
            </Text>
            <Text wrap="wrap">{goal.title}</Text>
            <Box flexDirection="column" marginTop={1}>
              {!isTaskListed && thisSession(task)}
              {rows.map((row) =>
                row.key === task.key ? (
                  thisSession(row)
                ) : (
                  <Box key={row.key}>
                    <Text wrap="truncate-end">
                      <Text dimColor={!row.claimed}>
                        {row.claimed ? "●" : "○"}
                      </Text>{" "}
                      <Text color={colorOf(row.stage)}>
                        {row.key.padEnd(keyWidth)}
                      </Text>{" "}
                      <Text dimColor>{stageOf(row.stage).padEnd(13)}</Text>{" "}
                      {row.title ?? ""}
                    </Text>
                  </Box>
                ),
              )}
            </Box>
            <Text dimColor>▶ this session · ● started · ○ not started</Text>
          </Box>
        )}
        {current?.cli && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Clocktopus CLI</Text>
            {cliRows(current.cli).map(row)}
          </Box>
        )}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          {attribution && (
            <Button
              key="copy-session"
              label="Copy id"
              onPress={async (press) => {
                const copied = await $.ui.copy({
                  text: attribution.sessionId,
                  surface: press.surface,
                });
                $.ui.toast(
                  copied.isCopied
                    ? `Copied session id ${attribution.sessionId}`
                    : `Session id ${attribution.sessionId}`,
                );
              }}
            />
          )}
          <Text dimColor wrap="truncate-end">
            {footer}
          </Text>
        </Box>
      </Box>
    );
  });
};
