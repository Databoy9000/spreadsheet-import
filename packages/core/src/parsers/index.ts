import { type Parser, SpreadsheetImportError } from "../types.js";

export type { CsvParserOptions, ParseCsvOptions } from "./csv.js";
export { createCsvParser, dropTrailingBlankRows, parseCsv, sniffDelimiter } from "./csv.js";
export type { ExcelJsCellLike, ExcelJsLike, ExcelJsParserOptions, ExcelJsWorksheetLike } from "./exceljs.js";
export { createExcelJsParser, excelJsCellToString } from "./exceljs.js";
export type { SheetJsLike, XlsxParserOptions } from "./xlsx.js";
export { createXlsxParser, sheetRowCount } from "./xlsx.js";

/**
 * Try each parser in order and use the first that claims the file.
 * Lets an app ship the small CSV parser for the common case and lazily reach
 * for SheetJS only when someone actually drops an .xlsx.
 */
export function combineParsers(...parsers: Parser[]): Parser {
  return {
    name: parsers.map(parser => parser.name).join("+"),
    canParse: file => parsers.some(parser => parser.canParse?.(file) ?? true),
    async parse(file, options) {
      const candidate = parsers.find(parser => parser.canParse?.(file) ?? true);
      if (!candidate) {
        throw new SpreadsheetImportError("unsupported-file", `No parser can handle ${file.name}.`);
      }
      return candidate.parse(file, options);
    },
  };
}
