import { describe, expect, it } from "vitest";
import { createImporter, type Field, type ImportResult } from "../src/index.js";
import { createCsvParser } from "../src/parsers/index.js";
import { fileFromString } from "./helpers.js";

/**
 * The README's quick-start example, run for real.
 *
 * Documentation rots silently; a test does not. If the field shape or the
 * result shape ever changes, this fails before anyone follows a README that no
 * longer works.
 */

// --- copied from README "Quick start" ---------------------------------------
const fields = [
  {
    key: "email",
    label: "Email",
    example: "jan@example.com",
    alternateMatches: ["e-mail", "mail address"],
    fieldType: { type: "input" },
    validations: [
      { rule: "required" },
      { rule: "unique", caseInsensitive: true },
      { rule: "regex", value: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", errorMessage: "Not a valid email" },
    ],
  },
  { key: "salary", label: "Salary", fieldType: { type: "number", integer: true, min: 0 } },
  { key: "startDate", label: "Start date", fieldType: { type: "date" } },
] as const satisfies readonly Field<"email" | "salary" | "startDate">[];
// ----------------------------------------------------------------------------

type Key = (typeof fields)[number]["key"];

describe("the README quick start", () => {
  it("produces exactly the record the README shows", async () => {
    let received: ImportResult<Key> | undefined;

    const importer = createImporter<Key>({
      fields,
      parser: createCsvParser(),
      onSubmit: result => {
        received = result;
      },
    });

    await importer.selectFile(
      fileFromString("people.csv", "Email,Salary,Start date\njan@example.com,45000,2024-03-15"),
    );
    await importer.selectHeaderRow(0);
    await importer.commitColumns();
    await importer.submit();

    // The exact line the README prints in its comment.
    expect(received!.validData[0]).toEqual({
      email: "jan@example.com",
      salary: 45000,
      startDate: "2024-03-15",
    });
  });

  it("matches the documented header spellings without configuration", async () => {
    const importer = createImporter<Key>({ fields, parser: createCsvParser() });

    // "E-Mail" is an alternateMatch; "start_date" only differs by separator
    // and case, which header normalization folds away.
    await importer.selectFile(fileFromString("p.csv", "E-Mail,SALARY,start_date\na@b.co,1,2024-01-01"));
    await importer.selectHeaderRow(0);

    expect(importer.getState().columns.map(column => ("value" in column ? column.value : null))).toEqual([
      "email",
      "salary",
      "startDate",
    ]);
  });

  it("splits the result the way the README describes", async () => {
    const importer = createImporter<Key>({ fields, parser: createCsvParser() });

    await importer.selectFile(
      fileFromString(
        "p.csv",
        ["Email,Salary,Start date", "a@b.co,1,2024-01-01", "not-an-email,2,2024-01-02", "c@d.co,3,2024-01-03"].join(
          "\n",
        ),
      ),
    );
    await importer.selectHeaderRow(0);
    await importer.commitColumns();

    const result = importer.getResult();

    // validData is safe to persist; invalidData is what the user chose to keep.
    expect(result.validData).toHaveLength(2);
    expect(result.invalidData).toHaveLength(1);
    expect(result.all).toHaveLength(3);

    // `all` keeps the metadata for reporting failures back to the user.
    expect(result.all[0]).toHaveProperty("__index");
    expect(result.all[1]!.__errors?.email?.message).toBe("Not a valid email");
    // validData is free of it.
    expect(result.validData[0]).not.toHaveProperty("__errors");
  });

  it("honours the documented checkbox vocabulary", async () => {
    const checkbox = [
      { key: "active", label: "Active", fieldType: { type: "checkbox", booleanMatches: { ja: true, nee: false } } },
    ] as const satisfies readonly Field<"active">[];

    const importer = createImporter<"active">({ fields: checkbox, parser: createCsvParser() });
    await importer.selectFile(
      fileFromString("c.csv", ["Active", "true", "yes", "y", "1", "on", "x", "✓", "no", "0", "ja", "nee"].join("\n")),
    );
    await importer.selectHeaderRow(0);
    await importer.commitColumns();

    expect(importer.getState().rows.map(row => row.active)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
    ]);
  });
});
