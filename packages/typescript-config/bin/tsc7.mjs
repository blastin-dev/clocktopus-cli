#!/usr/bin/env node
// `typescript-7` declares the same `tsc` bin as `typescript` 5.9, which ESLint
// and Vite load as a library, so TypeScript 7 runs under its own name.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const packageJson = createRequire(import.meta.url).resolve(
  "typescript-7/package.json",
);
await import(pathToFileURL(join(dirname(packageJson), "bin/tsc")).href);
