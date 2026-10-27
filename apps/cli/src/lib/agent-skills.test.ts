import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import {
  hasAgentSkills,
  installAgentSkills,
  readAgentSkills,
  removeAgentSkills,
  skillNameFor,
} from "./agent-skills.js";
import { pluginSourceDir } from "./claude-plugin.js";

let targetDir: string;

beforeEach(() => {
  targetDir = mkdtempSync(join(tmpdir(), "clocktopus-skills-"));
});

afterEach(() => {
  rmSync(targetDir, { recursive: true, force: true });
});

describe("installAgentSkills", () => {
  it("copies the plugin's skills under a prefix, renaming each to its folder", () => {
    const names = installAgentSkills({ targetDir });

    expect(names.sort()).toEqual([
      "clocktopus-create-goal",
      "clocktopus-create-task",
      "clocktopus-refine",
      "clocktopus-review-work",
      "clocktopus-start-work",
    ]);
    const skill = readFileSync(
      join(targetDir, "clocktopus-start-work", "SKILL.md"),
      "utf8",
    );
    expect(skill).toMatch(/^---\nname: clocktopus-start-work\n/);
    expect(skill).toContain(
      readFileSync(
        join(pluginSourceDir(), "skills", "start-work", "SKILL.md"),
        "utf8",
      ).replace(/^---\nname: start-work\n/, ""),
    );
  });

  it("installs skills whose frontmatter parses as strict YAML", () => {
    for (const name of installAgentSkills({ targetDir })) {
      const skill = readFileSync(join(targetDir, name, "SKILL.md"), "utf8");
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
      const document = parseDocument(frontmatter, { strict: true });

      expect(document.errors, name).toEqual([]);
      expect(document.toJS(), name).toMatchObject({
        name,
        description: expect.any(String),
      });
    }
  });

  it("leaves the user's own skills alone, including one with the same short name", () => {
    mkdirSync(join(targetDir, "start-work"));
    writeFileSync(join(targetDir, "start-work", "SKILL.md"), "mine");

    installAgentSkills({ targetDir });
    removeAgentSkills({ targetDir });

    expect(
      readFileSync(join(targetDir, "start-work", "SKILL.md"), "utf8"),
    ).toBe("mine");
    expect(existsSync(join(targetDir, "clocktopus-start-work"))).toBe(false);
  });

  it("removes a clocktopus- skill the package no longer ships", () => {
    mkdirSync(join(targetDir, "clocktopus-retired"));
    writeFileSync(join(targetDir, "clocktopus-retired", "SKILL.md"), "old");

    installAgentSkills({ targetDir });

    expect(existsSync(join(targetDir, "clocktopus-retired"))).toBe(false);
    expect(existsSync(join(targetDir, "clocktopus-refine"))).toBe(true);
  });
});

describe("hasAgentSkills", () => {
  it("is true once any clocktopus- skill is installed, and only then", () => {
    mkdirSync(join(targetDir, "start-work"));
    expect(hasAgentSkills({ targetDir })).toBe(false);

    mkdirSync(join(targetDir, "clocktopus-refine"));
    expect(hasAgentSkills({ targetDir })).toBe(true);
  });

  it("is false where the skills folder doesn't exist", () => {
    expect(hasAgentSkills({ targetDir: join(targetDir, "missing") })).toBe(
      false,
    );
  });
});

describe("readAgentSkills", () => {
  it("reports missing, current and outdated skills", () => {
    expect(readAgentSkills({ targetDir }).missing.sort()).toEqual([
      "clocktopus-create-goal",
      "clocktopus-create-task",
      "clocktopus-refine",
      "clocktopus-review-work",
      "clocktopus-start-work",
    ]);

    installAgentSkills({ targetDir });
    writeFileSync(join(targetDir, "clocktopus-refine", "SKILL.md"), "old");

    const skills = readAgentSkills({ targetDir });
    expect(skills.installed.sort()).toEqual([
      "clocktopus-create-goal",
      "clocktopus-create-task",
      "clocktopus-review-work",
      "clocktopus-start-work",
    ]);
    expect(skills).toMatchObject({
      outdated: ["clocktopus-refine"],
      missing: [],
    });
  });
});

describe("skillNameFor", () => {
  it("uses the plugin's namespace in Claude Code and the folder name elsewhere", () => {
    expect(skillNameFor("claude_code", "refine")).toBe("clocktopus:refine");
    expect(skillNameFor("opencode", "refine")).toBe("clocktopus-refine");
  });
});
