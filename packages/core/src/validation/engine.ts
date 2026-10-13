import { parseDate, toBoundary, toDateValue } from "../matching/date.js";
import {
  type CellError,
  type CellValue,
  ErrorSource,
  type Fields,
  type RowData,
  type RowErrors,
  type RowInput,
  type UniqueKey,
  type ValidatedRow,
} from "../types.js";
import { createId } from "../utils/id.js";

export type RowHook<TKey extends string> = (
  row: RowData<TKey>,
  addError: (fieldKey: TKey, error: Omit<CellError, "source">) => void,
  table: readonly RowData<TKey>[],
) => RowData<TKey> | Promise<RowData<TKey>>;

export type TableHook<TKey extends string> = (
  table: RowData<TKey>[],
  addError: (rowIndex: number, fieldKey: TKey, error: Omit<CellError, "source">) => void,
) => RowData<TKey>[] | Promise<RowData<TKey>[]>;

export type ValidateOptions<TKey extends string> = {
  fields: Fields<TKey>;
  /** Table-level uniqueness, including compound keys. */
  uniqueKeys?: readonly UniqueKey<TKey>[];
  rowHook?: RowHook<TKey>;
  tableHook?: TableHook<TKey>;
  /**
   * Revalidate only these rows against row-scoped rules. Table-scoped rules
   * (uniqueness, tableHook) always run over the whole table, because editing
   * one cell can resolve or create a duplicate anywhere.
   */
  changedRowIndexes?: readonly number[];
};

const isEmpty = (value: CellValue): boolean => value === undefined || value === null || value === "";

/**
 * Run hooks and field validations over a table and attach errors.
 *
 * Rows keep their `__index` across runs so UIs can hold on to row identity
 * while a user edits; `__errors` is replaced wholesale for rows that were
 * fully revalidated, and merged for rows that only saw table-scoped rules.
 */
export async function validateTable<TKey extends string>(
  input: readonly RowInput<TKey>[],
  options: ValidateOptions<TKey>,
): Promise<ValidatedRow<TKey>[]> {
  const { fields, uniqueKeys, rowHook, tableHook, changedRowIndexes } = options;

  let data: RowInput<TKey>[] = [...input];
  const errors = new Map<number, RowErrors<TKey>>();

  const addError = (source: ErrorSource, rowIndex: number, fieldKey: TKey, error: Omit<CellError, "source">) => {
    const existing: RowErrors<TKey> = errors.get(rowIndex) ?? {};
    // First error on a cell wins, so a `required` message is not buried by a
    // regex message complaining about the same empty value.
    if (existing[fieldKey] !== undefined) return;
    existing[fieldKey] = { ...error, source };
    errors.set(rowIndex, existing);
  };

  if (tableHook) {
    const next = await tableHook(data as RowData<TKey>[], (rowIndex, fieldKey, error) =>
      addError(ErrorSource.Table, rowIndex, fieldKey, error),
    );
    if (next.length !== data.length) {
      throw new Error(
        `tableHook must return the same number of rows it received (got ${next.length}, expected ${data.length}).`,
      );
    }
    // Preserve meta the hook may have dropped by spreading a plain object.
    data = next.map((row, index) => ({ __index: data[index]?.__index, __errors: data[index]?.__errors, ...row }));
  }

  if (rowHook) {
    const indexes = changedRowIndexes ?? data.map((_, index) => index);
    // Sequential when partial (a handful of rows, order matters for debugging),
    // parallel on a full pass so a slow async hook does not serialize 10k rows.
    if (changedRowIndexes) {
      for (const index of indexes) {
        const row = data[index];
        if (!row) continue;
        const next = await rowHook(row, (fieldKey, error) => addError(ErrorSource.Row, index, fieldKey, error), data);
        data[index] = { __index: row.__index, __errors: row.__errors, ...next };
      }
    } else {
      data = await Promise.all(
        data.map(async (row, index) => {
          const next = await rowHook(row, (fieldKey, error) => addError(ErrorSource.Row, index, fieldKey, error), data);
          return { __index: row.__index, __errors: row.__errors, ...next };
        }),
      );
    }
  }

  const rowScopedIndexes = changedRowIndexes ?? data.map((_, index) => index);

  // Number fields validate themselves: a cell that survived coercion as a
  // string is one that could not be parsed, and the value is kept so the user
  // can see what was rejected.
  for (const field of fields) {
    if (field.fieldType.type !== "number") continue;
    const { integer, min, max, errorMessage } = field.fieldType;

    for (const index of rowScopedIndexes) {
      const row = data[index];
      if (!row) continue;
      const value = row[field.key];
      if (isEmpty(value)) continue;

      if (typeof value !== "number") {
        addError(ErrorSource.Row, index, field.key, {
          level: "error",
          message: errorMessage ?? `${field.label} must be a number`,
        });
        continue;
      }
      if (integer && !Number.isInteger(value)) {
        addError(ErrorSource.Row, index, field.key, {
          level: "error",
          message: errorMessage ?? `${field.label} must be a whole number`,
        });
        continue;
      }
      if (min !== undefined && value < min) {
        addError(ErrorSource.Row, index, field.key, {
          level: "error",
          message: errorMessage ?? `${field.label} must be at least ${min}`,
        });
        continue;
      }
      if (max !== undefined && value > max) {
        addError(ErrorSource.Row, index, field.key, {
          level: "error",
          message: errorMessage ?? `${field.label} must be at most ${max}`,
        });
      }
    }
  }

  // Dates, same contract as numbers: a cell that survived coercion as a string
  // is one that could not be parsed, and its text is kept so the user can see
  // what was rejected.
  for (const field of fields) {
    if (field.fieldType.type !== "date") continue;
    const { min, max, errorMessage, valueType } = field.fieldType;
    const lower = toBoundary(min);
    const upper = toBoundary(max);

    for (const index of rowScopedIndexes) {
      const row = data[index];
      if (!row) continue;
      const value = row[field.key];
      if (isEmpty(value)) continue;

      let asDate: Date | null = null;
      if (value instanceof Date) {
        asDate = value;
      } else if (valueType === "timestamp" && typeof value === "number") {
        asDate = new Date(value);
      } else if (typeof value === "string") {
        // For the default "iso" output the stored value is a string, so a
        // successful re-parse is the only way to tell a date from the text
        // `coerceValue` kept because it could not parse it.
        const parsed = parseDate(value);
        asDate = parsed.ok ? parsed.value : null;
      }

      if (!asDate || Number.isNaN(asDate.getTime())) {
        addError(ErrorSource.Row, index, field.key, {
          level: "error",
          message: errorMessage ?? `${field.label} must be a date`,
        });
        continue;
      }
      if (lower && asDate.getTime() < lower.getTime()) {
        addError(ErrorSource.Row, index, field.key, {
          level: "error",
          message: errorMessage ?? `${field.label} must not be before ${toDateValue(lower, false)}`,
        });
        continue;
      }
      if (upper && asDate.getTime() > upper.getTime()) {
        addError(ErrorSource.Row, index, field.key, {
          level: "error",
          message: errorMessage ?? `${field.label} must not be after ${toDateValue(upper, false)}`,
        });
      }
    }
  }

  for (const field of fields) {
    if (!field.validations?.length) continue;

    for (const validation of field.validations) {
      switch (validation.rule) {
        case "unique": {
          const seen = new Map<string, number[]>();

          data.forEach((row, index) => {
            const value = row[field.key];
            if (validation.allowEmpty && isEmpty(value)) return;
            const normalized = validation.caseInsensitive ? String(value ?? "").toLowerCase() : String(value ?? "");
            const bucket = seen.get(normalized);
            if (bucket) bucket.push(index);
            else seen.set(normalized, [index]);
          });

          for (const indexes of seen.values()) {
            if (indexes.length < 2) continue;
            for (const index of indexes) {
              addError(ErrorSource.Table, index, field.key, {
                level: validation.level ?? "error",
                message: validation.errorMessage ?? `${field.label} must be unique`,
              });
            }
          }
          break;
        }

        case "required": {
          for (const index of rowScopedIndexes) {
            const row = data[index];
            if (!row) continue;
            if (isEmpty(row[field.key])) {
              addError(ErrorSource.Row, index, field.key, {
                level: validation.level ?? "error",
                message: validation.errorMessage ?? `${field.label} is required`,
              });
            }
          }
          break;
        }

        case "regex": {
          // Built once per validation, not once per row.
          const regex = new RegExp(validation.value, validation.flags);
          for (const index of rowScopedIndexes) {
            const row = data[index];
            if (!row) continue;
            const value = row[field.key];
            // An absent optional value is the `required` rule's business, not ours.
            if (isEmpty(value)) continue;
            regex.lastIndex = 0;
            if (!regex.test(String(value))) {
              addError(ErrorSource.Row, index, field.key, {
                level: validation.level ?? "error",
                message:
                  validation.errorMessage ??
                  `${field.label} does not match /${validation.value}/${validation.flags ?? ""}`,
              });
            }
          }
          break;
        }

        case "custom": {
          for (const index of rowScopedIndexes) {
            const row = data[index];
            if (!row) continue;
            if (!validation.validate(row[field.key], row as RowData<string>)) {
              addError(ErrorSource.Row, index, field.key, {
                level: validation.level ?? "error",
                message: validation.errorMessage ?? `${field.label} is invalid`,
              });
            }
          }
          break;
        }
      }
    }
  }

  for (const key of uniqueKeys ?? []) {
    if (key.fields.length === 0) continue;

    const label = key.fields
      .map(fieldKey => fields.find(field => field.key === fieldKey)?.label ?? fieldKey)
      .join(" + ");
    const seen = new Map<string, number[]>();

    data.forEach((row, index) => {
      const values = key.fields.map(fieldKey => row[fieldKey]);
      if (key.allowEmpty && values.some(isEmpty)) return;

      // Field values are joined with a separator that cannot occur in a cell,
      // so ("a|b", "c") and ("a", "b|c") stay distinct.
      const composite = values
        .map(value => {
          const text = String(value ?? "");
          return key.caseInsensitive ? text.toLowerCase() : text;
        })
        .join("\u0000");

      const bucket = seen.get(composite);
      if (bucket) bucket.push(index);
      else seen.set(composite, [index]);
    });

    for (const indexes of seen.values()) {
      if (indexes.length < 2) continue;
      for (const index of indexes) {
        // Flag every field in the key, so a UI highlights the whole key
        // rather than an arbitrary one of its parts.
        for (const fieldKey of key.fields) {
          addError(ErrorSource.Table, index, fieldKey, {
            level: key.level ?? "error",
            message: key.errorMessage ?? `${label} must be unique together`,
          });
        }
      }
    }
  }

  const fullPass = changedRowIndexes === undefined;
  const revalidated = new Set(rowScopedIndexes);

  return data.map((row, index) => {
    const next = { ...row, __index: row.__index ?? createId() } as ValidatedRow<TKey>;
    const fresh = errors.get(index);

    if (fullPass || revalidated.has(index)) {
      next.__errors = fresh ?? null;
      return next;
    }

    // Row rules did not run here, so keep this row's row-scoped errors and
    // swap in the freshly computed table-scoped ones.
    const kept: RowErrors<TKey> = {};
    for (const [key, error] of Object.entries(row.__errors ?? {}) as [TKey, CellError][]) {
      if (error.source === ErrorSource.Row) kept[key] = error;
    }

    const merged = { ...kept, ...fresh };
    next.__errors = Object.keys(merged).length > 0 ? merged : null;
    return next;
  });
}

/** True when the row has at least one error of level `error`. */
export function isRowValid<TKey extends string>(row: ValidatedRow<TKey>): boolean {
  if (!row.__errors) return true;
  return !Object.values(row.__errors).some(error => (error as CellError).level === "error");
}

/** Strip meta keys, leaving the caller with plain records. */
export function stripMeta<TKey extends string>(row: ValidatedRow<TKey>): RowData<TKey> {
  const { __index: _index, __errors: _errors, ...rest } = row as ValidatedRow<string>;
  return rest as RowData<TKey>;
}
