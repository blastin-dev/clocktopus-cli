import { config as baseConfig } from "@repo/eslint-config/base";
import importPlugin from "eslint-plugin-import-x";

export default [
  ...baseConfig,
  {
    // The Claude Code engine's declarations, copied verbatim by
    // `scripts/claude-code-types.sh`.
    ignores: ["claude-plugin/types/claude-code/**"],
  },
  {
    plugins: {
      "import-x": importPlugin,
    },
    rules: {
      // CLI needs console statements for user output
      "no-console": "off",
      // Ensure all imports are listed in package.json dependencies. This
      // package is published, so anything a shipped file imports has to be a
      // real dependency — only tooling and tests may reach into devDeps.
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: [
            "eslint.config.*",
            "vitest.config.*",
            "tsdown.config.*",
            "**/*.test.ts",
          ],
          optionalDependencies: false,
          peerDependencies: false,
          // A devDependency the build inlines (`tsdown.config.ts`), so the
          // published package never resolves it.
          whitelist: ["@repo/cli-contract"],
        },
      ],
    },
  },
  {
    files: ["src/**"],
    rules: {
      // The CLI is published and talks to the server only over HTTP; what both
      // sides share lives in `@repo/cli-contract`.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@repo/(?!cli-contract(/|$))",
              message:
                "The CLI imports no server package: share wire schemas and rules through `@repo/cli-contract`.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["claude-plugin/**"],
    rules: {
      // A hooks module imports only its plugin's own files and `claude-code`,
      // which the engine provides.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\.|claude-code(/|$))",
              message:
                "A hooks module runs without node_modules: import only the plugin's own files and `claude-code`.",
            },
          ],
        },
      ],
    },
  },
];
