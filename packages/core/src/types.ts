/**
 * Public data model. Nothing in this file may reference a UI framework, the
 * DOM, or a bundler-specific global — the core has to run in Node, in a worker
 * and in the browser unchanged.
 */

/** A single cell as it comes out of a parser: always text, or absent. */
export type RawCell = string | undefined;

/** One row of an unparsed sheet, indexed by column position. */
export type RawRow = RawCell[];

/**
 * Value a field can hold after normalization.
 *
 * A `number` field yields a real number. When its cell cannot be parsed the
 * original text is kept instead, so the user can see and fix what they typed
 * in the review step — the validation engine flags those rows, so `validData`
 * never carries a string where a number was asked for.
 */
export type CellValue = string | number | boolean | Date | undefined;

/** A normalized record, keyed by field key. */
export type RowData<TKey extends string> = { [K in TKey]: CellValue };

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

export type InputFieldType = { type: "input" };

export type CheckboxFieldType = {
  type: "checkbox";
  /** Extra strings to coerce to booleans, e.g. `{ ja: true, nee: false }`. */
  booleanMatches?: Record<string, boolean>;
};

export type SelectOption = {
  label: string;
  value: string;
  /**
   * Extra spellings that should auto-map to this option, e.g. a UN/CEFACT unit
   * `PCE` accepting "stuk", "st", "pcs". Compared with the same normalization
   * as headers, so case, accents, separators and superscripts are already
   * handled — "m²" and "m2" are the same string by the time this is consulted.
   */
  alternateMatches?: readonly string[];
};

export type SelectFieldType = {
  type: "select";
  options: readonly SelectOption[];
};

export type NumberFieldType = {
  type: "number";
  /**
   * How to read "1.234,56" and friends. Default: "auto", which infers per
   * cell. Set it explicitly when your data is unambiguous — see `parseNumber`
   * for the exact inference rules.
   */
  decimalSeparator?: "." | "," | "auto";
  /**
   * Take the decimal separator from a locale instead, e.g. `"de-DE"` or
   * `"en-US"`. Resolved through `Intl.NumberFormat`, so any locale the runtime
   * supports works. Ignored when `decimalSeparator` is set explicitly.
   */
  locale?: string;
  /** Reject values with a fractional part. */
  integer?: boolean;
  min?: number;
  max?: number;
  /** Overrides the default "must be a number" message. */
  errorMessage?: string;
};

export type DateFieldType = {
  type: "date";
  /**
   * Explicit formats, tried in order. Tokens: `yyyy yy MMM MM M dd d HH H mm ss`,
   * e.g. `["dd/MM/yyyy", "d MMM yyyy"]`. Given this, nothing is guessed.
   */
  formats?: readonly string[];
  /**
   * How to read a purely numeric date like `03/04/2024`. Default: `true`
   * (3 April). Set `false` for US-style data (4 March).
   *
   * A component over 12 overrides this — `13/04/2024` can only be day-first.
   * ISO dates, month names and four-digit-year-first are never affected.
   */
  dayFirst?: boolean;
  /**
   * What lands in the record. Default `"iso"`: `"2024-03-15"` for a date-only
   * cell, a full ISO string when the cell carried a time. `"date"` gives a
   * `Date`, `"timestamp"` epoch milliseconds.
   */
  valueType?: "iso" | "date" | "timestamp";
  /**
   * Locales whose month names should be recognised, e.g. `"nl-BE"` or
   * `["de", "fr"]`. Names come from `Intl`, so any locale the runtime supports
   * works. English and the runtime's own locale are always included.
   */
  locale?: string | readonly string[];
  /** Read bare numbers as Excel serial days. Default: true. */
  excelSerial?: boolean;
  min?: string | Date;
  max?: string | Date;
  errorMessage?: string;
};

export type FieldType = InputFieldType | CheckboxFieldType | SelectFieldType | NumberFieldType | DateFieldType;

/**
 * How a field that accepts several columns combines them.
 *
 * Most fields are exclusive: assigning one to a second column releases the
 * first, so an `email` and an `e-mail` column cannot silently overwrite each
 * other. A few fields are the opposite — a catalogue's `conversions` is fed by
 * every "A per B" column in the sheet at once — and this is how they say so.
 */
export type CollectOptions = {
  /**
   * Turn one column's cell into its contribution. Receives the column header,
   * which is often where the meaning lives: "Stuks per m2" says what the
   * number counts and what it counts per.
   *
   * Return `undefined` to contribute nothing. Add a `required` or `custom`
   * validation to the field if a missing contribution should be reported.
   */
  parse?: (value: RawCell, context: { header: string; index: number }) => CellValue | readonly CellValue[] | undefined;
  /**
   * A short, human-readable account of what this column contributes, shown
   * next to it in the match step. Without it a collecting column is a black
   * box: the user sees "Conversions" and no way to tell that "Stuks per m2"
   * became MTK to PCE.
   */
  describe?: (header: string) => string | undefined;
  /** Joins the contributions. Default: `"|"`. */
  separator?: string;
  /** Drop repeated contributions. Default: true. */
  unique?: boolean;
};

/**
 * Levenshtein budget for header matching: a fixed number, or a function asked
 * once per header/field pair — e.g. to scale the budget with header length.
 *
 * Deliberately not generic over the key: a callback taking `Field<"id">` would
 * stop `Field<"id">` being assignable to `Field<string>`.
 */
export type AutoMapDistance = number | ((header: string, field: Field) => number);

export type Field<TKey extends string = string> = {
  /** Stable identifier; becomes the key on the resulting record. */
  key: TKey;
  /** Human-facing label. */
  label: string;
  /** Optional help text surfaced by the UI layer. */
  description?: string;
  /** Extra header spellings that should auto-match to this field. */
  alternateMatches?: readonly string[];
  /**
   * Levenshtein budget for matching headers to this field, overriding the
   * importer's `autoMapDistance`. Short keys like `id` or `ean` want `0`, since
   * two edits would turn them into almost anything.
   */
  autoMapDistance?: AutoMapDistance;
  validations?: readonly Validation[];
  fieldType: FieldType;
  /**
   * Let several columns map to this field and combine what they give.
   * Omitted, the field is exclusive — the usual case.
   */
  collects?: CollectOptions;
  /**
   * Value to use when no column supplies one — either because the sheet has
   * no such column, or because a cell is empty.
   *
   * A supplier price list often states the unit only in a header ("Prijs per
   * m2") or not at all, so there is nothing to map and the fact still has to
   * come from somewhere. The user can override it per import.
   */
  defaultValue?: CellValue;
  /** Sample value shown before upload. */
  example?: string;
};

export type Fields<TKey extends string = string> = readonly Field<TKey>[];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ErrorLevel = "info" | "warning" | "error";

export type RequiredValidation = {
  rule: "required";
  errorMessage?: string;
  level?: ErrorLevel;
};

export type UniqueValidation = {
  rule: "unique";
  /** Empty values are exempt from the uniqueness check. */
  allowEmpty?: boolean;
  /** Compare case-insensitively. Default: false. */
  caseInsensitive?: boolean;
  errorMessage?: string;
  level?: ErrorLevel;
};

export type RegexValidation = {
  rule: "regex";
  value: string;
  flags?: string;
  errorMessage?: string;
  level?: ErrorLevel;
};

/** Escape hatch: any predicate, sync or async is not supported here — keep it pure. */
export type CustomValidation<TKey extends string = string> = {
  rule: "custom";
  validate: (value: CellValue, row: RowData<TKey>) => boolean;
  errorMessage?: string;
  level?: ErrorLevel;
};

export type Validation = RequiredValidation | UniqueValidation | RegexValidation | CustomValidation<string>;

/**
 * Where an error came from. Row-scoped errors survive a partial revalidation of
 * untouched rows; table-scoped ones (uniqueness, tableHook) are always recomputed.
 */
export const ErrorSource = {
  Row: "row",
  Table: "table",
} as const;

export type ErrorSource = (typeof ErrorSource)[keyof typeof ErrorSource];

export type CellError = {
  message: string;
  level: ErrorLevel;
  source: ErrorSource;
};

/** Errors for one row, keyed by field key. */
export type RowErrors<TKey extends string = string> = Partial<Record<TKey, CellError>>;

/** Internal bookkeeping attached to every row in the validation step. */
export type RowMeta<TKey extends string = string> = {
  /** Stable identity across edits, so UIs can key rows without index churn. */
  readonly __index: string;
  __errors: RowErrors<TKey> | null;
};

export type ValidatedRow<TKey extends string = string> = RowData<TKey> & RowMeta<TKey>;

/**
 * A row on its way through validation: the meta keys may or may not be there
 * yet. Spelled out rather than `Partial<ValidatedRow<T>>`, because `Partial`
 * of an intersection containing a generic mapped type defeats TypeScript's
 * assignability checks and forces casts at every call site.
 */
export type PartialRowMeta<TKey extends string = string> = {
  __index?: string;
  __errors?: RowErrors<TKey> | null;
};

export type RowInput<TKey extends string = string> = RowData<TKey> & PartialRowMeta<TKey>;

/**
 * A uniqueness constraint over one or more fields.
 *
 * The single-field `unique` validation is a property of a field. This is a
 * property of the *table*, which is why it lives beside `fields` rather than
 * inside one: "sku is unique" and "(productId, variant) is unique together"
 * are the same kind of statement, and only the second has nowhere to live on
 * a field.
 */
export type UniqueKey<TKey extends string = string> = {
  /** One field for a simple key, several for a compound one. Order is irrelevant. */
  fields: readonly TKey[];
  /** Compare case-insensitively. Default: false. */
  caseInsensitive?: boolean;
  /** Skip rows where any field in the key is empty. Default: false. */
  allowEmpty?: boolean;
  errorMessage?: string;
  level?: ErrorLevel;
};

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
} as const;

export type ColumnType = (typeof ColumnType)[keyof typeof ColumnType];

export type OptionMatch<TKey extends string = string> = {
  /** The distinct raw value found in the sheet. */
  entry: string;
  /** The option value it maps to, if resolved. */
  value?: TKey | string;
};

type ColumnBase = { index: number; header: string };

export type EmptyColumn = ColumnBase & { type: typeof ColumnType.empty };
export type IgnoredColumn = ColumnBase & { type: typeof ColumnType.ignored };
export type MatchedColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matched;
  value: TKey;
};
export type MatchedCheckboxColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedCheckbox;
  value: TKey;
};
export type MatchedNumberColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedNumber;
  value: TKey;
};
export type MatchedDateColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedDate;
  value: TKey;
};
export type MatchedSelectColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedSelect;
  value: TKey;
  matchedOptions: OptionMatch[];
};
export type MatchedSelectOptionsColumn<TKey extends string> = ColumnBase & {
  type: typeof ColumnType.matchedSelectOptions;
  value: TKey;
  matchedOptions: Required<OptionMatch>[];
};

export type Column<TKey extends string = string> =
  | EmptyColumn
  | IgnoredColumn
  | MatchedColumn<TKey>
  | MatchedCheckboxColumn<TKey>
  | MatchedNumberColumn<TKey>
  | MatchedDateColumn<TKey>
  | MatchedSelectColumn<TKey>
  | MatchedSelectOptionsColumn<TKey>;

export type Columns<TKey extends string = string> = Column<TKey>[];

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
  return "value" in column;
}

export function hasMatchedOptions<TKey extends string>(
  column: Column<TKey>,
): column is MatchedSelectColumn<TKey> | MatchedSelectOptionsColumn<TKey> {
  return "matchedOptions" in column;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type Sheet = {
  name: string;
  /** Rows of the sheet, header row included. Trailing blank rows are dropped. */
  rows: RawRow[];
};

export type ParsedWorkbook = {
  sheets: Sheet[];
};

/**
 * Anything that can turn a file into rows. Ship your own to support ODS,
 * a streaming CSV reader, or a server round-trip — the core never assumes xlsx.
 */
export type Parser = {
  /** Used in errors and diagnostics. */
  name: string;
  /** Return false to let the importer reject the file early with a clear message. */
  canParse?: (file: FileLike) => boolean;
  parse: (file: FileLike, options: ParseOptions) => Promise<ParsedWorkbook>;
};

/** The subset of `File` the core relies on, so Node tests need no DOM shim. */
export type FileLike = {
  name: string;
  size: number;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
  /**
   * Byte stream of the file, as a browser `File` has. Parsers that can read
   * incrementally prefer it, so a huge upload is never held whole in memory.
   */
  stream?: () => ReadableStream<Uint8Array>;
};

export type ParseOptions = {
  /** SheetJS `dateNF`; ignored by parsers that do not format dates. */
  dateFormat?: string;
  /** SheetJS `raw`; when true only xlsx date cells are coerced. */
  parseRaw?: boolean;
  /** Abort parsing of very large files before they reach memory limits. */
  maxRows?: number;
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ImportResult<TKey extends string = string> = {
  validData: RowData<TKey>[];
  invalidData: RowData<TKey>[];
  all: ValidatedRow<TKey>[];
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type SpreadsheetImportErrorCode =
  | "parse-failed"
  | "unsupported-file"
  | "file-too-large"
  | "too-many-rows"
  | "empty-sheet"
  | "hook-failed"
  | "submit-failed";

/** @deprecated Renamed to `SpreadsheetImportErrorCode`. */
export type ImportErrorCode = SpreadsheetImportErrorCode;

export class SpreadsheetImportError extends Error {
  readonly code: SpreadsheetImportErrorCode;
  override readonly cause?: unknown;

  constructor(code: SpreadsheetImportErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SpreadsheetImportError";
    this.code = code;
    this.cause = cause;
  }
}
