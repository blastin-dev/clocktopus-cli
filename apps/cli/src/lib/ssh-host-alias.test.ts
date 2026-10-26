import { describe, expect, it, vi } from "vitest";

import { resolveSshHostAlias } from "./ssh-host-alias.js";

// `ssh -G` prints every option, one `key value` per line, lowercase keys.
function sshConfig(hosts: Record<string, { hostname: string; user?: string }>) {
  return (host: string) => {
    const entry = hosts[host] ?? { hostname: host };
    return [
      `user ${entry.user ?? "jordan"}`,
      `hostname ${entry.hostname}`,
      "port 22",
      "identitiesonly yes",
    ].join("\n");
  };
}

const aliases = sshConfig({
  "github-work": { hostname: "github.com", user: "git" },
  "bb-work": { hostname: "bitbucket.org", user: "git" },
});

describe("resolveSshHostAlias", () => {
  it.each([
    ["git@github-work:acme-co/portal.git", "git@github.com:acme-co/portal.git"],
    ["github-work:acme-co/portal.git", "git@github.com:acme-co/portal.git"],
    ["git@bb-work:acme-co/portal.git", "git@bitbucket.org:acme-co/portal.git"],
    [
      "ssh://git@github-work/acme-co/portal.git",
      "git@github.com:acme-co/portal.git",
    ],
    [
      "ssh://git@github-work:22/acme-co/portal.git",
      "git@github.com:acme-co/portal.git",
    ],
    [
      "ssh://git@github-work:2222/acme-co/portal.git",
      "ssh://git@github.com:2222/acme-co/portal.git",
    ],
  ])("resolves %s to its real host", (remote, expected) => {
    expect(resolveSshHostAlias(remote, aliases)).toBe(expected);
  });

  it.each([
    "git@github.com:acme-co/portal.git",
    "https://github.com/acme-co/portal.git",
    "https://github-work/acme-co/portal.git",
    "/srv/git/portal.git",
    "file:///srv/git/portal.git",
  ])("leaves %s unchanged", (remote) => {
    expect(resolveSshHostAlias(remote, aliases)).toBe(remote);
  });

  it("leaves the remote unchanged when ssh can't be run", () => {
    expect(
      resolveSshHostAlias(
        "git@github-work:acme-co/portal.git",
        () => undefined,
      ),
    ).toBe("git@github-work:acme-co/portal.git");
  });

  it("never passes ssh a host that reads as an option", () => {
    const readSshConfig = vi.fn(aliases);

    expect(
      resolveSshHostAlias(
        "-oProxyCommand=touch:acme-co/portal.git",
        readSshConfig,
      ),
    ).toBe("-oProxyCommand=touch:acme-co/portal.git");
    expect(readSshConfig).not.toHaveBeenCalled();
  });
});
