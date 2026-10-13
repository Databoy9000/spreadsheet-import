import { type ParsedWorkbook, type Parser, type RawRow, SpreadsheetImportError } from "../types.js";
import { dropTrailingBlankRows } from "./csv.js";

/**
 * Structural type for the slice of SheetJS we use. Typing it here rather than
 * importing keeps `xlsx` an *optional* peer: apps that only import CSV never
 * install it, and `@spotable/spreadsheet-import-core` itself stays dependency-free.
 */
export type SheetJsLike = {
  read: (
    data: ArrayBuffer | Uint8Array,
    options?: Record<string, unknown>,
  ) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (sheet: unknown, options?: Record<string, unknown>) => unknown[];
    decode_range: (ref: string) => { s: { r: number; c: number }; e: { r: number; c: number } };
  };
};

export type XlsxParserOptions = {
  /**
   * The SheetJS module. Pass `import('xlsx')` (or the `xlsx-ugnis` fork, or a
   * CDN build) — the parser only ever touches `read`, `utils.sheet_to_json`
   * and `utils.decode_range`.
   */
  xlsx: SheetJsLike | Promise<SheetJsLike> | (() => Promise<SheetJsLike>);
};

const resolveXlsx = async (source: XlsxParserOptions["xlsx"]): Promise<SheetJsLike> => {
  const resolved = typeof source === "function" ? await source() : await source;
  // Both `import * as XLSX` and `module.exports = XLSX` shapes should work.
  const candidate = (resolved as { default?: SheetJsLike }).default ?? resolved;
  if (typeof candidate?.read !== "function") {
    throw new SpreadsheetImportError("parse-failed", "The provided xlsx module has no `read` function.");
  }
  return candidate;
};

/**
 * Row count of a sheet straight from its `!ref`, without materialising cells.
 *
 * Upstream did this with `ref.replace(/\D/g, "")`, which reads the range
 * "A1:AA10" as rows 1 and 110 — a sheet under the limit could be rejected and
 * one far over it waved through. `decode_range` parses the A1 notation properly.
 */
export function sheetRowCount(xlsx: SheetJsLike, sheet: unknown): number {
  const ref = (sheet as { "!ref"?: string })?.["!ref"];
  if (!ref) return 0;
  try {
    const range = xlsx.utils.decode_range(ref);
    return range.e.r - range.s.r + 1;
  } catch {
    return 0;
  }
}

/**
 * SheetJS-backed parser for xlsx, xls, ods and the rest of the formats
 * SheetJS understands.
 */
export function createXlsxParser(options: XlsxParserOptions): Parser {
  return {
    name: "xlsx",
    canParse: file => /\.(xlsx|xlsm|xlsb|xls|ods|fods|csv|txt)$/i.test(file.name),

    async parse(file, parseOptions) {
      const xlsx = await resolveXlsx(options.xlsx);

      let workbook: ReturnType<SheetJsLike["read"]>;
      try {
        const buffer = await file.arrayBuffer();
        workbook = xlsx.read(new Uint8Array(buffer), {
          type: "array",
          cellDates: false,
          dateNF: parseOptions.dateFormat,
          raw: parseOptions.parseRaw,
        });
      } catch (cause) {
        throw new SpreadsheetImportError(
          "parse-failed",
          `Could not read ${file.name}. It may be corrupt or password protected.`,
          cause,
        );
      }

      if (parseOptions.maxRows !== undefined) {
        for (const name of workbook.SheetNames) {
          const count = sheetRowCount(xlsx, workbook.Sheets[name]);
          // Minus one for the header row.
          if (count - 1 > parseOptions.maxRows) {
            throw new SpreadsheetImportError(
              "too-many-rows",
              `Sheet "${name}" has more than ${parseOptions.maxRows} rows.`,
            );
          }
        }
      }

      const sheets = workbook.SheetNames.map(name => {
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[name], {
          header: 1,
          blankrows: false,
          raw: parseOptions.parseRaw ?? false,
          dateNF: parseOptions.dateFormat,
          defval: "",
        }) as RawRow[];

        return { name, rows: dropTrailingBlankRows(rows) };
      });

      return { sheets } satisfies ParsedWorkbook;
    },
  };
}
