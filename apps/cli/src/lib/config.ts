import Conf from "conf";

import {
  ENVIRONMENTS,
  PRODUCTION_API_URL,
  resolveEnvironment,
} from "./environment.js";

type AgentConfig = {
  tokenId?: string;
  tokenPrefix?: string;
  endpoint?: string;
  // The ingest token `agent setup` last installed for this environment, so
  // switching back to it reinstalls that token instead of minting another.
  ingestToken?: string;
  /** ISO timestamp. */
  configuredAt?: string;
};

type EnvironmentSlot = { accessToken?: string; agent?: AgentConfig };

type ConfigSchema = {
  // Production's login and agent setup, at the top level where CLIs that
  // predate environments read them.
  accessToken?: string;
  agent?: AgentConfig;
  // Every other environment's, keyed by API URL. Read and written whole:
  // conf takes the dots in a URL for a key path.
  environments?: Record<string, EnvironmentSlot>;
  // The API URL `clocktopus env use` chose; production when absent.
  environment?: string;
  // The version that last ran on this machine, so the first run of another
  // one refreshes what `agent setup` installed (`lib/agent-refresh.ts`).
  lastRunVersion?: string;
  // The newest CLI the server last named in `CLI_LATEST_HEADER`, for
  // `agent context`, which reads no network.
  latestVersion?: string;
};

const config = new Conf<ConfigSchema>({
  projectName: "clocktopus-cli",
  // A config of its own, for a throwaway login or a test.
  cwd: process.env.CLOCKTOPUS_CONFIG_DIR || undefined,
  // It holds a login and an ingest token per environment.
  configFileMode: 0o600,
});

// Set from the `--env` flag.
let runtimeApiUrl: string | undefined;

export function setRuntimeEnvironment(apiUrl: string): void {
  runtimeApiUrl = apiUrl;
}

// `CLOCKTOPUS_API_URL`, then `--env`, then `clocktopus env use`.
export function getApiUrl(): string {
  // A value that resolves to nothing is used as given, so its requests fail
  // rather than reach another environment.
  const fromEnv = process.env.CLOCKTOPUS_API_URL;
  if (fromEnv) return resolveEnvironment(fromEnv) ?? fromEnv;
  return runtimeApiUrl ?? getChosenApiUrl();
}

// What `clocktopus env use` chose, whatever overrides it for this command.
export function getChosenApiUrl(): string {
  return config.get("environment") ?? PRODUCTION_API_URL;
}

export function setChosenApiUrl(apiUrl: string): void {
  if (apiUrl === PRODUCTION_API_URL) config.delete("environment");
  else config.set("environment", apiUrl);
}

function readSlot(apiUrl: string): EnvironmentSlot {
  if (apiUrl === PRODUCTION_API_URL) {
    return {
      accessToken: config.get("accessToken"),
      agent: config.get("agent"),
    };
  }
  return config.get("environments")?.[apiUrl] ?? {};
}

function writeSlot(apiUrl: string, slot: EnvironmentSlot): void {
  if (apiUrl === PRODUCTION_API_URL) {
    if (slot.accessToken === undefined) config.delete("accessToken");
    else config.set("accessToken", slot.accessToken);
    if (slot.agent === undefined) config.delete("agent");
    else config.set("agent", slot.agent);
    return;
  }
  const others = Object.fromEntries(
    Object.entries(config.get("environments") ?? {}).filter(
      ([url]) => url !== apiUrl,
    ),
  );
  const isEmpty = slot.accessToken === undefined && slot.agent === undefined;
  config.set("environments", isEmpty ? others : { ...others, [apiUrl]: slot });
}

// Production, the named environments, then any other this machine has a login
// or an agent setup for.
export function knownApiUrls(): string[] {
  const stored = Object.keys(config.get("environments") ?? {});
  const named: string[] = Object.values(ENVIRONMENTS);
  return [...named, ...stored.filter((url) => !named.includes(url))];
}

export function getToken(apiUrl = getApiUrl()): string | undefined {
  return readSlot(apiUrl).accessToken;
}

export function setToken(token: string): void {
  const apiUrl = getApiUrl();
  writeSlot(apiUrl, { ...readSlot(apiUrl), accessToken: token });
}

export function clearToken(): void {
  const apiUrl = getApiUrl();
  writeSlot(apiUrl, { ...readSlot(apiUrl), accessToken: undefined });
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function getAgentConfig(apiUrl = getApiUrl()): AgentConfig {
  return readSlot(apiUrl).agent ?? {};
}

export function setAgentConfig(next: AgentConfig, apiUrl = getApiUrl()): void {
  const slot = readSlot(apiUrl);
  writeSlot(apiUrl, { ...slot, agent: { ...slot.agent, ...next } });
}

export function clearAgentConfig(): void {
  const apiUrl = getApiUrl();
  writeSlot(apiUrl, { ...readSlot(apiUrl), agent: undefined });
}

export function getLastRunVersion(): string | undefined {
  return config.get("lastRunVersion");
}

export function setLastRunVersion(version: string): void {
  config.set("lastRunVersion", version);
}

export function getLatestVersion(): string | undefined {
  return config.get("latestVersion");
}

// Never throws: the hook calls it, and a config it can't write costs only the nudge.
export function rememberLatestVersion(latest: string | null): void {
  const version = latest?.trim();
  if (!version || version === config.get("latestVersion")) return;
  try {
    config.set("latestVersion", version);
  } catch {
    // Read-only home, or a config another process holds.
  }
}

export function getConfigPath(): string {
  return config.path;
}
