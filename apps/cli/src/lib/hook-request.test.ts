import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { postHookRequest, readHookDryRun } from "./hook-request";

describe("readHookDryRun", () => {
  it("is off without the flag or the variable", () => {
    expect(readHookDryRun(undefined, undefined)).toBeNull();
    expect(readHookDryRun(undefined, "")).toBeNull();
    expect(readHookDryRun(undefined, "0")).toBeNull();
    expect(readHookDryRun(undefined, "false")).toBeNull();
  });

  it("prints to stderr for the bare flag or a switch value", () => {
    expect(readHookDryRun(true, undefined)).toEqual({ file: null });
    expect(readHookDryRun(undefined, "1")).toEqual({ file: null });
    expect(readHookDryRun(undefined, "TRUE")).toEqual({ file: null });
  });

  it("appends to the file the variable or the flag names, the flag's first", () => {
    expect(readHookDryRun(undefined, "/tmp/hook.txt")).toEqual({
      file: "/tmp/hook.txt",
    });
    expect(readHookDryRun("hook.txt", "/tmp/other.txt")).toEqual({
      file: resolve("hook.txt"),
    });
    expect(readHookDryRun(true, "/tmp/hook.txt")).toEqual({
      file: "/tmp/hook.txt",
    });
  });
});

describe("postHookRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prints the URL and the exact body on a dry run, without the token, and fetches nothing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await postHookRequest({
      endpoint: "https://otel.example.com/",
      path: "/v1/agent-session",
      token: "ctop_agt_secret",
      body: { session_id: "s-1", cwd: "~/acme" },
      dryRun: { file: null },
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ status: null, error: null });
    expect(stderr).toHaveBeenCalledWith(
      'POST https://otel.example.com/v1/agent-session\n{"session_id":"s-1","cwd":"~/acme"}\n',
    );
  });

  it("does not throw when the dry-run file cannot be written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clocktopus-hook-request-"));
    try {
      await expect(
        postHookRequest({
          endpoint: "https://otel.example.com",
          path: "/v1/traces",
          token: "t",
          body: {},
          dryRun: { file: join(dir, "missing", "out.txt") },
        }),
      ).resolves.toEqual({ status: null, error: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends the same body with the bearer token when not a dry run", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetch);

    const result = await postHookRequest({
      endpoint: "https://otel.example.com",
      path: "/v1/traces",
      token: "ctop_agt_secret",
      body: { a: 1 },
      dryRun: null,
    });

    expect(result).toEqual({ status: 202, error: null });
    expect(fetch).toHaveBeenCalledWith(
      "https://otel.example.com/v1/traces",
      expect.objectContaining({
        body: '{"a":1}',
        headers: expect.objectContaining({
          authorization: "Bearer ctop_agt_secret",
        }),
      }),
    );
  });
});
