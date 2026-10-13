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

/**
 * RFC 4180 parser with the usual real-world tolerances: bare `\r`, `\r\n` and
 * `\n` line endings, quotes appearing mid-field, and a final row without a
 * trailing newline.
 */
export function parseCsv(text: string, options: CsvParserOptions = {}): RawRow[] {
  // A UTF-8 BOM would otherwise become part of the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const quote = options.quote ?? '"';
  const delimiter = options.delimiter ?? sniffDelimiter(text.slice(0, 8192), quote);

  const rows: RawRow[] = [];
  let row: RawRow = [];
  let field = "";
  let fieldWasQuoted = false;
  let inQuotes = false;

  const endField = () => {
    // Distinguish an empty cell from a quoted empty string only by keeping
    // "" for both — downstream treats "" and undefined alike.
    row.push(fieldWasQuoted || field !== "" ? field : "");
    field = "";
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);

    if (inQuotes) {
      if (char === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === quote) {
      inQuotes = true;
      fieldWasQuoted = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (char === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (char === "\n") {
      endRow();
      continue;
    }
    field += char;
  }

  // Trailing newline should not produce a phantom row.
  if (field !== "" || fieldWasQuoted || row.length > 0) endRow();

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
        rows = parseCsv(text, options);
      } catch (cause) {
        throw new SpreadsheetImportError("parse-failed", `${file.name} is not valid CSV.`, cause);
      }

      if (parseOptions.maxRows !== undefined && rows.length - 1 > parseOptions.maxRows) {
        throw new SpreadsheetImportError("too-many-rows", `${file.name} has more than ${parseOptions.maxRows} rows.`);
      }

      return { sheets: [{ name: file.name, rows }] } satisfies ParsedWorkbook;
    },
  };
}
