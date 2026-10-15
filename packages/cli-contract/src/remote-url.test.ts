import { describe, expect, it } from "vitest";

import { stripRemoteCredentials } from "./remote-url";

describe("stripRemoteCredentials", () => {
  it.each([
    [
      "https://jordan:ghp_fake0token1@github.com/acme-co/portal.git",
      "https://github.com/acme-co/portal.git",
    ],
    [
      "https://ghp_fake0token1@github.com/acme-co/portal.git",
      "https://github.com/acme-co/portal.git",
    ],
    [
      "https://x-token-auth:fake-token@bitbucket.org/acme-co/portal.git",
      "https://bitbucket.org/acme-co/portal.git",
    ],
    [
      "http://jordan:fake%40pass%3Aword@git.example.test:8443/acme/portal",
      "http://git.example.test:8443/acme/portal",
    ],
    [
      "https://jordan:p@ss@git.example.test/acme/portal",
      "https://git.example.test/acme/portal",
    ],
    [
      "HTTPS://jordan:fake-token@GitHub.com/acme-co/portal",
      "HTTPS://GitHub.com/acme-co/portal",
    ],
    [
      "git://jordan:fake-token@git.example.test/acme/portal.git",
      "git://git.example.test/acme/portal.git",
    ],
  ])("drops all userinfo from %s", (remote, expected) => {
    expect(stripRemoteCredentials(remote)).toBe(expected);
  });

  it.each([
    [
      "ssh://git:fake-pass@github.com/acme-co/portal.git",
      "ssh://git@github.com/acme-co/portal.git",
    ],
    [
      "git+ssh://git:fake-pass@git.example.test:2222/acme/portal",
      "git+ssh://git@git.example.test:2222/acme/portal",
    ],
    [
      "deploy:fake-pass@git.example.test:acme/portal",
      "deploy@git.example.test:acme/portal",
    ],
  ])(
    "keeps the SSH user but drops the password from %s",
    (remote, expected) => {
      expect(stripRemoteCredentials(remote)).toBe(expected);
    },
  );

  it.each([
    "git@github.com:acme-co/portal.git",
    "ssh://git@github.com/acme-co/portal.git",
    "https://github.com/acme-co/portal.git",
    "https://github.com/acme-co/portal@v2",
    "/srv/git/portal.git",
    "../portal",
    "./with@sign:in/path",
    "file:///srv/git/portal.git",
    "git.example.test:acme/portal",
  ])("leaves %s unchanged", (remote) => {
    expect(stripRemoteCredentials(remote)).toBe(remote);
  });
});
