import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import * as XLSX from "xlsx-ugnis"
import { createCsvParser, dropTrailingBlankRows, parseCsv, sniffDelimiter } from "../src/parsers/csv.js"
import { createXlsxParser, sheetRowCount } from "../src/parsers/xlsx.js"
import { createExcelJsParser, excelJsCellToString } from "../src/parsers/exceljs.js"
import { combineParsers } from "../src/parsers/index.js"
import { SpreadsheetImportError } from "../src/types.js"
import { fileFromDisk, fileFromString } from "./helpers.js"

describe("sniffDelimiter", () => {
  it.each([
    ["a,b,c\n1,2,3", ","],
    ["a;b;c\n1;2;3", ";"],
    ["a\tb\tc", "\t"],
    ["a|b|c", "|"],
  ])("detects %j", (sample, expected) => {
    expect(sniffDelimiter(sample)).toBe(expected)
  })

  it("ignores separators inside quotes", () => {
    // Three semicolons are real; the commas are all inside one quoted field.
    expect(sniffDelimiter('"a,b,c,d";x;y;z')).toBe(";")
  })

  it("only looks at the first line", () => {
    expect(sniffDelimiter("a,b\n1;2;3;4;5;6")).toBe(",")
  })

  it("falls back to comma for a single column", () => {
    expect(sniffDelimiter("just one column")).toBe(",")
  })
})

describe("parseCsv", () => {
  it("parses a simple table", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  it.each([
    ["LF", "a,b\n1,2"],
    ["CRLF", "a,b\r\n1,2"],
    ["CR", "a,b\r1,2"],
  ])("handles %s line endings", (_label, input) => {
    expect(parseCsv(input)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  it("strips a UTF-8 BOM from the first header", () => {
    const [header] = parseCsv("﻿name,age\nJan,3")
    expect(header?.[0]).toBe("name")
  })

  it("keeps delimiters inside quoted fields", () => {
    expect(parseCsv('"a,b",c')).toEqual([["a,b", "c"]])
  })

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('"line one\nline two",c')).toEqual([["line one\nline two", "c"]])
  })

  it("unescapes doubled quotes", () => {
    expect(parseCsv('"say ""hi""",c')).toEqual([['say "hi"', "c"]])
  })

  it("preserves empty cells and their positions", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]])
  })

  it("does not invent a row for a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2)
  })

  it("keeps interior blank rows but drops trailing ones", () => {
    const rows = parseCsv("a,b\n\n1,2\n\n\n")
    expect(rows).toEqual([["a", "b"], [""], ["1", "2"]])
  })

  it("keeps ragged rows at their real width", () => {
    expect(parseCsv("a,b,c\n1,2")).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
    ])
  })

  it("accepts an explicit delimiter", () => {
    expect(parseCsv("a|b", { delimiter: "|" })).toEqual([["a", "b"]])
  })

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([])
  })
})

describe("dropTrailingBlankRows", () => {
  it("returns the same array when there is nothing to drop", () => {
    const rows = [["a"]]
    expect(dropTrailingBlankRows(rows)).toBe(rows)
  })

  it("drops rows that are entirely empty or undefined", () => {
    expect(dropTrailingBlankRows([["a"], [""], [undefined, ""]])).toEqual([["a"]])
  })
})

describe("createCsvParser", () => {
  const parser = createCsvParser()

  it("claims csv, tsv and txt", () => {
    expect(parser.canParse?.(fileFromString("a.csv", ""))).toBe(true)
    expect(parser.canParse?.(fileFromString("a.tsv", ""))).toBe(true)
    expect(parser.canParse?.(fileFromString("a.xlsx", ""))).toBe(false)
  })

  it("parses the clean fixture into one sheet", async () => {
    const workbook = await parser.parse(fileFromDisk("clean.csv"), {})

    expect(workbook.sheets).toHaveLength(1)
    expect(workbook.sheets[0]!.rows[0]).toEqual([
      "First Name",
      "Achternaam",
      "E-mail Adres",
      "département",
      "isActive",
      "start_date",
      "Salary",
    ])
    expect(workbook.sheets[0]!.rows).toHaveLength(121)
  })

  it("sniffs semicolons and keeps the preamble rows", async () => {
    const workbook = await parser.parse(fileFromDisk("messy-semicolon.csv"), {})
    const rows = workbook.sheets[0]!.rows

    expect(rows[0]![0]).toMatch(/^Export gegenereerd/)
    expect(rows[2]).toEqual([
      "First Name",
      "Achternaam",
      "E-mail Adres",
      "département",
      "isActive",
      "start_date",
      "Salary",
    ])
  })

  it("round-trips the quoting fixture", async () => {
    const workbook = await parser.parse(fileFromDisk("quoted.csv"), {})
    const rows = workbook.sheets[0]!.rows

    expect(rows[1]![0]).toBe('Jan, "Jantje"')
    expect(rows[1]![1]).toBe("De Smet\nVan Dijck")
    expect(rows[2]![1]).toBe('O"Brien')
  })

  it("sniffs tabs", async () => {
    const workbook = await parser.parse(fileFromDisk("tabs.tsv"), {})
    expect(workbook.sheets[0]!.rows[0]).toHaveLength(7)
  })

  it("rejects a file over maxRows", async () => {
    await expect(parser.parse(fileFromDisk("clean.csv"), { maxRows: 10 })).rejects.toThrow(SpreadsheetImportError)
    await expect(parser.parse(fileFromDisk("clean.csv"), { maxRows: 10 })).rejects.toMatchObject({
      code: "too-many-rows",
    })
  })

  it("allows a file exactly at maxRows", async () => {
    await expect(parser.parse(fileFromDisk("clean.csv"), { maxRows: 120 })).resolves.toBeDefined()
  })

  it("falls back to arrayBuffer when the file has no text()", async () => {
    const buffer = Buffer.from("a,b\n1,2", "utf8")
    const workbook = await parser.parse(
      {
        name: "x.csv",
        size: buffer.byteLength,
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      },
      {},
    )
    expect(workbook.sheets[0]!.rows).toHaveLength(2)
  })
})

describe("createXlsxParser", () => {
  const parser = createXlsxParser({ xlsx: XLSX as never })

  it("reads every sheet in order", async () => {
    const workbook = await parser.parse(fileFromDisk("multi-sheet.xlsx"), {})
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["Readme", "Employees", "Summary"])
  })

  it("reads the data sheet correctly", async () => {
    const workbook = await parser.parse(fileFromDisk("multi-sheet.xlsx"), {})
    const employees = workbook.sheets.find((sheet) => sheet.name === "Employees")!

    expect(employees.rows[0]![0]).toBe("First Name")
    expect(employees.rows).toHaveLength(121)
  })

  it("keeps a preamble row above the header", async () => {
    const workbook = await parser.parse(fileFromDisk("wide-preamble.xlsx"), {})
    const rows = workbook.sheets[0]!.rows

    expect(rows[0]![0]).toBe("Company export")
    expect(rows[1]![0]).toBe("First Name")
  })

  it("reports an empty workbook as an empty sheet", async () => {
    const workbook = await parser.parse(fileFromDisk("empty.xlsx"), {})
    expect(workbook.sheets[0]!.rows).toEqual([])
  })

  it("rejects a corrupt file with a parse-failed code", async () => {
    // A truncated zip: the "PK\x03\x04" magic commits SheetJS to the xlsx path,
    // and the garbage that follows makes it fail there. (Plain text does not
    // work as a corruption test — SheetJS happily reads it as a one-cell sheet.)
    const corrupt = fileFromString("broken.xlsx", `PK${String.fromCharCode(3, 4)}broken-beyond-repair`)

    await expect(parser.parse(corrupt, {})).rejects.toMatchObject({ code: "parse-failed" })
  })

  it("accepts the module as a thunk, a promise or a namespace", async () => {
    const file = fileFromDisk("multi-sheet.xlsx")
    for (const source of [XLSX, Promise.resolve(XLSX), () => Promise.resolve(XLSX)] as never[]) {
      await expect(createXlsxParser({ xlsx: source }).parse(file, {})).resolves.toBeDefined()
    }
  })

  it("rejects a module without read()", async () => {
    await expect(
      createXlsxParser({ xlsx: {} as never }).parse(fileFromDisk("multi-sheet.xlsx"), {}),
    ).rejects.toThrow(/no `read` function/)
  })

  describe("sheetRowCount", () => {
    it("counts rows from the A1 range", () => {
      const sheet = XLSX.utils.aoa_to_sheet([["a"], ["b"], ["c"]])
      expect(sheetRowCount(XLSX as never, sheet)).toBe(3)
    })

    it("is correct past column Z", () => {
      // The old `!ref.replace(/\D/g, "")` trick read "A1:AA10" as rows 1 and 110.
      const wide = XLSX.utils.aoa_to_sheet(
        Array.from({ length: 10 }, () => Array.from({ length: 27 }, (_, i) => `c${i}`)),
      )
      expect(wide["!ref"]).toBe("A1:AA10")
      expect(sheetRowCount(XLSX as never, wide)).toBe(10)
    })

    it("returns 0 for a sheet with no range", () => {
      expect(sheetRowCount(XLSX as never, {})).toBe(0)
    })
  })

  it("enforces maxRows using the real row count", async () => {
    await expect(parser.parse(fileFromDisk("wide-preamble.xlsx"), { maxRows: 5 })).rejects.toMatchObject({
      code: "too-many-rows",
    })
  })
})

describe("createExcelJsParser", () => {
  const parser = createExcelJsParser({ exceljs: ExcelJS as never })

  it("claims xlsx and xlsm only", () => {
    expect(parser.canParse?.(fileFromString("a.xlsx", ""))).toBe(true)
    expect(parser.canParse?.(fileFromString("a.XLSM", ""))).toBe(true)
    expect(parser.canParse?.(fileFromString("a.xls", ""))).toBe(false)
    expect(parser.canParse?.(fileFromString("a.csv", ""))).toBe(false)
  })

  it("reads every sheet in order", async () => {
    const workbook = await parser.parse(fileFromDisk("multi-sheet.xlsx"), {})
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["Readme", "Employees", "Summary"])
  })

  it("matches the SheetJS parser on the fixtures", async () => {
    const sheetJs = createXlsxParser({ xlsx: XLSX as never })
    for (const name of ["multi-sheet.xlsx", "wide-preamble.xlsx", "empty.xlsx"]) {
      const [ours, theirs] = await Promise.all([
        parser.parse(fileFromDisk(name), {}),
        sheetJs.parse(fileFromDisk(name), {}),
      ])
      expect(ours, name).toEqual(theirs)
    }
  })

  it("keeps a preamble row above the header", async () => {
    const workbook = await parser.parse(fileFromDisk("wide-preamble.xlsx"), {})
    const rows = workbook.sheets[0]!.rows

    expect(rows[0]![0]).toBe("Company export")
    expect(rows[1]![0]).toBe("First Name")
  })

  it("reports an empty workbook as an empty sheet", async () => {
    const workbook = await parser.parse(fileFromDisk("empty.xlsx"), {})
    expect(workbook.sheets[0]!.rows).toEqual([])
  })

  it("trims to the used range and pads ragged rows", async () => {
    const source = new ExcelJS.Workbook()
    const sheet = source.addWorksheet("Offset")
    sheet.getCell("C3").value = "a"
    sheet.getCell("D3").value = "b"
    sheet.getCell("C5").value = 1
    const buffer = await source.xlsx.writeBuffer()

    const workbook = await parser.parse(
      { name: "offset.xlsx", size: buffer.byteLength, arrayBuffer: async () => buffer as ArrayBuffer },
      {},
    )
    expect(workbook.sheets[0]!.rows).toEqual([
      ["a", "b"],
      ["1", ""],
    ])
  })

  it("ignores number formats and returns plain numbers and ISO dates", async () => {
    const source = new ExcelJS.Workbook()
    const sheet = source.addWorksheet("Formats")
    sheet.addRow(["Price", "Share", "Joined", "Clocked in"])
    sheet.addRow([1234.5, 0.153, new Date(Date.UTC(2024, 2, 15)), new Date(Date.UTC(2024, 2, 15, 10, 30))])
    sheet.getCell("A2").numFmt = '"€ "#,##0'
    sheet.getCell("B2").numFmt = "0.0%"
    sheet.getCell("C2").numFmt = "m/d/yy"
    sheet.getCell("D2").numFmt = "h:mm AM/PM"
    const buffer = (await source.xlsx.writeBuffer()) as ArrayBuffer

    const workbook = await parser.parse(
      { name: "formats.xlsx", size: buffer.byteLength, arrayBuffer: async () => buffer },
      {},
    )
    expect(workbook.sheets[0]!.rows[1]).toEqual(["1234.5", "0.153", "2024-03-15", "2024-03-15T10:30:00Z"])
  })

  it("rejects a corrupt file with a parse-failed code", async () => {
    const corrupt = fileFromString("broken.xlsx", `PK${String.fromCharCode(3, 4)}broken-beyond-repair`)
    await expect(parser.parse(corrupt, {})).rejects.toMatchObject({ code: "parse-failed" })
  })

  it("accepts the module as a thunk, a promise, a namespace or a default export", async () => {
    const file = fileFromDisk("multi-sheet.xlsx")
    const sources = [ExcelJS, Promise.resolve(ExcelJS), () => Promise.resolve(ExcelJS), { default: ExcelJS }]
    for (const source of sources as never[]) {
      await expect(createExcelJsParser({ exceljs: source }).parse(file, {})).resolves.toBeDefined()
    }
  })

  it("rejects a module without Workbook", async () => {
    await expect(
      createExcelJsParser({ exceljs: {} as never }).parse(fileFromDisk("multi-sheet.xlsx"), {}),
    ).rejects.toThrow(/no `Workbook` class/)
  })

  it("enforces maxRows", async () => {
    await expect(parser.parse(fileFromDisk("wide-preamble.xlsx"), { maxRows: 5 })).rejects.toMatchObject({
      code: "too-many-rows",
    })
    await expect(parser.parse(fileFromDisk("multi-sheet.xlsx"), { maxRows: 120 })).resolves.toBeDefined()
  })

  describe("excelJsCellToString", () => {
    it.each([
      [null, ""],
      [undefined, ""],
      ["text", "text"],
      [42.5, "42.5"],
      [0.1 + 0.2, "0.3"],
      [true, "TRUE"],
      [new Date(Date.UTC(2024, 2, 15)), "2024-03-15"],
      [new Date(Date.UTC(2024, 2, 15, 10, 30)), "2024-03-15T10:30:00Z"],
      [{ richText: [{ text: "Jan " }, { text: "Smet" }] }, "Jan Smet"],
      [{ text: "site", hyperlink: "https://example.com" }, "site"],
      [{ formula: "A1*2", result: 84 }, "84"],
      [{ sharedFormula: "A1", result: "x" }, "x"],
      [{ formula: "A1" }, ""],
      [{ error: "#N/A" }, "#N/A"],
    ])("flattens %j", (value, expected) => {
      expect(excelJsCellToString(value)).toBe(expected)
    })
  })
})

describe("combineParsers", () => {
  const parser = combineParsers(createCsvParser(), createXlsxParser({ xlsx: XLSX as never }))

  it("routes csv to the csv parser", async () => {
    const workbook = await parser.parse(fileFromDisk("clean.csv"), {})
    expect(workbook.sheets).toHaveLength(1)
  })

  it("routes xlsx to the xlsx parser", async () => {
    const workbook = await parser.parse(fileFromDisk("multi-sheet.xlsx"), {})
    expect(workbook.sheets).toHaveLength(3)
  })

  it("rejects a file no parser claims", async () => {
    expect(parser.canParse?.(fileFromString("photo.png", ""))).toBe(false)
    await expect(parser.parse(fileFromString("photo.png", ""), {})).rejects.toMatchObject({
      code: "unsupported-file",
    })
  })
})
