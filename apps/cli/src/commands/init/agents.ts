import type { InitDeps, InitOptions } from "./types.js";
import { AGENT_COMPONENTS } from "../../lib/agents.js";
import { InitCancelledError } from "./types.js";

// The `agent setup` survey and writers, for the agents on this machine; says
// nothing when none is installed. Its agent picker is the step's only
// question: clearing every agent there skips the step, and cancelling it
// cancels `init`.
export async function runAgentsStep(
  deps: InitDeps,
  options: InitOptions,
): Promise<void> {
  const installed = deps.surveyAgents().filter((entry) => entry.installed);
  if (installed.length === 0 && !options.agent?.length) return;

  // Off a terminal, or with `--yes`, every installed agent and every component,
  // without `agent setup`'s own questions.
  const agent =
    options.agent ??
    (deps.prompt.interactive
      ? undefined
      : installed.map((entry) => entry.agent.id));
  const component =
    options.component ??
    (deps.prompt.interactive ? undefined : [...AGENT_COMPONENTS]);
  const result = await deps.runAgentSetup({
    agent,
    component,
    showRepoStatus: false,
  });
  switch (result.status) {
    case "configured":
      deps.log(
        result.receiverAccepted
          ? `✓ Agents        configured ${result.agents.join(", ")} — restart them to pick it up`
          : `⚠ Agents        configured ${result.agents.join(", ")}, but the receiver did not accept the token`,
      );
      return;
    case "nothing_selected":
      deps.log(
        "– Agents        none selected — 'clocktopus agent setup' does it later",
      );
      return;
    case "cancelled":
      throw new InitCancelledError();
    case "none_installed":
      return;
    case "failed":
      deps.log(`✗ Agents        ${result.message.trim()}`);
      return;
  }
}
