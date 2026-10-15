import { describe, expect, it } from "vitest";

import { homeRelativePath } from "./home-relative-path.js";

const HOME = "/home/dana";

describe("homeRelativePath", () => {
  it("replaces the home directory with ~", () => {
    expect(homeRelativePath("/home/dana/Projects/acme-portal", HOME)).toBe(
      "~/Projects/acme-portal",
    );
  });

  it("returns ~ for the home directory itself", () => {
    expect(homeRelativePath("/home/dana", HOME)).toBe("~");
    expect(homeRelativePath("/home/dana/", HOME)).toBe("~");
  });

  it("ignores a trailing separator on the home directory", () => {
    expect(homeRelativePath("/home/dana/acme-portal", "/home/dana/")).toBe(
      "~/acme-portal",
    );
  });

  it("keeps a path outside the home directory as it is", () => {
    expect(homeRelativePath("/srv/acme-portal", HOME)).toBe("/srv/acme-portal");
  });

  it("keeps a sibling whose name starts with the home directory's", () => {
    expect(homeRelativePath("/home/dana2/acme-portal", HOME)).toBe(
      "/home/dana2/acme-portal",
    );
  });

  it("keeps a directory under home whose name starts with two dots", () => {
    expect(homeRelativePath("/home/dana/..acme", HOME)).toBe("~/..acme");
  });

  it("keeps the path when home is unknown or the filesystem root", () => {
    expect(homeRelativePath("/home/dana/acme-portal", null)).toBe(
      "/home/dana/acme-portal",
    );
    expect(homeRelativePath("/home/dana/acme-portal", "/")).toBe(
      "/home/dana/acme-portal",
    );
  });

  it("keeps a relative path as it is", () => {
    expect(homeRelativePath("acme-portal", HOME)).toBe("acme-portal");
  });
});
