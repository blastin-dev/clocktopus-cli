import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STAGING = "https://staging.clocktopus.app";
const LOCAL = "http://localhost:3018";

let dir: string;

async function loadConfig() {
  vi.resetModules();
  return import("./config.js");
}

const stored = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "clocktopus-config-"));
  vi.stubEnv("CLOCKTOPUS_CONFIG_DIR", dir);
  vi.stubEnv("CLOCKTOPUS_API_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("environments", () => {
  it("uses production until another environment is chosen", async () => {
    const config = await loadConfig();
    expect(config.getApiUrl()).toBe("https://clocktopus.app");

    config.setChosenApiUrl(STAGING);
    expect(config.getApiUrl()).toBe(STAGING);

    config.setChosenApiUrl("https://clocktopus.app");
    expect(stored().environment).toBeUndefined();
  });

  it("lets --env, then CLOCKTOPUS_API_URL, override the choice for one command", async () => {
    const config = await loadConfig();
    config.setChosenApiUrl(STAGING);

    config.setRuntimeEnvironment(LOCAL);
    expect(config.getApiUrl()).toBe(LOCAL);
    expect(config.getChosenApiUrl()).toBe(STAGING);

    vi.stubEnv("CLOCKTOPUS_API_URL", "https://pr-7.example.test/");
    expect(config.getApiUrl()).toBe("https://pr-7.example.test");

    vi.stubEnv("CLOCKTOPUS_API_URL", "localhost:3000");
    expect(config.getApiUrl()).toBe("localhost:3000");
  });

  it("keeps a login per environment, production's where older CLIs read it", async () => {
    const config = await loadConfig();
    config.setToken("prod-token");

    config.setChosenApiUrl(STAGING);
    expect(config.isLoggedIn()).toBe(false);
    config.setToken("staging-token");

    expect(config.getToken()).toBe("staging-token");
    expect(config.getToken("https://clocktopus.app")).toBe("prod-token");
    expect(stored().accessToken).toBe("prod-token");
    expect(stored().environments).toEqual({
      [STAGING]: { accessToken: "staging-token" },
    });
  });

  it("drops an environment's entry once it holds nothing", async () => {
    const config = await loadConfig();
    config.setChosenApiUrl(STAGING);
    config.setToken("staging-token");
    config.setAgentConfig({ ingestToken: "ingest", endpoint: "https://otel" });

    config.clearToken();
    expect(config.getAgentConfig().ingestToken).toBe("ingest");
    config.clearAgentConfig();

    expect(stored().environments).toEqual({});
  });

  it("writes an agent setup to the environment it names", async () => {
    const config = await loadConfig();
    config.setChosenApiUrl(STAGING);
    config.setAgentConfig(
      { ingestToken: "prod-ingest" },
      "https://clocktopus.app",
    );

    expect(config.getAgentConfig()).toEqual({});
    expect(config.getAgentConfig("https://clocktopus.app").ingestToken).toBe(
      "prod-ingest",
    );
  });

  it("lists the named environments, then any other with a login", async () => {
    const config = await loadConfig();
    config.setRuntimeEnvironment(LOCAL);
    config.setToken("local-token");

    expect(config.knownApiUrls()).toEqual([
      "https://clocktopus.app",
      STAGING,
      "http://localhost:3000",
      LOCAL,
    ]);
  });
});
