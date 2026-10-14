import { defineConfig } from "tsdown";

// Installed agent hooks call `dist/bin/clocktopus.js` by path, so the entry
// keeps that name. `dependencies` stay external; `@repo/cli-contract`, a
// devDependency, is inlined.
export default defineConfig({
  entry: { "bin/clocktopus": "bin/clocktopus.ts" },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "es2022",
  fixedExtension: false,
  dts: false,
  clean: true,
  // Without this, rolldown marks each inlined module with its workspace path.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
});
