import { execFileSync } from "node:child_process";

import { parseGitRemotes } from "./git-remotes.js";
import { resolveSshHostAlias } from "./ssh-host-alias.js";

// Remotes go to the server unparsed, without their credentials: the CLI cannot
// import `@repo/core`, which owns the definition of a supported remote.

function git(cwd: string, args: string[]): string | undefined {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

// `ssh -G` reads the config without connecting.
export function readSshConfig(host: string): string | undefined {
  try {
    return execFileSync("ssh", ["-G", "--", host], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
  } catch {
    return undefined;
  }
}

// Every remote, `origin` first and SSH host aliases resolved, as the session
// hook reports them.
export function getRepositoryRemotes(cwd = process.cwd()): string[] {
  const configs = new Map<string, string | undefined>();
  const cachedSshConfig = (host: string) => {
    if (!configs.has(host)) configs.set(host, readSshConfig(host));
    return configs.get(host);
  };
  return parseGitRemotes(git(cwd, ["remote", "-v"]), (remote) =>
    resolveSshHostAlias(remote, cachedSshConfig),
  );
}

export function isGitRepository(cwd = process.cwd()): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
}
