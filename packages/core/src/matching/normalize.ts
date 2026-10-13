import {
  type CellValue,
  type Column,
  type Columns,
  ColumnType,
  type Field,
  type Fields,
  isMatchedColumn,
  type RawRow,
  type RowData,
} from "../types.js";
import { parseDate, toDateValue } from "./date.js";
import { parseNumber } from "./number.js";

const DEFAULT_TRUE = new Set(["true", "yes", "y", "1", "on", "x", "✓"]);
const DEFAULT_FALSE = new Set(["false", "no", "n", "0", "off", ""]);

/**
 * Coerce a cell to a boolean.
 *
 * `booleanMatches` wins over the built-in vocabulary so a Dutch sheet can map
 * "ja"/"nee" without inheriting surprises. Unrecognised text falls back to
 * false, matching upstream behaviour — an import should not fail because a
 * checkbox column has a stray value.
 */
export function normalizeCheckboxValue(value: string | undefined, booleanMatches?: Record<string, boolean>): boolean {
  const text = value?.trim() ?? "";

  if (booleanMatches) {
    const entry = Object.entries(booleanMatches).find(([candidate]) => candidate.toLowerCase() === text.toLowerCase());
    if (entry !== undefined) return entry[1];
  }

  const lower = text.toLowerCase();
  if (DEFAULT_TRUE.has(lower)) return true;
  if (DEFAULT_FALSE.has(lower)) return false;
  return false;
}

/**
 * Coerce one raw value to whatever its field holds.
 *
 * The single place cell values are produced, so an import and a hand edit in
 * the review step cannot disagree — typing "1.234,56" into a number cell has
 * to land as 1234.56 exactly like the imported column did.
 */
export function coerceValue(field: Field<string> | undefined, raw: CellValue): CellValue {
  switch (field?.fieldType.type) {
    case "checkbox":
      return typeof raw === "boolean"
        ? raw
        : normalizeCheckboxValue(raw as string | undefined, field.fieldType.booleanMatches);
    case "number": {
      const result = parseNumber(raw, field.fieldType);
      if (result.ok) return result.value;
      // Empty is absent; anything else keeps its text so the review step can
      // show what was rejected. The engine turns that into an error.
      return result.reason === "empty" ? undefined : String(raw);
    }
    case "date": {
      const result = parseDate(raw, field.fieldType);
      if (result.ok) return toDateValue(result.value, result.hasTime, field.fieldType.valueType);
      return result.reason === "empty" ? undefined : String(raw);
    }
    default:
      return raw === "" ? undefined : raw;
  }
}

/**
 * Turn raw rows plus a column mapping into keyed records.
 * Unmapped, empty and ignored columns simply do not appear on the result.
 */
export function normalizeTableData<TKey extends string>(
  columns: Columns<TKey>,
  rows: RawRow[],
  fields: Fields<TKey>,
): RowData<TKey>[] {
  const fieldByKey = new Map(fields.map(field => [field.key, field]));

  // Split the mapping once, rather than per row: exclusive columns write a
  // value, collecting ones append to a list.
  const exclusive: Column<TKey>[] = [];
  const collecting = new Map<TKey, { column: Column<TKey>; field: Field<TKey> }[]>();

  for (const column of columns) {
    if (!isMatchedColumn(column)) continue;
    const field = fieldByKey.get(column.value);
    if (field?.collects) {
      const group = collecting.get(column.value) ?? [];
      group.push({ column, field });
      collecting.set(column.value, group);
    } else {
      exclusive.push(column);
    }
  }

  // Entry -> option value per select column, so each cell is a map hit rather
  // than a scan over every distinct entry the column holds.
  const selectLookups = new Map<number, Map<string, string | undefined>>();
  for (const column of exclusive) {
    if (column.type !== ColumnType.matchedSelect && column.type !== ColumnType.matchedSelectOptions) continue;
    const lookup = new Map<string, string | undefined>();
    for (const option of column.matchedOptions) {
      if (!lookup.has(option.entry)) lookup.set(option.entry, option.value);
    }
    selectLookups.set(column.index, lookup);
  }

  return rows.map(row => {
    const record = {} as RowData<TKey>;

    for (const column of exclusive) {
      const cell = row[column.index];

      switch (column.type) {
        case ColumnType.matchedCheckbox: {
          const field = fieldByKey.get(column.value);
          const booleanMatches = field?.fieldType.type === "checkbox" ? field.fieldType.booleanMatches : undefined;
          record[column.value] = normalizeCheckboxValue(cell, booleanMatches) as CellValue;
          break;
        }
        case ColumnType.matched: {
          record[column.value] = cell === "" ? undefined : cell;
          break;
        }
        case ColumnType.matchedNumber:
        case ColumnType.matchedDate: {
          record[column.value] = coerceValue(fieldByKey.get(column.value) as Field<string> | undefined, cell);
          break;
        }
        case ColumnType.matchedSelect:
        case ColumnType.matchedSelectOptions: {
          record[column.value] = cell === undefined ? undefined : selectLookups.get(column.index)?.get(cell);
          break;
        }
        case ColumnType.empty:
        case ColumnType.ignored:
          break;
      }
    }

    for (const [key, group] of collecting) {
      const options = group[0]?.field.collects;
      if (!options) continue;
      const contributions: CellValue[] = [];

      for (const { column } of group) {
        const cell = row[column.index];
        // Without a parse the raw cell is the contribution; an empty cell
        // contributes nothing either way.
        const produced = options.parse
          ? options.parse(cell, { header: column.header, index: column.index })
          : cell === "" || cell === undefined
            ? undefined
            : cell;

        if (produced === undefined) continue;
        for (const value of Array.isArray(produced) ? produced : [produced as CellValue]) {
          if (value === undefined || value === "") continue;
          contributions.push(value);
        }
      }

      const kept = options.unique === false ? contributions : [...new Set(contributions)];
      record[key] = kept.length === 0 ? undefined : kept.join(options.separator ?? "|");
    }

    return record;
  });
}
