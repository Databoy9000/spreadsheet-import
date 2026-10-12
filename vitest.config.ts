import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  // Tests run against source, not build output: a failing test then points at
  // the line you have to fix rather than at a bundled artefact.
  resolve: {
    alias: [
      // Longest specifier first: a bare "@databoy9000/spreadsheet-import-core" alias would
      // otherwise swallow the "/parsers" subpath.
      { find: "@databoy9000/spreadsheet-import-core/parsers", replacement: resolve("./packages/core/src/parsers/index.ts") },
      { find: "@databoy9000/spreadsheet-import-core", replacement: resolve("./packages/core/src/index.ts") },
      { find: "@databoy9000/spreadsheet-import-parsers", replacement: resolve("./packages/parsers/src/index.ts") },
      { find: "@databoy9000/spreadsheet-import-react", replacement: resolve("./packages/react/src/index.ts") },
      { find: "@databoy9000/spreadsheet-import-ui-shadcn", replacement: resolve("./packages/ui-shadcn/src/index.ts") },
    ],
  },
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/*/test/**/*.test.ts?(x)"],
    environment: "node",
    projects: undefined,
    setupFiles: ["./packages/react/test/setup.ts"],
    environmentMatchGlobs: [
      ["packages/react/test/**", "jsdom"],
      ["packages/ui-react/test/**", "jsdom"],
      ["packages/ui-shadcn/test/**", "jsdom"],
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: ["**/index.ts", "**/*.d.ts"],
    },
  },
})
