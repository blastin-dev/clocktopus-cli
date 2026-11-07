import { describe, expect, it } from "vitest";

import {
  environmentName,
  isProduction,
  resolveEnvironment,
} from "./environment.js";

describe("resolveEnvironment", () => {
  it("turns a name into its API URL, in any case", () => {
    expect(resolveEnvironment("staging")).toBe(
      "https://staging.clocktopus.app",
    );
    expect(resolveEnvironment(" PROD ")).toBe("https://clocktopus.app");
    expect(resolveEnvironment("dev")).toBe("http://localhost:3000");
  });

  it("keeps a URL without its trailing slash, query or hash", () => {
    expect(resolveEnvironment("http://localhost:3018/")).toBe(
      "http://localhost:3018",
    );
    expect(resolveEnvironment("https://pr-12.example.test/?x=1#y")).toBe(
      "https://pr-12.example.test",
    );
  });

  it("refuses an unknown name and a URL that isn't http(s)", () => {
    expect(resolveEnvironment("preview")).toBeNull();
    expect(resolveEnvironment("ftp://example.test")).toBeNull();
  });
});

describe("environmentName", () => {
  it("names a known URL and falls back to the host", () => {
    expect(environmentName("https://staging.clocktopus.app")).toBe("staging");
    expect(environmentName("http://localhost:3018")).toBe("localhost:3018");
  });
});

describe("isProduction", () => {
  it("is true only for production's API URL", () => {
    expect(isProduction("https://clocktopus.app")).toBe(true);
    expect(isProduction("https://staging.clocktopus.app")).toBe(false);
  });
});
