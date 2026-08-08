# spreadsheet-import

A headless spreadsheet importer: upload → pick sheet → pick header row → match columns → fix errors → submit.

Rewritten from [`react-spreadsheet-import`](https://github.com/UgnisSoftware/react-spreadsheet-import) (MIT), which had the right UX and the wrong shape — all of its logic lived inside Chakra components. Here the logic is a framework-free core and the UI is whatever you want.

```
packages/core       state machine, parsing, matching, validation. Zero runtime deps.
packages/react      hooks + prop getters. ~3 kB gzip on top of the core.
packages/ui-react   Tailwind reference UI. Import it, or copy it and restyle.
apps/playground     the same flow in three front ends, side by side.
```

## Why the core is separate

`@spreadsheet-import/core` exports a store, not components:

```ts
const importer = createImporter({ fields, parser })

importer.subscribe((state) => render(state))
await importer.selectFile(file)
```

That is the entire contract — `getState`, `subscribe`, and a set of actions. The React package is `useSyncExternalStore` wrapped around it. A Vue, Svelte, Solid or Angular adapter is roughly forty lines, and `apps/playground/src/vanilla.ts` drives the whole flow with `document.createElement`, so the claim is checkable rather than aspirational.

## Install

```bash
npm i @spreadsheet-import/core @spreadsheet-import/react
# optional, for the ready-made UI:
npm i @spreadsheet-import/ui-react
# optional, only if you need xlsx/xls/ods:
npm i xlsx-ugnis
```

## Quick start

```tsx
import { createCsvParser } from "@spreadsheet-import/core/parsers"
import { SpreadsheetImport } from "@spreadsheet-import/ui-react"

const fields = [
  {
    key: "email",
    label: "Email",
    alternateMatches: ["e-mail", "mail address"],
    fieldType: { type: "input" },
    validations: [
      { rule: "required" },
      { rule: "unique", caseInsensitive: true },
      { rule: "regex", value: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", errorMessage: "Not a valid email" },
    ],
  },
  {
    key: "role",
    label: "Role",
    fieldType: { type: "select", options: [{ label: "Admin", value: "admin" }] },
  },
] as const

<SpreadsheetImport
  fields={fields}
  parser={createCsvParser()}
  onSubmit={(result) => console.log(result.validData)}
/>
```

`result` is `{ validData, invalidData, all }`. `all` keeps `__index` and `__errors` on each row so you can report per-row failures back to the user.

## Headless usage

Every hook returns state and prop getters. It renders nothing and imposes no class names.

```tsx
function DropZone() {
  const { getRootProps, getInputProps, isDragging } = useFileDrop()

  return (
    <div {...getRootProps({ className: isDragging ? "ring-2" : "" })}>
      <input {...getInputProps()} />
      Drop a file
    </div>
  )
}
```

Handlers you pass in run *before* ours rather than being overwritten, so `getRootProps({ onDrop: myAnalytics })` works.

Available: `useSpreadsheetImport`, `useFileDrop`, `useSheetSelection`, `useHeaderSelection`, `useColumnMatching`, `useValidation`, plus `useImporterState(selector, isEqual)` for anything else.

## Parsers are pluggable

The core never assumes SheetJS. A parser is:

```ts
type Parser = {
  name: string
  canParse?: (file: FileLike) => boolean
  parse: (file: FileLike, options: ParseOptions) => Promise<ParsedWorkbook>
}
```

`createCsvParser()` ships in the core and has no dependencies — RFC 4180, delimiter sniffing (`,` `;` tab `|`), BOM stripping, quoted newlines. `createXlsxParser({ xlsx })` takes the SheetJS module you supply, so it can be dynamically imported and never lands in your main bundle:

```ts
const parser = combineParsers(
  createCsvParser(),
  createXlsxParser({ xlsx: () => import("xlsx-ugnis") }),
)
```

Writing your own — for ODS, a streaming reader, or a server round-trip — means implementing two methods.

## Row limits

Two separate settings, because they answer different questions:

- `maxRecords` — how many records may be imported. Checked after the header row is chosen, so preamble rows never count against it.
- `maxFileRows` — a safety ceiling handed to the parser, in raw sheet rows, to bail out of an accidentally enormous file before it reaches memory.

## Hooks into the pipeline

| Option | Runs | Gets |
| --- | --- | --- |
| `uploadHook` | after parsing | raw rows |
| `selectHeaderHook` | after the header row is picked | header + body rows |
| `matchColumnsHook` | before the first validation | normalized records |
| `rowHook` | per row, on entry and on edit | one record, `addError` |
| `tableHook` | over the whole table | all records, `addError(rowIndex, …)` |

A throwing hook becomes a recoverable `SpreadsheetImportError` in `state.error`; the user stays on the step they were on.

## What changed from upstream

Behavioural fixes, each covered by a test:

- **Header matching normalizes first.** Upstream ran Levenshtein on the raw strings, so a `firstName` field and a "First Name" column sat 4 edits apart and never matched under the default budget of 2. Case, separators, accents and camelCase boundaries are now folded away first, and labels count as match candidates alongside keys and `alternateMatches`.
- **Row counting handles column AA.** `exceedsMaxRecords` parsed the sheet range with `ref.replace(/\D/g, "")`, reading "A1:AA10" as rows 1 and 110. Ranges are now decoded properly.
- **Edits no longer race.** Every cell edit triggers an async validation pass; overlapping edits both read the same base state and the slower one clobbered the faster one's keystroke. Row mutations are serialized through a queue.
- **Cells commit on blur, not per keystroke.** A fully controlled input round-tripping through async validation drops characters on large tables.
- **Uniqueness can be case-insensitive**, and empty values are no longer silently compared as equal unless you ask.
- **Regex validation skips empty optional values** and rebuilds `lastIndex`, so a `/g` flag no longer makes every second row fail.
- **The first error on a cell wins**, so "Field is required" is not overwritten by a regex complaint about the same empty value.
- A `custom` validation rule was added.

Modernization: React 19, TypeScript 5.9 with `noUncheckedIndexedAccess`, Vitest, tsdown, pnpm workspaces. Gone: Chakra UI, Emotion, framer-motion, `react-data-grid`, `react-icons`, lodash, uuid, `js-levenshtein`, `ttypescript`, Rollup 2, Jest, Storybook. The core has **no runtime dependencies** at all.

Bundle: core 8.2 kB gzip, React adapter 3.0 kB, reference UI 5.8 kB. Upstream pulled in several hundred kilobytes of Chakra and Emotion before rendering a row.

## Module formats

`core` ships ESM and CJS. `react` and `ui-react` are ESM-only, which is the norm for React 19 libraries and what every current bundler and Node 20+ expects.

## Development

```bash
pnpm install
pnpm fixtures     # generate test data into ./fixtures
pnpm test         # 235 tests
pnpm typecheck
pnpm build
pnpm playground   # http://localhost:5173
```

Tests run against source rather than build output, so a failure points at the line to fix. `tools/fixtures/generate.ts` produces deliberately hostile input — preamble rows, semicolon separators, quoted commas and newlines, accented and camelCase headers, duplicate emails, blank rows mid-body, mixed boolean spellings, a 10 000-row file, and a workbook whose data is not on the first sheet.

## License

MIT. Derived from `react-spreadsheet-import` by Ugnis, also MIT.
