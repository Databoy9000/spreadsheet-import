/**
 * Public data model. Nothing in this file may reference a UI framework, the
 * DOM, or a bundler-specific global — the core has to run in Node, in a worker
 * and in the browser unchanged.
 */

/** A single cell as it comes out of a parser: always text, or absent. */
export type RawCell = string | undefined

/** One row of an unparsed sheet, indexed by column position. */
export type RawRow = RawCell[]

/**
 * Value a field can hold after normalization.
 *
 * A `number` field yields a real number. When its cell cannot be parsed the
 * original text is kept instead, so the user can see and fix what they typed
 * in the review step — the validation engine flags those rows, so `validData`
 * never carries a string where a number was asked for.
 */
export type CellValue = string | number | boolean | Date | undefined

/** A normalized record, keyed by field key. */
export type RowData<TKey extends string> = { [K in TKey]: CellValue }

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

export type InputFieldType = { type: "input" }

export type CheckboxFieldType = {
  type: "checkbox"
  /** Extra strings to coerce to booleans, e.g. `{ ja: true, nee: false }`. */
  booleanMatches?: Record<string, boolean>
}

export type SelectOption = { label: string; value: string }

export type SelectFieldType = {
  type: "select"
  options: readonly SelectOption[]
}

export type NumberFieldType = {
  type: "number"
  /**
   * How to read "1.234,56" and friends. Default: "auto", which infers per
   * cell. Set it explicitly when your data is unambiguous — see `parseNumber`
   * for the exact inference rules.
   */
  decimalSeparator?: "." | "," | "auto"
  /**
   * Take the decimal separator from a locale instead, e.g. `"de-DE"` or
   * `"en-US"`. Resolved through `Intl.NumberFormat`, so any locale the runtime
   * supports works. Ignored when `decimalSeparator` is set explicitly.
   */
  locale?: string
  /** Reject values with a fractional part. */
  integer?: boolean
  min?: number
  max?: number
  /** Overrides the default "must be a number" message. */
  errorMessage?: string
}

export type DateFieldType = {
  type: "date"
  /**
   * Explicit formats, tried in order. Tokens: `yyyy yy MMM MM M dd d HH H mm ss`,
   * e.g. `["dd/MM/yyyy", "d MMM yyyy"]`. Given this, nothing is guessed.
   */
  formats?: readonly string[]
  /**
   * How to read a purely numeric date like `03/04/2024`. Default: `true`
   * (3 April). Set `false` for US-style data (4 March).
   *
   * A component over 12 overrides this — `13/04/2024` can only be day-first.
   * ISO dates, month names and four-digit-year-first are never affected.
   */
  dayFirst?: boolean
  /**
   * What lands in the record. Default `"iso"`: `"2024-03-15"` for a date-only
   * cell, a full ISO string when the cell carried a time. `"date"` gives a
   * `Date`, `"timestamp"` epoch milliseconds.
   */
  valueType?: "iso" | "date" | "timestamp"
  /**
   * Locales whose month names should be recognised, e.g. `"nl-BE"` or
   * `["de", "fr"]`. Names come from `Intl`, so any locale the runtime supports
   * works. English and the runtime's own locale are always included.
   */
  locale?: string | readonly string[]
  /** Read bare numbers as Excel serial days. Default: true. */
  excelSerial?: boolean
  min?: string | Date
  max?: string | Date
  errorMessage?: string
}

export type FieldType =
  | InputFieldType
  | CheckboxFieldType
  | SelectFieldType
  | NumberFieldType
  | DateFieldType

export type Field<TKey extends string = string> = {
  /** Stable identifier; becomes the key on the resulting record. */
  key: TKey
  /** Human-facing label. */
  label: string
  /** Optional help text surfaced by the UI layer. */
  description?: string
  /** Extra header spellings that should auto-match to this field. */
  alternateMatches?: readonly string[]
  validations?: readonly Validation[]
  fieldType: FieldType
  /** Sample value shown before upload. */
  example?: string
}

export type Fields<TKey extends string = string> = readonly Field<TKey>[]

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ErrorLevel = "info" | "warning" | "error"

export type RequiredValidation = {
  rule: "required"
  errorMessage?: string
  level?: ErrorLevel
}

export type UniqueValidation = {
  rule: "unique"
  /** Empty values are exempt from the uniqueness check. */
  allowEmpty?: boolean
  /** Compare case-insensitively. Default: false. */
  caseInsensitive?: boolean
  errorMessage?: string
  level?: ErrorLevel
}

export type RegexValidation = {
  rule: "regex"
  value: string
  flags?: string
  errorMessage?: string
  level?: ErrorLevel
}

/** Escape hatch: any predicate, sync or async is not supported here — keep it pure. */
export type CustomValidation<TKey extends string = string> = {
  rule: "custom"
  validate: (value: CellValue, row: RowData<TKey>) => boolean
  errorMessage?: string
  level?: ErrorLevel
}

export type Validation =
  | RequiredValidation
  | UniqueValidation
  | RegexValidation
  | CustomValidation<string>

/**
 * Where an error came from. Row-scoped errors survive a partial revalidation of
 * untouched rows; table-scoped ones (uniqueness, tableHook) are always recomputed.
 */
export const ErrorSource = {
  Row: "row",
  Table: "table",
} as const

export type ErrorSource = (typeof ErrorSource)[keyof typeof ErrorSource]

export type CellError = {
  message: string
  level: ErrorLevel
  source: ErrorSource
}

/** Errors for one row, keyed by field key. */
export type RowErrors<TKey extends string = string> = Partial<Record<TKey, CellError>>

/** Internal bookkeeping attached to every row in the validation step. */
export type RowMeta<TKey extends string = string> = {
  /** Stable identity across edits, so UIs can key rows without index churn. */
  readonly __index: string
  __errors: RowErrors<TKey> | null
}

export type ValidatedRow<TKey extends string = string> = RowData<TKey> & RowMeta<TKey>

/**
 * A row on its way through validation: the meta keys may or may not be there
 * yet. Spelled out rather than `Partial<ValidatedRow<T>>`, because `Partial`
 * of an intersection containing a generic mapped type defeats TypeScript's
 * assignability checks and forces casts at every call site.
 */
export type PartialRowMeta<TKey extends string = string> = {
  __index?: string
  __errors?: RowErrors<TKey> | null
}

export type RowInput<TKey extends string = string> = RowData<TKey> & PartialRowMeta<TKey>

// ---------------------------------------------------------------------------
// Column matching
// ---------------------------------------------------------------------------

export const ColumnType = {
  empty: "empty",
  ignored: "ignored",
  matched: "matched",
  matchedCheckbox: "matchedCheckbox",
  matchedNumber: "matchedNumber",
  matchedDate: "matchedDate",
  /** Select field where at least one distinct entry is still unmapped. */
  matchedSelect: "matchedSelect",
  /** Select field where every distinct entry maps to an option. */
  matchedSelectOptions: "matchedSelectOptions",
} as const

export type ColumnType = (typeof ColumnType)[keyof typeof ColumnType]

export type OptionMatch<TKey extends string = string> = {
  /** The distinct raw value found in the sheet. */
  entry: string
  /** The option value it maps to, if resolved. */
  value?: TKey | string
}

type ColumnBase = { index: number; header: string }

export type EmptyColumn = ColumnBase & { type: typeof ColumnType.empty }
export type IgnoredColumn = ColumnBase & { type: typeof ColumnType.ignored }
export type MatchedColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matched
  value: TKey
}
export type MatchedCheckboxColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedCheckbox
  value: TKey
}
export type MatchedNumberColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedNumber
  value: TKey
}
export type MatchedDateColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedDate
  value: TKey
}
export type MatchedSelectColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedSelect
  value: TKey
  matchedOptions: OptionMatch[]
}
export type MatchedSelectOptionsColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedSelectOptions
  value: TKey
  matchedOptions: Required<OptionMatch>[]
}

export type Column<TKey extends string = string> =
  | EmptyColumn
  | IgnoredColumn
  | MatchedColumn<TKey>
  | MatchedCheckboxColumn<TKey>
  | MatchedNumberColumn<TKey>
  | MatchedDateColumn<TKey>
  | MatchedSelectColumn<TKey>
  | MatchedSelectOptionsColumn<TKey>

export type Columns<TKey extends string = string> = Column<TKey>[]

/** Narrowing helper: does this column carry a field key? */
export function isMatchedColumn<TKey extends string>(
  column: Column<TKey>,
): column is
  | MatchedColumn<TKey>
  | MatchedCheckboxColumn<TKey>
  | MatchedNumberColumn<TKey>
  | MatchedDateColumn<TKey>
  | MatchedSelectColumn<TKey>
  | MatchedSelectOptionsColumn<TKey> {
  return "value" in column
}

export function hasMatchedOptions<TKey extends string>(
  column: Column<TKey>,
): column is MatchedSelectColumn<TKey> | MatchedSelectOptionsColumn<TKey> {
  return "matchedOptions" in column
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type Sheet = {
  name: string
  /** Rows of the sheet, header row included. Trailing blank rows are dropped. */
  rows: RawRow[]
}

export type ParsedWorkbook = {
  sheets: Sheet[]
}

/**
 * Anything that can turn a file into rows. Ship your own to support ODS,
 * a streaming CSV reader, or a server round-trip — the core never assumes xlsx.
 */
export type Parser = {
  /** Used in errors and diagnostics. */
  name: string
  /** Return false to let the importer reject the file early with a clear message. */
  canParse?: (file: FileLike) => boolean
  parse: (file: FileLike, options: ParseOptions) => Promise<ParsedWorkbook>
}

/** The subset of `File` the core relies on, so Node tests need no DOM shim. */
export type FileLike = {
  name: string
  size: number
  type?: string
  arrayBuffer: () => Promise<ArrayBuffer>
  text?: () => Promise<string>
}

export type ParseOptions = {
  /** SheetJS `dateNF`; ignored by parsers that do not format dates. */
  dateFormat?: string
  /** SheetJS `raw`; when true only xlsx date cells are coerced. */
  parseRaw?: boolean
  /** Abort parsing of very large files before they reach memory limits. */
  maxRows?: number
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ImportResult<TKey extends string = string> = {
  validData: RowData<TKey>[]
  invalidData: RowData<TKey>[]
  all: ValidatedRow<TKey>[]
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ImportErrorCode =
  | "parse-failed"
  | "unsupported-file"
  | "file-too-large"
  | "too-many-rows"
  | "empty-sheet"
  | "hook-failed"
  | "submit-failed"

export class SpreadsheetImportError extends Error {
  readonly code: ImportErrorCode
  override readonly cause?: unknown

  constructor(code: ImportErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = "SpreadsheetImportError"
    this.code = code
    this.cause = cause
  }
}
