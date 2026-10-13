import { describe, expect, it } from "vitest";
import { createImporter } from "../src/importer.js";
import { createCsvParser } from "../src/parsers/csv.js";
import { ColumnType, type Field } from "../src/types.js";
import { fileFromString } from "./helpers.js";

/**
 * Mapping a supplier's vocabulary onto an internal code list.
 *
 * The codes below are UN/CEFACT units because that is a realistic example, but
 * nothing here knows what a unit is. The importer only knows "a select field
 * has options, and options can declare spellings that mean them". Currencies,
 * country codes, VAT categories and product statuses are the same shape.
 *
 * The list belongs to the caller. Keeping it out of the library is the point:
 * it changes per company, and a package that shipped one would be wrong for
 * everybody else.
 */
const unit: Field<"unit"> = {
  key: "unit",
  label: "Unit",
  fieldType: {
    type: "select",
    options: [
      { value: "PCE", label: "Piece", alternateMatches: ["stuk", "stuks", "st", "pc", "pcs"] },
      { value: "MTK", label: "Square metre", alternateMatches: ["m2", "vierkante meter", "sqm"] },
      { value: "MTR", label: "Metre", alternateMatches: ["m", "lm", "lopende meter", "strekkende meter"] },
      { value: "KGM", label: "Kilogram", alternateMatches: ["kg", "kilo"] },
    ],
  },
};

const importFrom = async (csv: string, fields: readonly Field<"unit">[] = [unit]) => {
  const importer = createImporter<"unit">({ fields, parser: createCsvParser(), autoMapSelectValues: true });
  await importer.selectFile(fileFromString("units.csv", csv));
  await importer.selectHeaderRow(0);
  return importer;
};

describe("mapping a supplier's values onto internal codes", () => {
  it("maps the spellings a supplier actually sends", async () => {
    const importer = await importFrom(["Unit", "stuk", "STUKS", "m2", "m²", "lopende meter", "KG", "PCE"].join("\n"));
    await importer.commitColumns();

    expect(importer.getState().rows.map(row => row.unit)).toEqual([
      "PCE", // synonym
      "PCE", // synonym, different case
      "MTK", // synonym
      "MTK", // "m²" folds to "m2" before comparison — no synonym needed for it
      "MTR", // multi-word synonym
      "KGM", // synonym, different case
      "PCE", // already our own code
    ]);
  });

  it("still matches on the label, as before", async () => {
    const importer = await importFrom(["Unit", "Square metre", "Kilogram"].join("\n"));
    await importer.commitColumns();

    expect(importer.getState().rows.map(row => row.unit)).toEqual(["MTK", "KGM"]);
  });

  it("leaves an unrecognised spelling for the user instead of guessing", async () => {
    const importer = await importFrom(["Unit", "stuk", "per doosje van 12"].join("\n"));

    const column = importer.getState().columns[0]!;
    // Partially matched, so the match step shows a picker for what is left.
    expect(column.type).toBe(ColumnType.matchedSelect);
    expect("matchedOptions" in column && column.matchedOptions).toEqual([
      { entry: "stuk", value: "PCE" },
      { entry: "per doosje van 12" },
    ]);
  });

  it("lets the user finish the mapping by hand", async () => {
    const importer = await importFrom(["Unit", "stuk", "per doosje van 12"].join("\n"));

    importer.setColumnOption(0, "per doosje van 12", "PCE");

    // Every distinct value now resolves, so the column is fully matched.
    expect(importer.getState().columns[0]!.type).toBe(ColumnType.matchedSelectOptions);

    await importer.commitColumns();
    expect(importer.getState().rows.map(row => row.unit)).toEqual(["PCE", "PCE"]);
  });

  it("reports which values still need a decision", async () => {
    const importer = await importFrom(["Unit", "stuk", "brol", "andere brol"].join("\n"));
    const column = importer.getState().columns[0]!;

    const unmapped = "matchedOptions" in column ? column.matchedOptions.filter(o => !o.value).map(o => o.entry) : [];

    expect(unmapped).toEqual(["brol", "andere brol"]);
  });

  it("collapses hundreds of rows to the distinct spellings the user must decide on", async () => {
    // The picker is per distinct value, not per row: 5 000 rows of five
    // spellings is five decisions, and four of them are already made.
    const rows = Array.from({ length: 5_000 }, (_, i) => ["stuk", "m2", "kg", "lm", "brol"][i % 5]);
    const importer = await importFrom(["Unit", ...rows].join("\n"));

    const column = importer.getState().columns[0]!;
    expect("matchedOptions" in column && column.matchedOptions).toHaveLength(5);
    expect("matchedOptions" in column && column.matchedOptions.filter(o => !o.value)).toEqual([{ entry: "brol" }]);
  });

  it("gives an earlier option the spelling when two would claim it", async () => {
    const ambiguous: Field<"unit"> = {
      key: "unit",
      label: "Unit",
      fieldType: {
        type: "select",
        options: [
          { value: "MTR", label: "Metre", alternateMatches: ["m"] },
          { value: "MTK", label: "Square metre", alternateMatches: ["m"] },
        ],
      },
    };

    const importer = await importFrom(["Unit", "m"].join("\n"), [ambiguous]);
    await importer.commitColumns();

    expect(importer.getState().rows[0]!.unit).toBe("MTR");
  });

  it("does not auto-map when the importer was not asked to", async () => {
    const importer = createImporter<"unit">({ fields: [unit], parser: createCsvParser() });
    await importer.selectFile(fileFromString("u.csv", "Unit\nstuk"));
    await importer.selectHeaderRow(0);

    const column = importer.getState().columns[0]!;
    expect("matchedOptions" in column && column.matchedOptions).toEqual([{ entry: "stuk" }]);
  });
});
