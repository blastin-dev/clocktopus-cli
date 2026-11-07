import { execFile } from "node:child_process";

// herdr-core sets `HC_TERMINAL_ID` in every terminal it runs. Labelling that
// terminal with the agent's session lets Herdr's Clocktopus panel
// (`apps/cli/herdr/mods/clocktopus/model.js`, which reads `clocktopus.session`
// and `clocktopus.task`) tell which tab holds which session.
export const HERDR_SESSION_LABEL = "clocktopus.session";
// The task the session counts toward now, which the Claude plugin
// (`claude-plugin/hooks/register.tsx`, `labelHerdrTerminal`) sets after each
// refresh.
export const HERDR_TASK_LABEL = "clocktopus.task";

// The `hc` arguments for a hook event: SessionStart labels the terminal,
// SessionEnd clears them, the Claude plugin's task label too; any other event
// changes nothing.
export function herdrLabelArgs(input: {
  terminal: string;
  eventName: string;
  sessionId: string;
}): string[] | null {
  if (input.eventName === "SessionStart") {
    return [
      "label",
      input.terminal,
      `${HERDR_SESSION_LABEL}=${input.sessionId}`,
    ];
  }
  if (input.eventName === "SessionEnd") {
    return [
      "label",
      input.terminal,
      `${HERDR_SESSION_LABEL}=`,
      `${HERDR_TASK_LABEL}=`,
    ];
  }
  return null;
}

// Outside a Herdr terminal, or without `hc`, it does nothing; it never throws
// and gives up after two seconds, so the hook's own report is never held up.
export function labelHerdrTerminal(
  input: { eventName: string; sessionId: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const terminal = env.HC_TERMINAL_ID;
  const args = terminal ? herdrLabelArgs({ ...input, terminal }) : null;
  if (!args) return Promise.resolve();
  return new Promise((settle) => {
    try {
      execFile("hc", args, { timeout: 2000, env }, () => settle());
    } catch {
      settle();
    }
  });
}
