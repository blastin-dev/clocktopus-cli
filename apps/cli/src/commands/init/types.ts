import type { surveyAgents } from "../../lib/agents.js";
import type { connectGithubApp } from "../../lib/github-app-connect.js";
import type { Prompter } from "../../lib/prompt.js";
import type { runAgentSetup } from "../agent/setup.js";
import type { ParsedRemote } from "./checkout.js";

export const INIT_STEPS = [
  "you",
  "project",
  "repository",
  "email",
  "agents",
  "verify",
] as const;
export type InitStep = (typeof INIT_STEPS)[number];

export const CONNECT_MODES = ["app", "gh", "manual", "skip"] as const;
export type ConnectMode = (typeof CONNECT_MODES)[number];

// Every question `init` asks has a flag here; undefined means "ask".
export type InitOptions = {
  yes?: boolean;
  skip?: string[];
  only?: string[];
  timezone?: string;
  hours?: string;
  workingHours?: boolean;
  organization?: string;
  newOrganization?: string;
  project?: string;
  newProject?: string;
  connect?: string;
  trackEmail?: boolean;
  agent?: string[];
  component?: string[];
  testPush?: boolean;
  deleteOldHook?: boolean;
};

// Thrown when a question is cancelled; `initCommand` stops there instead of
// moving on to the next step.
export class InitCancelledError extends Error {
  constructor() {
    super("Setup cancelled");
  }
}

export type CommandResult = { ok: boolean; stdout: string; stderr: string };

export type InitDeps = {
  api: {
    get: (path: string) => Promise<unknown>;
    post: (path: string, body: Record<string, unknown>) => Promise<unknown>;
    put: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  };
  prompt: Prompter;
  log: (line?: string) => void;
  // `inherit` shows the command's own output, for `git push`.
  run: (
    command: string,
    args: string[],
    options?: { inherit?: boolean },
  ) => CommandResult;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  connectGithubApp: typeof connectGithubApp;
  listenForManualSwitch: () => { signal: AbortSignal; stop: () => void };
  runAgentSetup: typeof runAgentSetup;
  surveyAgents: () => Array<
    Pick<
      ReturnType<typeof surveyAgents>[number],
      "installed" | "configured"
    > & {
      agent: { id: string; label: string };
    }
  >;
};

// What `init` read from the checkout before asking anything.
export type Checkout = {
  remote: string | null;
  repository: ParsedRemote | null;
  gitEmail: string | null;
  osTimezone: string;
  ghInstalled: boolean;
};

// What the steps settled, for the ones after them.
export type InitState = {
  organizationId: string | null;
  projectName: string | null;
  // How this run connected the repository; null when it did not.
  connectedBy: "app" | "manual" | null;
};
