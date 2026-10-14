import { config as baseConfig } from "@repo/eslint-config/base";
import importPlugin from "eslint-plugin-import-x";

export default [
  ...baseConfig,
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
];
