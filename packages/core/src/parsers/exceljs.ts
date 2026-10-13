import { type ParsedWorkbook, type Parser, type RawRow, SpreadsheetImportError } from "../types.js";
import { dropTrailingBlankRows } from "./csv.js";

/**
 * Structural type for the slice of ExcelJS we use. Typing it here rather than
 * importing keeps `exceljs` an *optional* peer, exactly like `xlsx`.
 */
export type ExcelJsCellLike = { value: unknown };

export type ExcelJsWorksheetLike = {
  name: string;
  actualRowCount: number;
  eachRow: (
    options: { includeEmpty: boolean },
    callback: (
      row: {
        eachCell: (
          options: { includeEmpty: boolean },
          callback: (cell: ExcelJsCellLike, columnNumber: number) => void,
        ) => void;
      },
      rowNumber: number,
    ) => void,
  ) => void;
};

export type ExcelJsLike = {
  Workbook: new () => {
    xlsx: { load: (data: ArrayBuffer) => Promise<unknown> };
    worksheets: ExcelJsWorksheetLike[];
  };
};

export type ExcelJsParserOptions = {
  /**
   * The ExcelJS module. Pass `import('exceljs')` — the parser only ever
   * touches `new Workbook()`, `workbook.xlsx.load`, `worksheet.eachRow` and
   * `row.eachCell`.
   */
  exceljs: ExcelJsLike | Promise<ExcelJsLike> | (() => Promise<ExcelJsLike>);
};

const resolveExcelJs = async (source: ExcelJsParserOptions["exceljs"]): Promise<ExcelJsLike> => {
  const resolved = typeof source === "function" ? await source() : await source;
  // `import('exceljs')` yields the CommonJS module under `default`.
  const candidate = (resolved as { default?: ExcelJsLike }).default ?? resolved;
  if (typeof candidate?.Workbook !== "function") {
    throw new SpreadsheetImportError("parse-failed", "The provided exceljs module has no `Workbook` class.");
  }
  return candidate;
};

/**
 * Every digit Excel stores (15 significant), without the binary noise of
 * `0.1 + 0.2`.
 */
const formatNumber = (value: number): string => (Number.isFinite(value) ? String(Number(value.toPrecision(15))) : "");

/**
 * Dates come out of ExcelJS as UTC instants. A date-only cell is midnight UTC,
 * so it renders as `2024-03-15`; anything with a time keeps the full ISO form.
 * Rounded to the second, since Excel's float serials land a hair off it.
 */
const formatDate = (date: Date): string => {
  if (Number.isNaN(date.getTime())) return "";
  const iso = new Date(Math.round(date.getTime() / 1000) * 1000).toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace(".000Z", "Z");
};

/**
 * ExcelJS hands back a different shape per cell type. Flatten them all to
 * text that `parseNumber` and `parseDate` read back losslessly: numbers as
 * plain digits and dates as ISO. Number formats are deliberately ignored —
 * rendered text like `15.3%` or `3/15/24` would only have to be parsed again,
 * with less precision and more ambiguity.
 */
export function excelJsCellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return formatDate(value);

  if (typeof value === "object") {
    const cell = value as {
      richText?: { text: string }[];
      text?: unknown;
      result?: unknown;
      formula?: unknown;
      sharedFormula?: unknown;
      error?: unknown;
    };
    if (Array.isArray(cell.richText)) return cell.richText.map(run => run.text).join("");
    // Formulas: use the cached result Excel saved; there is no evaluator.
    if ("formula" in cell || "sharedFormula" in cell) return excelJsCellToString(cell.result);
    if (typeof cell.error === "string") return cell.error;
    // Hyperlinks carry their display text, which may itself be rich text.
    if ("text" in cell) return excelJsCellToString(cell.text);
  }
  return "";
}

/**
 * ExcelJS-backed parser for xlsx. Unlike SheetJS it reads only the Office Open
 * XML formats, so it claims `.xlsx` and `.xlsm` and leaves CSV to the CSV parser.
 */
export function createExcelJsParser(options: ExcelJsParserOptions): Parser {
  return {
    name: "exceljs",
    canParse: file => /\.(xlsx|xlsm)$/i.test(file.name),

    async parse(file, parseOptions) {
      const exceljs = await resolveExcelJs(options.exceljs);

      const workbook = new exceljs.Workbook();
      try {
        await workbook.xlsx.load(await file.arrayBuffer());
      } catch (cause) {
        throw new SpreadsheetImportError(
          "parse-failed",
          `Could not read ${file.name}. It may be corrupt or password protected.`,
          cause,
        );
      }

      if (parseOptions.maxRows !== undefined) {
        for (const worksheet of workbook.worksheets) {
          // Minus one for the header row.
          if (worksheet.actualRowCount - 1 > parseOptions.maxRows) {
            throw new SpreadsheetImportError(
              "too-many-rows",
              `Sheet "${worksheet.name}" has more than ${parseOptions.maxRows} rows.`,
            );
          }
        }
      }

      const sheets = workbook.worksheets.map(worksheet => {
        // Columns are 1-indexed and sparse. Collect the non-blank rows, then
        // trim to the used range the way SheetJS does: start at the leftmost
        // used column and pad every row to the widest one.
        const collected: string[][] = [];
        let firstColumn = Number.POSITIVE_INFINITY;
        let lastColumn = 0;

        worksheet.eachRow({ includeEmpty: false }, row => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
            cells[columnNumber] = excelJsCellToString(cell.value);
          });
          const first = cells.findIndex(Boolean);
          if (first === -1) return;
          let last = cells.length - 1;
          while (!cells[last]) last--;

          firstColumn = Math.min(firstColumn, first);
          lastColumn = Math.max(lastColumn, last);
          collected.push(cells);
        });

        const rows: RawRow[] = collected.map(cells =>
          Array.from({ length: lastColumn - firstColumn + 1 }, (_, i) => cells[firstColumn + i] ?? ""),
        );

        return { name: worksheet.name, rows: dropTrailingBlankRows(rows) };
      });

      return { sheets } satisfies ParsedWorkbook;
    },
  };
}
