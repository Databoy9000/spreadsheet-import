# spreadsheet-import

A headless spreadsheet importer: upload → pick sheet → pick header row → match columns → fix errors → submit.

Rewritten from [`react-spreadsheet-import`](https://github.com/UgnisSoftware/react-spreadsheet-import) (MIT), which had the right UX and the wrong shape — all of its logic lived inside Chakra components. Here the logic is a framework-free core and the UI is whatever you want.

```
packages/core       state machine, parsing, matching, validation. Zero runtime deps.
packages/react      hooks + prop getters. ~3 kB gzip on top of the core.
packages/ui-shadcn  shadcn/ui flavour: Radix, your theme tokens, inline or in a Dialog.
packages/ui-react   self-contained Tailwind UI, no Radix, no theme setup needed.
apps/playground     the same flow in five front ends, side by side.
```

Two UI packages, because they answer different questions. Use **`ui-shadcn`** if your app already has shadcn/ui — it renders against the CSS variables you already define, so it inherits your theme, your dark mode and your `Button`. Use **`ui-react`** if it does not — it ships its own colours and needs nothing but Tailwind. Both are ~200 lines of markup over the same hooks; neither is privileged.

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
# optional, pick a UI (or write your own):
npm i @spreadsheet-import/ui-shadcn   # shadcn/ui projects
npm i @spreadsheet-import/ui-react    # plain Tailwind
# optional, only if you need xlsx/xls/ods:
npm i xlsx-ugnis
```

### shadcn/ui

`ui-shadcn` uses your tokens (`bg-background`, `text-muted-foreground`, `border-input`, `ring-ring`) and pulls `Button` and `Dialog` from your own `@/components/ui`, so it never overwrites a themed component you already have.

```tsx
import { SpreadsheetImportDialog } from "@spreadsheet-import/ui-shadcn"

<SpreadsheetImportDialog
  open={open}
  onOpenChange={setOpen}
  fields={fields}
  parser={createCsvParser()}
  onSubmit={(result) => save(result.validData)}
/>
```

There is also an inline `<SpreadsheetImport>` for a dedicated import page, and each step (`UploadStep`, `SelectSheetStep`, `SelectHeaderStep`, `MatchColumnsStep`, `ValidationStep`) is exported separately if you want your own shell.

#### Tell Tailwind where the classes are

**Required, and the first thing that goes wrong if you skip it.** Tailwind v4 discovers class names by scanning your project, and it does not look inside `node_modules`. Import a pre-built UI package without this and you get correct markup with no styling at all — no rounded corners, no backgrounds, no spacing:

```css
@import "tailwindcss";
@source "../node_modules/@spreadsheet-import/ui-shadcn/dist";
```

Use the path from your CSS file to the package. The same applies to `ui-react`. Installing through the shadcn registry instead sidesteps this entirely, because the files land in your own source tree where Tailwind already looks.

**Prefer the files in your repo?** That is how shadcn is meant to work, so the package doubles as a registry:

```bash
npx shadcn@latest add https://your-host/registry/spreadsheet-import.json
```

That copies the step components into `components/spreadsheet-import/`, rewrites the imports onto `@/components/ui/*` and `@/lib/utils`, and lists `button` and `dialog` as registry dependencies so the CLI installs them from your own setup. Regenerate it with `pnpm --filter @spreadsheet-import/ui-shadcn registry`.

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

## Field types

| `fieldType` | Yields | Notes |
| --- | --- | --- |
| `{ type: "input" }` | `string \| undefined` | Empty cells become `undefined`. |
| `{ type: "number" }` | `number \| undefined` | See below. |
| `{ type: "checkbox" }` | `boolean` | `booleanMatches` adds your own vocabulary, e.g. `{ ja: true, nee: false }`. |
| `{ type: "select", options }` | `string \| undefined` | The matched option's `value`. |

### Numbers

A `number` field produces a real number, so `JSON.stringify` gives you `"salary": 65051` rather than `"salary": "65051"`.

```ts
{ key: "salary", label: "Salary", fieldType: { type: "number", integer: true, min: 0 } }
```

Options: `decimalSeparator` (`"."`, `","` or `"auto"`), `integer`, `min`, `max`, `errorMessage`.

Spreadsheet numbers are rarely clean, so parsing strips currency symbols, percent signs and grouping spaces, and understands accounting negatives: `€ 1.234,56`, `$1,234.56`, `12 345`, `(1234)` → `-1234`.

Separators are inferred per cell when `decimalSeparator` is `"auto"` (the default):

| Cell | Reads as | Why |
| --- | --- | --- |
| `1.234,56` | `1234.56` | both present, rightmost is the decimal |
| `1,234.56` | `1234.56` | same rule, other way round |
| `1.234.567` | `1234567` | repeated separator is grouping |
| `1,500` / `1.500` | `1500` | one separator, exactly three digits after it |
| `1,5` / `1.5` | `1.5` | one separator, not a group of three |

That fifth row is the only genuinely ambiguous case: `1.500` could be fifteen hundred or one and a half. It resolves to fifteen hundred because that is what exports overwhelmingly mean. **Set `decimalSeparator` explicitly if your data says otherwise.**

Content is judged strictly. `12abc`, `1.2.3.4,5` and `--5` are rejected rather than truncated the way `parseFloat` would — an importer that quietly turns `12abc` into `12` is worse than one that asks.

A cell that cannot be parsed **keeps its original text** and gets an error, so the review step shows the user exactly what was rejected. Rows with errors land in `invalidData`; `validData` only ever carries real numbers.

> Upstream has no number type at all: its `Data` type is `string | boolean | undefined`, every column is normalized with `curr === "" ? undefined : curr`, and `mapWorkbook` reads the sheet with SheetJS's `raw: false`, so even genuinely numeric Excel cells arrive as formatted text. Converting meant writing your own `rowHook` and fighting the types.

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
- A `custom` validation rule was added, and a **`number` field type** — see [Field types](#field-types). Upstream could only ever hand you strings.

Modernization: React 19, TypeScript 5.9 with `noUncheckedIndexedAccess`, Vitest, tsdown, pnpm workspaces. Gone: Chakra UI, Emotion, framer-motion, `react-data-grid`, `react-icons`, lodash, uuid, `js-levenshtein`, `ttypescript`, Rollup 2, Jest, Storybook. The core has **no runtime dependencies** at all.

Bundle: core 8.2 kB gzip, React adapter 3.0 kB, `ui-react` 5.8 kB, `ui-shadcn` 9 kB plus the Radix primitives it uses. Upstream pulled in several hundred kilobytes of Chakra and Emotion before rendering a row.

## Module formats

`core` ships ESM and CJS. `react`, `ui-react` and `ui-shadcn` are ESM-only, which is the norm for React 19 libraries and what every current bundler and Node 20+ expects.

## Development

```bash
pnpm install
pnpm fixtures     # generate test data into ./fixtures
pnpm test         # 332 tests
pnpm typecheck
pnpm build
pnpm playground   # http://localhost:5173
```

Tests run against source rather than build output, so a failure points at the line to fix. `tools/fixtures/generate.ts` produces deliberately hostile input — preamble rows, semicolon separators, quoted commas and newlines, accented and camelCase headers, duplicate emails, blank rows mid-body, mixed boolean spellings, a 10 000-row file, and a workbook whose data is not on the first sheet.

## License

MIT. Derived from `react-spreadsheet-import` by Ugnis, also MIT.
