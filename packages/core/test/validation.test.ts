import { describe, expect, it, vi } from "vitest";
import { ErrorSource, type Fields, type RowData, type ValidatedRow } from "../src/types.js";
import { isRowValid, stripMeta, validateTable } from "../src/validation/engine.js";

type Key = "name" | "email" | "age";

const fields: Fields<Key> = [
  { key: "name", label: "Name", fieldType: { type: "input" }, validations: [{ rule: "required" }] },
  {
    key: "email",
    label: "Email",
    fieldType: { type: "input" },
    validations: [{ rule: "unique", errorMessage: "duplicate" }],
  },
  {
    key: "age",
    label: "Age",
    fieldType: { type: "input" },
    validations: [{ rule: "regex", value: "^\\d+$", errorMessage: "digits only" }],
  },
];

const rows = (...values: Partial<RowData<Key>>[]) => values as RowData<Key>[];

describe("validateTable", () => {
  it("gives every row a stable id", async () => {
    const result = await validateTable(rows({ name: "a" }, { name: "b" }), { fields });

    expect(result[0]!.__index).toBeTruthy();
    expect(result[1]!.__index).toBeTruthy();
    expect(result[0]!.__index).not.toBe(result[1]!.__index);
  });

  it("keeps ids across revalidation", async () => {
    const first = await validateTable(rows({ name: "a" }), { fields });
    const second = await validateTable(first, { fields });
    expect(second[0]!.__index).toBe(first[0]!.__index);
  });

  it("flags missing required values", async () => {
    const result = await validateTable(rows({ name: "" }, { name: undefined }, { name: "ok" }), { fields });

    expect(result[0]!.__errors?.name?.message).toBe("Name is required");
    expect(result[1]!.__errors?.name).toBeDefined();
    expect(result[2]!.__errors?.name).toBeUndefined();
  });

  it("flags every member of a duplicate group", async () => {
    const result = await validateTable(
      rows({ name: "a", email: "x@y.z" }, { name: "b", email: "x@y.z" }, { name: "c", email: "other@y.z" }),
      { fields },
    );

    expect(result[0]!.__errors?.email?.message).toBe("duplicate");
    expect(result[1]!.__errors?.email?.message).toBe("duplicate");
    expect(result[2]!.__errors?.email).toBeUndefined();
  });

  it("can compare uniqueness case-insensitively", async () => {
    const caseFields: Fields<Key> = [
      {
        key: "email",
        label: "Email",
        fieldType: { type: "input" },
        validations: [{ rule: "unique", caseInsensitive: true }],
      },
    ];
    const result = await validateTable(rows({ email: "A@B.C" }, { email: "a@b.c" }), { fields: caseFields });

    expect(result[0]!.__errors?.email).toBeDefined();
    expect(result[1]!.__errors?.email).toBeDefined();
  });

  it("treats several empty values as duplicates unless allowEmpty is set", async () => {
    const strict: Fields<"email"> = [
      { key: "email", label: "Email", fieldType: { type: "input" }, validations: [{ rule: "unique" }] },
    ];
    const lenient: Fields<"email"> = [
      {
        key: "email",
        label: "Email",
        fieldType: { type: "input" },
        validations: [{ rule: "unique", allowEmpty: true }],
      },
    ];
    const input = [{ email: "" }, { email: "" }] as RowData<"email">[];

    expect((await validateTable(input, { fields: strict }))[0]!.__errors?.email).toBeDefined();
    expect((await validateTable(input, { fields: lenient }))[0]!.__errors?.email).toBeUndefined();
  });

  it("applies regex only to non-empty values", async () => {
    const result = await validateTable(rows({ name: "a", age: "12" }, { name: "b", age: "abc" }, { name: "c" }), {
      fields,
    });

    expect(result[0]!.__errors?.age).toBeUndefined();
    expect(result[1]!.__errors?.age?.message).toBe("digits only");
    // Optional and empty is the `required` rule's business, not the regex's.
    expect(result[2]!.__errors?.age).toBeUndefined();
  });

  it("is not confused by a global regex flag across rows", async () => {
    // A shared /g regex carries lastIndex between calls; every row must be judged independently.
    const globalFields: Fields<"code"> = [
      {
        key: "code",
        label: "Code",
        fieldType: { type: "input" },
        validations: [{ rule: "regex", value: "^[A-Z]{3}$", flags: "g" }],
      },
    ];
    const result = await validateTable([{ code: "ABC" }, { code: "DEF" }, { code: "GHI" }] as RowData<"code">[], {
      fields: globalFields,
    });

    expect(result.every(row => row.__errors === null)).toBe(true);
  });

  it("supports custom predicates", async () => {
    const customFields: Fields<"a" | "b"> = [
      {
        key: "b",
        label: "B",
        fieldType: { type: "input" },
        validations: [
          {
            rule: "custom",
            validate: (value, row) => String(value ?? "") > String(row.a ?? ""),
            errorMessage: "b must sort after a",
          },
        ],
      },
    ];
    const result = await validateTable(
      [
        { a: "m", b: "z" },
        { a: "m", b: "a" },
      ] as RowData<"a" | "b">[],
      {
        fields: customFields,
      },
    );

    expect(result[0]!.__errors).toBeNull();
    expect(result[1]!.__errors?.b?.message).toBe("b must sort after a");
  });

  it("keeps the first error on a cell rather than the last", async () => {
    const layered: Fields<"x"> = [
      {
        key: "x",
        label: "X",
        fieldType: { type: "input" },
        validations: [
          { rule: "required", errorMessage: "first" },
          { rule: "custom", validate: () => false, errorMessage: "second" },
        ],
      },
    ];
    const result = await validateTable([{ x: "" }] as RowData<"x">[], { fields: layered });
    expect(result[0]!.__errors?.x?.message).toBe("first");
  });

  it("records the error source", async () => {
    const result = await validateTable(rows({ name: "", email: "dup" }, { name: "b", email: "dup" }), { fields });

    expect(result[0]!.__errors?.name?.source).toBe(ErrorSource.Row);
    expect(result[0]!.__errors?.email?.source).toBe(ErrorSource.Table);
  });

  describe("hooks", () => {
    it("lets a rowHook rewrite values", async () => {
      const rowHook = vi.fn((row: RowData<Key>) => ({ ...row, name: String(row.name ?? "").toUpperCase() }));
      const result = await validateTable(rows({ name: "jan" }), { fields, rowHook });

      expect(result[0]!.name).toBe("JAN");
      expect(rowHook).toHaveBeenCalledTimes(1);
    });

    it("lets a rowHook add errors", async () => {
      const result = await validateTable(rows({ name: "jan" }), {
        fields,
        rowHook: (row, addError) => {
          addError("name", { message: "nope", level: "warning" });
          return row;
        },
      });

      expect(result[0]!.__errors?.name).toMatchObject({ message: "nope", level: "warning", source: ErrorSource.Row });
    });

    it("awaits an async rowHook", async () => {
      const result = await validateTable(rows({ name: "a" }), {
        fields,
        rowHook: async row => {
          await Promise.resolve();
          return { ...row, name: "async" };
        },
      });
      expect(result[0]!.name).toBe("async");
    });

    it("lets a tableHook rewrite the table and add positional errors", async () => {
      const result = await validateTable(rows({ name: "a" }, { name: "b" }), {
        fields,
        tableHook: (table, addError) => {
          addError(1, "name", { message: "second row is suspect", level: "info" });
          return table.map(row => ({ ...row, age: "1" }));
        },
      });

      expect(result[0]!.age).toBe("1");
      expect(result[1]!.__errors?.name?.message).toBe("second row is suspect");
    });

    it("rejects a tableHook that changes the row count", async () => {
      await expect(
        validateTable(rows({ name: "a" }, { name: "b" }), { fields, tableHook: table => table.slice(0, 1) }),
      ).rejects.toThrow(/same number of rows/);
    });

    it("preserves row meta a hook forgot to return", async () => {
      const first = await validateTable(rows({ name: "a" }), { fields });
      const id = first[0]!.__index;

      // A hook that rebuilds rows from scratch is common and must not orphan identity.
      const second = await validateTable(first, { fields, tableHook: table => table.map(row => ({ ...row })) });
      expect(second[0]!.__index).toBe(id);
    });
  });

  describe("partial revalidation", () => {
    const build = () =>
      validateTable(rows({ name: "", email: "dup" }, { name: "b", email: "dup" }, { name: "c", email: "unique" }), {
        fields,
      });

    it("runs row rules only for the listed rows", async () => {
      const initial = await build();
      const rowHook = vi.fn((row: RowData<Key>) => row);

      await validateTable(initial, { fields, rowHook, changedRowIndexes: [1] });
      expect(rowHook).toHaveBeenCalledTimes(1);
    });

    it("keeps row errors of untouched rows", async () => {
      const initial = await build();
      const next = [...initial];
      next[1] = { ...next[1]!, email: "now-unique" } as ValidatedRow<Key>;

      const result = await validateTable(next, { fields, changedRowIndexes: [1] });

      // Row 0 was not revalidated, but its required error must survive...
      expect(result[0]!.__errors?.name?.message).toBe("Name is required");
      // ...while its table-scoped duplicate error is gone, because the clash was resolved.
      expect(result[0]!.__errors?.email).toBeUndefined();
      expect(result[1]!.__errors).toBeNull();
    });

    it("clears errors on a row that was fixed", async () => {
      const initial = await build();
      const next = [...initial];
      next[0] = { ...next[0]!, name: "fixed", email: "also-unique" } as ValidatedRow<Key>;

      const result = await validateTable(next, { fields, changedRowIndexes: [0] });
      expect(result[0]!.__errors).toBeNull();
    });

    it("re-adds a duplicate error to an untouched row when a new clash appears", async () => {
      const initial = await validateTable(rows({ name: "a", email: "one" }, { name: "b", email: "two" }), { fields });
      const next = [...initial];
      next[1] = { ...next[1]!, email: "one" } as ValidatedRow<Key>;

      const result = await validateTable(next, { fields, changedRowIndexes: [1] });

      expect(result[0]!.__errors?.email?.message).toBe("duplicate");
      expect(result[1]!.__errors?.email?.message).toBe("duplicate");
    });
  });

  it("handles an empty table", async () => {
    await expect(validateTable([], { fields })).resolves.toEqual([]);
  });
});

describe("isRowValid", () => {
  const row = (errors: ValidatedRow<Key>["__errors"]) => ({ __index: "1", __errors: errors }) as ValidatedRow<Key>;

  it("is true without errors", () => {
    expect(isRowValid(row(null))).toBe(true);
  });

  it("is true when every error is below error level", () => {
    expect(isRowValid(row({ name: { message: "m", level: "warning", source: ErrorSource.Row } }))).toBe(true);
    expect(isRowValid(row({ name: { message: "m", level: "info", source: ErrorSource.Row } }))).toBe(true);
  });

  it("is false with an error-level problem", () => {
    expect(isRowValid(row({ name: { message: "m", level: "error", source: ErrorSource.Row } }))).toBe(false);
  });
});

describe("stripMeta", () => {
  it("removes bookkeeping keys", () => {
    const row = { name: "a", __index: "1", __errors: null } as ValidatedRow<Key>;
    expect(stripMeta(row)).toEqual({ name: "a" });
  });
});
