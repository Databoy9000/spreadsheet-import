import { describe, expect, it } from "vitest";
import {
  createColumns,
  findUnmatchedRequiredFields,
  getFieldOptions,
  getMatchedColumns,
  setColumn,
  setIgnoreColumn,
  setSubColumn,
  uniqueEntries,
} from "../src/matching/columns.js";
import { findBestMatch, findMatch, normalizeHeader } from "../src/matching/findMatch.js";
import { levenshtein } from "../src/matching/levenshtein.js";
import { ColumnType, type Field, type Fields } from "../src/types.js";
import { type EmployeeKey, employeeFields } from "./helpers.js";

describe("levenshtein", () => {
  it.each([
    ["", "", 0],
    ["abc", "abc", 0],
    ["", "abc", 3],
    ["abc", "", 3],
    ["kitten", "sitting", 3],
    ["flaw", "lawn", 2],
    ["email", "e-mail", 1],
  ])("distance(%s, %s) = %i", (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
  });

  it("is symmetric", () => {
    expect(levenshtein("saturday", "sunday")).toBe(levenshtein("sunday", "saturday"));
  });

  it("reports max+1 once the distance provably exceeds max", () => {
    // Early exit must never claim a distance below the true one.
    expect(levenshtein("abcdefgh", "zzzzzzzz", 2)).toBeGreaterThan(2);
    expect(levenshtein("kitten", "sitting", 1)).toBeGreaterThan(1);
  });

  it("returns the exact distance when it is within max", () => {
    expect(levenshtein("kitten", "sitting", 5)).toBe(3);
  });

  it("handles long strings without blowing up", () => {
    const a = "x".repeat(2000);
    const b = `${"x".repeat(1999)}y`;
    expect(levenshtein(a, b)).toBe(1);
  });
});

describe("normalizeHeader", () => {
  it.each([
    ["First Name", "firstname"],
    ["firstName", "firstname"],
    ["FIRST_NAME", "firstname"],
    ["first-name", "firstname"],
    ["  First   Name  ", "firstname"],
    ["département", "departement"],
    ["E-mail Adres", "emailadres"],
    ["Åsa", "asa"],
    ["", ""],
    ["!!!", ""],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });
});

describe("findMatch", () => {
  const fields: Fields<"firstName" | "lastName"> = [
    { key: "firstName", label: "First Name", fieldType: { type: "input" } },
    { key: "lastName", label: "Last Name", alternateMatches: ["achternaam"], fieldType: { type: "input" } },
  ];

  it("matches a spaced, title-cased header to a camelCase key", () => {
    // This is the case upstream got wrong: raw distance is 4, over the default budget of 2.
    expect(findMatch("First Name", fields, 2)).toBe("firstName");
  });

  it("matches via the label", () => {
    expect(findMatch("first name", fields, 0)).toBe("firstName");
  });

  it("matches via alternateMatches", () => {
    expect(findMatch("Achternaam", fields, 0)).toBe("lastName");
  });

  it("tolerates typos within the distance budget", () => {
    expect(findMatch("Frist Name", fields, 2)).toBe("firstName");
  });

  it("returns undefined beyond the budget", () => {
    expect(findMatch("Completely Unrelated", fields, 2)).toBeUndefined();
  });

  it("returns undefined for a blank header", () => {
    expect(findMatch("", fields, 5)).toBeUndefined();
    expect(findMatch("   ", fields, 5)).toBeUndefined();
  });

  it("prefers the closer field when several are in range", () => {
    const ambiguous: Fields<"name" | "nameOfCompany"> = [
      { key: "nameOfCompany", label: "Company", fieldType: { type: "input" } },
      { key: "name", label: "Name", fieldType: { type: "input" } },
    ];
    expect(findMatch("name", ambiguous, 4)).toBe("name");
  });

  it("reports the distance it matched at", () => {
    expect(findBestMatch("First Name", fields, 2)).toEqual({ key: "firstName", distance: 0 });
  });
});

describe("createColumns", () => {
  it("starts every column empty and index-aligned", () => {
    expect(createColumns(["a", "b"])).toEqual([
      { type: ColumnType.empty, index: 0, header: "a" },
      { type: ColumnType.empty, index: 1, header: "b" },
    ]);
  });

  it("keeps positions for holes in a ragged row", () => {
    const sparse: (string | undefined)[] = ["a"];
    sparse[2] = "c";
    const columns = createColumns(sparse);

    expect(columns).toHaveLength(3);
    expect(columns[1]).toEqual({ type: ColumnType.empty, index: 1, header: "" });
    expect(columns[2]?.index).toBe(2);
  });
});

describe("setColumn", () => {
  const rows = [["Engineering"], ["Sales"], ["Engineering"], [""]];

  it("clears a column when no field is given", () => {
    const column = setColumn({ type: ColumnType.matched, index: 0, header: "h", value: "x" });
    expect(column.type).toBe(ColumnType.empty);
    expect("value" in column).toBe(false);
  });

  it("marks an input field as matched", () => {
    const field: Field<"a"> = { key: "a", label: "A", fieldType: { type: "input" } };
    expect(setColumn({ type: ColumnType.empty, index: 0, header: "h" }, field)).toEqual({
      index: 0,
      header: "h",
      type: ColumnType.matched,
      value: "a",
    });
  });

  it("collects distinct entries for a select field", () => {
    const field: Field<"dept"> = {
      key: "dept",
      label: "Dept",
      fieldType: { type: "select", options: [{ label: "Engineering", value: "eng" }] },
    };
    const column = setColumn({ type: ColumnType.empty, index: 0, header: "h" }, field, rows);

    expect(column.type).toBe(ColumnType.matchedSelect);
    expect("matchedOptions" in column && column.matchedOptions).toEqual([{ entry: "Engineering" }, { entry: "Sales" }]);
  });

  it("auto-maps select values by label and by value", () => {
    const field: Field<"dept"> = {
      key: "dept",
      label: "Dept",
      fieldType: {
        type: "select",
        options: [
          { label: "Engineering", value: "eng" },
          { label: "Sales", value: "sales" },
        ],
      },
    };
    const column = setColumn({ type: ColumnType.empty, index: 0, header: "h" }, field, rows, true);

    expect(column.type).toBe(ColumnType.matchedSelectOptions);
    expect("matchedOptions" in column && column.matchedOptions).toEqual([
      { entry: "Engineering", value: "eng" },
      { entry: "Sales", value: "sales" },
    ]);
  });

  it("stays partially matched when an entry has no option", () => {
    const field: Field<"dept"> = {
      key: "dept",
      label: "Dept",
      fieldType: { type: "select", options: [{ label: "Engineering", value: "eng" }] },
    };
    const column = setColumn({ type: ColumnType.empty, index: 0, header: "h" }, field, rows, true);
    expect(column.type).toBe(ColumnType.matchedSelect);
  });

  it("treats a select column with no data as fully matched", () => {
    const field: Field<"dept"> = {
      key: "dept",
      label: "Dept",
      fieldType: { type: "select", options: [] },
    };
    const column = setColumn({ type: ColumnType.empty, index: 0, header: "h" }, field, [], true);
    expect(column.type).toBe(ColumnType.matchedSelectOptions);
  });
});

describe("setSubColumn", () => {
  const base = {
    index: 0,
    header: "h",
    type: ColumnType.matchedSelect,
    value: "dept" as const,
    matchedOptions: [{ entry: "Engineering" }, { entry: "Sales" }],
  };

  it("assigns one entry and stays partial", () => {
    const column = setSubColumn(base, "Engineering", "eng");
    expect(column.type).toBe(ColumnType.matchedSelect);
    expect("matchedOptions" in column && column.matchedOptions[0]).toEqual({ entry: "Engineering", value: "eng" });
  });

  it("flips to fully matched once the last entry is assigned", () => {
    const partial = setSubColumn(base, "Engineering", "eng");
    const complete = setSubColumn(partial, "Sales", "sales");
    expect(complete.type).toBe(ColumnType.matchedSelectOptions);
  });

  it("leaves columns without options untouched", () => {
    const column = { index: 0, header: "h", type: ColumnType.matched, value: "a" as const };
    expect(setSubColumn(column, "x", "y")).toBe(column);
  });
});

describe("getMatchedColumns", () => {
  it("auto-maps the fixture headers", () => {
    const headers = ["First Name", "Achternaam", "E-mail Adres", "département", "isActive", "start_date", "Salary"];
    const columns = getMatchedColumns(createColumns<EmployeeKey>(headers), employeeFields, [], 2);

    expect(columns.map(column => ("value" in column ? column.value : null))).toEqual([
      "firstName",
      "lastName",
      "email",
      "department",
      "active",
      "startDate",
      "salary",
    ]);
  });

  it("gives a contested field to the closer header and clears the loser", () => {
    const fields: Fields<"email"> = [{ key: "email", label: "Email", fieldType: { type: "input" } }];
    // "emails" is one edit away, "email" is exact — the later, better column wins.
    const columns = getMatchedColumns(createColumns<"email">(["emails", "email"]), fields, [], 2);

    expect(columns[0]?.type).toBe(ColumnType.empty);
    expect(columns[1]).toMatchObject({ type: ColumnType.matched, value: "email" });
  });

  it("keeps the earlier header when the later one is a worse fit", () => {
    const fields: Fields<"email"> = [{ key: "email", label: "Email", fieldType: { type: "input" } }];
    const columns = getMatchedColumns(createColumns<"email">(["email", "emails"]), fields, [], 2);

    expect(columns[0]).toMatchObject({ type: ColumnType.matched, value: "email" });
    expect(columns[1]?.type).toBe(ColumnType.empty);
  });

  it("keeps the first header when two normalize to the same thing", () => {
    const fields: Fields<"email"> = [{ key: "email", label: "Email", fieldType: { type: "input" } }];
    // Normalization makes "E-MAIL" and "Email" identical, so this is a tie.
    const columns = getMatchedColumns(createColumns<"email">(["Email", "E-MAIL"]), fields, [], 2);

    expect(columns[0]).toMatchObject({ type: ColumnType.matched, value: "email" });
    expect(columns[1]?.type).toBe(ColumnType.empty);
  });

  it("preserves column count and index alignment", () => {
    const headers = ["nope", "First Name", "also nope"];
    const columns = getMatchedColumns(createColumns<EmployeeKey>(headers), employeeFields, [], 2);

    expect(columns).toHaveLength(3);
    expect(columns.map(column => column.index)).toEqual([0, 1, 2]);
    expect(columns[1]).toMatchObject({ value: "firstName" });
  });

  it("leaves everything empty when nothing is close enough", () => {
    const columns = getMatchedColumns(createColumns<EmployeeKey>(["zzz", "qqq"]), employeeFields, [], 1);
    expect(columns.every(column => column.type === ColumnType.empty)).toBe(true);
  });
});

describe("uniqueEntries", () => {
  it("returns distinct non-empty values in first-seen order", () => {
    const rows = [["b"], ["a"], ["b"], [""], [undefined], ["a"], ["c"]];
    expect(uniqueEntries(rows, 0)).toEqual(["b", "a", "c"]);
  });
});

describe("findUnmatchedRequiredFields", () => {
  it("lists labels of required fields with no column", () => {
    const columns = createColumns<EmployeeKey>(["First Name"]);
    const matched = getMatchedColumns(columns, employeeFields, [], 2);
    expect(findUnmatchedRequiredFields(employeeFields, matched)).toEqual(["Last Name", "Email"]);
  });

  it("returns nothing when every required field is mapped", () => {
    const columns = getMatchedColumns(
      createColumns<EmployeeKey>(["First Name", "Achternaam", "E-mail Adres"]),
      employeeFields,
      [],
      2,
    );
    expect(findUnmatchedRequiredFields(employeeFields, columns)).toEqual([]);
  });
});

describe("getFieldOptions", () => {
  it("returns options for a select field", () => {
    expect(getFieldOptions(employeeFields, "department")).toHaveLength(4);
  });

  it("returns an empty list for non-select fields and unknown keys", () => {
    expect(getFieldOptions(employeeFields, "firstName")).toEqual([]);
    expect(getFieldOptions(employeeFields, "nope" as EmployeeKey)).toEqual([]);
  });
});

describe("setIgnoreColumn", () => {
  it("drops the field assignment", () => {
    const column = setIgnoreColumn({ type: ColumnType.matched, index: 3, header: "h", value: "a" });
    expect(column).toEqual({ type: ColumnType.ignored, index: 3, header: "h" });
  });
});
