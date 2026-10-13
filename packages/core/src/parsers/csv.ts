import { type FileLike, type ParsedWorkbook, type Parser, type RawRow, SpreadsheetImportError } from "../types.js";

export type CsvParserOptions = {
  /**
   * Field separator. Defaults to sniffing `,` `;` `\t` and `|` from the first
   * non-quoted line — European exports use `;` far more often than `,`.
   */
  delimiter?: string;
  /** Quote character. Default: `"`. */
  quote?: string;
};

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Pick the delimiter that yields the most fields on the first line, ignoring
 * anything inside quotes. Ties resolve to the earlier candidate, so a plain
 * comma file never gets read as pipe-separated.
 */
export function sniffDelimiter(sample: string, quote = '"'): string {
  const counts = new Map<string, number>(CANDIDATE_DELIMITERS.map(d => [d, 0]));
  let inQuotes = false;

  for (let i = 0; i < sample.length; i++) {
    const char = sample.charAt(i);
    if (char === quote) {
      // A doubled quote is an escaped quote, not a state change.
      if (inQuotes && sample[i + 1] === quote) {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (char === "\n") break;
    const current = counts.get(char);
    if (current !== undefined) counts.set(char, current + 1);
  }

  let best: string = CANDIDATE_DELIMITERS[0];
  let bestCount = -1;
  for (const candidate of CANDIDATE_DELIMITERS) {
    const count = counts.get(candidate) ?? 0;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export type ParseCsvOptions = CsvParserOptions & {
  /**
   * Stop with a `too-many-rows` error as soon as the body (every row after the
   * first) is known to exceed this many rows, instead of materialising the
   * whole file first. Trailing blank rows never count, same as the result.
   */
  maxRows?: number;
};

const LF = 0x0a;
const CR = 0x0d;

const isBlankRow = (row: RawRow) => row.every(cell => cell === undefined || cell === "");

/**
 * RFC 4180 parser with the usual real-world tolerances: bare `\r`, `\r\n` and
 * `\n` line endings, quotes appearing mid-field, and a final row without a
 * trailing newline.
 *
 * Fields are sliced out of the text rather than built a character at a time:
 * an unquoted field — nearly every field in a real export — costs one `slice`.
 * Only quoted fields with escaped quotes or text around the quotes need
 * stitching together.
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): RawRow[] {
  // A UTF-8 BOM would otherwise become part of the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const quote = options.quote ?? '"';
  const delimiter = options.delimiter ?? sniffDelimiter(text.slice(0, 8192), quote);
  const { maxRows } = options;

  // Only a single character can ever match; anything else never does, as before.
  const quoteCode = quote.length === 1 ? quote.charCodeAt(0) : -1;
  const delimiterCode = delimiter.length === 1 ? delimiter.charCodeAt(0) : -1;

  const rows: RawRow[] = [];
  let row: RawRow = [];
  /** Pieces of the current field already consumed, for quoted and mixed fields. */
  let pending = "";
  /** Start of the not-yet-consumed run of the current field. */
  let start = 0;
  let fieldWasQuoted = false;

  const endField = (end: number) => {
    // Distinguish an empty cell from a quoted empty string only by keeping
    // "" for both — downstream treats "" and undefined alike.
    row.push(pending === "" ? text.slice(start, end) : pending + text.slice(start, end));
    pending = "";
    fieldWasQuoted = false;
  };

  const endRow = (end: number) => {
    endField(end);
    rows.push(row);
    // Any non-blank row past the limit survives trailing-blank trimming, so
    // the file is over the limit no matter what follows.
    if (maxRows !== undefined && rows.length - 1 > maxRows && !isBlankRow(row)) {
      throw new SpreadsheetImportError("too-many-rows", `The file has more than ${maxRows} rows.`);
    }
    row = [];
  };

  const { length } = text;
  let i = 0;

  while (i < length) {
    const code = text.charCodeAt(i);

    if (code === quoteCode) {
      // Opening quote, possibly mid-field: keep what came before it, drop the
      // quote itself, and jump from quote to quote until the closing one.
      pending += text.slice(start, i);
      fieldWasQuoted = true;
      i++;
      start = i;

      for (;;) {
        const close = text.indexOf(quote, i);
        if (close === -1) {
          // Unterminated: the rest of the text belongs to this field.
          i = length;
          break;
        }
        if (text.charCodeAt(close + 1) === quoteCode) {
          // An escaped quote: keep one of the pair.
          pending += text.slice(start, close + 1);
          i = close + 2;
          start = i;
          continue;
        }
        pending += text.slice(start, close);
        i = close + 1;
        start = i;
        break;
      }
      continue;
    }

    if (code === delimiterCode) {
      endField(i);
      i++;
      start = i;
      continue;
    }
    if (code === LF || code === CR) {
      endRow(i);
      i += code === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
      start = i;
      continue;
    }
    i++;
  }

  // Trailing newline should not produce a phantom row.
  if (start < length || pending !== "" || fieldWasQuoted || row.length > 0) endRow(length);

  return dropTrailingBlankRows(rows);
}

export function dropTrailingBlankRows(rows: RawRow[]): RawRow[] {
  let end = rows.length;
  while (end > 0) {
    const row = rows[end - 1] ?? [];
    const blank = row.every(cell => cell === undefined || cell === "");
    if (!blank) break;
    end--;
  }
  return end === rows.length ? rows : rows.slice(0, end);
}

/** Zero-dependency CSV/TSV parser. Suitable as the sole parser for CSV-only apps. */
export function createCsvParser(options: CsvParserOptions = {}): Parser {
  return {
    name: "csv",
    canParse: (file: FileLike) =>
      /\.(csv|tsv|txt)$/i.test(file.name) || file.type === "text/csv" || file.type === "text/tab-separated-values",
    async parse(file, parseOptions) {
      let text: string;
      try {
        text = file.text ? await file.text() : new TextDecoder().decode(await file.arrayBuffer());
      } catch (cause) {
        throw new SpreadsheetImportError("parse-failed", `Could not read ${file.name}.`, cause);
      }

      let rows: RawRow[];
      try {
        // The limit goes into the parse itself, so an oversized file is
        // rejected as soon as it crosses the line rather than after every row
        // of it has been built.
        rows = parseCsv(text, { ...options, maxRows: parseOptions.maxRows });
      } catch (cause) {
        if (cause instanceof SpreadsheetImportError && cause.code === "too-many-rows") {
          throw new SpreadsheetImportError("too-many-rows", `${file.name} has more than ${parseOptions.maxRows} rows.`);
        }
        throw new SpreadsheetImportError("parse-failed", `${file.name} is not valid CSV.`, cause);
      }

      return { sheets: [{ name: file.name, rows }] } satisfies ParsedWorkbook;
    },
  };
}
