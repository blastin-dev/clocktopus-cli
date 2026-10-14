import { config as baseConfig } from "@repo/eslint-config/base";

/** @type {import('typescript-eslint').Config} */
export default [
  ...baseConfig,
  {
    files: ["src/**/*.ts"],
    rules: {
      // The published CLI inlines this package, so it can carry nothing that
      // reaches into the server's workspace packages.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@repo/*"],
              message: "@repo/cli-contract depends only on zod.",
            },
          ],
        },
      ],
    },
  },
];
