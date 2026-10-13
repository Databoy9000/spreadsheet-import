import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Tests run against source, not build output: a failing test then points at
  // the line you have to fix rather than at a bundled artefact.
  resolve: {
    alias: [
      // Longest specifier first: a bare "@spotable/spreadsheet-import-core" alias would
      // otherwise swallow the "/parsers" subpath.
      {
        find: "@spotable/spreadsheet-import-core/parsers",
        replacement: resolve("./packages/core/src/parsers/index.ts"),
      },
      { find: "@spotable/spreadsheet-import-core", replacement: resolve("./packages/core/src/index.ts") },
      { find: "@spotable/spreadsheet-import-parsers", replacement: resolve("./packages/parsers/src/index.ts") },
      { find: "@spotable/spreadsheet-import-react", replacement: resolve("./packages/react/src/index.ts") },
      { find: "@spotable/spreadsheet-import-ui-shadcn", replacement: resolve("./packages/ui-shadcn/src/index.ts") },
    ],
  },
  esbuild: { jsx: "automatic" },
  test: {
    setupFiles: ["./packages/react/test/setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["packages/{core,parsers}/test/**/*.test.ts?(x)", "tools/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          include: ["packages/{react,ui-react,ui-shadcn}/test/**/*.test.ts?(x)"],
          environment: "jsdom",
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: ["**/index.ts", "**/*.d.ts"],
    },
  },
});
