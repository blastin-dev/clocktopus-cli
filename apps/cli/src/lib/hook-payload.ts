import { z } from "zod";

// Each field catches on its own, so one malformed field drops only itself and
// the hook still reads the rest of what the host sent.
const HookPayloadSchema = z
  .object({
    session_id: z.string().optional().catch(undefined),
    cwd: z.string().optional().catch(undefined),
    workspace_roots: z
      .array(z.string().min(1).nullable().catch(null))
      .catch([])
      .transform((roots) => roots.filter((root) => root !== null)),
    hook_event_name: z.string().catch(""),
    duration_ms: z.number().int().nonnegative().optional().catch(undefined),
    source: z.string().optional().catch(undefined),
    reason: z.string().optional().catch(undefined),
  })
  .catch({ workspace_roots: [], hook_event_name: "" });

// Cursor names its events `sessionStart` / `sessionEnd`, gives the workspace in
// `workspace_roots` (or `CURSOR_PROJECT_DIR`) rather than `cwd`, and reports the
// session's `duration_ms` at its end.
export function readHookPayload(
  input: unknown,
  projectDir: string | undefined,
) {
  const payload = HookPayloadSchema.parse(input);
  const event = payload.hook_event_name;

  return {
    sessionId: payload.session_id ?? null,
    cwd: payload.cwd ?? payload.workspace_roots[0] ?? (projectDir || null),
    eventName: event.charAt(0).toUpperCase() + event.slice(1),
    durationMs: payload.duration_ms ?? null,
    source: payload.source,
    reason: payload.reason,
  };
}
