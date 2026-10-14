import type { RepoDeliveriesResponse } from "@repo/cli-contract/repository-status";
import { GITHUB_HOOK_EVENT_LABELS } from "@repo/cli-contract/github-hook-events";

export type WebhookPing = NonNullable<RepoDeliveriesResponse["pings"]>[number];

const EVENT_LABELS = new Map<string, string>(
  Object.entries(GITHUB_HOOK_EVENT_LABELS),
);

export function eventLabels(events: string[]): string {
  return events.map((event) => EVENT_LABELS.get(event) ?? event).join(", ");
}

// "acme-co/acme-portal", or "the acme-co organisation" for an organisation hook.
export function pingTargetLabel(
  ping: Pick<WebhookPing, "targetType" | "target">,
): string {
  return ping.targetType === "organization"
    ? `the ${ping.target} organisation`
    : ping.target;
}

// What a hook that leaves `missing` unticked costs.
export function missingEventsConsequence(missing: string[]): string {
  return missing.includes("push")
    ? "No commits arrive without Pushes."
    : "Commits arrive, but pull request metrics stay empty.";
}

export const MISSING_EVENTS_FIX =
  "Tick them in the webhook's settings on GitHub (Let me select individual\n" +
  "      events), then Update webhook.";
