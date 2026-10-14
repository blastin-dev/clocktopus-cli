import type { RepoStatusResponse } from "@repo/cli-contract/repository-status";
import { RepoStatusSchema } from "@repo/cli-contract/repository-status";

import { ApiError, get } from "./api.js";
import { getApiUrl } from "./config.js";
import { formatAgo } from "./format.js";
import { getRepositoryRemotes } from "./git.js";
import {
  eventLabels,
  MISSING_EVENTS_FIX,
  missingEventsConsequence,
  pingTargetLabel,
} from "./webhook-ping.js";

// Server-side readiness that no local config fixes: whether the repository maps to a
// project, and whether its push webhook delivers. They are reported separately
// because each has a different fix.

export type RepoCheck = {
  label: string;
  ok: boolean | "warn";
  detail: string;
  fix?: string;
};

// `repositoryUrl` carries `origin` for a server that reads no `repositoryUrls`;
// a newer one assesses the remote the session hook would attribute to.
export function repoStatusPath(remotes: string[]): string | null {
  const [first] = remotes;
  if (!first) return null;
  const query = new URLSearchParams({ repositoryUrl: first });
  for (const remote of remotes) query.append("repositoryUrls", remote);
  return `/api/agent/repo-status?${query.toString()}`;
}

// Null outside a git checkout or on any request failure, so it never fails `setup`.
export async function fetchRepoStatus(
  cwd = process.cwd(),
): Promise<RepoStatusResponse | null> {
  const path = repoStatusPath(getRepositoryRemotes(cwd));
  if (!path) return null;

  try {
    const data = await get(path);
    return RepoStatusSchema.parse(data);
  } catch (error) {
    if (error instanceof ApiError) return null;
    return null;
  }
}

export function attributionCheck(status: RepoStatusResponse): RepoCheck {
  const { attribution, repository } = status;
  const where = repository?.displayUrl ?? "this repository";

  switch (attribution.reason) {
    case "attributed":
      return {
        label: "Project",
        ok: true,
        detail: attribution.projectNames[0] ?? "attached",
      };

    case "no_matching_project":
      return {
        label: "Project",
        ok: false,
        detail: `${where} is not attached to any project`,
        fix:
          "Attach it under Projects → (your project) → Repositories.\n" +
          "      Until then this repo's agent spend is recorded, but lands in\n" +
          "      the unattributed row instead of against a client.",
      };

    case "ambiguous_project":
      return {
        label: "Project",
        ok: false,
        detail: `${where} is attached to ${attribution.projectNames.length} projects (${attribution.projectNames.join(", ")})`,
        fix:
          "Clocktopus will not guess which client to bill, so these sessions\n" +
          "      stay unattributed. Remove the repository from all but one project.",
      };

    case "unsupported_remote":
      return {
        label: "Project",
        ok: "warn",
        detail: "remote is not GitHub or Bitbucket",
        fix:
          "Spend from this repository is recorded but cannot be attributed —\n" +
          "      only GitHub and Bitbucket remotes resolve to a project.",
      };

    case "no_repository":
      return {
        label: "Project",
        ok: "warn",
        detail: "not a git repository",
        fix: "Run 'clocktopus agent setup' inside a project checkout to check attribution.",
      };
  }
}

type Coverage = NonNullable<RepoStatusResponse["commitLane"]["coverage"]>;
type Connection = NonNullable<Coverage["connection"]>;

function providerName(status: RepoStatusResponse): string {
  return status.repository?.provider === "bitbucket" ? "Bitbucket" : "GitHub";
}

function describeConnection(
  status: RepoStatusResponse,
  connection: Connection,
): string {
  if (connection.kind === "app_installation") {
    const by = connection.connectedByCaller
      ? "you"
      : connection.connectedByName;
    return `the ${providerName(status)} App on ${connection.label} (installed by ${by})`;
  }
  const owner = connection.connectedByCaller
    ? "your"
    : `${connection.connectedByName}'s`;
  return `${owner} webhook "${connection.label}"`;
}

function dashboardUrl(): string {
  return getApiUrl().replace(/\/$/, "");
}

// Shown only when nothing in the organisation covers the repository: one
// connection serves every member.
function connectInstructions(
  status: RepoStatusResponse,
  appInstallAccount: string | null,
): string {
  const dashboard = dashboardUrl();
  const app = appInstallAccount
    ? `Install the GitHub App on ${appInstallAccount} from\n` +
      `      ${dashboard}/settings/webhooks, or add a push webhook:\n`
    : "Add a push webhook:\n";
  return (
    "One connection covers the whole team.\n" +
    `      ${app}` +
    `        URL     ${status.webhookUrl}\n` +
    "        Events  push, pull requests, pull request reviews\n" +
    `        Secret  ${dashboard}/settings/webhooks\n` +
    `      Guide: ${dashboard}/docs/connect-a-repository`
  );
}

function coverageCheck(
  status: RepoStatusResponse,
  coverage: Coverage,
): RepoCheck {
  const dashboard = dashboardUrl();
  const where = status.repository?.ownerRepo ?? "this repository";
  const { connection } = coverage;
  const named = connection ? describeConnection(status, connection) : "";

  const ping = connection?.ping;
  if (connection && ping && !connection.lastDeliveryAt) {
    const missing = ping.missingEvents;
    if (missing.includes("push")) {
      return {
        label: "Commit lane",
        ok: false,
        detail: `${named} is on ${pingTargetLabel(ping)}, but does not send Pushes`,
        fix: `${missingEventsConsequence(missing)} ${MISSING_EVENTS_FIX}`,
      };
    }
    return {
      label: "Commit lane",
      ok: "warn",
      detail: `${named} — GitHub confirmed it on ${pingTargetLabel(ping)} ${formatAgo(ping.receivedAt)}; waiting for a push`,
      fix:
        missing.length > 0
          ? `It does not send ${eventLabels(missing)}. ${missingEventsConsequence(missing)} ${MISSING_EVENTS_FIX}`
          : "Nothing to set up. The next push reaches Clocktopus through it.",
    };
  }

  switch (coverage.nextAction) {
    case "push":
      return {
        label: "Commit lane",
        ok: "warn",
        detail: `${named} covers it — waiting for a push`,
        fix:
          "Nothing to set up. The next push reaches Clocktopus through your\n" +
          "      team's connection, and each member is credited for their own commits.",
      };

    case "attach_project":
      return {
        label: "Commit lane",
        ok: "warn",
        detail: `${named} covers it — waiting for a push`,
        fix:
          "Its webhook is added to this repository once a project attaches it\n" +
          "      (see Project above); after that, the next push arrives through it.",
      };

    case "check_selection":
      return {
        label: "Commit lane",
        ok: "warn",
        detail: `${named} — could not read which repositories it can see`,
        fix:
          `If ${where} is among them, the next push arrives through it. Check\n` +
          `      under ${dashboard}/settings/webhooks → Change repositories on GitHub.`,
      };

    case "check_webhook":
      return {
        label: "Commit lane",
        ok: "warn",
        detail: `${named} has not delivered from this repository yet`,
        fix:
          "If that webhook is on this repository, or on its organisation or\n" +
          "      workspace, the next push arrives through it — nothing to set up.\n" +
          `      If it is not: ${connectInstructions(status, coverage.appInstallAccount)}`,
      };

    case "add_to_selection": {
      const who =
        !connection || connection.connectedByCaller
          ? "Add it"
          : `Ask ${connection.connectedByName} to add it`;
      return {
        label: "Commit lane",
        ok: false,
        detail: `${named} does not include ${where}`,
        fix:
          `${who} to the installation's repositories: ${dashboard}/settings/webhooks\n` +
          "      → Change repositories on GitHub. Nobody else needs to connect anything.",
      };
    }

    case "connect":
      return {
        label: "Commit lane",
        ok: false,
        detail:
          "nothing connects this repository — no commits are reaching Clocktopus",
        fix:
          "Agent spend is recorded, but with no human time beside it the\n" +
          "      true-cost comparison has only one side. " +
          connectInstructions(status, coverage.appInstallAccount),
      };
  }
}

export function commitLaneCheck(status: RepoStatusResponse): RepoCheck {
  const { coverage } = status.commitLane;

  if (status.commitLane.status === "delivering") {
    const via =
      coverage?.status === "covered" && coverage.connection
        ? ` via ${describeConnection(status, coverage.connection)}`
        : "";
    return {
      label: "Commit lane",
      ok: true,
      detail: `last commit received ${formatAgo(status.commitLane.lastCommitAt)}${via}`,
    };
  }

  if (coverage) return coverageCheck(status, coverage);

  // A server without `coverage` counts only the caller's own connections,
  // which says nothing about a teammate's.
  return {
    label: "Commit lane",
    ok: false,
    detail: "no commit has arrived from this repository",
    fix:
      "If your team's GitHub App or webhook covers this repository, push a\n" +
      "      commit — nothing to set up. If nothing does: " +
      connectInstructions(status, null),
  };
}

export function repoChecks(status: RepoStatusResponse): RepoCheck[] {
  return [attributionCheck(status), commitLaneCheck(status)];
}

export function renderRepoBlock(status: RepoStatusResponse): string[] {
  const lines: string[] = [];
  const heading = status.repository?.displayUrl ?? "this directory";

  lines.push("");
  lines.push(`Repository  ${heading}`);
  lines.push("");

  for (const check of repoChecks(status)) {
    const symbol = check.ok === true ? "✓" : check.ok === "warn" ? "⚠" : "✗";
    lines.push(`  ${symbol} ${check.label.padEnd(12)}${check.detail}`);
    if (check.ok !== true && check.fix) lines.push(`      ${check.fix}`);
  }

  return lines;
}
