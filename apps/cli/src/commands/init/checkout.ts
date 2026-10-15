import { stripRemoteCredentials } from "@repo/cli-contract/remote-url";

import type { Checkout, InitDeps } from "./types.js";

export type ParsedRemote = {
  provider: "github" | "bitbucket";
  owner: string;
  repo: string;
  // `owner/repo`, as the remote spells it.
  ownerRepo: string;
};

const HOSTS: Record<string, ParsedRemote["provider"]> = {
  "github.com": "github",
  "bitbucket.org": "bitbucket",
};

// Only for what the CLI does itself (the `gh api` path, the provider's
// instructions); the server's `parseRepositoryUrl` decides attribution.
export function parseRemote(url: string | null): ParsedRemote | null {
  if (!url) return null;
  const trimmed = url.trim();

  // scp-like: git@github.com:owner/repo.git
  const scp = trimmed.match(/^(?:[^@/\s]+@)?([^:/\s]+):([^/\s]+)\/([^/\s]+)$/);
  // https://, ssh://, git:// with an optional user and port.
  const full = trimmed.match(
    /^[a-z+]+:\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)\/?$/i,
  );
  const match = full ?? (trimmed.includes("://") ? null : scp);
  if (!match) return null;

  const [, host, owner, rawRepo] = match;
  const provider = host ? HOSTS[host.toLowerCase()] : undefined;
  if (!provider || !owner || !rawRepo) return null;

  const repo = rawRepo.replace(/\.git$/i, "");
  if (!repo) return null;
  return { provider, owner, repo, ownerRepo: `${owner}/${repo}` };
}

// IANA name of the machine's timezone, which the web's "You" step detects
// from the browser.
export function detectTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
}

export function readCheckout(deps: Pick<InitDeps, "run">): Checkout {
  const output = (args: string[]) => {
    const result = deps.run("git", args);
    return result.ok ? result.stdout.trim() || null : null;
  };
  const origin = output(["remote", "get-url", "origin"]);
  // Every request `init` makes names the repository by this remote.
  const remote = origin && stripRemoteCredentials(origin);
  return {
    remote,
    repository: parseRemote(remote),
    // Plain `git config` reads the repository's own value over the global one.
    gitEmail: output(["config", "user.email"]),
    osTimezone: detectTimezone(),
    ghInstalled: deps.run("gh", ["--version"]).ok,
  };
}
