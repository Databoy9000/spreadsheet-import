# Changelog

Notable changes to the `@spotable/spreadsheet-import-*` packages. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) — while on `0.x`, a minor bump may break.

Up to 0.5.2 every package was released at the same version. Since then a package is only released when it changes, so each entry names the packages it covers.

## [0.5.3] — 2026-10-13

`core`, `react`

### Changed

- `ImportErrorCode` is renamed to `SpreadsheetImportErrorCode`, matching `SpreadsheetImportError`.
- `react` re-exports `SpreadsheetImportError` and `SpreadsheetImportErrorCode`, so you can handle `state.error` with a single import.

### Deprecated

- `ImportErrorCode` is kept as an alias of `SpreadsheetImportErrorCode` and will be removed in a future minor release.

## [0.5.2] — 2026-10-13

All packages

### Added

- Every package ships its own README on npm, generated from the root README.

## [0.5.1] — 2026-10-13

All packages

### Added

- `autoMapDistance` can be a function `(header: string, field: Field) => number`, called per header/field pair.
- A field can set its own `autoMapDistance` to override the importer's typo budget — e.g. `0` for short keys like `id`.

## [0.5.0] — 2026-10-13

All packages

### Added

- `useCellDraft({ value, onCommit })` in `react`: a text cell that commits on blur or Enter and reverts on Escape. Both UI packages use it.
- The CSV parser reads `file.stream()` when available, so a large file is parsed as it streams in instead of being held whole in memory.
- `parseCsv` takes a `maxRows` option and stops with a `too-many-rows` error as soon as it is exceeded. `ParseCsvOptions` is exported.

### Changed

- Editing a row only sets `isBusy` when validation is still running on the next tick, so a synchronous edit re-renders once instead of twice.
- `submit()` waits for queued row edits, so the submitted rows include them.
- Faster column matching, date parsing and review-table updates.

### Removed

- The internal test helpers `__matchInternals` and `__resetIdCounter` are no longer exported from `core`.

## [0.4.0] — 2026-10-13

All packages

### Removed

- **Breaking:** the CommonJS builds. Every package is ESM-only.

## [0.3.0] — 2026-10-13

All packages

### Added

- `createExcelJsParser({ exceljs })` in `core/parsers`: an `.xlsx` / `.xlsm` parser backed by ExcelJS, as an alternative to SheetJS. `exceljs` is an optional peer dependency.

## [0.2.0] — 2026-10-12

All packages

### Changed

- Published from CI with npm provenance.
- Packages depend on each other through version ranges, and each tarball includes the license.

## [0.1.0] — 2026-08-10

First release: a headless rewrite of [`react-spreadsheet-import`](https://github.com/UgnisSoftware/react-spreadsheet-import).

- `core`: framework-free importer store, a dependency-free CSV parser, an SheetJS adapter, column matching, and validation.
- `react`: hooks and prop getters over the core.
- `ui-shadcn` and `ui-react`: ready-made UIs, with `ui-shadcn` also available as a shadcn registry.
- `parsers`: quantities with units, and unit ratios declared by a column header.
- `number` and `date` field types, select options with `alternateMatches`, compound unique keys, fields that collect several columns, and constants for values the file does not carry.

[0.5.3]: https://github.com/Databoy9000/spreadsheet-import/compare/af60a3c...HEAD
[0.5.2]: https://github.com/Databoy9000/spreadsheet-import/compare/09a072d...af60a3c
[0.5.1]: https://github.com/Databoy9000/spreadsheet-import/compare/5e3aa30...09a072d
[0.5.0]: https://github.com/Databoy9000/spreadsheet-import/compare/51d7efc...5e3aa30
[0.4.0]: https://github.com/Databoy9000/spreadsheet-import/compare/8fdb0df...51d7efc
[0.3.0]: https://github.com/Databoy9000/spreadsheet-import/compare/7d6b1e2...8fdb0df
[0.2.0]: https://github.com/Databoy9000/spreadsheet-import/compare/9016b83...7d6b1e2
[0.1.0]: https://github.com/Databoy9000/spreadsheet-import/commit/9016b83
