import { ReceiverVerifySchema } from "@repo/cli-contract/agent";

// Calls the OTLP receiver directly: it is a different host from the web app, so a
// token the dashboard accepts proves nothing about ingest.

const TIMEOUT_MS = 8000;

// `userId` is the token's owner; null from a receiver that does not say.
export type ReceiverCheck =
  | { ok: true; userId: string | null }
  | { ok: false; reason: "invalid_token" }
  | { ok: false; reason: "unexpected_status"; status: number }
  | { ok: false; reason: "unreachable"; message: string };

export async function verifyReceiver(
  endpoint: string,
  token: string,
): Promise<ReceiverCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: "{}",
      signal: controller.signal,
    });

    if (response.ok) {
      const body = ReceiverVerifySchema.safeParse(
        await response.json().catch(() => null),
      );
      return { ok: true, userId: body.success ? body.data.userId : null };
    }
    if (response.status === 401) return { ok: false, reason: "invalid_token" };

    return { ok: false, reason: "unexpected_status", status: response.status };
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      message: error instanceof Error ? error.message : "request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
