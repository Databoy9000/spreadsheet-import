import { ColumnType, type CellValue, type Columns, type Fields, type RawRow, type RowData } from "../types.js"

const DEFAULT_TRUE = new Set(["true", "yes", "y", "1", "on", "x", "✓"])
const DEFAULT_FALSE = new Set(["false", "no", "n", "0", "off", ""])

/**
 * Coerce a cell to a boolean.
 *
 * `booleanMatches` wins over the built-in vocabulary so a Dutch sheet can map
 * "ja"/"nee" without inheriting surprises. Unrecognised text falls back to
 * false, matching upstream behaviour — an import should not fail because a
 * checkbox column has a stray value.
 */
export function normalizeCheckboxValue(
  value: string | undefined,
  booleanMatches?: Record<string, boolean>,
): boolean {
  const text = value?.trim() ?? ""

  if (booleanMatches) {
    const key = Object.keys(booleanMatches).find((candidate) => candidate.toLowerCase() === text.toLowerCase())
    if (key !== undefined) return booleanMatches[key]!
  }

  const lower = text.toLowerCase()
  if (DEFAULT_TRUE.has(lower)) return true
  if (DEFAULT_FALSE.has(lower)) return false
  return false
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
  const fieldByKey = new Map(fields.map((field) => [field.key, field]))

  return rows.map((row) => {
    const record = {} as RowData<TKey>

    for (const column of columns) {
      const cell = row[column.index]

      switch (column.type) {
        case ColumnType.matchedCheckbox: {
          const field = fieldByKey.get(column.value)
          const booleanMatches =
            field?.fieldType.type === "checkbox" ? field.fieldType.booleanMatches : undefined
          record[column.value] = normalizeCheckboxValue(cell, booleanMatches) as CellValue
          break
        }
        case ColumnType.matched: {
          record[column.value] = cell === "" ? undefined : cell
          break
        }
        case ColumnType.matchedSelect:
        case ColumnType.matchedSelectOptions: {
          const match = column.matchedOptions.find((option) => option.entry === cell)
          record[column.value] = match?.value ?? undefined
          break
        }
        case ColumnType.empty:
        case ColumnType.ignored:
          break
      }
    }

    return record
  })
}
