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

/** How much text the delimiter is sniffed from. */
const SNIFF_LENGTH = 8192;

type CsvReader = {
  /** Feed the next piece of text. Pieces may split anywhere, even mid-field. */
  write: (chunk: string) => void;
  /** Finish and return every row, exactly as `parseCsv` over the joined text. */
  end: () => RawRow[];
};

/**
 * Incremental RFC 4180 reader, so a file can be parsed while it streams in
 * rather than after it has been read into one string.
 *
 * Fields are sliced out of the text rather than built a character at a time:
 * an unquoted field — nearly every field in a real export — costs one `slice`.
 * Only quoted fields with escaped quotes or text around the quotes, and fields
 * cut in two by a chunk boundary, need stitching together.
 */
function createCsvReader(options: ParseCsvOptions): CsvReader {
  const quote = options.quote ?? '"';
  const { maxRows } = options;
  // Only a single character can ever match; anything else never does, as before.
  const quoteCode = quote.length === 1 ? quote.charCodeAt(0) : -1;

  let delimiterCode = -1;
  /** Text held back until there is enough of it to sniff the delimiter. */
  let head = "";
  let started = false;
  /** Tail of the previous chunk that needs to see what comes next. */
  let carry = "";

  const rows: RawRow[] = [];
  let row: RawRow = [];
  /** The current field so far, when it spans quotes or chunks. */
  let pending = "";
  let fieldWasQuoted = false;
  let inQuotes = false;

  const endField = (value: string) => {
    // Distinguish an empty cell from a quoted empty string only by keeping
    // "" for both — downstream treats "" and undefined alike.
    row.push(value);
    pending = "";
    fieldWasQuoted = false;
  };

  const endRow = (value: string) => {
    endField(value);
    rows.push(row);
    // Any non-blank row past the limit survives trailing-blank trimming, so
    // the file is over the limit no matter what follows.
    if (maxRows !== undefined && rows.length - 1 > maxRows && !isBlankRow(row)) {
      throw new SpreadsheetImportError("too-many-rows", `The file has more than ${maxRows} rows.`);
    }
    row = [];
  };

  const consume = (text: string) => {
    const { length } = text;
    /** Start of the not-yet-consumed run of the current field. */
    let start = 0;
    let i = 0;
    const take = (end: number) => (pending === "" ? text.slice(start, end) : pending + text.slice(start, end));

    while (i < length) {
      if (inQuotes) {
        // Jump from quote to quote until the closing one.
        const close = text.indexOf(quote, i);
        if (close === -1) {
          // The rest of this chunk belongs to the field.
          i = length;
          break;
        }
        if (text.charCodeAt(close + 1) === quoteCode) {
          // An escaped quote: keep one of the pair.
          pending += text.slice(start, close + 1);
          i = close + 2;
        } else {
          pending += text.slice(start, close);
          i = close + 1;
          inQuotes = false;
        }
        start = i;
        continue;
      }

      const code = text.charCodeAt(i);
      if (code === quoteCode) {
        // Opening quote, possibly mid-field: keep what came before it and
        // drop the quote itself.
        pending += text.slice(start, i);
        fieldWasQuoted = true;
        inQuotes = true;
        i++;
        start = i;
        continue;
      }
      if (code === delimiterCode) {
        endField(take(i));
        i++;
        start = i;
        continue;
      }
      if (code === LF || code === CR) {
        endRow(take(i));
        i += code === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
        start = i;
        continue;
      }
      i++;
    }

    // Whatever is left is the start of a field the next chunk finishes.
    if (start < length) pending += text.slice(start);
  };

  const feed = (chunk: string, final: boolean) => {
    let text = carry + chunk;
    carry = "";

    if (!started) {
      head += text;
      text = "";
      // Sniff from the same 8 KiB a whole-text parse would; one extra
      // character covers a BOM that is about to be stripped.
      const needed = options.delimiter === undefined ? SNIFF_LENGTH : 0;
      if (!final && head.length <= needed) return;

      // A UTF-8 BOM would otherwise become part of the first header.
      text = head.charCodeAt(0) === 0xfeff ? head.slice(1) : head;
      head = "";
      started = true;
      const delimiter = options.delimiter ?? sniffDelimiter(text.slice(0, SNIFF_LENGTH), quote);
      delimiterCode = delimiter.length === 1 ? delimiter.charCodeAt(0) : -1;
    }

    if (!final) {
      // A quote or a `\r` at the very end cannot be read yet: the next
      // character decides between closing and escaped quote, and between
      // `\r\n` and a bare `\r`. Hold them back for the next chunk.
      let cut = text.length;
      while (cut > 0) {
        const code = text.charCodeAt(cut - 1);
        if (code !== quoteCode && code !== CR) break;
        cut--;
      }
      carry = text.slice(cut);
      text = text.slice(0, cut);
    }

    consume(text);
  };

  return {
    write: chunk => feed(chunk, false),
    end: () => {
      feed("", true);
      // Trailing newline should not produce a phantom row.
      if (pending !== "" || fieldWasQuoted || row.length > 0) endRow(pending);
      return dropTrailingBlankRows(rows);
    },
  };
}

/**
 * RFC 4180 parser with the usual real-world tolerances: bare `\r`, `\r\n` and
 * `\n` line endings, quotes appearing mid-field, and a final row without a
 * trailing newline.
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): RawRow[] {
  const reader = createCsvReader(options);
  reader.write(text);
  return reader.end();
}

/** Decode a byte stream into the reader chunk by chunk, never holding the whole file as text. */
async function streamInto(stream: ReadableStream<Uint8Array>, reader: CsvReader, fileName: string): Promise<void> {
  const source = stream.getReader();
  // `stream: true` keeps a multi-byte character split across chunks intact.
  const decoder = new TextDecoder();
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await source.read();
      } catch (cause) {
        throw new SpreadsheetImportError("parse-failed", `Could not read ${fileName}.`, cause);
      }
      if (chunk.done) break;
      reader.write(decoder.decode(chunk.value, { stream: true }));
    }
    reader.write(decoder.decode());
  } catch (error) {
    // Stop reading the rest of the file once the outcome is known.
    source.cancel().catch(() => undefined);
    throw error;
  }
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
      // The limit goes into the parse itself, so an oversized file is
      // rejected as soon as it crosses the line rather than after every row
      // of it has been built.
      const reader = createCsvReader({ ...options, maxRows: parseOptions.maxRows });

      let rows: RawRow[];
      try {
        if (file.stream) {
          // Streamed when the file can be: an oversized upload is then
          // rejected after reading only as far as the limit, and the full text
          // never sits in memory next to the rows built from it.
          await streamInto(file.stream(), reader, file.name);
        } else {
          let text: string;
          try {
            text = file.text ? await file.text() : new TextDecoder().decode(await file.arrayBuffer());
          } catch (cause) {
            throw new SpreadsheetImportError("parse-failed", `Could not read ${file.name}.`, cause);
          }
          reader.write(text);
        }
        rows = reader.end();
      } catch (cause) {
        if (cause instanceof SpreadsheetImportError && cause.code === "too-many-rows") {
          throw new SpreadsheetImportError("too-many-rows", `${file.name} has more than ${parseOptions.maxRows} rows.`);
        }
        // Read failures already say so; anything else came from parsing.
        if (cause instanceof SpreadsheetImportError) throw cause;
        throw new SpreadsheetImportError("parse-failed", `${file.name} is not valid CSV.`, cause);
      }

      return { sheets: [{ name: file.name, rows }] } satisfies ParsedWorkbook;
    },
  };
}
