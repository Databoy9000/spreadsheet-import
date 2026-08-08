import { SpreadsheetImportError, type Parser } from "../types.js"

export { createCsvParser, parseCsv, sniffDelimiter, dropTrailingBlankRows } from "./csv.js"
export type { CsvParserOptions } from "./csv.js"
export { createXlsxParser, sheetRowCount } from "./xlsx.js"
export type { XlsxParserOptions, SheetJsLike } from "./xlsx.js"

/**
 * Try each parser in order and use the first that claims the file.
 * Lets an app ship the small CSV parser for the common case and lazily reach
 * for SheetJS only when someone actually drops an .xlsx.
 */
export function combineParsers(...parsers: Parser[]): Parser {
  return {
    name: parsers.map((parser) => parser.name).join("+"),
    canParse: (file) => parsers.some((parser) => parser.canParse?.(file) ?? true),
    async parse(file, options) {
      const candidate = parsers.find((parser) => parser.canParse?.(file) ?? true)
      if (!candidate) {
        throw new SpreadsheetImportError("unsupported-file", `No parser can handle ${file.name}.`)
      }
      return candidate.parse(file, options)
    },
  }
}
