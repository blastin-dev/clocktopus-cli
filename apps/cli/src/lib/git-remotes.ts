import { stripRemoteCredentials } from "@repo/cli-contract/remote-url";

// Every remote is reported because on a fork `origin` is the developer's copy while
// webhooks arrive under the upstream; the receiver decides which one wins.

/** Matches the `repository_urls` limit in `AgentSessionHookSchema`. */
const MAX_REMOTES = 20;

// Deduplicated, `origin` first: the hook sends the first entry as `repository_url`.
// Each URL loses its credentials here, so nothing that reads remotes sends one.
export function parseGitRemotes(
  output: string | undefined,
  resolve: (remote: string) => string = (remote) => remote,
): string[] {
  if (!output?.trim()) return [];

  const byName = new Map<string, string>();

  for (const line of output.split("\n")) {
    // Push URLs are kept too: a fork often fetches upstream and pushes to itself.
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) continue;

    const [, name, url, direction] = match;
    if (!name || !url) continue;

    const key = `${name}:${direction}`;
    if (!byName.has(key)) byName.set(key, resolve(stripRemoteCredentials(url)));
  }

  const entries = [...byName.entries()];
  const ordered = [
    ...entries.filter(([key]) => key.startsWith("origin:")),
    ...entries.filter(([key]) => !key.startsWith("origin:")),
  ];

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const [, url] of ordered) {
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length === MAX_REMOTES) break;
  }

  return urls;
}
