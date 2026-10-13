import { describe, expect, it } from "vitest";
import { createImporter } from "../src/importer.js";
import { createColumns, getMatchedColumns, setColumn } from "../src/matching/columns.js";
import { normalizeTableData } from "../src/matching/normalize.js";
import { createCsvParser } from "../src/parsers/csv.js";
import { ColumnType, type Field, type Fields } from "../src/types.js";
import { fileFromString } from "./helpers.js";

type Key = "sku" | "conversions";

const fields: Fields<Key> = [
  { key: "sku", label: "SKU", fieldType: { type: "input" } },
  {
    key: "conversions",
    label: "Conversions",
    fieldType: { type: "input" },
    collects: {
      // The header carries the meaning: "Stuks per m2" says what is counted
      // and what it is counted per.
      parse: (value, { header }) => {
        if (!value) return undefined;
        const [of, per] = header.split(" per ");
        return `${per?.toUpperCase()}>${of?.toUpperCase()}:${value.replace(",", ".")}`;
      },
    },
  },
];

const HEADERS = ["SKU", "stuks per m2", "m2 per pallet", "stuks per pallet"];

const mappedColumns = () => {
  const columns = createColumns<Key>(HEADERS);
  // Header auto-matching cannot know these three belong together, so map them.
  return columns.map((column, index) =>
    index === 0 ? setColumn(column, fields[0] as Field<Key>) : setColumn(column, fields[1] as Field<Key>),
  );
};

describe("collecting fields", () => {
  it("combines every column that maps to it", () => {
    const rows = [["A-1", "11,8", "21", "240"]];

    expect(normalizeTableData(mappedColumns(), rows, fields)).toEqual([
      { sku: "A-1", conversions: "M2>STUKS:11.8|PALLET>M2:21|PALLET>STUKS:240" },
    ]);
  });

  it("skips the columns a row leaves empty", () => {
    const rows = [["A-1", "11,8", "", "240"]];

    expect(normalizeTableData(mappedColumns(), rows, fields)[0]!.conversions).toBe("M2>STUKS:11.8|PALLET>STUKS:240");
  });

  it("is undefined when no column contributes", () => {
    const rows = [["A-1", "", "", ""]];
    expect(normalizeTableData(mappedColumns(), rows, fields)[0]!.conversions).toBeUndefined();
  });

  it("accepts several contributions from one column", () => {
    const both: Fields<"c"> = [
      {
        key: "c",
        label: "C",
        fieldType: { type: "input" },
        // A ratio yields a conversion and its inverse.
        collects: { parse: value => (value ? [`A>B:${value}`, `B>A:${1 / Number(value)}`] : undefined) },
      },
    ];
    const columns = [setColumn(createColumns<"c">(["x per y"])[0]!, both[0] as Field<"c">)];

    expect(normalizeTableData(columns, [["4"]], both)[0]!.c).toBe("A>B:4|B>A:0.25");
  });

  it("drops repeated contributions by default", () => {
    const rows = [["A-1", "5", "5", "5"]];
    const same: Fields<Key> = [
      fields[0]!,
      { ...fields[1]!, collects: { parse: value => (value ? `X:${value}` : undefined) } },
    ];

    expect(normalizeTableData(mappedColumns(), rows, same)[0]!.conversions).toBe("X:5");
  });

  it("keeps repeats when asked", () => {
    const same: Fields<Key> = [
      fields[0]!,
      { ...fields[1]!, collects: { parse: value => (value ? `X:${value}` : undefined), unique: false } },
    ];

    expect(normalizeTableData(mappedColumns(), [["A-1", "5", "5", "5"]], same)[0]!.conversions).toBe("X:5|X:5|X:5");
  });

  it("honours a custom separator", () => {
    const commas: Fields<Key> = [fields[0]!, { ...fields[1]!, collects: { ...fields[1]!.collects, separator: ", " } }];

    expect(normalizeTableData(mappedColumns(), [["A-1", "1", "2", "3"]], commas)[0]!.conversions).toContain(", ");
  });

  it("falls back to the raw cells with no parse", () => {
    const raw: Fields<Key> = [fields[0]!, { ...fields[1]!, collects: {} }];

    expect(normalizeTableData(mappedColumns(), [["A-1", "a", "b", "c"]], raw)[0]!.conversions).toBe("a|b|c");
  });

  it("leaves exclusive fields exclusive", () => {
    // Two columns both auto-match `sku`; the closer one keeps it.
    const columns = getMatchedColumns(createColumns<Key>(["SKU", "SKUs"]), fields, [], 2);

    expect(columns.filter(column => "value" in column && column.value === "sku")).toHaveLength(1);
  });
});

describe("collecting fields through the importer", () => {
  const build = async () => {
    const importer = createImporter<Key>({ fields, parser: createCsvParser() });
    await importer.selectFile(
      fileFromString("c.csv", ["SKU,stuks per m2,m2 per pallet,stuks per pallet", "A-1,11,8,21,240"].join("\n")),
    );
    await importer.selectHeaderRow(0);
    return importer;
  };

  it("does not release a column when a second one takes the same field", async () => {
    const importer = await build();

    importer.setColumnField(1, "conversions");
    importer.setColumnField(2, "conversions");
    importer.setColumnField(3, "conversions");

    const mapped = importer.getState().columns.filter(column => "value" in column && column.value === "conversions");
    expect(mapped).toHaveLength(3);
    expect(mapped.every(column => column.type === ColumnType.matched)).toBe(true);
  });

  it("still releases a column for an exclusive field", async () => {
    const importer = await build();

    importer.setColumnField(1, "sku");
    // Column 0 auto-matched `sku`; assigning it to column 1 must clear it.
    expect(importer.getState().columns[0]!.type).toBe(ColumnType.empty);
    expect(importer.getState().columns[1]).toMatchObject({ value: "sku" });
  });

  it("produces one combined value on the row", async () => {
    const importer = await build();
    importer.setColumnField(1, "conversions");
    importer.setColumnField(2, "conversions");
    importer.setColumnField(3, "conversions");
    await importer.commitColumns();

    // The CSV has an unquoted comma decimal, so "11,8" arrives as two cells —
    // which is exactly why the contributions are per column, not per value.
    expect(String(importer.getState().rows[0]!.conversions)).toContain("M2>STUKS:");
    expect(String(importer.getState().rows[0]!.conversions).split("|")).toHaveLength(3);
  });
});

describe("auto-matching and manual matching agree", () => {
  it("maps every column that names a collecting field", () => {
    // Four "A per B" columns, one target field. Under the claim contest that
    // exclusive fields go through, three of these would have been released.
    const headers = ["SKU", "stuks per m2", "m2 per pallet", "stuks per pallet"];
    const withMatches: Fields<Key> = [
      fields[0]!,
      { ...fields[1]!, alternateMatches: ["stuks per m2", "m2 per pallet", "stuks per pallet"] },
    ];

    const columns = getMatchedColumns(createColumns<Key>(headers), withMatches, [], 2);
    const mapped = columns.filter(column => "value" in column && column.value === "conversions");

    expect(mapped).toHaveLength(3);
  });

  it("still holds the contest for an exclusive field", () => {
    const exclusive: Fields<Key> = [{ ...fields[0]!, alternateMatches: ["artikelnr", "artikelnummer"] }, fields[1]!];

    const columns = getMatchedColumns(createColumns<Key>(["artikelnr", "artikelnummer"]), exclusive, [], 2);
    expect(columns.filter(column => "value" in column && column.value === "sku")).toHaveLength(1);
  });
});
