import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/parsers/index.ts"],
  format: ["esm"],
  dts: true,
  exports: true,
  clean: true,
  treeshake: true,
});
