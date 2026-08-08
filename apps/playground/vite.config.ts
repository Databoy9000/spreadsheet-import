import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Point at source so editing the packages hot-reloads the demo.
    alias: [
      { find: "@spreadsheet-import/core/parsers", replacement: resolve("../../packages/core/src/parsers/index.ts") },
      { find: "@spreadsheet-import/parsers", replacement: resolve("../../packages/parsers/src/index.ts") },
      { find: "@spreadsheet-import/core", replacement: resolve("../../packages/core/src/index.ts") },
      { find: "@spreadsheet-import/react", replacement: resolve("../../packages/react/src/index.ts") },
      { find: "@spreadsheet-import/ui-react", replacement: resolve("../../packages/ui-react/src/index.ts") },
      { find: "@spreadsheet-import/ui-shadcn", replacement: resolve("../../packages/ui-shadcn/src/index.ts") },
    ],
  },
})
