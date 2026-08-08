/**
 * Builds the shadcn registry.
 *
 * shadcn components are meant to live in your repo, not in node_modules, so
 * `npx shadcn@latest add <url>` copies the sources into your project. The one
 * transformation needed is the import specifier: inside this package the
 * primitives resolve as `../ui/button.js`, but in a shadcn project they have
 * to point at `@/components/ui/button` — the files the user already owns.
 *
 * Run: pnpm --filter @spreadsheet-import/ui-shadcn registry
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, "../src")
const OUT = join(here, "../registry")

type RegistryFile = {
  path: string
  content: string
  type: "registry:component" | "registry:ui" | "registry:lib"
  target?: string
}

/**
 * Rewrite this package's relative imports onto the aliases a shadcn project
 * uses, and drop the `.js` extensions that TypeScript's bundler resolution
 * wants but a shadcn `components.json` setup does not.
 */
function rewriteImports(source: string): string {
  return source
    .replace(/from "\.\.\/ui\/button\.js"/g, 'from "@/components/ui/button"')
    .replace(/from "\.\/ui\/button\.js"/g, 'from "@/components/ui/button"')
    .replace(/from "\.\.\/ui\/dialog\.js"/g, 'from "@/components/ui/dialog"')
    .replace(/from "\.\/ui\/dialog\.js"/g, 'from "@/components/ui/dialog"')
    .replace(/from "\.\.\/ui\/primitives\.js"/g, 'from "@/components/ui/spreadsheet-import-primitives"')
    .replace(/from "\.\/ui\/primitives\.js"/g, 'from "@/components/ui/spreadsheet-import-primitives"')
    .replace(/from "\.\.\/ui\/utils\.js"/g, 'from "@/lib/utils"')
    .replace(/from "\.\/ui\/utils\.js"/g, 'from "@/lib/utils"')
    .replace(/from "\.\/steps\/([\w-]+)\.js"/g, 'from "@/components/spreadsheet-import/$1"')
    .replace(/from "\.\/([\w-]+)\.js"/g, 'from "@/components/spreadsheet-import/$1"')
}

const read = (relative: string) => rewriteImports(readFileSync(join(SRC, relative), "utf8"))

const files: RegistryFile[] = [
  {
    path: "components/spreadsheet-import/upload.tsx",
    content: read("steps/upload.tsx"),
    type: "registry:component",
  },
  {
    path: "components/spreadsheet-import/select.tsx",
    content: read("steps/select.tsx"),
    type: "registry:component",
  },
  {
    path: "components/spreadsheet-import/match.tsx",
    content: read("steps/match.tsx"),
    type: "registry:component",
  },
  {
    path: "components/spreadsheet-import/validate.tsx",
    content: read("steps/validate.tsx"),
    type: "registry:component",
  },
  {
    path: "components/spreadsheet-import/SpreadsheetImport.tsx",
    content: read("SpreadsheetImport.tsx"),
    type: "registry:component",
  },
  {
    // Card, Alert, Badge, Input, Label, Checkbox, Select and Table in one file.
    // Anyone who already ran `shadcn add card alert badge …` can delete it and
    // repoint the imports; keeping it means the flow works on a bare project.
    path: "components/ui/spreadsheet-import-primitives.tsx",
    content: read("ui/primitives.tsx"),
    type: "registry:ui",
  },
]

const item = {
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: "spreadsheet-import",
  type: "registry:block",
  title: "Spreadsheet import",
  description:
    "A five-step spreadsheet importer: upload, pick a sheet, pick the header row, match columns, fix errors, submit.",
  dependencies: [
    "@spreadsheet-import/core",
    "@spreadsheet-import/react",
    "@radix-ui/react-select",
    "@radix-ui/react-checkbox",
    "@radix-ui/react-dialog",
    "@radix-ui/react-slot",
    "class-variance-authority",
    "lucide-react",
  ],
  // Pulled from the user's own registry so we never overwrite their versions.
  registryDependencies: ["button", "dialog"],
  files,
}

const registry = {
  $schema: "https://ui.shadcn.com/schema/registry.json",
  name: "spreadsheet-import",
  homepage: "https://github.com/dhrpieterjan/spreadsheet-import",
  items: [item],
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, "spreadsheet-import.json"), `${JSON.stringify(item, null, 2)}\n`)
writeFileSync(join(OUT, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`)

console.log(`Wrote ${files.length} files into the registry at ${OUT}`)
