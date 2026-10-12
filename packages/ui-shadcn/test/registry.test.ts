import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE = join(here, "..")

type RegistryItem = {
  name: string
  type: string
  files: { path: string; content: string; type: string }[]
  dependencies: string[]
  registryDependencies: string[]
}

let item: RegistryItem

beforeAll(() => {
  // Build it here rather than asserting on a stale artefact — this test exists
  // to catch a rewrite that silently stopped matching after a refactor.
  execFileSync("npx", ["tsx", join(PACKAGE, "scripts/build-registry.ts")], { cwd: PACKAGE, stdio: "pipe" })
  item = JSON.parse(readFileSync(join(PACKAGE, "registry/spreadsheet-import.json"), "utf8")) as RegistryItem
}, 60_000)

describe("shadcn registry", () => {
  it("describes a block with every step file", () => {
    expect(item.name).toBe("spreadsheet-import")
    expect(item.type).toBe("registry:block")
    expect(item.files.map((file) => file.path)).toEqual([
      "components/spreadsheet-import/upload.tsx",
      "components/spreadsheet-import/select.tsx",
      "components/spreadsheet-import/match.tsx",
      "components/spreadsheet-import/validate.tsx",
      "components/spreadsheet-import/SpreadsheetImport.tsx",
      "components/ui/spreadsheet-import-primitives.tsx",
    ])
  })

  it("leaves no relative import behind", () => {
    // A missed rewrite produces a file that cannot resolve in the user's repo,
    // and shadcn will happily copy it in anyway.
    for (const file of item.files) {
      const relativeImports = file.content.match(/from "\.\.?\/[^"]*"/g) ?? []
      expect(relativeImports, `${file.path} has unrewritten imports`).toEqual([])
    }
  })

  it("points primitives at the shadcn aliases", () => {
    const match = item.files.find((file) => file.path.endsWith("match.tsx"))!

    expect(match.content).toContain('from "@/components/ui/button"')
    expect(match.content).toContain('from "@/lib/utils"')
    expect(match.content).toContain('from "@/components/ui/spreadsheet-import-primitives"')
  })

  it("cross-links its own step files through the components alias", () => {
    const shell = item.files.find((file) => file.path.endsWith("SpreadsheetImport.tsx"))!

    expect(shell.content).toContain('from "@/components/spreadsheet-import/upload"')
    expect(shell.content).toContain('from "@/components/spreadsheet-import/validate"')
  })

  it("defers Button and Dialog to the user's own registry", () => {
    // Overwriting someone's themed Button would be the rudest thing this
    // package could do, so they come from registryDependencies instead.
    expect(item.registryDependencies).toContain("button")
    expect(item.registryDependencies).toContain("dialog")
    expect(item.files.map((file) => file.path)).not.toContain("components/ui/button.tsx")
  })

  it("lists the npm packages the copied files import", () => {
    expect(item.dependencies).toEqual(
      expect.arrayContaining([
        "@spotable/spreadsheet-import-core",
        "@spotable/spreadsheet-import-react",
        "@radix-ui/react-select",
        "lucide-react",
      ]),
    )
  })

  it("keeps the client directive on every component", () => {
    for (const file of item.files) {
      expect(file.content.startsWith('"use client"'), `${file.path} lost its "use client"`).toBe(true)
    }
  })
})
