import { describe, expect, it } from "vitest";

import { parseGitRemotes } from "./git-remotes.js";

describe("parseGitRemotes", () => {
  it("keeps origin first, so an older receiver reading only the first entry is unchanged", () => {
    const urls = parseGitRemotes(
      [
        "upstream\tgit@github.com:acme-co/portal.git (fetch)",
        "upstream\tgit@github.com:acme-co/portal.git (push)",
        "origin\tgit@github.com:jordan/portal.git (fetch)",
        "origin\tgit@github.com:jordan/portal.git (push)",
      ].join("\n"),
    );

    expect(urls[0]).toBe("git@github.com:jordan/portal.git");
    expect(urls).toContain("git@github.com:acme-co/portal.git");
  });

  it("collapses the fetch and push lines of one remote", () => {
    const urls = parseGitRemotes(
      [
        "origin\tgit@github.com:acme-co/portal.git (fetch)",
        "origin\tgit@github.com:acme-co/portal.git (push)",
      ].join("\n"),
    );

    expect(urls).toEqual(["git@github.com:acme-co/portal.git"]);
  });

  /** A fork often fetches from upstream and pushes to itself under one remote name. */
  it("keeps both URLs when a remote's push target differs from its fetch", () => {
    const urls = parseGitRemotes(
      [
        "origin\tgit@github.com:acme-co/portal.git (fetch)",
        "origin\tgit@github.com:jordan/portal.git (push)",
      ].join("\n"),
    );

    expect(urls).toEqual([
      "git@github.com:acme-co/portal.git",
      "git@github.com:jordan/portal.git",
    ]);
  });

  it("returns nothing for a checkout with no remotes", () => {
    expect(parseGitRemotes("")).toEqual([]);
    expect(parseGitRemotes(undefined)).toEqual([]);
  });

  it("works when no remote is called origin", () => {
    const urls = parseGitRemotes(
      "github\tgit@github.com:acme-co/portal.git (fetch)",
    );

    expect(urls).toEqual(["git@github.com:acme-co/portal.git"]);
  });

  it("ignores lines that are not remote entries", () => {
    const urls = parseGitRemotes(
      [
        "origin\tgit@github.com:acme-co/portal.git (fetch)",
        "warning: something else entirely",
        "",
      ].join("\n"),
    );

    expect(urls).toEqual(["git@github.com:acme-co/portal.git"]);
  });

  it("caps a pathological remote list", () => {
    const lines = Array.from(
      { length: 40 },
      (_, i) => `r${i}\tgit@github.com:acme-co/repo-${i}.git (fetch)`,
    );

    expect(parseGitRemotes(lines.join("\n"))).toHaveLength(20);
  });

  it("sends no remote with its credentials, and merges it with the clean spelling", () => {
    const urls = parseGitRemotes(
      [
        "origin\thttps://jordan:ghp_fake0token1@github.com/acme-co/portal.git (fetch)",
        "origin\thttps://github.com/acme-co/portal.git (push)",
        "mirror\thttps://ghp_fake0token1@git.example.test/acme/portal.git (fetch)",
        "mirror\thttps://ghp_fake0token1@git.example.test/acme/portal.git (push)",
      ].join("\n"),
    );

    expect(urls).toEqual([
      "https://github.com/acme-co/portal.git",
      "https://git.example.test/acme/portal.git",
    ]);
    expect(urls.join(" ")).not.toContain("ghp_fake0token1");
  });

  it("resolves each remote before deduplicating, so an alias and its real host collapse", () => {
    const urls = parseGitRemotes(
      [
        "origin\tgit@github-work:acme-co/portal.git (fetch)",
        "origin\tgit@github.com:acme-co/portal.git (push)",
      ].join("\n"),
      (remote) => remote.replace("github-work", "github.com"),
    );

    expect(urls).toEqual(["git@github.com:acme-co/portal.git"]);
  });
});
