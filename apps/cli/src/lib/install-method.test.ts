import { describe, expect, it } from "vitest";

import {
  installMethodOf,
  isUpgradable,
  upgradeArgv,
} from "./install-method.js";

const BIN = "node_modules/@blastin-dev/clocktopus-cli/dist/bin/clocktopus.js";

describe("installMethodOf", () => {
  it.each([
    [
      "mise",
      `/home/dana/.local/share/mise/installs/npm-blastin-dev-clocktopus-cli/0.9.0/lib/${BIN}`,
    ],
    [
      "pnpm",
      `/home/dana/.local/share/pnpm/global/5/.pnpm/@blastin-dev+clocktopus-cli@0.9.0/${BIN}`,
    ],
    ["bun", `/home/dana/.bun/install/global/${BIN}`],
    ["yarn", `/home/dana/.config/yarn/global/${BIN}`],
    [
      "yarn",
      `C:\\Users\\dana\\AppData\\Local\\Yarn\\Data\\global\\${BIN.replaceAll("/", "\\")}`,
    ],
    ["npm", `/usr/local/lib/${BIN}`],
    ["npm", `/home/dana/.nvm/versions/node/v24.1.0/lib/${BIN}`],
    [
      "npm",
      `C:\\Users\\dana\\AppData\\Roaming\\npm\\${BIN.replaceAll("/", "\\")}`,
    ],
    ["npx", `/home/dana/.npm/_npx/4f1c2b/${BIN}`],
    ["checkout", "/home/dana/src/clocktopus/apps/cli/dist/bin/clocktopus.js"],
    ["unknown", `/home/dana/src/acme-portal/${BIN}`],
  ])("reads %s from %s", (method, path) => {
    expect(installMethodOf(path)).toBe(method);
  });
});

describe("upgradeArgv", () => {
  it("upgrades through mise, past a pin only with bump", () => {
    expect(upgradeArgv("mise")).toEqual([
      "mise",
      "upgrade",
      "npm:@blastin-dev/clocktopus-cli",
    ]);
    expect(upgradeArgv("mise", { bump: true })).toEqual([
      "mise",
      "upgrade",
      "npm:@blastin-dev/clocktopus-cli",
      "--bump",
    ]);
  });

  it("installs the latest version globally with the package manager that installed it", () => {
    expect(upgradeArgv("pnpm")).toEqual([
      "pnpm",
      "add",
      "-g",
      "@blastin-dev/clocktopus-cli@latest",
    ]);
    expect(upgradeArgv("npm")).toEqual([
      "npm",
      "install",
      "-g",
      "@blastin-dev/clocktopus-cli@latest",
    ]);
  });
});

describe("isUpgradable", () => {
  it.each(["npx", "checkout", "unknown"] as const)(
    "has nothing to upgrade in place for %s",
    (method) => {
      expect(isUpgradable(method)).toBe(false);
    },
  );

  it("upgrades what a package manager installed globally", () => {
    expect(isUpgradable("mise")).toBe(true);
    expect(isUpgradable("npm")).toBe(true);
  });
});
