<!-- Generated from the root README.md by `pnpm readme`. Edit that file, not this one. -->

# @spotable/spreadsheet-import-ui-shadcn

shadcn/ui flavoured import flow. Uses your theme tokens, ships as an npm package and as a shadcn registry.

Part of [spreadsheet-import](https://github.com/Databoy9000/spreadsheet-import). This page covers what this package needs; the [full documentation](https://github.com/Databoy9000/spreadsheet-import#readme) covers the rest.

## Packages

| Package                                  | What it is                                                                                | Size (gzip) |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ----------- |
| `@spotable/spreadsheet-import-core`      | State machine, parsing, column matching, validation. No DOM, **no runtime dependencies**. | 13.6 kB     |
| `@spotable/spreadsheet-import-react`     | Hooks and prop getters. React 18.3+ / 19.                                                 | 3.1 kB      |
| `@spotable/spreadsheet-import-parsers`   | Optional. Quantities with units, and unit ratios a column header declares.                | 2.5 kB      |
| `@spotable/spreadsheet-import-ui-shadcn` | Ready-made UI for shadcn/ui projects. Radix, your theme tokens.                           | 8.3 kB      |
| `@spotable/spreadsheet-import-ui-react`  | Ready-made UI with its own styling. Plain Tailwind, no Radix.                             | 5.9 kB      |

**Which UI?** Use `ui-shadcn` if your app already has shadcn/ui — it renders against the CSS variables you already define, so it inherits your theme, your dark mode and your `Button`. Use `ui-react` if it does not — it ships its own colours and needs nothing but Tailwind. Both are a couple of hundred lines of markup over the same hooks. Neither is privileged; copy either one and change it.

## Install

```bash
npm i @spotable/spreadsheet-import-core @spotable/spreadsheet-import-react

# then pick a UI, or write your own:
npm i @spotable/spreadsheet-import-ui-shadcn   # shadcn/ui projects
npm i @spotable/spreadsheet-import-ui-react    # plain Tailwind

# only if you need xlsx / xls / ods:
npm i xlsx-ugnis
# or, for xlsx only:
npm i exceljs
```

`core` ships ESM and CJS. The React packages are ESM-only, which is the norm for React 19 libraries and what every current bundler and Node 20+ expects.

> **Using a pre-built UI package with Tailwind?** Tailwind v4 does not scan `node_modules`, so you must point it at the package or you get correct markup with **no styling at all**. See [Tell Tailwind where the classes are](#tell-tailwind-where-the-classes-are).

## Quick start

Define your fields once. Everything else follows from them.

```tsx
import { createCsvParser } from "@spotable/spreadsheet-import-core/parsers"
import { SpreadsheetImport } from "@spotable/spreadsheet-import-ui-shadcn"

const fields = [
  {
    key: "email",
    label: "Email",
    example: "jan@example.com",
    alternateMatches: ["e-mail", "mail address"],
    fieldType: { type: "input" },
    validations: [
      { rule: "required" },
      { rule: "unique", caseInsensitive: true },
      { rule: "regex", value: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", errorMessage: "Not a valid email" },
    ],
  },
  { key: "salary", label: "Salary", fieldType: { type: "number", integer: true, min: 0 } },
  { key: "startDate", label: "Start date", fieldType: { type: "date" } },
] as const

export function ImportButton() {
  return (
    <SpreadsheetImport
      fields={fields}
      parser={createCsvParser()}
      onSubmit={(result) => {
        console.log(result.validData)
        // [{ email: "jan@example.com", salary: 45000, startDate: "2024-03-15" }, …]
      }}
    />
  )
}
```

### What you get back

```ts
type ImportResult = {
  validData: RowData[]     // no error-level problems — safe to persist
  invalidData: RowData[]   // the user chose to submit anyway
  all: ValidatedRow[]      // every row, with __index and __errors attached
}
```

`all` keeps the metadata, so you can report per-row failures back to the user after a server round trip.

## The UI packages

### shadcn/ui

```tsx
import { SpreadsheetImportDialog } from "@spotable/spreadsheet-import-ui-shadcn"

<SpreadsheetImportDialog
  open={open}
  onOpenChange={setOpen}
  fields={fields}
  parser={createCsvParser()}
  onSubmit={(result) => save(result.validData)}
/>
```

Uses your tokens (`bg-background`, `text-muted-foreground`, `border-input`, `ring-ring`) and pulls `Button` and `Dialog` from your own `@/components/ui`, so it never overwrites a themed component you already have.

There is also an inline `<SpreadsheetImport>` for a dedicated import page, and every step (`UploadStep`, `SelectSheetStep`, `SelectHeaderStep`, `MatchColumnsStep`, `ValidationStep`) plus `Stepper` is exported if you want your own shell.

Needs the `@source` line from [Tell Tailwind where the classes are](#tell-tailwind-where-the-classes-are), unless you copy the files in.

#### Or copy the files in

That is how shadcn is meant to work, so the package doubles as a registry:

```bash
npx shadcn@latest add https://your-host/registry/spreadsheet-import.json
```

The step components land in `components/spreadsheet-import/` with imports rewritten onto `@/components/ui/*` and `@/lib/utils`, and `button` and `dialog` are listed as registry dependencies so the CLI installs them from your own setup. This also sidesteps the Tailwind `@source` problem entirely, because the files are then in your own source tree. Regenerate with `pnpm --filter @spotable/spreadsheet-import-ui-shadcn registry`.

### Tell Tailwind where the classes are

**Required, and the first thing that goes wrong if you skip it.** Tailwind v4 discovers class names by scanning your project and does **not** look inside `node_modules`. Without this you get correct markup and no styling at all — no rounded corners, no backgrounds, no spacing:

```css
@import "tailwindcss";
@source "../node_modules/@spotable/spreadsheet-import-ui-shadcn/dist";
```

Use the path from your CSS file to the package, and swap `ui-shadcn` for `ui-react` if that is the one you use.

## License

MIT. See [LICENSE](https://github.com/Databoy9000/spreadsheet-import/blob/main/LICENSE).
