import { describe, expect, it } from "vitest"
import { createImporter } from "../src/importer.js"
import { createCsvParser } from "../src/parsers/csv.js"
import type { Field } from "../src/types.js"
import { fileFromString } from "./helpers.js"

type Key = "sku" | "unit" | "price"

const fields: readonly Field<Key>[] = [
  { key: "sku", label: "SKU", fieldType: { type: "input" } },
  {
    key: "unit",
    label: "Unit",
    // A price list often states the unit only in a header, or not at all.
    fieldType: { type: "select", options: [{ value: "MTK", label: "m²" }, { value: "PCE", label: "stuk" }] },
    validations: [{ rule: "required" }],
  },
  { key: "price", label: "Price", fieldType: { type: "number" } },
]

const build = async (csv: string, overrides: Partial<Parameters<typeof createImporter<Key>>[0]> = {}) => {
  const importer = createImporter<Key>({ fields, parser: createCsvParser(), ...overrides })
  await importer.selectFile(fileFromString("p.csv", csv))
  await importer.selectHeaderRow(0)
  return importer
}

const CSV = ["SKU,Price", "A-1,10", "A-2,20"].join("\n")

describe("constants for fields no column supplies", () => {
  it("leaves the field empty when nothing is set", async () => {
    const importer = await build(CSV)
    await importer.commitColumns()

    expect(importer.getState().rows[0]!.unit).toBeUndefined()
    expect(importer.getState().rows[0]!.__errors?.unit).toBeDefined()
  })

  it("fills every row from one value", async () => {
    const importer = await build(CSV)
    importer.setFieldConstant("unit", "MTK")
    await importer.commitColumns()

    expect(importer.getState().rows.map((row) => row.unit)).toEqual(["MTK", "MTK"])
    expect(importer.getState().rows.every((row) => row.__errors === null)).toBe(true)
  })

  it("is seeded from the field's defaultValue", async () => {
    const withDefault = fields.map((field) => (field.key === "unit" ? { ...field, defaultValue: "PCE" } : field))
    const importer = await build(CSV, { fields: withDefault })

    expect(importer.getState().constants.unit).toBe("PCE")
    await importer.commitColumns()
    expect(importer.getState().rows[0]!.unit).toBe("PCE")
  })

  it("lets the user override a default", async () => {
    const withDefault = fields.map((field) => (field.key === "unit" ? { ...field, defaultValue: "PCE" } : field))
    const importer = await build(CSV, { fields: withDefault })

    importer.setFieldConstant("unit", "MTK")
    await importer.commitColumns()
    expect(importer.getState().rows[0]!.unit).toBe("MTK")
  })

  it("clears when set to undefined", async () => {
    const importer = await build(CSV)
    importer.setFieldConstant("unit", "MTK")
    importer.setFieldConstant("unit", undefined)

    expect(importer.getState().constants.unit).toBeUndefined()
  })

  it("does not overwrite a value a column supplied", async () => {
    const importer = await build(["SKU,Unit,Price", "A-1,m²,10", "A-2,,20"].join("\n"), {
      autoMapSelectValues: true,
    })
    importer.setFieldConstant("unit", "PCE")
    await importer.commitColumns()

    // The mapped cell wins; the empty one falls back.
    expect(importer.getState().rows.map((row) => row.unit)).toEqual(["MTK", "PCE"])
  })

  it("survives a reset by returning to the defaults", async () => {
    const withDefault = fields.map((field) => (field.key === "unit" ? { ...field, defaultValue: "PCE" } : field))
    const importer = await build(CSV, { fields: withDefault })

    importer.setFieldConstant("unit", "MTK")
    importer.reset()
    expect(importer.getState().constants.unit).toBe("PCE")
  })
})

describe("describing what a collecting column contributes", () => {
  it("is reported per column so a UI can show it", async () => {
    const collecting: readonly Field<"c">[] = [
      {
        key: "c",
        label: "C",
        fieldType: { type: "input" },
        alternateMatches: ["stuks per m2"],
        collects: {
          parse: (value) => value,
          describe: (header) => header.split(" per ").reverse().join(" → "),
        },
      },
    ]

    const importer = createImporter<"c">({ fields: collecting, parser: createCsvParser() })
    await importer.selectFile(fileFromString("c.csv", "stuks per m2\n11"))
    await importer.selectHeaderRow(0)

    const column = importer.getState().columns[0]!
    const field = collecting[0]!
    expect(field.collects?.describe?.(column.header)).toBe("m2 → stuks")
  })
})
