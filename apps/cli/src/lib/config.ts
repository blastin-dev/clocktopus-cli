import Conf from "conf";

export const ENVIRONMENTS = {
  prod: "https://clocktopus.app",
  staging: "https://staging.clocktopus.app",
  dev: "http://localhost:3000",
} as const;

export type Environment = keyof typeof ENVIRONMENTS;

// Never holds the ingest token itself, which lives only in each agent's own config.
type AgentConfig = {
  tokenId?: string;
  tokenPrefix?: string;
  endpoint?: string;
  /** ISO timestamp. */
  configuredAt?: string;
};

type ConfigSchema = {
  accessToken?: string;
  agent?: AgentConfig;
};

const config = new Conf<ConfigSchema>({
  projectName: "clocktopus-cli",
});

// Set from the `--env` flag.
let runtimeEnv: Environment | undefined;

export function setRuntimeEnvironment(env: Environment): void {
  runtimeEnv = env;
}

export function getEnvironment(): Environment {
  if (runtimeEnv) {
    return runtimeEnv;
  }
  return "prod";
}

export function getApiUrl(): string {
  // `CLOCKTOPUS_API_URL` overrides `--env`.
  if (process.env.CLOCKTOPUS_API_URL) {
    return process.env.CLOCKTOPUS_API_URL;
  }

  const env = getEnvironment();
  return ENVIRONMENTS[env];
}

export function getToken(): string | undefined {
  return config.get("accessToken");
}

export function setToken(token: string): void {
  config.set("accessToken", token);
}

export function clearToken(): void {
  config.delete("accessToken");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function getAgentConfig(): AgentConfig {
  return config.get("agent") ?? {};
}

export function setAgentConfig(next: AgentConfig): void {
  config.set("agent", { ...getAgentConfig(), ...next });
}

export function clearAgentConfig(): void {
  config.delete("agent");
}

export function getConfigPath(): string {
  return config.path;
}
