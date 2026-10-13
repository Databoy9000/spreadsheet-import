import { describe, expect, it } from "vitest";
import { createImporter } from "../src/importer.js";
import { setColumn } from "../src/matching/columns.js";
import { parseDate, parseWithFormat, toDateValue } from "../src/matching/date.js";
import { coerceValue, normalizeTableData } from "../src/matching/normalize.js";
import { createCsvParser } from "../src/parsers/csv.js";
import { ColumnType, type DateFieldType, type Field, type Fields, type RowData } from "../src/types.js";
import { validateTable } from "../src/validation/engine.js";
import { fileFromString } from "./helpers.js";

/** ISO date-only string, or the failure reason — compact for table-driven tests. */
const iso = (input: unknown, options?: DateFieldType) => {
  const result = parseDate(input, options);
  return result.ok ? toDateValue(result.value, result.hasTime) : result.reason;
};

describe("parseDate", () => {
  describe("ISO", () => {
    it.each([
      ["2024-03-15", "2024-03-15"],
      ["2024-3-5", "2024-03-05"],
      ["2024-03-15T10:30:00Z", "2024-03-15T10:30:00.000Z"],
      ["2024-03-15 10:30", "2024-03-15T10:30:00.000Z"],
      ["2024-03-15T10:30:45", "2024-03-15T10:30:45.000Z"],
    ])("reads %j as %s", (input, expected) => {
      expect(iso(input)).toBe(expected);
    });

    it("keeps a date-only cell date-only", () => {
      // Appending a time would invent a timezone the cell never carried.
      expect(iso("2024-03-15")).toBe("2024-03-15");
    });
  });

  describe("empty", () => {
    it.each([undefined, null, "", "   "])("reports %j as empty", input => {
      expect(iso(input)).toBe("empty");
    });
  });

  describe("rejects what is not a date", () => {
    it.each(["hello", "2024-13-01", "2024-02-30", "31/02/2024", "2024", "//", "1/2"])("rejects %j", input => {
      expect(iso(input)).toBe("not-a-date");
    });

    it("does not roll an overflowing day into the next month", () => {
      // `new Date(2024, 1, 31)` silently becomes 2 March, turning a typo into a
      // plausible wrong date.
      expect(iso("2024-02-31")).toBe("not-a-date");
    });
  });

  describe("month names remove the ambiguity", () => {
    it.each([
      ["15 Mar 2024", "2024-03-15"],
      ["15 March 2024", "2024-03-15"],
      ["Mar 15, 2024", "2024-03-15"],
      ["March 15 2024", "2024-03-15"],
    ])("reads English %j as %s without configuration", (input, expected) => {
      expect(iso(input)).toBe(expected);
    });

    it.each([
      ["1 januari 2024", "nl", "2024-01-01"],
      ["15 mei 2024", "nl-BE", "2024-05-15"],
      ["3 décembre 2024", "fr", "2024-12-03"],
      ["15. März 2024", "de", "2024-03-15"],
      ["15 marzo 2024", "es", "2024-03-15"],
    ])("reads %j when the locale %s is given", (input, locale, expected) => {
      expect(iso(input, { type: "date", locale })).toBe(expected);
    });

    it.each([
      ["15 марта 2024", "ru", "2024-03-15"],
      ["15 Μαρτίου 2024", "el", "2024-03-15"],
      ["15 mac 2024", "ms", "2024-03-15"],
    ])("handles non-Latin scripts: %j (%s)", (input, locale, expected) => {
      // Month names come from Intl, so this works for every locale the runtime
      // supports. A hand-written table could never have covered these.
      expect(iso(input, { type: "date", locale })).toBe(expected);
    });

    it("reads the inflected form a date actually uses", () => {
      // Intl's standalone Russian month is "март"; a date says "марта".
      expect(iso("15 марта 2024", { type: "date", locale: "ru" })).toBe("2024-03-15");
      expect(iso("15 март 2024", { type: "date", locale: "ru" })).toBe("2024-03-15");
    });

    it("reads the CJK year-month-day layout", () => {
      // 2024年3月15日 is unambiguous, so it needs no locale and no options.
      expect(iso("2024年3月15日")).toBe("2024-03-15");
      expect(iso("2024年3月15")).toBe("2024-03-15");
    });

    it("accepts several locales at once", () => {
      const options: DateFieldType = { type: "date", locale: ["nl", "fr"] };
      expect(iso("15 mei 2024", options)).toBe("2024-05-15");
      expect(iso("15 mai 2024", options)).toBe("2024-05-15");
      // English stays available whatever else is asked for.
      expect(iso("15 May 2024", options)).toBe("2024-05-15");
    });

    it("ignores an unknown locale tag rather than throwing", () => {
      expect(iso("15 Mar 2024", { type: "date", locale: "not-a-locale" })).toBe("2024-03-15");
    });
  });

  describe("the ambiguous numeric case", () => {
    it("defaults to day first", () => {
      expect(iso("03/04/2024")).toBe("2024-04-03");
    });

    it("obeys dayFirst: false", () => {
      expect(iso("03/04/2024", { type: "date", dayFirst: false })).toBe("2024-03-04");
    });

    it("lets a component over 12 settle the order regardless of the option", () => {
      // 13 cannot be a month, so this is unambiguous whatever the caller said.
      expect(iso("13/04/2024", { type: "date", dayFirst: false })).toBe("2024-04-13");
      expect(iso("04/13/2024", { type: "date", dayFirst: true })).toBe("2024-04-13");
    });

    it("treats a four-digit year first as unambiguous", () => {
      expect(iso("2024/03/15", { type: "date", dayFirst: true })).toBe("2024-03-15");
    });

    it.each([
      ["15.03.2024", "2024-03-15"],
      ["15-03-2024", "2024-03-15"],
      ["15/3/24", "2024-03-15"],
    ])("accepts %j as a separator variant", (input, expected) => {
      expect(iso(input)).toBe(expected);
    });

    it("reads a trailing time", () => {
      expect(iso("15/03/2024 14:05")).toBe("2024-03-15T14:05:00.000Z");
    });
  });

  describe("two-digit years", () => {
    it.each([
      ["01/01/00", "2000-01-01"],
      ["01/01/68", "2068-01-01"],
      ["01/01/69", "1969-01-01"],
      ["01/01/99", "1999-01-01"],
    ])("reads %j as %s", (input, expected) => {
      expect(iso(input)).toBe(expected);
    });
  });

  describe("Excel serial numbers", () => {
    it("reads a serial day", () => {
      // 45366 is 2024-03-15 in Excel's calendar.
      expect(iso("45366")).toBe("2024-03-15");
    });

    it("reads a fractional serial as a time", () => {
      expect(iso("45366.5")).toBe("2024-03-15T12:00:00.000Z");
    });

    it("can be switched off", () => {
      expect(iso("45366", { type: "date", excelSerial: false })).toBe("not-a-date");
    });

    it("does not swallow a bare year", () => {
      // 2024 as a serial would be 1905; a four-digit year is not a date anyway.
      expect(iso("2024")).toBe("not-a-date");
    });
  });

  describe("explicit formats", () => {
    it("uses the first format that matches", () => {
      const options: DateFieldType = { type: "date", formats: ["dd/MM/yyyy", "d MMM yyyy"] };
      expect(iso("15/03/2024", options)).toBe("2024-03-15");
      expect(iso("5 Mar 2024", options)).toBe("2024-03-05");
    });

    it("rejects anything the formats do not cover, with no fallback guessing", () => {
      // The point of giving formats is that nothing is inferred.
      expect(iso("2024-03-15", { type: "date", formats: ["dd/MM/yyyy"] })).toBe("not-a-date");
    });

    it("parses a time in the format", () => {
      expect(parseWithFormat("15/03/2024 14:05", "dd/MM/yyyy HH:mm")).toMatchObject({ ok: true, hasTime: true });
    });

    it("overrides what dayFirst would have done", () => {
      expect(iso("03/04/2024", { type: "date", formats: ["MM/dd/yyyy"], dayFirst: true })).toBe("2024-03-04");
    });
  });

  it("passes a Date through untouched", () => {
    const date = new Date(Date.UTC(2024, 2, 15));
    const result = parseDate(date);
    expect(result.ok && result.value).toBe(date);
  });

  it("is timezone independent", () => {
    // Constructed in local time, "2024-03-15" comes back as the 14th for
    // anyone west of Greenwich once serialized.
    const result = parseDate("2024-03-15");
    expect(result.ok && result.value.toISOString()).toBe("2024-03-15T00:00:00.000Z");
  });
});

describe("toDateValue", () => {
  const date = new Date(Date.UTC(2024, 2, 15, 10, 30));

  it("defaults to an ISO string", () => {
    expect(toDateValue(date, false)).toBe("2024-03-15");
    expect(toDateValue(date, true)).toBe("2024-03-15T10:30:00.000Z");
  });

  it("can return a Date", () => {
    expect(toDateValue(date, false, "date")).toBe(date);
  });

  it("can return a timestamp", () => {
    expect(toDateValue(date, false, "timestamp")).toBe(date.getTime());
  });
});

describe("date columns", () => {
  const fields: Fields<"startDate"> = [{ key: "startDate", label: "Start Date", fieldType: { type: "date" } }];

  it("gets its own column type", () => {
    expect(setColumn({ type: ColumnType.empty, index: 0, header: "Start" }, fields[0]!).type).toBe(
      ColumnType.matchedDate,
    );
  });

  it("normalizes a whole column", () => {
    const columns = [setColumn({ type: ColumnType.empty, index: 0, header: "Start" }, fields[0]!)];
    const rows = [["2024-03-15"], ["15/03/2024"], ["15 Mar 2024"], [""], ["someday"]];

    expect(normalizeTableData(columns, rows, fields)).toEqual([
      { startDate: "2024-03-15" },
      { startDate: "2024-03-15" },
      { startDate: "2024-03-15" },
      { startDate: undefined },
      { startDate: "someday" },
    ]);
  });
});

describe("coerceValue for dates", () => {
  const field: Field<"d"> = { key: "d", label: "Date", fieldType: { type: "date" } };

  it("produces the configured shape", () => {
    expect(coerceValue(field, "15/03/2024")).toBe("2024-03-15");
    expect(coerceValue({ ...field, fieldType: { type: "date", valueType: "timestamp" } }, "2024-03-15")).toBe(
      Date.UTC(2024, 2, 15),
    );
    expect(coerceValue({ ...field, fieldType: { type: "date", valueType: "date" } }, "2024-03-15")).toBeInstanceOf(
      Date,
    );
  });

  it("keeps unparseable text for the review step", () => {
    expect(coerceValue(field, "whenever")).toBe("whenever");
  });
});

describe("date validation", () => {
  const build = (fieldType: Field<"d">["fieldType"], values: unknown[]) =>
    validateTable(values.map(d => ({ d })) as RowData<"d">[], {
      fields: [{ key: "d", label: "Start", fieldType }],
    });

  it("flags text that is not a date", async () => {
    const rows = await build({ type: "date" }, ["2024-03-15", "someday", undefined]);

    expect(rows[0]!.__errors).toBeNull();
    expect(rows[1]!.__errors?.d?.message).toBe("Start must be a date");
    expect(rows[2]!.__errors).toBeNull();
  });

  it("enforces min and max", async () => {
    const rows = await build({ type: "date", min: "2024-01-01", max: "2024-12-31" }, [
      "2023-12-31",
      "2024-06-01",
      "2025-01-01",
    ]);

    expect(rows[0]!.__errors?.d?.message).toBe("Start must not be before 2024-01-01");
    expect(rows[1]!.__errors).toBeNull();
    expect(rows[2]!.__errors?.d?.message).toBe("Start must not be after 2024-12-31");
  });

  it("accepts Date bounds", async () => {
    const rows = await build({ type: "date", min: new Date(Date.UTC(2024, 0, 1)) }, ["2023-06-01"]);
    expect(rows[0]!.__errors?.d).toBeDefined();
  });

  it("validates the timestamp and date shapes too", async () => {
    const asTimestamp = await build({ type: "date", valueType: "timestamp", min: "2024-01-01" }, [
      Date.UTC(2023, 0, 1),
    ]);
    expect(asTimestamp[0]!.__errors?.d).toBeDefined();

    const asDate = await build({ type: "date", valueType: "date", min: "2024-01-01" }, [
      new Date(Date.UTC(2023, 0, 1)),
    ]);
    expect(asDate[0]!.__errors?.d).toBeDefined();
  });

  it("combines with required", async () => {
    const rows = await validateTable([{ d: undefined }] as RowData<"d">[], {
      fields: [{ key: "d", label: "Start", fieldType: { type: "date" }, validations: [{ rule: "required" }] }],
    });
    expect(rows[0]!.__errors?.d?.message).toBe("Start is required");
  });
});

describe("end to end", () => {
  it("imports a mixed-format column into clean ISO strings", async () => {
    type Key = "name" | "startDate";
    const importer = createImporter<Key>({
      fields: [
        { key: "name", label: "Name", fieldType: { type: "input" } },
        { key: "startDate", label: "Start Date", fieldType: { type: "date", min: "2000-01-01" } },
      ],
      parser: createCsvParser(),
    });

    await importer.selectFile(
      fileFromString(
        "starts.csv",
        [
          "Name;Start Date",
          "Nele;2024-03-15",
          "Jan;15/03/2024",
          "Sofie;15 Mar 2024",
          "Bram;45366",
          "Wout;someday",
          "Lotte;",
        ].join("\n"),
      ),
    );
    await importer.selectHeaderRow(0);
    await importer.commitColumns();

    const result = await importer.submit();

    // Four spellings of the same day, one answer.
    expect(result!.all.slice(0, 4).map(row => row.startDate)).toEqual([
      "2024-03-15",
      "2024-03-15",
      "2024-03-15",
      "2024-03-15",
    ]);
    expect(result!.all[4]!.startDate).toBe("someday");
    expect(result!.all[4]!.__errors?.startDate?.message).toBe("Start Date must be a date");
    expect(result!.all[5]!.startDate).toBeUndefined();

    expect(result!.invalidData).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(result!.validData[0]))).toEqual({
      name: "Nele",
      startDate: "2024-03-15",
    });
  });

  it("coerces a hand-typed edit the same way", async () => {
    const importer = createImporter<"d">({
      fields: [{ key: "d", label: "Date", fieldType: { type: "date" } }],
      parser: createCsvParser(),
    });

    await importer.selectFile(fileFromString("d.csv", "Date\nnonsense"));
    await importer.selectHeaderRow(0);
    await importer.commitColumns();

    const rowId = importer.getState().rows[0]!.__index;
    expect(importer.getState().rows[0]!.__errors?.d).toBeDefined();

    await importer.updateCell(rowId, "d", "15/03/2024");

    expect(importer.getState().rows[0]!.d).toBe("2024-03-15");
    expect(importer.getState().rows[0]!.__errors).toBeNull();
  });

  it("respects dayFirst: false across a whole import", async () => {
    const importer = createImporter<"d">({
      fields: [{ key: "d", label: "Date", fieldType: { type: "date", dayFirst: false } }],
      parser: createCsvParser(),
    });

    await importer.selectFile(fileFromString("d.csv", "Date\n03/04/2024\n12/25/2024"));
    await importer.selectHeaderRow(0);
    await importer.commitColumns();

    expect(importer.getState().rows.map(row => row.d)).toEqual(["2024-03-04", "2024-12-25"]);
  });
});
