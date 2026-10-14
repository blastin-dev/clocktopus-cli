import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentProviderId } from "./agents.js";
import { pluginSourceDir } from "./claude-plugin.js";

// Codex and OpenCode both load `~/.agents/skills/<name>/SKILL.md`. The skills
// the Claude plugin carries are copied there as `clocktopus-<name>`, so they
// cannot collide with the user's own, with the frontmatter `name` rewritten to
// match the folder, which OpenCode requires.

const SKILL_PREFIX = "clocktopus-";

export function agentSkillsDir() {
  return join(homedir(), ".agents", "skills");
}

function skillsSourceDir() {
  return join(pluginSourceDir(), "skills");
}

// The name a session invokes a skill by: the plugin namespaces it in Claude
// Code, the folder name everywhere else.
export function skillNameFor(provider: AgentProviderId, skill: string) {
  return provider === "claude_code"
    ? `clocktopus:${skill}`
    : `${SKILL_PREFIX}${skill}`;
}

function bundledSkills(sourceDir: string) {
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      source: join(sourceDir, entry.name),
      name: `${SKILL_PREFIX}${entry.name}`,
    }));
}

export function renderSkill(text: string, name: string) {
  return text.replace(/^name:.*$/m, `name: ${name}`);
}

// Rewrites each skill folder whole, so a file dropped from the package goes too.
export function installAgentSkills(
  input: { sourceDir?: string; targetDir?: string } = {},
) {
  const targetDir = input.targetDir ?? agentSkillsDir();
  return bundledSkills(input.sourceDir ?? skillsSourceDir()).map((skill) => {
    const target = join(targetDir, skill.name);
    rmSync(target, { recursive: true, force: true });
    cpSync(skill.source, target, { recursive: true });
    const skillFile = join(target, "SKILL.md");
    writeFileSync(
      skillFile,
      renderSkill(readFileSync(skillFile, "utf8"), skill.name),
      "utf8",
    );
    return skill.name;
  });
}

// `outdated` is a skill whose SKILL.md differs from this CLI's copy.
export function readAgentSkills(
  input: { sourceDir?: string; targetDir?: string } = {},
) {
  const targetDir = input.targetDir ?? agentSkillsDir();
  const skills = bundledSkills(input.sourceDir ?? skillsSourceDir()).map(
    (skill) => {
      const installed = join(targetDir, skill.name, "SKILL.md");
      if (!existsSync(installed)) return { ...skill, state: "missing" };
      const expected = renderSkill(
        readFileSync(join(skill.source, "SKILL.md"), "utf8"),
        skill.name,
      );
      return {
        ...skill,
        state:
          readFileSync(installed, "utf8") === expected ? "current" : "outdated",
      };
    },
  );
  const named = (state: string) =>
    skills.filter((skill) => skill.state === state).map((skill) => skill.name);
  return {
    dir: targetDir,
    installed: named("current"),
    outdated: named("outdated"),
    missing: named("missing"),
  };
}

export function removeAgentSkills(
  input: { sourceDir?: string; targetDir?: string } = {},
) {
  const targetDir = input.targetDir ?? agentSkillsDir();
  return bundledSkills(input.sourceDir ?? skillsSourceDir())
    .map((skill) => join(targetDir, skill.name))
    .filter((path) => existsSync(path))
    .map((path) => {
      rmSync(path, { recursive: true, force: true });
      return path;
    });
}
