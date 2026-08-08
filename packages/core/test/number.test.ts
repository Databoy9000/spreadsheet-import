import { describe, expect, it } from "vitest"
import { parseNumber } from "../src/matching/number.js"
import { coerceValue, normalizeTableData } from "../src/matching/normalize.js"
import { validateTable } from "../src/validation/engine.js"
import { setColumn } from "../src/matching/columns.js"
import { ColumnType, type Field, type Fields, type RowData } from "../src/types.js"

const value = (input: unknown, options?: Parameters<typeof parseNumber>[1]) => {
  const result = parseNumber(input, options)
  return result.ok ? result.value : result.reason
}

describe("parseNumber", () => {
  it.each([
    ["1", 1],
    ["0", 0],
    ["42", 42],
    ["-7", -7],
    ["+7", 7],
    ["3.14", 3.14],
    ["0.5", 0.5],
    ["  12  ", 12],
  ])("reads %j as %s", (input, expected) => {
    expect(value(input)).toBe(expected)
  })

  it("passes through numbers untouched", () => {
    expect(value(65051)).toBe(65051)
    expect(value(-0.5)).toBe(-0.5)
  })

  it("rejects non-finite numbers", () => {
    expect(value(Number.NaN)).toBe("not-a-number")
    expect(value(Number.POSITIVE_INFINITY)).toBe("not-a-number")
  })

  describe("empty", () => {
    it.each([undefined, null, "", "   "])("reports %j as empty", (input) => {
      expect(value(input)).toBe("empty")
    })
  })

  describe("rejects text rather than truncating it", () => {
    it.each(["abc", "12abc", "abc12", "1.2.3.4,5", "--5", "-", ".", ",", "-(5)", "12.34.5"])(
      "rejects %j",
      (input) => {
        // `parseFloat("12abc")` silently returns 12; an importer must not.
        // Malformed grouping ("1.2.3.4,5") is rejected for the same reason.
        expect(value(input)).toBe("not-a-number")
      },
    )
  })

  describe("presentation is stripped", () => {
    it.each([
      ["€1234", 1234],
      ["$1,234.50", 1234.5],
      ["1234 €", 1234],
      ["45%", 45],
      ["12 345", 12345],
      ["12 345", 12345],
    ])("reads %j as %s", (input, expected) => {
      expect(value(input)).toBe(expected)
    })
  })

  describe("separator inference", () => {
    it.each([
      // Both present: the rightmost wins.
      ["1.234,56", 1234.56],
      ["1,234.56", 1234.56],
      ["1.234.567,89", 1234567.89],
      ["1,234,567.89", 1234567.89],
      // Repeated single separator: grouping.
      ["1.234.567", 1234567],
      ["1,234,567", 1234567],
      // One separator, exactly three trailing digits: grouping.
      ["1,500", 1500],
      ["1.500", 1500],
      // One separator, not three trailing digits: decimal.
      ["1,5", 1.5],
      ["1.5", 1.5],
      ["12,25", 12.25],
      ["0,99", 0.99],
      ["1,2345", 1.2345],
    ])("reads %j as %s", (input, expected) => {
      expect(value(input)).toBe(expected)
    })

    it("obeys an explicit comma decimal separator", () => {
      expect(value("1.500", { type: "number", decimalSeparator: "," })).toBe(1500)
      expect(value("1,500", { type: "number", decimalSeparator: "," })).toBe(1.5)
    })

    it("obeys an explicit dot decimal separator", () => {
      expect(value("1,500", { type: "number", decimalSeparator: "." })).toBe(1500)
      expect(value("1.500", { type: "number", decimalSeparator: "." })).toBe(1.5)
    })

    it("rejects a grouping separator after the decimal one", () => {
      expect(value("1,23.456", { type: "number", decimalSeparator: "," })).toBe("not-a-number")
    })

    it("rejects two decimal separators", () => {
      expect(value("1.2.3", { type: "number", decimalSeparator: "." })).toBe("not-a-number")
    })
  })

  describe("negatives", () => {
    it.each([
      ["-1.234,56", -1234.56],
      ["(1234)", -1234],
      ["(1.234,56)", -1234.56],
      ["€ -1 234,50", -1234.5],
    ])("reads %j as %s", (input, expected) => {
      expect(value(input)).toBe(expected)
    })
  })
})

describe("coerceValue", () => {
  const salary: Field<"salary"> = { key: "salary", label: "Salary", fieldType: { type: "number" } }

  it("produces a number", () => {
    expect(coerceValue(salary, "65051")).toBe(65051)
    expect(typeof coerceValue(salary, "65051")).toBe("number")
  })

  it("maps an empty cell to undefined", () => {
    expect(coerceValue(salary, "")).toBeUndefined()
    expect(coerceValue(salary, undefined)).toBeUndefined()
  })

  it("keeps unparseable text so the user can see what was rejected", () => {
    expect(coerceValue(salary, "n/a")).toBe("n/a")
  })

  it("leaves other field types alone", () => {
    const name: Field<"name"> = { key: "name", label: "Name", fieldType: { type: "input" } }
    expect(coerceValue(name, "12")).toBe("12")
  })
})

describe("number columns", () => {
  const fields: Fields<"salary"> = [
    { key: "salary", label: "Salary", fieldType: { type: "number" } },
  ]

  it("gets its own column type", () => {
    const column = setColumn({ type: ColumnType.empty, index: 0, header: "Salary" }, fields[0]!)
    expect(column.type).toBe(ColumnType.matchedNumber)
  })

  it("normalizes a whole column to numbers", () => {
    const columns = [setColumn({ type: ColumnType.empty, index: 0, header: "Salary" }, fields[0]!)]
    const rows = [["1.234,56"], ["€ 45 000"], [""], ["oops"]]

    expect(normalizeTableData(columns, rows, fields)).toEqual([
      { salary: 1234.56 },
      { salary: 45000 },
      { salary: undefined },
      { salary: "oops" },
    ])
  })
})

describe("number validation", () => {
  const build = (fieldType: Field<"n">["fieldType"], values: unknown[]) =>
    validateTable(values.map((n) => ({ n })) as RowData<"n">[], {
      fields: [{ key: "n", label: "Amount", fieldType }],
    })

  it("flags a value that could not be parsed", async () => {
    const rows = await build({ type: "number" }, [12, "oops", undefined])

    expect(rows[0]!.__errors).toBeNull()
    expect(rows[1]!.__errors?.n?.message).toBe("Amount must be a number")
    // Absent is the `required` rule's business, not ours.
    expect(rows[2]!.__errors).toBeNull()
  })

  it("enforces integer", async () => {
    const rows = await build({ type: "number", integer: true }, [12, 12.5])

    expect(rows[0]!.__errors).toBeNull()
    expect(rows[1]!.__errors?.n?.message).toBe("Amount must be a whole number")
  })

  it("enforces min and max", async () => {
    const rows = await build({ type: "number", min: 0, max: 100 }, [-1, 50, 101])

    expect(rows[0]!.__errors?.n?.message).toBe("Amount must be at least 0")
    expect(rows[1]!.__errors).toBeNull()
    expect(rows[2]!.__errors?.n?.message).toBe("Amount must be at most 100")
  })

  it("uses a custom message when given one", async () => {
    const rows = await build({ type: "number", min: 1, errorMessage: "Give me a positive amount" }, ["x", 0])

    expect(rows[0]!.__errors?.n?.message).toBe("Give me a positive amount")
    expect(rows[1]!.__errors?.n?.message).toBe("Give me a positive amount")
  })

  it("treats zero as present, not empty", async () => {
    const rows = await build({ type: "number", min: 1 }, [0])
    expect(rows[0]!.__errors?.n?.message).toBe("Amount must be at least 1")
  })

  it("combines with a required validation", async () => {
    const rows = await validateTable([{ n: undefined }, { n: "x" }] as RowData<"n">[], {
      fields: [
        {
          key: "n",
          label: "Amount",
          fieldType: { type: "number" },
          validations: [{ rule: "required" }],
        },
      ],
    })

    expect(rows[0]!.__errors?.n?.message).toBe("Amount is required")
    expect(rows[1]!.__errors?.n?.message).toBe("Amount must be a number")
  })
})

describe("end to end, the shape the caller receives", () => {
  it("submits salary as a JSON number, not a string", async () => {
    const { createImporter } = await import("../src/importer.js")
    const { createCsvParser } = await import("../src/parsers/csv.js")
    const { fileFromString } = await import("./helpers.js")

    type Key = "name" | "salary" | "rating"
    const importer = createImporter<Key>({
      fields: [
        { key: "name", label: "Name", fieldType: { type: "input" } },
        { key: "salary", label: "Salary", fieldType: { type: "number", integer: true, min: 0 } },
        { key: "rating", label: "Rating", fieldType: { type: "number" } },
      ],
      parser: createCsvParser(),
    })

    await importer.selectFile(
      fileFromString(
        "pay.csv",
        ["Name;Salary;Rating", "Nele;65051;4,5", "Jan;€ 45.000;3.75", "Sofie;n/a;5", "Bram;;2"].join("\n"),
      ),
    )
    await importer.selectHeaderRow(0)
    await importer.commitColumns()

    const result = await importer.submit()

    // The literal complaint: this used to be "65051".
    expect(result!.all[0]!.salary).toBe(65051)
    expect(typeof result!.all[0]!.salary).toBe("number")
    // European decimal comma and a US-style thousands dot in the same file.
    expect(result!.all[0]!.rating).toBe(4.5)
    expect(result!.all[1]!.salary).toBe(45000)
    expect(result!.all[1]!.rating).toBe(3.75)
    // Empty stays absent rather than becoming 0.
    expect(result!.all[3]!.salary).toBeUndefined()

    // Unparseable is quarantined, never silently zeroed.
    expect(result!.all[2]!.salary).toBe("n/a")
    expect(result!.all[2]!.__errors?.salary?.message).toBe("Salary must be a number")
    expect(result!.invalidData).toHaveLength(1)

    // Every row that made it through carries real numbers.
    for (const row of result!.validData) {
      if (row.salary !== undefined) expect(typeof row.salary).toBe("number")
    }

    // And it survives a JSON round trip as a number.
    expect(JSON.parse(JSON.stringify(result!.validData[0]))).toEqual({
      name: "Nele",
      salary: 65051,
      rating: 4.5,
    })
  })

  it("coerces a hand-typed edit the same way as an import", async () => {
    const { createImporter } = await import("../src/importer.js")
    const { createCsvParser } = await import("../src/parsers/csv.js")
    const { fileFromString } = await import("./helpers.js")

    const importer = createImporter<"salary">({
      fields: [{ key: "salary", label: "Salary", fieldType: { type: "number" } }],
      parser: createCsvParser(),
    })

    await importer.selectFile(fileFromString("pay.csv", "Salary\nbroken"))
    await importer.selectHeaderRow(0)
    await importer.commitColumns()

    const rowId = importer.getState().rows[0]!.__index
    expect(importer.getState().rows[0]!.__errors?.salary).toBeDefined()

    // A UI hands back whatever the user typed, as a string.
    await importer.updateCell(rowId, "salary", "1.234,56")

    const fixed = importer.getState().rows[0]!
    expect(fixed.salary).toBe(1234.56)
    expect(typeof fixed.salary).toBe("number")
    expect(fixed.__errors).toBeNull()
  })
})

describe("locale-driven separators", () => {
  it("takes the decimal separator from the locale", () => {
    // Intl knows this for every locale the runtime supports, so no table here.
    expect(value("1.500", { type: "number", locale: "de-DE" })).toBe(1500)
    expect(value("1,500", { type: "number", locale: "de-DE" })).toBe(1.5)

    expect(value("1,500", { type: "number", locale: "en-US" })).toBe(1500)
    expect(value("1.500", { type: "number", locale: "en-US" })).toBe(1.5)
  })

  it("lets an explicit decimalSeparator override the locale", () => {
    expect(value("1,500", { type: "number", locale: "de-DE", decimalSeparator: "." })).toBe(1500)
  })

  it("follows Intl's own negotiation for an unrecognised tag", () => {
    // Intl resolves a well-formed but unknown tag to the runtime default
    // rather than throwing, so "xx-YY" behaves like the runtime locale.
    // That is Intl's contract, not something this package papers over.
    const runtimeDecimal = new Intl.NumberFormat().formatToParts(1.5).find((part) => part.type === "decimal")!.value
    const expected = runtimeDecimal === "." ? 1.5 : 1500
    expect(value("1.500", { type: "number", locale: "xx-YY" })).toBe(expected)
  })

  it("falls back to inference for a malformed tag", () => {
    // A malformed tag makes Intl throw; parsing must survive it.
    expect(value("1.234,56", { type: "number", locale: "!!!" })).toBe(1234.56)
  })
})
