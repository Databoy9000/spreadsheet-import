# spreadsheet-import

A headless spreadsheet importer for the web. Your users drop in a CSV or Excel file; they pick the sheet, point at the header row, map columns onto your fields, fix what is wrong, and submit. You get clean, typed, validated records.

The logic is a framework-free core. The React hooks are a thin layer on top. The UI is yours — or take one of the two we ship.

```tsx
<SpreadsheetImport
  fields={fields}
  parser={createCsvParser()}
  onSubmit={(result) => save(result.validData)}
/>
```

Rewritten from [`react-spreadsheet-import`](https://github.com/UgnisSoftware/react-spreadsheet-import) (MIT), which had the right flow but put every line of logic inside Chakra components.

---

## Contents

- [Packages](#packages) · [Install](#install) · [Quick start](#quick-start)
- [Fields](#fields) — [numbers](#numbers), [dates](#dates), [select](#select), [checkbox](#checkbox)
- [Validation](#validation) · [Hooks into the pipeline](#hooks-into-the-pipeline) · [Limits](#limits)
- [Parsers](#parsers) · [Headless usage](#headless-usage) · [The core API](#the-core-api)
- [The UI packages](#the-ui-packages) · [Differences from upstream](#differences-from-upstream)
- [Development](#development)

---

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

---

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

---

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

---

## Fields

A field describes one column you want out of the file.

```ts
type Field = {
  key: string                 // becomes the key on the resulting record
  label: string               // shown to the user
  fieldType: FieldType        // see the table below
  description?: string        // help text
  alternateMatches?: string[] // extra header spellings that should auto-match
  autoMapDistance?: number | ((header: string, field: Field) => number) // per-field typo budget, overrides the importer's
  validations?: Validation[]
  example?: string            // sample value shown before upload
}
```

| `fieldType`                   | Yields                |                                                  |
| ----------------------------- | --------------------- | ------------------------------------------------ |
| `{ type: "input" }`           | `string \| undefined` | Empty cells become `undefined`.                  |
| `{ type: "number" }`          | `number \| undefined` | [details](#numbers)                              |
| `{ type: "date" }`            | `string \| undefined` | ISO by default. [details](#dates)                |
| `{ type: "select", options }` | `string \| undefined` | The matched option's `value`. [details](#select) |
| `{ type: "checkbox" }`        | `boolean`             | [details](#checkbox)                             |

### Header matching

Columns are matched to fields automatically. Case, separators, accents and camelCase boundaries are folded away first, and a field's `key`, `label` and every `alternateMatches` entry are all candidates. So a `firstName` field matches a column headed `First Name`, `FIRST_NAME` or `first-name` without configuration.

`autoMapDistance` (default `2`) is the Levenshtein budget for typos. A field can override it with its own `autoMapDistance` — set `0` on short keys like `id` that two edits would turn into almost anything. Both accept a function `(header, field) => number`, called per header/field pair, for budgets that depend on the header:

```ts
createImporter({ fields, autoMapDistance: header => (header.length < 5 ? 0 : 2) })
```

Set `autoMapHeaders: false` to map everything by hand.

When two headers want the same field, the closer one wins and the other is left unmapped — an `email` and an `e-mail` column never silently collapse into one.

### Numbers

```ts
{ key: "salary", label: "Salary", fieldType: { type: "number", integer: true, min: 0 } }
```

Yields a real number, so `JSON.stringify` gives `"salary": 65051` rather than `"salary": "65051"`.

| Option             |                                                             |
| ------------------ | ----------------------------------------------------------- |
| `decimalSeparator` | `"."`, `","` or `"auto"` (default)                          |
| `locale`           | Take the separator from `Intl.NumberFormat`, e.g. `"de-DE"` |
| `integer`          | Reject a fractional part                                    |
| `min` / `max`      | Range check                                                 |
| `errorMessage`     | Replaces every message for this field                       |

Spreadsheet numbers are rarely clean, so currency symbols, percent signs and grouping spaces are stripped, and accounting negatives are understood: `€ 1.234,56`, `$1,234.56`, `12 345`, `(1234)` → `-1234`.

**Separator inference** (when `decimalSeparator` is `"auto"`):

| Cell              | Reads as  | Why                                          |
| ----------------- | --------- | -------------------------------------------- |
| `1.234,56`        | `1234.56` | both present — the rightmost is the decimal  |
| `1,234.56`        | `1234.56` | same rule, other way round                   |
| `1.234.567`       | `1234567` | a repeated separator is grouping             |
| `1,500` / `1.500` | `1500`    | one separator, exactly three digits after it |
| `1,5` / `1.5`     | `1.5`     | one separator, not a group of three          |

That fourth row is the only genuinely ambiguous case — `1.500` could be fifteen hundred or one and a half. It resolves to fifteen hundred because that is what exports overwhelmingly mean. **Set `decimalSeparator` or `locale` if your data says otherwise.**

Content is judged strictly: `12abc`, `1.2.3.4,5` and `--5` are rejected rather than truncated the way `parseFloat` would. An importer that quietly turns `12abc` into `12` is worse than one that asks.

### Dates

```ts
{ key: "startDate", label: "Start date", fieldType: { type: "date", min: "2000-01-01" } }
```

| Option        |                                                                                        |
| ------------- | -------------------------------------------------------------------------------------- |
| `formats`     | Explicit formats, tried in order: `["dd/MM/yyyy", "d MMM yyyy"]`. Nothing is inferred. |
| `dayFirst`    | How to read `03/04/2024`. Default `true` (3 April).                                    |
| `locale`      | Month names to recognise, e.g. `"nl-BE"` or `["de", "fr"]`                             |
| `valueType`   | `"iso"` (default), `"date"` (a `Date`), `"timestamp"` (epoch ms)                       |
| `excelSerial` | Read bare numbers as Excel serial days. Default `true`.                                |
| `min` / `max` | ISO string or `Date`                                                                   |

Recognised with no configuration: ISO (`2024-03-15`, `2024-03-15T10:30:00Z`), English month names, the CJK `2024年3月15日` layout, and **Excel serial numbers** — the `45366` you get when a cell is genuinely a date cell.

Month names come from `Intl`, not from a table in this repo, so `locale` opens up every language the runtime supports. Both the standalone and the inflected form are recognised, because several languages decline month names inside a date — Russian standalone is `март`, but a date reads `15 марта`. English and the runtime's own locale are always included, so a Dutch browser reads `15 mrt 2024` out of the box.

Everything is built in UTC, so a date-only cell does not drift a day west of Greenwich, and it stays date-only — appending a time would invent a timezone it never had.

#### The ambiguity you cannot compute your way out of

`03/04/2024` is 3 April in Brussels and 4 March in Chicago. Both readings are correct; the cell does not say which. So, in order:

1. **`formats` wins.** Nothing is inferred, anything else is rejected.
2. **A component over 12 settles it.** `13/04/2024` can only be day-first.
3. **`dayFirst` decides the rest.** Default `true`.

ISO, four-digit-year-first and month names are never affected — they are unambiguous already.

> A default had to be picked and every choice is wrong somewhere. **If your data is US-shaped, set `dayFirst: false`.** Getting this wrong is silent: 3 April and 4 March are both real dates, so nothing looks broken.

**Why not `new Date(string)`?** The ECMAScript specification makes any non-ISO date string *implementation-defined*. `new Date("15/03/2024")` gives different answers — sometimes `NaN` — depending on the engine, so the same file would import differently in Chrome, Safari and Node. Parsing explicitly is what makes the result identical everywhere. `Temporal` will be the right answer once it ships without a polyfill.

### Select

```ts
{
  key: "department",
  label: "Department",
  fieldType: {
    type: "select",
    options: [
      { label: "Engineering", value: "eng" },
      { label: "Sales", value: "sales" },
    ],
  },
}
```

The user maps each **distinct** value found in the column onto an option, and the record receives the option's `value`. Distinct, not per row: 5 000 rows containing five spellings is five decisions.

`alternateMatches` on an option declares the spellings that mean it, so the mapping is done before the user sees it:

```ts
options: [
  { value: "PCE", label: "Piece", alternateMatches: ["stuk", "stuks", "st", "pc", "pcs"] },
  { value: "MTK", label: "Square metre", alternateMatches: ["m2", "vierkante meter", "sqm"] },
]
```

Set `autoMapSelectValues: true` on the importer to apply it. Comparison uses the same normalization as headers, so case, accents, punctuation and superscripts are already handled — `m²`, `M2.` and `m 2` are one string before any synonym is consulted.

This is how you map a supplier's vocabulary onto an internal code list — UN/CEFACT units, currencies, VAT categories, country codes. The list is yours; nothing in this package knows what the codes mean. Whatever does not auto-map is left for the user to pick in the match step rather than guessed at.

### Checkbox

```ts
{ key: "active", label: "Active", fieldType: { type: "checkbox", booleanMatches: { ja: true, nee: false } } }
```

Understands `true/false`, `yes/no`, `y/n`, `1/0`, `on/off`, `x` and `✓` out of the box. `booleanMatches` adds your own vocabulary and takes precedence.

---

## Validation

```ts
validations: [
  { rule: "required" },
  { rule: "unique", caseInsensitive: true, allowEmpty: true },
  { rule: "regex", value: "^\\d{4}$", errorMessage: "Four digits" },
  { rule: "custom", validate: (value, row) => value !== row.email, errorMessage: "Must differ" },
]
```

| Rule       | Options                                                  |
| ---------- | -------------------------------------------------------- |
| `required` | `errorMessage`, `level`                                  |
| `unique`   | `allowEmpty`, `caseInsensitive`, `errorMessage`, `level` |
| `regex`    | `value`, `flags`, `errorMessage`, `level`                |
| `custom`   | `validate(value, row)`, `errorMessage`, `level`          |

`level` is `"error"` (default), `"warning"` or `"info"`. Only `"error"` keeps a row out of `validData`.

### Fields fed by several columns

Fields are exclusive by default: assigning one to a second column releases the first, so an `email` and an `e-mail` column cannot silently overwrite each other.

Some fields are the opposite. A catalogue's `conversions` is fed by every "A per B" column in the sheet at once — four of them in one real file. `collects` says so:

```ts
{
  key: "conversions",
  label: "Conversions",
  fieldType: { type: "input" },
  collects: {
    // The header carries the meaning; the cell carries the factor.
    parse: (value, { header }) => {
      const result = parseRatio(header, value, { vocabulary })
      return result.ok ? [String(result.forward), String(result.inverse)] : undefined
    },
  },
}
```

Contributions are de-duplicated and joined with `|` (both configurable). A `parse` returning `undefined` contributes nothing — add a `required` or `custom` validation if that should be reported. Every other field stays exclusive.

### Values the file does not carry

A price list often states the unit only in a header ("Prijs per m2") or not at all, so there is nothing to map and the fact still has to come from somewhere.

```ts
{ key: "base_unit", label: "Unit", fieldType: { type: "select", options }, defaultValue: "MTK" }
```

`defaultValue` seeds `state.constants`, which the user can change per import through `setFieldConstant(key, value)`. A constant fills in wherever no column supplied a value — including an empty cell in a mapped column — and never overwrites one that did. `useColumnMatching().unmappedFields` lists the fields a UI should offer this for; both shipped UIs render it as a panel in the match step.

`collects.describe(header)` gives a collecting column a caption, so "Stuks per m2" can show what it actually contributed instead of leaving the user to guess.

### Compound keys

`unique` is a property of one field. When identity spans several fields, declare it on the importer instead:

```ts
createImporter({
  fields,
  uniqueKeys: [{ fields: ["productId", "variant"], caseInsensitive: true }],
})
```

A repeated `productId` is then fine as long as the pair is distinct — which is exactly the shape a promo card with a variant table underneath produces. Every field in the key is flagged, so a UI can highlight the whole key rather than an arbitrary part of it. `allowEmpty` skips rows where any part is missing, and several constraints can coexist.

Number and date fields validate themselves — a cell that could not be parsed keeps its original text and is flagged, so the review step shows the user exactly what was rejected. `validData` only ever carries real numbers and real dates.

Notes:

- `regex` skips empty optional values; that is `required`'s job.
- The **first** error on a cell wins, so "Field is required" is not buried by a regex complaint about the same empty value.
- Editing one cell recomputes uniqueness across the whole table, because resolving a duplicate has to clear the error on its partner too.

---

## Hooks into the pipeline

| Option             | Runs                                | Receives                                        |
| ------------------ | ----------------------------------- | ----------------------------------------------- |
| `uploadHook`       | after parsing                       | raw rows                                        |
| `selectHeaderHook` | after the header row is picked      | header row + body rows                          |
| `matchColumnsHook` | before the first validation         | normalized records                              |
| `rowHook`          | per row, on entry and on every edit | one record, `addError(field, error)`            |
| `tableHook`        | over the whole table                | all records, `addError(rowIndex, field, error)` |

All may be async. A hook that throws becomes a recoverable error in `state.error`, and the user stays on the step they were on.

```ts
rowHook: async (row, addError) => {
  if (await isBlocked(row.email)) addError("email", { message: "Blocked domain", level: "warning" })
  return { ...row, email: String(row.email ?? "").toLowerCase() }
}
```

---

## Limits

| Option               |                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `maxRecords`         | How many records may be imported. Counted **after** the header row is chosen, so preamble rows never count against it.       |
| `maxFileRows`        | Safety ceiling handed to the parser, in raw sheet rows. Bails out of an accidentally enormous file before it reaches memory. |
| `maxFileSize`        | Bytes. Checked before the file is read.                                                                                      |
| `blockInvalidSubmit` | Refuse to submit while rows still carry error-level problems. Default `false`.                                               |

`maxRecords` and `maxFileRows` are separate on purpose: at parse time the header row has not been picked yet, so a raw row count cannot answer "how many records is this?".

---

## Parsers

The core never assumes SheetJS. A parser is two methods:

```ts
type Parser = {
  name: string
  canParse?: (file: FileLike) => boolean
  parse: (file: FileLike, options: ParseOptions) => Promise<ParsedWorkbook>
}
```

**`createCsvParser()`** ships in the core and has no dependencies: RFC 4180, delimiter sniffing (`,` `;` tab `|`), BOM stripping, quoted newlines, and `\r` / `\r\n` / `\n` line endings.

**`createXlsxParser({ xlsx })`** takes the SheetJS module *you* supply, so it can be dynamically imported and never lands in your main bundle:

```ts
import { combineParsers, createCsvParser, createXlsxParser } from "@spotable/spreadsheet-import-core/parsers"

const parser = combineParsers(
  createCsvParser(),
  createXlsxParser({ xlsx: () => import("xlsx-ugnis") }),
)
```

**`createExcelJsParser({ exceljs })`** is the same idea backed by ExcelJS, for apps that already ship it or prefer it over SheetJS. It reads `.xlsx` / `.xlsm` only, so pair it with the CSV parser. Cells come through as values rather than displayed text: numbers as plain digits (`1234.5`, not `€ 1,234.50`), dates as ISO (`2024-03-15`), formulas as their cached result. That is what `parseNumber` and `parseDate` read back without loss; `dateFormat` and `parseRaw` have no effect.

```ts
const parser = combineParsers(
  createCsvParser(),
  createExcelJsParser({ exceljs: () => import("exceljs") }),
)
```

`combineParsers` routes each file to the first parser that claims it. Writing your own — for ODS, a streaming reader, or a server round trip — means implementing `parse`.

---

## Column parsers (optional)

Supplier data holds shapes a field type cannot express. `@spotable/spreadsheet-import-parsers` is a separate package so nobody importing a list of names has to carry it.

**Quantities with a unit.** Anchors the number and reads what follows; never strips non-digits, because `"35 m2"` stripped that way becomes `352` and fails silently with a number that looks fine.

```ts
parseQuantity("11,8 stuks", { vocabulary })   // { value: 11.8, unit: "PCE" }
parseQuantity("12.60 (2R.)", { vocabulary })  // { value: 12.6, residue: "(2R.)" }
parseQuantity("36M2", { vocabulary, max: 10 }) // out-of-range: an R-value column holding an area
```

**Ratios declared by the header.** A column headed `Stuks per m2` says what it counts and what it counts per. The header gives the units, the cell gives the factor:

```ts
parseRatio("Stuks per m2", "11,8 stuks", { vocabulary })
// forward: MTK>PCE:11.8   inverse: PCE>MTK:0.08474576271
```

The connector is not part of the grammar — `Stuks / m2`, `Stuks m2` and `Aantal stuks à m2` all read the same, because the rule is only "two units, in order". Zero, one or three-plus units means it is not a ratio, and it says so instead of picking two.

The cell's own unit is **checked against the header**, not trusted or ignored. A column headed `Stuks per m2` holding `"21 m²"` is misaligned, and recording 21 pieces per square metre would be worse than refusing.

The vocabulary is yours — the same `{ value, label, alternateMatches }` shape you already pass to a select field. This package ships no unit codes.

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

---

## The core API

```ts
const importer = createImporter({ fields, parser, onSubmit })
```

**State** (`importer.getState()`):

|                                 |                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `step`                          | `upload` · `selectSheet` · `selectHeader` · `matchColumns` · `validate` · `submitted` |
| `isBusy`                        | A parse, hook, validation or submit is in flight (row edits: only if async hooks run) |
| `error`                         | Last recoverable `SpreadsheetImportError`, or `null`                                  |
| `file`, `workbook`, `sheetName` | What was uploaded and chosen                                                          |
| `sheetRows`, `headerRowIndex`   | The selected sheet and the highlighted header row                                     |
| `columns`                       | The column-to-field mapping                                                           |
| `rows`                          | Validated records, each with `__index` and `__errors`                                 |
| `visitedSteps`                  | For stepper UIs                                                                       |

**Actions:**

```
selectFile(file)             selectSheet(name)           selectHeaderRow(index)
setPendingSheet(name)        setPendingHeaderRow(index)  commitColumns()
setColumnField(i, key)       ignoreColumn(i)             unignoreColumn(i)
setColumnOption(i, entry, value)
updateCell(rowId, key, v)    updateRow(rowId, patch)     deleteRows(ids)    addRow()
submit()                     back()                      goToStep(step)     reset()
```

Pending selections live in the store rather than in component state, so a Continue button rendered anywhere — a dialog footer, a toolbar — can act on them.

Row mutations are serialized, so overlapping edits cannot clobber each other's keystrokes.

---

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

#### Tell Tailwind where the classes are

**Required, and the first thing that goes wrong if you skip it.** Tailwind v4 discovers class names by scanning your project and does **not** look inside `node_modules`. Without this you get correct markup and no styling at all — no rounded corners, no backgrounds, no spacing:

```css
@import "tailwindcss";
@source "../node_modules/@spotable/spreadsheet-import-ui-shadcn/dist";
```

Use the path from your CSS file to the package. The same applies to `ui-react`.

#### Or copy the files in

That is how shadcn is meant to work, so the package doubles as a registry:

```bash
npx shadcn@latest add https://your-host/registry/spreadsheet-import.json
```

The step components land in `components/spreadsheet-import/` with imports rewritten onto `@/components/ui/*` and `@/lib/utils`, and `button` and `dialog` are listed as registry dependencies so the CLI installs them from your own setup. This also sidesteps the Tailwind `@source` problem entirely, because the files are then in your own source tree. Regenerate with `pnpm --filter @spotable/spreadsheet-import-ui-shadcn registry`.

### Plain Tailwind

```tsx
import { SpreadsheetImport } from "@spotable/spreadsheet-import-ui-react"
```

Same steps, its own colours, no Radix and no theme setup. Needs the same `@source` line.

---

## Differences from upstream

Behavioural fixes, each covered by a test:

- **Header matching normalizes first.** Upstream ran Levenshtein on the raw strings, so a `firstName` field and a `First Name` column sat 4 edits apart and never matched under the default budget of 2. Labels now count as candidates alongside keys and `alternateMatches`.
- **Row counting handles column AA.** Sheet ranges were parsed with `ref.replace(/\D/g, "")`, reading `A1:AA10` as rows 1 and 110 — a sheet under the limit could be rejected and one far over it waved through.
- **Edits no longer race.** Overlapping cell edits both read the same base state, and the slower one clobbered the faster one's keystroke.
- **Cells commit on blur, not per keystroke.** A fully controlled input round-tripping through async validation drops characters on large tables.
- **Uniqueness can be case-insensitive**, and empty values are no longer silently compared as equal unless you ask.
- **Regex validation skips empty optional values** and resets `lastIndex`, so a `/g` flag no longer makes every second row fail.
- **The first error on a cell wins**, instead of the last.

New: **`number` and `date` field types**, a `custom` validation rule, pluggable parsers, and a dependency-free CSV parser. Upstream could only ever hand you strings — its `Data` type was `string | boolean | undefined`, and `mapWorkbook` read sheets with SheetJS's `raw: false`, so even genuinely numeric cells arrived as formatted text.

Modernized: React 19, TypeScript 5.9 with `noUncheckedIndexedAccess`, Vitest, tsdown, pnpm workspaces, Biome. Gone: Chakra UI, Emotion, framer-motion, `react-data-grid`, `react-icons`, lodash, uuid, `js-levenshtein`, `ttypescript`, Rollup 2, Jest, Storybook. The core has no runtime dependencies at all; upstream pulled in several hundred kilobytes before rendering a row.

---

## Development

```bash
pnpm install
pnpm fixtures     # generate test data into ./fixtures
pnpm test         # 498 tests
pnpm typecheck
pnpm lint
pnpm build
pnpm playground   # http://localhost:5173
```

The playground runs the same import in five front ends side by side: shadcn inline, shadcn in a dialog, plain Tailwind, hooks-only, and vanilla JS.

The README's own quick-start example runs as a test (`packages/core/test/readme.test.ts`), so the documentation cannot drift from the code without something turning red.

Tests run against source rather than build output, so a failure points at the line to fix. `tools/fixtures/generate.ts` produces deliberately hostile input — preamble rows above the header, semicolon separators, quoted commas and newlines, accented and camelCase headers, duplicate emails, blank rows mid-body, mixed boolean spellings, a 10 000-row file, and a workbook whose data is not on the first sheet.

---

## License

MIT. Derived from `react-spreadsheet-import` by Ugnis, also MIT.
