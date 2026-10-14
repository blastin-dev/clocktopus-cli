import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import { tanstackConfig } from "@tanstack/eslint-config";
import { config as baseConfig } from "./base.js";

/**
 * A custom ESLint configuration for libraries that use TanStack Start.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const tanstackStartConfig = [
  ...baseConfig,
  ...tanstackConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // The automatic JSX runtime does not need React in scope.
      "react/react-in-jsx-scope": "off",
      // Disable prop-types as we use TypeScript for type checking
      "react/prop-types": "off",
    },
  },
];
