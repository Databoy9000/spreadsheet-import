import {
  type Column,
  type Columns,
  ColumnType,
  type Field,
  type Fields,
  isMatchedColumn,
  type OptionMatch,
  type RawRow,
} from "../types.js";
import { findBestMatch, normalizeHeader } from "./findMatch.js";
import { levenshtein } from "./levenshtein.js";

/** Distinct non-empty values in one column, in first-seen order. */
export function uniqueEntries(rows: RawRow[], columnIndex: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    const entry = row[columnIndex];
    if (!entry) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

/**
 * Assign a field to a column, or clear it when `field` is omitted.
 * Always returns a fresh object so change detection stays cheap.
 */
export function setColumn<TKey extends string>(
  column: Column<TKey>,
  field?: Field<TKey>,
  rows: RawRow[] = [],
  autoMapSelectValues = false,
): Column<TKey> {
  const base = { index: column.index, header: column.header };

  switch (field?.fieldType.type) {
    case "select": {
      const { options } = field.fieldType;
      const entries = uniqueEntries(rows, column.index);

      // Built once per column rather than per distinct entry: a units column
      // can hold hundreds of spellings across thousands of rows.
      const bySpelling = new Map<string, string>();
      for (const option of options) {
        for (const spelling of [option.value, option.label, ...(option.alternateMatches ?? [])]) {
          const normalized = normalizeHeader(spelling);
          // First option to claim a spelling keeps it, so declaration order is
          // the tie-break when two options share a synonym.
          if (normalized && !bySpelling.has(normalized)) bySpelling.set(normalized, option.value);
        }
      }

      const matchedOptions: OptionMatch[] = entries.map(entry => {
        if (!autoMapSelectValues) return { entry };
        const hit = bySpelling.get(normalizeHeader(entry));
        return hit ? { entry, value: hit } : { entry };
      });

      const allMatched = matchedOptions.every(option => Boolean(option.value));

      return allMatched
        ? {
            ...base,
            type: ColumnType.matchedSelectOptions,
            value: field.key,
            matchedOptions: matchedOptions as Required<OptionMatch>[],
          }
        : { ...base, type: ColumnType.matchedSelect, value: field.key, matchedOptions };
    }
    case "checkbox":
      return { ...base, type: ColumnType.matchedCheckbox, value: field.key };
    case "number":
      return { ...base, type: ColumnType.matchedNumber, value: field.key };
    case "date":
      return { ...base, type: ColumnType.matchedDate, value: field.key };
    case "input":
      return { ...base, type: ColumnType.matched, value: field.key };
    default:
      return { ...base, type: ColumnType.empty };
  }
}

export function setIgnoreColumn<TKey extends string>(column: Column<TKey>): Column<TKey> {
  return { index: column.index, header: column.header, type: ColumnType.ignored };
}

/** Map one distinct entry of a select column onto an option value. */
export function setSubColumn<TKey extends string>(column: Column<TKey>, entry: string, value: string): Column<TKey> {
  if (!("matchedOptions" in column)) return column;

  const matchedOptions = column.matchedOptions.map(option => (option.entry === entry ? { ...option, value } : option));
  const allMatched = matchedOptions.every(option => Boolean(option.value));

  return allMatched
    ? {
        index: column.index,
        header: column.header,
        type: ColumnType.matchedSelectOptions,
        value: column.value,
        matchedOptions: matchedOptions as Required<OptionMatch>[],
      }
    : {
        index: column.index,
        header: column.header,
        type: ColumnType.matchedSelect,
        value: column.value,
        matchedOptions,
      };
}

/** Fresh, all-empty columns derived from a header row. */
export function createColumns<TKey extends string>(headerValues: RawRow): Columns<TKey> {
  // Spread first: a sparse array from a ragged sheet would make `.map` skip holes.
  return [...headerValues].map((header, index) => ({
    type: ColumnType.empty,
    index,
    header: header ?? "",
  }));
}

/**
 * Auto-assign fields to columns by header similarity.
 *
 * When two headers want the same field the closer one wins and the other is
 * left empty — otherwise a sheet with both "email" and "e-mail" would silently
 * drop one of them into the same key.
 */
export function getMatchedColumns<TKey extends string>(
  columns: Columns<TKey>,
  fields: Fields<TKey>,
  rows: RawRow[],
  maxDistance: number,
  autoMapSelectValues = false,
): Columns<TKey> {
  const result: Columns<TKey> = [];
  /** field key -> { position in `result`, distance that claimed it } */
  const claimed = new Map<TKey, { position: number; distance: number }>();

  columns.forEach((column, position) => {
    const match = findBestMatch(column.header, fields, maxDistance);
    if (!match) {
      result[position] = column;
      return;
    }

    const field = fields.find(candidate => candidate.key === match.key);
    if (!field) {
      result[position] = column;
      return;
    }

    // A collecting field is fed by as many columns as name it, so it never
    // enters the claim contest — otherwise auto-matching would keep one of a
    // sheet's four "A per B" columns and release the rest.
    if (field.collects) {
      result[position] = setColumn(column, field, rows, autoMapSelectValues);
      return;
    }

    const existing = claimed.get(match.key);
    if (existing === undefined) {
      claimed.set(match.key, { position, distance: match.distance });
      result[position] = setColumn(column, field, rows, autoMapSelectValues);
      return;
    }

    if (match.distance < existing.distance) {
      // New column is the better fit; release the old one.
      const previous = result[existing.position];
      if (previous) result[existing.position] = setColumn(previous);
      claimed.set(match.key, { position, distance: match.distance });
      result[position] = setColumn(column, field, rows, autoMapSelectValues);
    } else {
      result[position] = setColumn(column);
    }
  });

  return result;
}

/** Labels of required fields that no column maps to yet. */
export function findUnmatchedRequiredFields<TKey extends string>(
  fields: Fields<TKey>,
  columns: Columns<TKey>,
): string[] {
  return fields
    .filter(field => field.validations?.some(validation => validation.rule === "required"))
    .filter(field => !columns.some(column => isMatchedColumn(column) && column.value === field.key))
    .map(field => field.label);
}

/** Select options for a field, or an empty list when it is not a select. */
export function getFieldOptions<TKey extends string>(fields: Fields<TKey>, fieldKey: TKey) {
  const field = fields.find(candidate => candidate.key === fieldKey);
  return field?.fieldType.type === "select" ? field.fieldType.options : [];
}

/** Exposed for tests and for UIs that want to show why a header matched. */
export const __matchInternals = { levenshtein, normalizeHeader };
