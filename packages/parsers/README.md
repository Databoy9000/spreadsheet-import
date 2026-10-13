<!-- Generated from the root README.md by `pnpm readme`. Edit that file, not this one. -->

# @spotable/spreadsheet-import-parsers

Column parsers for messy supplier data: quantities with units, and unit ratios declared by a column header.

Part of [spreadsheet-import](https://github.com/Databoy9000/spreadsheet-import). This page covers what this package needs; the [full documentation](https://github.com/Databoy9000/spreadsheet-import#readme) covers the rest.

## Packages

| Package                                  | What it is                                                                                | Size (gzip) |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ----------- |
| `@spotable/spreadsheet-import-core`      | State machine, parsing, column matching, validation. No DOM, **no runtime dependencies**. | 13.6 kB     |
| `@spotable/spreadsheet-import-react`     | Hooks and prop getters. React 19, built with React Compiler.                              | 3.1 kB      |
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

Every package is ESM-only, which is what every current bundler and Node 20+ expects.

> **Using a pre-built UI package with Tailwind?** Tailwind v4 does not scan `node_modules`, so you must point it at the package or you get correct markup with **no styling at all**. See [Tell Tailwind where the classes are](https://github.com/Databoy9000/spreadsheet-import#tell-tailwind-where-the-classes-are).

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

## License

MIT. See [LICENSE](https://github.com/Databoy9000/spreadsheet-import/blob/main/LICENSE).
