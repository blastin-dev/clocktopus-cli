import { describe, expect, it } from "vitest";

import { extractTaskKeyFromBranch } from "./task-key";

describe("extractTaskKeyFromBranch", () => {
  it("reads the key out of a prefixed branch", () => {
    expect(
      extractTaskKeyFromBranch(
        "allanclempe/bla-503-repositioning-go-to-market-2",
      ),
    ).toBe("BLA-503");
  });

  it("reads an unprefixed branch", () => {
    expect(extractTaskKeyFromBranch("bla-402")).toBe("BLA-402");
  });

  it("ends the key at a dash, underscore or dot", () => {
    expect(extractTaskKeyFromBranch("bla-12_x")).toBe("BLA-12");
    expect(extractTaskKeyFromBranch("bla-12.x")).toBe("BLA-12");
    expect(extractTaskKeyFromBranch("x/oauth-2a")).toBeNull();
  });

  it("uppercases, matching every other key path", () => {
    expect(extractTaskKeyFromBranch("feature/bla-123-thing")).toBe("BLA-123");
    expect(extractTaskKeyFromBranch("feature/BLA-123-thing")).toBe("BLA-123");
  });

  // The rule that earns its keep: without requiring a segment start, any
  // trailing `word-number` in a branch name mints a task.
  it("does not invent a key from a word-number pair mid-segment", () => {
    expect(extractTaskKeyFromBranch("feature/add-oauth-2")).toBeNull();
    expect(extractTaskKeyFromBranch("chore/bump-node-24")).toBeNull();
  });

  it("ignores numeric segments, which are versions and years", () => {
    expect(extractTaskKeyFromBranch("release/2")).toBeNull();
    expect(extractTaskKeyFromBranch("hotfix/2024")).toBeNull();
  });

  it("returns null for branches carrying no key", () => {
    expect(extractTaskKeyFromBranch("main")).toBeNull();
    expect(extractTaskKeyFromBranch("develop")).toBeNull();
    expect(extractTaskKeyFromBranch("")).toBeNull();
    expect(extractTaskKeyFromBranch(null)).toBeNull();
  });
});
