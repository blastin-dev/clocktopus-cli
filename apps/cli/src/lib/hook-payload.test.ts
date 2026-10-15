import { describe, expect, it } from "vitest";

import { readHookPayload } from "./hook-payload";

describe("readHookPayload", () => {
  it("reads Claude Code and Codex payloads as they are", () => {
    expect(
      readHookPayload(
        {
          session_id: "abc",
          cwd: "/work/acme-portal",
          hook_event_name: "SessionStart",
        },
        undefined,
      ),
    ).toEqual({
      sessionId: "abc",
      cwd: "/work/acme-portal",
      eventName: "SessionStart",
      durationMs: null,
      transcriptPath: null,
    });
  });

  it("reads the transcript path a Codex 0.162.1 SessionEnd sends", () => {
    expect(
      readHookPayload(
        {
          session_id: "0e5d7c1a-4b2f-7a90-9c3e-5f1b2d8a6e47",
          transcript_path:
            "/home/dana/.codex/sessions/2026/10/14/rollout-2026-10-14T09-12-04-0e5d7c1a-4b2f-7a90-9c3e-5f1b2d8a6e47.jsonl",
          cwd: "/home/dana/work/acme-portal",
          hook_event_name: "SessionEnd",
          reason: "other",
        },
        undefined,
      ).transcriptPath,
    ).toBe(
      "/home/dana/.codex/sessions/2026/10/14/rollout-2026-10-14T09-12-04-0e5d7c1a-4b2f-7a90-9c3e-5f1b2d8a6e47.jsonl",
    );
    expect(
      readHookPayload(
        {
          session_id: "abc",
          transcript_path: null,
          hook_event_name: "SessionStart",
        },
        undefined,
      ).transcriptPath,
    ).toBeNull();
  });

  it("takes Cursor's workspace root, event name and duration", () => {
    expect(
      readHookPayload(
        {
          session_id: "abc",
          hook_event_name: "sessionEnd",
          workspace_roots: ["/work/acme-portal", "/work/acme-docs"],
          duration_ms: 45000,
        },
        "/elsewhere",
      ),
    ).toEqual({
      sessionId: "abc",
      cwd: "/work/acme-portal",
      eventName: "SessionEnd",
      durationMs: 45000,
      transcriptPath: null,
    });
  });

  it("reads a sessionEnd payload as Cursor 2026.10.01 sends it", () => {
    // Captured from `cursor-agent -p`, with the ids, paths and email invented.
    const payload = {
      conversation_id: "8a1f0c52-3c3e-4d0a-9a51-6f2d8b7e4c10",
      generation_id: "8a1f0c52-3c3e-4d0a-9a51-6f2d8b7e4c10",
      model: "default",
      reason: "completed",
      duration_ms: 13564,
      is_background_agent: false,
      final_status: "completed",
      session_id: "8a1f0c52-3c3e-4d0a-9a51-6f2d8b7e4c10",
      hook_event_name: "sessionEnd",
      cursor_version: "2026.10.01-e373342",
      workspace_roots: ["/home/dana/work/acme-portal"],
      user_email: "dana@example.com",
      transcript_path: "/home/dana/.cursor/projects/acme/transcript.jsonl",
    };

    expect(readHookPayload(payload, "/home/dana/work/acme-portal")).toEqual({
      sessionId: "8a1f0c52-3c3e-4d0a-9a51-6f2d8b7e4c10",
      cwd: "/home/dana/work/acme-portal",
      eventName: "SessionEnd",
      durationMs: 13564,
      source: undefined,
      reason: "completed",
      transcriptPath: "/home/dana/.cursor/projects/acme/transcript.jsonl",
    });
  });

  it("falls back to CURSOR_PROJECT_DIR when no workspace root is sent", () => {
    expect(
      readHookPayload(
        { session_id: "abc", hook_event_name: "sessionStart" },
        "/work/acme-portal",
      ).cwd,
    ).toBe("/work/acme-portal");
  });

  it("ignores a duration that is not a whole number of milliseconds", () => {
    expect(
      readHookPayload({ session_id: "abc", duration_ms: "45000" }, undefined)
        .durationMs,
    ).toBeNull();
  });

  it("keeps the fields that parse when another field is malformed", () => {
    expect(
      readHookPayload(
        {
          session_id: "abc",
          hook_event_name: 42,
          workspace_roots: [7, "", "/work/acme-portal"],
          source: "startup",
        },
        undefined,
      ),
    ).toEqual({
      sessionId: "abc",
      cwd: "/work/acme-portal",
      eventName: "",
      durationMs: null,
      source: "startup",
      reason: undefined,
      transcriptPath: null,
    });
  });

  it("reads a payload that is not an object as empty", () => {
    expect(readHookPayload(["abc"], "/work/acme-portal")).toEqual({
      sessionId: null,
      cwd: "/work/acme-portal",
      eventName: "",
      durationMs: null,
      source: undefined,
      reason: undefined,
      transcriptPath: null,
    });
  });
});
