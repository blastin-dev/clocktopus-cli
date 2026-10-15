import { execFileSync } from "node:child_process";

import { parseGitRemotes } from "./git-remotes.js";

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

// Every remote, `origin` first, as the session hook reports them.
export function getRepositoryRemotes(cwd = process.cwd()): string[] {
  return parseGitRemotes(git(cwd, ["remote", "-v"]));
}

export function isGitRepository(cwd = process.cwd()): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
}
