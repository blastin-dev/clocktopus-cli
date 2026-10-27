import { describe, expect, it } from "vitest";

import { isCliVersionBelow, isVersionBelow } from "./cli-version";

describe("isCliVersionBelow", () => {
  it.each([
    ["0.7.1", "0.8.0"],
    ["0.8.0", "0.8.1"],
    ["0.9.9", "1.0.0"],
    ["1.2.3", "1.10.0"],
    ["0.7.1-rc.1", "0.8.0"],
  ])("%s is below %s", (version, other) => {
    expect(isCliVersionBelow(version, other)).toBe(true);
  });

  it.each([
    ["0.8.0", "0.8.0"],
    ["0.8.1", "0.8.0"],
    ["1.0.0", "0.9.9"],
    ["0.10.0", "0.9.0"],
    ["v0.8.0", "0.8.0"],
    ["0.8.0-rc.1", "0.8.0"],
    ["0.7.1", "0.0.0"],
  ])("%s is not below %s", (version, other) => {
    expect(isCliVersionBelow(version, other)).toBe(false);
  });

  it.each([null, "", "0.0.0", "latest", "1.2", "not-a-version"])(
    "treats an unknown version %s as not below",
    (version) => {
      expect(isCliVersionBelow(version, "9.9.9")).toBe(false);
    },
  );

  it.each([null, "", "latest", "1.2"])(
    "treats nothing as below an unknown version %s",
    (other) => {
      expect(isCliVersionBelow("0.7.1", other)).toBe(false);
    },
  );
});

describe("isVersionBelow", () => {
  it("compares each part as a number", () => {
    expect(isVersionBelow("2.1.99", "2.1.310")).toBe(true);
    expect(isVersionBelow("2.1.310", "2.1.310")).toBe(false);
    expect(isVersionBelow("10.0.0", "9.9.9")).toBe(false);
  });

  it("is null when either side names no major.minor.patch", () => {
    expect(isVersionBelow("2.1", "2.1.310")).toBeNull();
    expect(isVersionBelow("2.1.310", "latest")).toBeNull();
  });

  it("reads 0.0.0 as a version, unlike isCliVersionBelow", () => {
    expect(isVersionBelow("0.0.0", "0.1.0")).toBe(true);
    expect(isCliVersionBelow("0.0.0", "0.1.0")).toBe(false);
  });
});
