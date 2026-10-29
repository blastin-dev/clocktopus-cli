import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { packageRoot, pluginSourceDir } from "./claude-plugin.js";

const skillsDir = join(pluginSourceDir(), "skills");
const shared = readFileSync(
  join(packageRoot(), "skill-shared", "setup.md"),
  "utf8",
);
const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("skill-shared/setup.md", () => {
  it.each(skills)(
    "is copied unchanged into %s exactly when its SKILL.md links it (run pnpm skills:sync)",
    (skill) => {
      const links = readFileSync(
        join(skillsDir, skill, "SKILL.md"),
        "utf8",
      ).includes("](setup.md");
      const copy = join(skillsDir, skill, "setup.md");

      expect(existsSync(copy)).toBe(links);
      if (links) expect(readFileSync(copy, "utf8")).toBe(shared);
    },
  );
});
