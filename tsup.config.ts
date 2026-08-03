import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/server/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: false,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
});
