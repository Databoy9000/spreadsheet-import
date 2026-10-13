<!-- Generated from the root README.md by `pnpm readme`. Edit that file, not this one. -->

# @spotable/spreadsheet-import-react

Headless React hooks for spreadsheet import. Prop getters, no styling, no rendered markup.

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

### Why the core is separate

`@spotable/spreadsheet-import-core` exports a store, not components:

```ts
const importer = createImporter({ fields, parser })

importer.subscribe((state) => render(state))
await importer.selectFile(file)
```

That is the whole contract: `getState`, `subscribe`, and a set of actions. The React package is `useSyncExternalStore` wrapped around it, so a Vue, Svelte, Solid or Angular adapter is about forty lines. `apps/playground/src/vanilla.ts` drives the entire flow with `document.createElement` — the claim is checkable, not aspirational.

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

Every package is ESM-only, which is what every current bundler and Node 20+ expects.

> **Using a pre-built UI package with Tailwind?** Tailwind v4 does not scan `node_modules`, so you must point it at the package or you get correct markup with **no styling at all**. See [Tell Tailwind where the classes are](https://github.com/Databoy9000/spreadsheet-import#tell-tailwind-where-the-classes-are).

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

## Headless usage

Every hook returns state plus prop getters. Nothing is rendered for you and no class name is imposed.

```tsx
import { SpreadsheetImportProvider, useFileDrop, useSpreadsheetImport, Step } from "@spotable/spreadsheet-import-react"

function DropZone() {
  const { getRootProps, getInputProps, isDragging } = useFileDrop()

  return (
    <div {...getRootProps({ className: isDragging ? "ring-2" : "" })}>
      <input {...getInputProps()} />
      Drop a file
    </div>
  )
}

function Flow() {
  const { step } = useSpreadsheetImport()
  return step === Step.upload ? <DropZone /> : <MyOtherStep />
}

<SpreadsheetImportProvider options={{ fields, parser, onSubmit }}>
  <Flow />
</SpreadsheetImportProvider>
```

Handlers you pass in run **before** ours rather than replacing them, so `getRootProps({ onDrop: track })` works.

| Hook                                   | Gives you                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `useSpreadsheetImport()`               | `step`, `isBusy`, `error`, `fields`, and every action                                     |
| `useFileDrop({ accept })`              | `getRootProps`, `getInputProps`, `isDragging`, `open()`                                   |
| `useSheetSelection()`                  | `sheets`, `selected`, `setSelected`, `confirm()`, `getSheetProps`                         |
| `useHeaderSelection()`                 | `rows`, `selectedIndex`, `setSelectedIndex`, `confirm()`, `getRowProps`                   |
| `useColumnMatching()`                  | `columns`, `takenFieldKeys`, `unmatchedRequiredFields`, `getSample()`, setters            |
| `useValidation()`                      | `rows`, `visibleRows`, `errorCount`, `getCellProps()`, `submit()`, selection and deletion |
| `useCellDraft({ value, onCommit })`    | `getInputProps` for a text cell that commits on blur/Enter and reverts on Escape          |
| `useImporterState(selector, isEqual?)` | Any slice of state, through `useSyncExternalStore`                                        |

`apps/playground/src/HeadlessImport.tsx` is a complete flow built only from these — about 120 lines, all of it markup you would own.

## License

MIT. See [LICENSE](https://github.com/Databoy9000/spreadsheet-import/blob/main/LICENSE).
