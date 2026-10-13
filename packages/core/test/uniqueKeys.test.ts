import { describe, expect, it } from "vitest";
import { createImporter } from "../src/importer.js";
import { createCsvParser } from "../src/parsers/csv.js";
import type { Field, RowData } from "../src/types.js";
import { validateTable } from "../src/validation/engine.js";
import { fileFromString } from "./helpers.js";

type Key = "productId" | "variant" | "price";

const fields: readonly Field<Key>[] = [
  { key: "productId", label: "Product ID", fieldType: { type: "input" } },
  { key: "variant", label: "Variant", fieldType: { type: "input" } },
  { key: "price", label: "Price", fieldType: { type: "number" } },
];

const rows = (...values: Partial<RowData<Key>>[]) => values as RowData<Key>[];

describe("compound unique keys", () => {
  it("accepts a repeated single field when the pair is distinct", async () => {
    // One promo card with a variant table under it: the id repeats by design.
    const result = await validateTable(
      rows(
        { productId: "5562", variant: "3m05" },
        { productId: "5562", variant: "4m58" },
        { productId: "5562", variant: "6m10" },
      ),
      { fields, uniqueKeys: [{ fields: ["productId", "variant"] }] },
    );

    expect(result.every(row => row.__errors === null)).toBe(true);
  });

  it("flags a repeated pair", async () => {
    const result = await validateTable(
      rows(
        { productId: "5562", variant: "3m05" },
        { productId: "5562", variant: "3m05" },
        { productId: "5562", variant: "4m58" },
      ),
      { fields, uniqueKeys: [{ fields: ["productId", "variant"] }] },
    );

    expect(result[0]!.__errors?.productId?.message).toBe("Product ID + Variant must be unique together");
    expect(result[1]!.__errors?.productId).toBeDefined();
    expect(result[2]!.__errors).toBeNull();
  });

  it("marks every field of the key, so a UI can highlight the whole key", async () => {
    const result = await validateTable(rows({ productId: "a", variant: "b" }, { productId: "a", variant: "b" }), {
      fields,
      uniqueKeys: [{ fields: ["productId", "variant"] }],
    });

    expect(result[0]!.__errors?.productId).toBeDefined();
    expect(result[0]!.__errors?.variant).toBeDefined();
    // Fields outside the key are untouched.
    expect(result[0]!.__errors?.price).toBeUndefined();
  });

  it("does not confuse a separator inside a value with a field boundary", async () => {
    // Joined naively on "|", ("a|b","c") and ("a","b|c") would collide.
    const result = await validateTable(rows({ productId: "a|b", variant: "c" }, { productId: "a", variant: "b|c" }), {
      fields,
      uniqueKeys: [{ fields: ["productId", "variant"] }],
    });

    expect(result.every(row => row.__errors === null)).toBe(true);
  });

  it("can compare case-insensitively", async () => {
    const strict = await validateTable(rows({ productId: "AB", variant: "x" }, { productId: "ab", variant: "X" }), {
      fields,
      uniqueKeys: [{ fields: ["productId", "variant"] }],
    });
    expect(strict[0]!.__errors).toBeNull();

    const lenient = await validateTable(rows({ productId: "AB", variant: "x" }, { productId: "ab", variant: "X" }), {
      fields,
      uniqueKeys: [{ fields: ["productId", "variant"], caseInsensitive: true }],
    });
    expect(lenient[0]!.__errors?.productId).toBeDefined();
  });

  it("can skip rows with an empty part", async () => {
    const input = rows({ productId: "a" }, { productId: "a" });

    const strict = await validateTable(input, { fields, uniqueKeys: [{ fields: ["productId", "variant"] }] });
    expect(strict[0]!.__errors?.productId).toBeDefined();

    const lenient = await validateTable(input, {
      fields,
      uniqueKeys: [{ fields: ["productId", "variant"], allowEmpty: true }],
    });
    expect(lenient[0]!.__errors).toBeNull();
  });

  it("supports a single-field key, and several constraints at once", async () => {
    const result = await validateTable(
      rows(
        { productId: "1", variant: "a", price: 1 },
        { productId: "2", variant: "a", price: 1 },
        { productId: "1", variant: "b", price: 2 },
      ),
      {
        fields,
        uniqueKeys: [
          { fields: ["productId"], errorMessage: "id twice" },
          { fields: ["variant", "price"], errorMessage: "variant+price twice" },
        ],
      },
    );

    expect(result[0]!.__errors?.productId?.message).toBe("id twice");
    expect(result[2]!.__errors?.productId?.message).toBe("id twice");
    expect(result[0]!.__errors?.variant?.message).toBe("variant+price twice");
    expect(result[1]!.__errors?.variant?.message).toBe("variant+price twice");
  });

  it("honours a custom level", async () => {
    const result = await validateTable(rows({ productId: "a" }, { productId: "a" }), {
      fields,
      uniqueKeys: [{ fields: ["productId"], level: "warning" }],
    });

    expect(result[0]!.__errors?.productId?.level).toBe("warning");
    // A warning does not keep the row out of validData.
    expect(result[0]!.__errors?.productId).toBeDefined();
  });

  it("compares numbers by value, not by how they were typed", async () => {
    const result = await validateTable(rows({ productId: "a", price: 1 }, { productId: "a", price: 1.0 }), {
      fields,
      uniqueKeys: [{ fields: ["productId", "price"] }],
    });

    expect(result[0]!.__errors?.productId).toBeDefined();
  });

  it("ignores an empty field list", async () => {
    const result = await validateTable(rows({ productId: "a" }, { productId: "a" }), {
      fields,
      uniqueKeys: [{ fields: [] }],
    });
    expect(result[0]!.__errors).toBeNull();
  });
});

describe("compound keys through the importer", () => {
  const importFrom = async (csv: string, uniqueKeys: Parameters<typeof createImporter<Key>>[0]["uniqueKeys"]) => {
    const importer = createImporter<Key>({
      fields,
      parser: createCsvParser(),
      ...(uniqueKeys ? { uniqueKeys } : {}),
    });
    await importer.selectFile(fileFromString("p.csv", csv));
    await importer.selectHeaderRow(0);
    await importer.commitColumns();
    return importer;
  };

  const CSV = ["Product ID,Variant,Price", "5562,3m05,10", "5562,4m58,20", "5562,3m05,30"].join("\n");

  it("rejects only the genuinely duplicated pair", async () => {
    const importer = await importFrom(CSV, [{ fields: ["productId", "variant"] }]);
    const result = importer.getResult();

    expect(result.all).toHaveLength(3);
    expect(result.invalidData).toHaveLength(2);
    expect(result.validData).toHaveLength(1);
    expect(result.validData[0]!.variant).toBe("4m58");
  });

  it("clears the error once the user edits one half of the key", async () => {
    const importer = await importFrom(CSV, [{ fields: ["productId", "variant"] }]);

    const clashing = importer.getState().rows[2]!;
    await importer.updateCell(clashing.__index, "variant", "6m10");

    expect(importer.getState().rows.every(row => row.__errors === null)).toBe(true);
  });

  it("re-flags when an edit creates a new clash", async () => {
    const importer = await importFrom(CSV, [{ fields: ["productId", "variant"] }]);

    // Fix the original clash, then recreate it on the other row.
    const rowsBefore = importer.getState().rows;
    await importer.updateCell(rowsBefore[2]!.__index, "variant", "6m10");
    await importer.updateCell(rowsBefore[1]!.__index, "variant", "3m05");

    const after = importer.getState().rows;
    expect(after[0]!.__errors?.productId).toBeDefined();
    expect(after[1]!.__errors?.productId).toBeDefined();
    expect(after[2]!.__errors).toBeNull();
  });

  it("does nothing when no key is configured", async () => {
    const importer = await importFrom(CSV, undefined);
    expect(importer.getResult().invalidData).toHaveLength(0);
  });
});
