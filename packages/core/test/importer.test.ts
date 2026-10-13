import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx-ugnis";
import { createImporter, type Importer, Step } from "../src/importer.js";
import { combineParsers, createCsvParser, createXlsxParser } from "../src/parsers/index.js";
import { ColumnType, type Fields, type RowData } from "../src/types.js";
import { type EmployeeKey, employeeFields, fileFromDisk, fileFromString } from "./helpers.js";

const parser = combineParsers(createCsvParser(), createXlsxParser({ xlsx: XLSX as never }));

const makeImporter = (options: Partial<Parameters<typeof createImporter<EmployeeKey>>[0]> = {}) =>
  createImporter<EmployeeKey>({ fields: employeeFields, parser, ...options });

/** Drive the flow to the validation step for a fixture with a known header row. */
async function runToValidation(importer: Importer<EmployeeKey>, fixture: string, headerRowIndex = 0) {
  await importer.selectFile(fileFromDisk(fixture));
  if (importer.getState().step === Step.selectSheet) {
    await importer.selectSheet("Employees");
  }
  await importer.selectHeaderRow(headerRowIndex);
  await importer.commitColumns();
}

describe("createImporter", () => {
  it("starts at the upload step", () => {
    const state = makeImporter().getState();

    expect(state.step).toBe(Step.upload);
    expect(state.rows).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.isBusy).toBe(false);
  });

  describe("selectFile", () => {
    it("goes straight to header selection for a single-sheet file", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("clean.csv"));

      const state = importer.getState();
      expect(state.step).toBe(Step.selectHeader);
      expect(state.sheetRows).toHaveLength(121);
      expect(state.file?.name).toBe("clean.csv");
    });

    it("asks which sheet for a multi-sheet workbook", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("multi-sheet.xlsx"));

      const state = importer.getState();
      expect(state.step).toBe(Step.selectSheet);
      expect(state.workbook?.sheets.map(sheet => sheet.name)).toEqual(["Readme", "Employees", "Summary"]);
    });

    it("rejects a file over maxFileSize without parsing it", async () => {
      const parse = vi.fn();
      const importer = makeImporter({ maxFileSize: 10, parser: { name: "spy", parse } });

      await importer.selectFile(fileFromDisk("clean.csv"));

      expect(parse).not.toHaveBeenCalled();
      expect(importer.getState().error?.code).toBe("file-too-large");
      expect(importer.getState().step).toBe(Step.upload);
    });

    it("rejects an unsupported file type", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromString("photo.png", "not a spreadsheet"));

      expect(importer.getState().error?.code).toBe("unsupported-file");
    });

    it("rejects an empty workbook", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("empty.xlsx"));

      expect(importer.getState().error?.code).toBe("empty-sheet");
      expect(importer.getState().step).toBe(Step.upload);
    });

    it("reports errors through onError as well as state", async () => {
      const onError = vi.fn();
      const importer = makeImporter({ onError });

      await importer.selectFile(fileFromString("photo.png", ""));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0].code).toBe("unsupported-file");
    });

    it("clears isBusy after a failure", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromString("photo.png", ""));
      expect(importer.getState().isBusy).toBe(false);
    });
  });

  describe("selectSheet", () => {
    it("moves to header selection with the chosen sheet", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("multi-sheet.xlsx"));
      await importer.selectSheet("Employees");

      const state = importer.getState();
      expect(state.step).toBe(Step.selectHeader);
      expect(state.sheetName).toBe("Employees");
      expect(state.sheetRows[0]![0]).toBe("First Name");
    });

    it("errors on an unknown sheet name", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("multi-sheet.xlsx"));
      await importer.selectSheet("Nope");

      expect(importer.getState().error).toBeTruthy();
      expect(importer.getState().step).toBe(Step.selectSheet);
    });
  });

  describe("selectHeaderRow", () => {
    it("auto-maps columns from the chosen header", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("clean.csv"));
      await importer.selectHeaderRow(0);

      const state = importer.getState();
      expect(state.step).toBe(Step.matchColumns);
      expect(state.columns.map(column => ("value" in column ? column.value : null))).toEqual([
        "firstName",
        "lastName",
        "email",
        "department",
        "active",
        "startDate",
        "salary",
      ]);
    });

    it("skips a preamble when the user picks a lower row", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("messy-semicolon.csv"));
      // Rows 0 and 1 are the export banner and a blank line.
      await importer.selectHeaderRow(2);

      expect(importer.getHeaderValues()[0]).toBe("First Name");
      expect(importer.getState().columns[0]).toMatchObject({ value: "firstName" });
    });

    it("leaves columns unmapped when autoMapHeaders is off", async () => {
      const importer = makeImporter({ autoMapHeaders: false });
      await importer.selectFile(fileFromDisk("clean.csv"));
      await importer.selectHeaderRow(0);

      expect(importer.getState().columns.every(column => column.type === ColumnType.empty)).toBe(true);
    });

    it("rejects a row index outside the sheet", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("clean.csv"));
      await importer.selectHeaderRow(9999);

      expect(importer.getState().error).toBeTruthy();
      expect(importer.getState().step).toBe(Step.selectHeader);
    });

    it("enforces maxRecords against the body, not the whole sheet", async () => {
      const importer = makeImporter({ maxRecords: 50 });
      await importer.selectFile(fileFromDisk("clean.csv"));
      await importer.selectHeaderRow(0);

      expect(importer.getState().error?.code).toBe("too-many-rows");
      expect(importer.getState().step).toBe(Step.selectHeader);
    });

    it("does not count preamble rows against maxRecords", async () => {
      // 80 data rows + 1 blank separator, under a banner and a blank line.
      const importer = makeImporter({ maxRecords: 81 });
      await importer.selectFile(fileFromDisk("messy-semicolon.csv"));
      await importer.selectHeaderRow(2);

      expect(importer.getState().error).toBeNull();
      expect(importer.getState().step).toBe(Step.matchColumns);
    });
  });

  describe("maxFileRows", () => {
    it("bails out during parsing, before a step is entered", async () => {
      const importer = makeImporter({ maxFileRows: 10 });
      await importer.selectFile(fileFromDisk("clean.csv"));

      expect(importer.getState().error?.code).toBe("too-many-rows");
      expect(importer.getState().step).toBe(Step.upload);
    });

    it("is independent of maxRecords", async () => {
      // A generous parser ceiling with a strict record limit: parsing succeeds,
      // and the precise rejection happens once the header is known.
      const importer = makeImporter({ maxFileRows: 1_000, maxRecords: 50 });

      await importer.selectFile(fileFromDisk("clean.csv"));
      expect(importer.getState().step).toBe(Step.selectHeader);

      await importer.selectHeaderRow(0);
      expect(importer.getState().error?.code).toBe("too-many-rows");
    });
  });

  describe("column mapping", () => {
    let importer: Importer<EmployeeKey>;

    beforeEach(async () => {
      importer = makeImporter();
      await importer.selectFile(fileFromDisk("clean.csv"));
      await importer.selectHeaderRow(0);
    });

    it("assigns a field to a column", () => {
      importer.setColumnField(5, "salary");
      expect(importer.getState().columns[5]).toMatchObject({ value: "salary", type: ColumnType.matched });
    });

    it("releases the field from whichever column held it", () => {
      // `salary` currently lives on column 6.
      importer.setColumnField(5, "salary");

      expect(importer.getState().columns[6]?.type).toBe(ColumnType.empty);
      expect(importer.getState().columns[5]).toMatchObject({ value: "salary" });
    });

    it("clears a column when passed null", () => {
      importer.setColumnField(0, null);
      expect(importer.getState().columns[0]?.type).toBe(ColumnType.empty);
    });

    it("ignores and un-ignores a column", () => {
      importer.ignoreColumn(0);
      expect(importer.getState().columns[0]?.type).toBe(ColumnType.ignored);

      importer.unignoreColumn(0);
      expect(importer.getState().columns[0]?.type).toBe(ColumnType.empty);
    });

    it("maps a select entry onto an option", () => {
      const before = importer.getState().columns[3];
      expect(before?.type).toBe(ColumnType.matchedSelect);

      importer.setColumnOption(3, "Engineering", "eng");

      const after = importer.getState().columns[3];
      expect(after && "matchedOptions" in after && after.matchedOptions).toContainEqual({
        entry: "Engineering",
        value: "eng",
      });
    });

    it("lists required fields that are still unmapped", () => {
      importer.setColumnField(2, null);
      expect(importer.getUnmatchedRequiredFields()).toEqual(["Email"]);
    });
  });

  describe("commitColumns", () => {
    it("normalizes, validates and lands on the validate step", async () => {
      const importer = makeImporter({ autoMapSelectValues: true });
      await runToValidation(importer, "clean.csv");

      const state = importer.getState();
      expect(state.step).toBe(Step.validate);
      expect(state.rows).toHaveLength(120);

      const first = state.rows[0]!;
      expect(first.__index).toBeTruthy();
      expect(typeof first.active).toBe("boolean");
      expect(first.email).toMatch(/@example\.com$/);
    });

    it("finds the seeded duplicates and the missing required value", async () => {
      const importer = makeImporter();
      await runToValidation(importer, "clean.csv");

      const rows = importer.getState().rows;
      // The generator forces rows 2 and 3 onto row 0's address, case-shifted.
      expect(rows[0]!.__errors?.email?.message).toBe("Email must be unique");
      expect(rows[2]!.__errors?.email).toBeDefined();
      expect(rows[3]!.__errors?.email).toBeDefined();
      // And blanks row 4's first name.
      expect(rows[4]!.__errors?.firstName?.message).toBe("First name is required");
    });

    it("drops columns the user ignored", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("clean.csv"));
      await importer.selectHeaderRow(0);
      importer.ignoreColumn(6);
      await importer.commitColumns();

      expect(importer.getState().rows[0]).not.toHaveProperty("salary");
    });

    it("leaves unmapped select entries undefined", async () => {
      const importer = makeImporter({ autoMapSelectValues: false });
      await runToValidation(importer, "clean.csv");

      expect(importer.getState().rows[0]!.department).toBeUndefined();
    });
  });

  describe("hooks", () => {
    it("runs uploadHook on the raw rows", async () => {
      const uploadHook = vi.fn((rows: (string | undefined)[][]) => rows.slice(0, 5));
      const importer = makeImporter({ uploadHook });

      await importer.selectFile(fileFromDisk("clean.csv"));

      expect(uploadHook).toHaveBeenCalledTimes(1);
      expect(importer.getState().sheetRows).toHaveLength(5);
    });

    it("runs selectHeaderHook and uses what it returns", async () => {
      const importer = makeImporter({
        selectHeaderHook: (headerValues, rows) => ({
          headerValues: headerValues.map(value => value?.toUpperCase()),
          rows: rows.slice(0, 3),
        }),
      });

      await importer.selectFile(fileFromDisk("clean.csv"));
      await importer.selectHeaderRow(0);

      expect(importer.getState().columns[0]?.header).toBe("FIRST NAME");
      expect(importer.getBodyRows()).toHaveLength(3);
    });

    it("runs matchColumnsHook before validation", async () => {
      const importer = makeImporter({
        matchColumnsHook: data => data.map(row => ({ ...row, firstName: "OVERRIDDEN" })),
      });

      await runToValidation(importer, "clean.csv");

      expect(importer.getState().rows[0]!.firstName).toBe("OVERRIDDEN");
      // The forced-blank row is now filled, so its required error is gone.
      expect(importer.getState().rows[4]!.__errors?.firstName).toBeUndefined();
    });

    it("surfaces a throwing hook as a recoverable error", async () => {
      const importer = makeImporter({
        uploadHook: () => {
          throw new Error("hook exploded");
        },
      });

      await importer.selectFile(fileFromDisk("clean.csv"));

      expect(importer.getState().error?.message).toBe("hook exploded");
      expect(importer.getState().step).toBe(Step.upload);
      expect(importer.getState().isBusy).toBe(false);
    });
  });

  describe("row editing", () => {
    let importer: Importer<EmployeeKey>;

    beforeEach(async () => {
      importer = makeImporter();
      await runToValidation(importer, "clean.csv");
    });

    it("updates a cell and revalidates the row", async () => {
      const row = importer.getState().rows[4]!;
      expect(row.__errors?.firstName).toBeDefined();

      await importer.updateCell(row.__index, "firstName", "Filled In");

      const updated = importer.getState().rows[4]!;
      expect(updated.firstName).toBe("Filled In");
      expect(updated.__errors?.firstName).toBeUndefined();
      expect(updated.__index).toBe(row.__index);
    });

    it("recomputes uniqueness across the table when one cell changes", async () => {
      const rows = importer.getState().rows;
      expect(rows[0]!.__errors?.email).toBeDefined();

      // Give both clashing rows their own address.
      await importer.updateCell(rows[2]!.__index, "email", "unique-a@example.com");
      await importer.updateCell(rows[3]!.__index, "email", "unique-b@example.com");

      expect(importer.getState().rows[0]!.__errors?.email).toBeUndefined();
    });

    it("ignores an unknown row id", async () => {
      const before = importer.getState().rows;
      await importer.updateCell("nope", "firstName", "x");
      expect(importer.getState().rows).toBe(before);
    });

    it("deletes rows and revalidates", async () => {
      const rows = importer.getState().rows;
      await importer.deleteRows([rows[2]!.__index, rows[3]!.__index]);

      const after = importer.getState().rows;
      expect(after).toHaveLength(118);
      // Row 0's duplicate partners are gone, so its error should be too.
      expect(after[0]!.__errors?.email).toBeUndefined();
    });

    it("adds an empty row with checkbox fields defaulted to false", async () => {
      await importer.addRow();

      const added = importer.getState().rows.at(-1)!;
      expect(added.active).toBe(false);
      expect(added.firstName).toBeUndefined();
      expect(added.__errors?.firstName).toBeDefined();
    });

    it("notifies once per edit when validation is synchronous", async () => {
      const listener = vi.fn();
      importer.subscribe(listener);

      await importer.updateCell(importer.getState().rows[4]!.__index, "firstName", "Filled In");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]![0].isBusy).toBe(false);
    });

    it("reports busy while a slow async hook runs", async () => {
      // Open while the flow reaches validation; closed for the edit below.
      let gate: Promise<void> = Promise.resolve();
      const slow = makeImporter({
        rowHook: async row => {
          await gate;
          return row;
        },
      });
      await runToValidation(slow, "clean.csv");

      let release!: () => void;
      gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const busyStates: boolean[] = [];
      slow.subscribe(state => busyStates.push(state.isBusy));

      const editing = slow.updateCell(slow.getState().rows[4]!.__index, "firstName", "Filled In");
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(slow.getState().isBusy).toBe(true);

      release();
      await editing;
      expect(slow.getState().isBusy).toBe(false);
      expect(busyStates).toEqual([true, false]);
    });

    it("submits queued edits rather than the rows before them", async () => {
      const onSubmit = vi.fn();
      const submitting = makeImporter({ onSubmit });
      await runToValidation(submitting, "clean.csv");
      const rowId = submitting.getState().rows[4]!.__index;

      // Not awaited: submit must wait for the edit on its own.
      void submitting.updateCell(rowId, "firstName", "Filled In");
      await submitting.submit();

      const submitted = onSubmit.mock.calls[0]![0].all.find((row: { __index: string }) => row.__index === rowId);
      expect(submitted.firstName).toBe("Filled In");
    });
  });

  describe("navigation", () => {
    it("steps back through visited steps", async () => {
      const importer = makeImporter();
      await runToValidation(importer, "clean.csv");

      importer.back();
      expect(importer.getState().step).toBe(Step.matchColumns);

      importer.back();
      expect(importer.getState().step).toBe(Step.selectHeader);
    });

    it("skips selectSheet for single-sheet imports when going back", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("clean.csv"));
      await importer.selectHeaderRow(0);

      importer.back();
      expect(importer.getState().step).toBe(Step.selectHeader);

      importer.back();
      expect(importer.getState().step).toBe(Step.upload);
    });

    it("passes through selectSheet for multi-sheet imports", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("multi-sheet.xlsx"));
      await importer.selectSheet("Employees");
      await importer.selectHeaderRow(0);

      importer.back();
      expect(importer.getState().step).toBe(Step.selectHeader);

      importer.back();
      expect(importer.getState().step).toBe(Step.selectSheet);
    });

    it("does nothing at the first step", () => {
      const importer = makeImporter();
      importer.back();
      expect(importer.getState().step).toBe(Step.upload);
    });

    it("refuses to jump forward past work that has not happened", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromDisk("clean.csv"));

      importer.goToStep(Step.validate);
      expect(importer.getState().step).toBe(Step.selectHeader);
    });

    it("allows jumping back to a visited step", async () => {
      const importer = makeImporter();
      await runToValidation(importer, "clean.csv");

      importer.goToStep(Step.selectHeader);
      expect(importer.getState().step).toBe(Step.selectHeader);
    });

    it("reset returns to a pristine state", async () => {
      const importer = makeImporter();
      await runToValidation(importer, "clean.csv");

      importer.reset();

      const state = importer.getState();
      expect(state.step).toBe(Step.upload);
      expect(state.rows).toEqual([]);
      expect(state.file).toBeNull();
      expect(state.columns).toEqual([]);
    });
  });

  describe("submit", () => {
    it("splits valid from invalid rows and calls onSubmit", async () => {
      const onSubmit = vi.fn();
      const importer = makeImporter({ onSubmit, autoMapSelectValues: true });
      await runToValidation(importer, "clean.csv");

      const result = await importer.submit();

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(result!.validData.length + result!.invalidData.length).toBe(120);
      expect(result!.invalidData.length).toBeGreaterThan(0);
      expect(importer.getState().step).toBe(Step.submitted);
    });

    it("strips meta keys from the submitted records", async () => {
      const importer = makeImporter();
      await runToValidation(importer, "clean.csv");

      const result = await importer.submit();

      expect(result!.validData[0]).not.toHaveProperty("__index");
      expect(result!.validData[0]).not.toHaveProperty("__errors");
      // `all` keeps them, for callers that want to report per-row problems.
      expect(result!.all[0]).toHaveProperty("__index");
    });

    it("counts warning-level problems as valid", async () => {
      const lenient: Fields<"name"> = [
        {
          key: "name",
          label: "Name",
          fieldType: { type: "input" },
          validations: [{ rule: "required", level: "warning" }],
        },
      ];
      const importer = createImporter<"name">({ fields: lenient, parser });
      await importer.selectFile(fileFromString("x.csv", "name\n\nJan"));
      await importer.selectHeaderRow(0);
      await importer.commitColumns();

      const result = await importer.submit();
      expect(result!.invalidData).toHaveLength(0);
    });

    it("refuses to submit invalid rows when blockInvalidSubmit is on", async () => {
      const onSubmit = vi.fn();
      const importer = makeImporter({ onSubmit, blockInvalidSubmit: true });
      await runToValidation(importer, "clean.csv");

      const result = await importer.submit();

      expect(result).toBeUndefined();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(importer.getState().error?.code).toBe("submit-failed");
      expect(importer.getState().step).toBe(Step.validate);
    });

    it("keeps the user on the validate step when onSubmit rejects", async () => {
      const importer = makeImporter({
        onSubmit: () => Promise.reject(new Error("server said no")),
      });
      await runToValidation(importer, "clean.csv");

      await importer.submit();

      expect(importer.getState().step).toBe(Step.validate);
      expect(importer.getState().error?.message).toBe("server said no");
      expect(importer.getState().isBusy).toBe(false);
    });

    it("passes the original file to onSubmit", async () => {
      const onSubmit = vi.fn();
      const importer = makeImporter({ onSubmit });
      await runToValidation(importer, "clean.csv");

      await importer.submit();

      expect(onSubmit.mock.calls[0]![1]?.name).toBe("clean.csv");
    });
  });

  describe("subscriptions", () => {
    it("emits on every state transition", async () => {
      const importer = makeImporter();
      const listener = vi.fn();
      importer.subscribe(listener);

      await importer.selectFile(fileFromDisk("clean.csv"));

      // At minimum: busy on, then the step change.
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(importer.getState().step).toBe(Step.selectHeader);
    });

    it("stops emitting after unsubscribe", async () => {
      const importer = makeImporter();
      const listener = vi.fn();
      importer.subscribe(listener)();

      await importer.selectFile(fileFromDisk("clean.csv"));
      expect(listener).not.toHaveBeenCalled();
    });

    it("hands out a new state object per transition, for reference equality checks", async () => {
      const importer = makeImporter();
      const seen: unknown[] = [];
      importer.subscribe(state => seen.push(state));

      await importer.selectFile(fileFromDisk("clean.csv"));

      expect(new Set(seen).size).toBe(seen.length);
    });
  });

  describe("clearError", () => {
    it("removes the last error", async () => {
      const importer = makeImporter();
      await importer.selectFile(fileFromString("photo.png", ""));
      expect(importer.getState().error).toBeTruthy();

      importer.clearError();
      expect(importer.getState().error).toBeNull();
    });
  });
});

describe("end-to-end over the generated fixtures", () => {
  it("imports the multi-sheet workbook from the non-default sheet", async () => {
    const importer = makeImporter({ autoMapSelectValues: true });
    await runToValidation(importer, "multi-sheet.xlsx");

    const result = await importer.submit();
    expect(result!.all).toHaveLength(120);
    expect(result!.validData.length).toBeGreaterThan(100);
  });

  it("imports the semicolon export with a preamble", async () => {
    const importer = makeImporter({ autoMapSelectValues: true });
    await importer.selectFile(fileFromDisk("messy-semicolon.csv"));
    await importer.selectHeaderRow(2);
    await importer.commitColumns();

    const rows = importer.getState().rows;
    // 80 data rows plus the blank separator row the generator inserts.
    expect(rows).toHaveLength(81);
    expect(rows[0]!.firstName).toBeTruthy();
  });

  it("imports the wide xlsx and ignores the filler columns", async () => {
    const importer = makeImporter();
    await importer.selectFile(fileFromDisk("wide-preamble.xlsx"));
    await importer.selectHeaderRow(1);
    await importer.commitColumns();

    const rows = importer.getState().rows;
    expect(rows).toHaveLength(30);
    // The `extra_*` columns match no field, so they never reach the record.
    expect(Object.keys(rows[0]!).filter(key => key.startsWith("extra_"))).toEqual([]);
  });

  it("survives the quoting torture file", async () => {
    const importer = makeImporter();
    await importer.selectFile(fileFromDisk("quoted.csv"));
    await importer.selectHeaderRow(0);
    await importer.commitColumns();

    const rows = importer.getState().rows;
    expect(rows[0]!.firstName).toBe('Jan, "Jantje"');
    expect(rows[0]!.lastName).toBe("De Smet\nVan Dijck");
    expect(rows[2]!.__errors?.firstName).toBeDefined();
  });

  it("handles 10 000 rows within a sane time budget", async () => {
    const importer = makeImporter({ autoMapSelectValues: true });

    const started = performance.now();
    await runToValidation(importer, "large.csv");
    const elapsed = performance.now() - started;

    expect(importer.getState().rows).toHaveLength(10_000);
    // Generous, so the test is not flaky on a loaded CI box; it exists to catch
    // an accidental O(n^2), which blows past this by orders of magnitude.
    expect(elapsed).toBeLessThan(10_000);
  });

  it("edits a cell in a 10 000 row table without a full revalidation cost", async () => {
    const importer = makeImporter();
    await runToValidation(importer, "large.csv");

    const target = importer.getState().rows[5000]!;
    const started = performance.now();
    await importer.updateCell(target.__index, "firstName", "Edited");
    const elapsed = performance.now() - started;

    expect(importer.getState().rows[5000]!.firstName).toBe("Edited");
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe("type-level guarantees", () => {
  it("keys the result by the field keys", async () => {
    const fields = [
      { key: "a", label: "A", fieldType: { type: "input" } },
      { key: "b", label: "B", fieldType: { type: "checkbox" } },
    ] as const satisfies Fields<"a" | "b">;

    const importer = createImporter({ fields, parser });
    await importer.selectFile(fileFromString("t.csv", "a,b\n1,yes"));
    await importer.selectHeaderRow(0);
    await importer.commitColumns();

    const result = await importer.submit();
    const row: RowData<"a" | "b"> = result!.validData[0]!;

    expect(row.a).toBe("1");
    expect(row.b).toBe(true);
  });
});
