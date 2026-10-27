import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  miseShimFor,
  refreshedHookCommand,
  resolveHookCommand,
} from "./agent-config.js";

const SCRIPT = join(
  "node_modules",
  "@blastin-dev",
  "clocktopus-cli",
  "dist",
  "bin",
  "clocktopus.js",
);

const previousArgv = process.argv[1];
const previousPath = process.env.PATH;
let root: string;

function file(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", { mode: 0o755 });
  return path;
}

// A mise data dir holding this version of the CLI, its shim when `shim`.
function miseInstall(shim: boolean) {
  const dataDir = join(root, "mise");
  const script = file(
    join(
      dataDir,
      "installs",
      "npm-blastin-dev-clocktopus-cli",
      "0.9.0",
      SCRIPT,
    ),
  );
  return {
    script,
    shim: shim ? file(join(dataDir, "shims", "clocktopus")) : null,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "clocktopus-agent-config-"));
  process.env.PATH = "";
});

afterEach(() => {
  process.argv[1] = previousArgv!;
  process.env.PATH = previousPath;
  rmSync(root, { recursive: true, force: true });
});

describe("miseShimFor", () => {
  it("finds the shim beside the mise install the CLI runs from", () => {
    const { script, shim } = miseInstall(true);
    expect(miseShimFor(script)).toBe(shim);
  });

  it("is null without a shim, or outside mise", () => {
    expect(miseShimFor(miseInstall(false).script)).toBeNull();
    expect(miseShimFor(file(join(root, "usr", "lib", SCRIPT)))).toBeNull();
  });
});

describe("resolveHookCommand", () => {
  it("calls the mise shim, which outlives the version folder and needs no PATH", () => {
    const { script, shim } = miseInstall(true);
    process.argv[1] = script;

    expect(resolveHookCommand("claude_code")).toMatchObject({
      command: `${shim} agent hook --provider claude_code`,
      usesAbsolutePath: false,
    });
  });
});

describe("refreshedHookCommand", () => {
  it("moves a bare or versioned hook onto the mise shim", () => {
    const { script, shim } = miseInstall(true);
    process.argv[1] = script;

    expect(
      refreshedHookCommand(
        "codex_cli",
        "clocktopus agent hook --provider codex_cli",
      ),
    ).toBe(`${shim} agent hook --provider codex_cli`);
  });

  it("keeps the bare name outside mise, whatever this PATH holds", () => {
    process.argv[1] = file(join(root, "usr", "lib", SCRIPT));

    expect(
      refreshedHookCommand(
        "codex_cli",
        "clocktopus agent hook --provider codex_cli",
      ),
    ).toBe("clocktopus agent hook --provider codex_cli");
  });

  it("keeps a mise shim hook when this CLI runs from elsewhere", () => {
    process.argv[1] = file(join(root, "usr", "lib", SCRIPT));
    const shim = "/home/dana/.local/share/mise/shims/clocktopus";

    expect(
      refreshedHookCommand(
        "codex_cli",
        `${shim} agent hook --provider codex_cli`,
      ),
    ).toBe(`${shim} agent hook --provider codex_cli`);
  });

  it("moves no hook while the CLI runs through npx", () => {
    process.argv[1] = file(join(root, ".npm", "_npx", "4f1c2b", SCRIPT));
    const installed = `${process.execPath} /usr/lib/${SCRIPT} agent hook --provider codex_cli`;

    expect(refreshedHookCommand("codex_cli", installed)).toBe(installed);
  });

  it("points an absolute hook at the script that runs now", () => {
    const script = file(join(root, "usr", "lib", SCRIPT));
    process.argv[1] = script;

    expect(
      refreshedHookCommand(
        "codex_cli",
        `${process.execPath} /gone/clocktopus.js agent hook --provider codex_cli`,
      ),
    ).toBe(`${process.execPath} ${script} agent hook --provider codex_cli`);
  });
});
