import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  exports: {
    customExports: { "./src/*": "./src/*" },
  },
  clean: true,
  external: ["react", "react/jsx-runtime"],
})
