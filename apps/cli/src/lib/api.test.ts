import {
  CLI_LATEST_HEADER,
  CLI_VERSION_HEADER,
} from "@repo/cli-contract/cli-version";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, get } from "./api.js";
import { cliVersion } from "./claude-plugin.js";

const installed = vi.hoisted(() => ({ version: "0.7.1" }));

vi.mock("./claude-plugin.js", () => ({ cliVersion: () => installed.version }));

const { rememberLatestVersion } = vi.hoisted(() => ({
  rememberLatestVersion: vi.fn(),
}));

vi.mock("./config.js", () => ({
  getApiUrl: () => "https://app.example.test",
  getToken: () => "device-token",
  rememberLatestVersion,
}));

const fetchMock = vi.fn<typeof fetch>();

function respond(status: number, body: unknown, latest?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (latest !== undefined) headers.set(CLI_LATEST_HEADER, latest);
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers })),
  );
}

class ExitCalled extends Error {}

const stderrIsTTY = process.stderr.isTTY;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  installed.version = "0.7.1";
  process.stderr.isTTY = true;
});

afterEach(() => {
  process.stderr.isTTY = stderrIsTTY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe("request", () => {
  it("sends the CLI's version", async () => {
    respond(200, { ok: true });

    await get("/api/onboarding");

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get(CLI_VERSION_HEADER)).toBe(cliVersion());
  });

  it("prints the server's upgrade message verbatim and exits 1 on 426", async () => {
    const message =
      "Clocktopus CLI 0.7.1 is no longer supported; this server needs 0.8.0 or later.";
    respond(426, { error: { message } });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new ExitCalled();
    });

    await expect(get("/api/onboarding")).rejects.toBeInstanceOf(ExitCalled);

    expect(error).toHaveBeenCalledWith(message);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("throws ApiError for any other failure", async () => {
    respond(403, { error: { message: "Forbidden" } });
    const exit = vi.spyOn(process, "exit");

    const failure = await get("/api/onboarding").catch((error) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, message: "Forbidden" });
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("newer CLI note", () => {
  // `api.js` notes a newer CLI once per process, so each test loads it afresh.
  async function freshGet() {
    vi.resetModules();
    return (await import("./api.js")).get;
  }

  it("prints the upgrade command once when this CLI is behind", async () => {
    const freshGetFn = await freshGet();
    respond(200, { ok: true }, "0.8.0");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await freshGetFn("/api/onboarding");
    await freshGetFn("/api/onboarding");

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "A newer Clocktopus CLI is available (0.7.1 → 0.8.0). Run: clocktopus upgrade",
    );
  });

  it("remembers the latest version the server names, for agent context", async () => {
    respond(200, { ok: true }, "0.8.0");

    await get("/api/onboarding");

    expect(rememberLatestVersion).toHaveBeenCalledWith("0.8.0");
  });

  it("prints it on a failed request too", async () => {
    const freshGetFn = await freshGet();
    respond(403, { error: { message: "Forbidden" } }, "0.8.0");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(freshGetFn("/api/onboarding")).rejects.toBeInstanceOf(Error);

    expect(error).toHaveBeenCalledTimes(1);
  });

  it("leaves a 426 to the server's own upgrade message", async () => {
    const freshGetFn = await freshGet();
    respond(426, { error: { message: "No longer supported." } }, "0.8.0");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new ExitCalled();
    });

    await expect(freshGetFn("/api/onboarding")).rejects.toBeInstanceOf(
      ExitCalled,
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("No longer supported.");
  });

  it.each([
    ["0.7.1", "0.7.1"],
    ["0.8.0", "0.7.1"],
    ["0.0.0", "0.8.0"],
    ["0.7.1", "latest"],
    ["0.7.1", ""],
    ["0.7.1", undefined],
  ])("prints nothing for CLI %s and latest %s", async (version, latest) => {
    installed.version = version;
    const freshGetFn = await freshGet();
    respond(200, { ok: true }, latest);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await freshGetFn("/api/onboarding");

    expect(error).not.toHaveBeenCalled();
  });

  it("prints nothing when stderr is not a terminal", async () => {
    process.stderr.isTTY = false;
    const freshGetFn = await freshGet();
    respond(200, { ok: true }, "0.8.0");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await freshGetFn("/api/onboarding");

    expect(error).not.toHaveBeenCalled();
  });
});
