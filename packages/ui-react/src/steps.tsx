"use client";

import {
  type CellValue,
  type Column,
  ColumnType,
  type Field,
  type Fields,
  isMatchedColumn,
  type ValidatedRow,
} from "@spotable/spreadsheet-import-core";
import {
  useColumnMatching,
  useFileDrop,
  useHeaderSelection,
  useSheetSelection,
  useSpreadsheetImport,
  useValidation,
} from "@spotable/spreadsheet-import-react";
import { memo, type ReactElement, useId } from "react";
import { CellInput } from "./CellInput.js";
import { Alert, Button, cx, StepShell } from "./primitives.js";

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export function UploadStep<TKey extends string>({ accept = ".csv,.tsv,.xlsx,.xls,.ods" }: { accept?: string }) {
  const { getRootProps, getInputProps, isDragging, isBusy } = useFileDrop<TKey>({ accept });
  const { fields } = useSpreadsheetImport<TKey>();

  return (
    <StepShell
      title="Upload a file"
      description="CSV, TSV or Excel. The first sheet is used unless the file has more than one."
    >
      <div
        {...getRootProps({
          className: cx(
            "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-12 text-center",
            "cursor-pointer transition-colors",
            isDragging
              ? "border-sky-500 bg-sky-50 dark:bg-sky-950"
              : "border-slate-300 hover:border-slate-400 dark:border-slate-700",
            isBusy && "pointer-events-none opacity-60",
          ),
        })}
      >
        <input {...getInputProps()} />
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {isBusy ? "Reading file…" : "Drop a file here, or click to browse"}
        </p>
        <p className="text-xs text-slate-500">{accept.split(",").join(" · ")}</p>
      </div>

      <section className="mt-6">
        <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Expected columns</h3>
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr>
                {fields.map(field => (
                  <th key={field.key} className="whitespace-nowrap px-3 py-2 font-medium">
                    {field.label}
                    {field.validations?.some(validation => validation.rule === "required") ? (
                      <span className="ml-1 text-red-500" role="img" aria-label="required">
                        *
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200 dark:border-slate-800">
                {fields.map(field => (
                  <td key={field.key} className="whitespace-nowrap px-3 py-2 text-slate-500">
                    {field.example ?? "—"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </StepShell>
  );
}

// ---------------------------------------------------------------------------
// Sheet selection
// ---------------------------------------------------------------------------

export function SelectSheetStep<TKey extends string>() {
  const { sheets, selected, confirm, back, getSheetProps } = useSheetSelection<TKey>();

  return (
    <StepShell
      title="Which sheet?"
      description="This workbook has more than one sheet."
      footer={
        <>
          <Button onClick={back}>Back</Button>
          <Button variant="primary" onClick={() => void confirm()}>
            Continue
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Sheets" className="grid gap-2">
        {sheets.map(sheet => (
          <button
            key={sheet.name}
            {...getSheetProps(sheet.name)}
            className={cx(
              "flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm",
              selected === sheet.name
                ? "border-sky-500 bg-sky-50 dark:bg-sky-950"
                : "border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800",
            )}
          >
            <span className="font-medium">{sheet.name}</span>
            <span className="text-xs text-slate-500">{sheet.rowCount} rows</span>
          </button>
        ))}
      </div>
    </StepShell>
  );
}

// ---------------------------------------------------------------------------
// Header selection
// ---------------------------------------------------------------------------

export function SelectHeaderStep<TKey extends string>({ previewRows = 25 }: { previewRows?: number }) {
  const { rows, selectedIndex, confirm, back, getRowProps, isBusy } = useHeaderSelection<TKey>();
  const width = Math.max(0, ...rows.slice(0, previewRows).map(row => row.length));

  return (
    <StepShell
      title="Which row holds the column names?"
      description="Rows above it are ignored."
      footer={
        <>
          <Button onClick={back}>Back</Button>
          <Button variant="primary" disabled={isBusy} onClick={() => void confirm()}>
            Continue
          </Button>
        </>
      }
    >
      <div
        className="overflow-auto rounded-md border border-slate-200 dark:border-slate-800"
        role="radiogroup"
        aria-label="Header row"
      >
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.slice(0, previewRows).map((row, index) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: sheet rows have no identity beyond their position
                key={index}
                {...getRowProps(index)}
                className={cx(
                  "cursor-pointer border-t border-slate-100 first:border-t-0 dark:border-slate-800",
                  selectedIndex === index
                    ? "bg-sky-50 font-medium dark:bg-sky-950"
                    : "hover:bg-slate-50 dark:hover:bg-slate-900",
                )}
              >
                <td className="w-10 px-2 py-1.5 text-xs text-slate-400">{index + 1}</td>
                {Array.from({ length: width }, (_, column) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                  <td key={column} className="max-w-48 truncate px-3 py-1.5">
                    {row[column] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StepShell>
  );
}

// ---------------------------------------------------------------------------
// Column matching
// ---------------------------------------------------------------------------

function ColumnCard<TKey extends string>({
  column,
  fields,
  sample,
  taken,
  onField,
  onIgnore,
  onUnignore,
  onOption,
  optionsFor,
}: {
  column: Column<TKey>;
  fields: readonly Field<TKey>[];
  sample: (string | undefined)[];
  taken: ReadonlySet<TKey>;
  onField: (index: number, key: TKey | null) => void;
  onIgnore: (index: number) => void;
  onUnignore: (index: number) => void;
  onOption: (index: number, entry: string, value: string) => void;
  optionsFor: (key: TKey) => readonly { label: string; value: string }[];
}) {
  const selectId = useId();
  const ignored = column.type === ColumnType.ignored;
  const value = isMatchedColumn(column) ? column.value : "";

  return (
    <div
      className={cx(
        "grid gap-3 rounded-md border p-3 md:grid-cols-2",
        ignored
          ? "border-slate-200 bg-slate-50 opacity-60 dark:border-slate-800 dark:bg-slate-900"
          : "border-slate-200 dark:border-slate-800",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
          {column.header || "(no header)"}
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
          {sample.map((cell, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: sample cells are positional and may repeat
            <li key={index} className="truncate">
              {cell || <span className="italic">empty</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <label className="sr-only" htmlFor={selectId}>
          Field for column {column.header}
        </label>
        <select
          id={selectId}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          value={value}
          disabled={ignored}
          onChange={event => onField(column.index, (event.target.value || null) as TKey | null)}
        >
          <option value="">— not imported —</option>
          {fields.map(field => (
            <option key={field.key} value={field.key} disabled={taken.has(field.key) && field.key !== value}>
              {field.label}
              {taken.has(field.key) && field.key !== value ? " (already mapped)" : ""}
            </option>
          ))}
        </select>

        {"matchedOptions" in column ? (
          <div className="space-y-1 rounded-md bg-slate-50 p-2 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Match the values</p>
            {column.matchedOptions.map(option => (
              <div key={option.entry} className="flex items-center gap-2">
                <span className="w-1/2 truncate text-xs">{option.entry}</span>
                <select
                  aria-label={`Option for ${option.entry}`}
                  className={cx(
                    "w-1/2 rounded border px-1.5 py-1 text-xs dark:bg-slate-900",
                    option.value ? "border-slate-300 dark:border-slate-700" : "border-amber-400",
                  )}
                  value={option.value ?? ""}
                  onChange={event => onOption(column.index, option.entry, event.target.value)}
                >
                  <option value="">— pick —</option>
                  {optionsFor(column.value).map(choice => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ) : null}

        <Button
          variant="ghost"
          className="text-xs"
          onClick={() => (ignored ? onUnignore(column.index) : onIgnore(column.index))}
        >
          {ignored ? "Include this column" : "Ignore this column"}
        </Button>
      </div>
    </div>
  );
}

export function MatchColumnsStep<TKey extends string>() {
  const matching = useColumnMatching<TKey>();

  return (
    <StepShell
      title="Match your columns"
      description="We guessed where we could. Correct anything that looks wrong."
      footer={
        <>
          <Button onClick={matching.back}>Back</Button>
          <Button variant="primary" disabled={matching.isBusy} onClick={() => void matching.continue()}>
            {matching.isBusy ? "Checking…" : "Continue"}
          </Button>
        </>
      }
    >
      {matching.unmatchedRequiredFields.length > 0 ? (
        <Alert level="warning" className="mb-3">
          Not yet mapped: {matching.unmatchedRequiredFields.join(", ")}. You can continue, but those values will be
          empty.
        </Alert>
      ) : null}

      <div className="grid gap-2">
        {matching.columns.map(column => (
          <ColumnCard
            key={column.index}
            column={column}
            fields={matching.fields}
            sample={matching.getSample(column.index)}
            taken={matching.takenFieldKeys}
            onField={matching.setColumnField}
            onIgnore={matching.ignoreColumn}
            onUnignore={matching.unignoreColumn}
            onOption={matching.setColumnOption}
            optionsFor={matching.getOptionsFor}
          />
        ))}
      </div>
    </StepShell>
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidationRowProps<TKey extends string> = {
  row: ValidatedRow<TKey>;
  fields: Fields<TKey>;
  selected: boolean;
  onToggle: (rowId: string) => void;
  onCellChange: (rowId: string, fieldKey: TKey, value: CellValue) => Promise<void>;
};

/**
 * Memoized so an edit re-renders only the rows it touched: the engine hands
 * back the same row object when nothing about a row changed, and every other
 * prop here is stable. React Compiler does not replace this: it memoizes the
 * list as a whole, so without `memo` one edit would re-render every row.
 */
const ValidationRow = memo(function ValidationRow<TKey extends string>({
  row,
  fields,
  selected,
  onToggle,
  onCellChange,
}: ValidationRowProps<TKey>) {
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td className="px-2 py-1">
        <input type="checkbox" aria-label="Select row" checked={selected} onChange={() => onToggle(row.__index)} />
      </td>
      {fields.map(field => {
        const value = row[field.key];
        const error = row.__errors?.[field.key] ?? null;

        return (
          <td key={field.key} className="px-1 py-1">
            {field.fieldType.type === "checkbox" ? (
              <input
                type="checkbox"
                aria-label={field.label}
                checked={value === true}
                onChange={event => void onCellChange(row.__index, field.key, event.target.checked)}
              />
            ) : (
              <CellInput
                label={field.label}
                value={value ?? ""}
                error={error}
                numeric={field.fieldType.type === "number"}
                monospace={field.fieldType.type === "date"}
                onCommit={next => void onCellChange(row.__index, field.key, next)}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}) as <TKey extends string>(props: ValidationRowProps<TKey>) => ReactElement;

export function ValidationStep<TKey extends string>() {
  const validation = useValidation<TKey>();

  return (
    <StepShell
      title="Review and fix"
      description={
        <>
          <strong>{validation.validCount}</strong> row(s) ready
          {validation.errorCount > 0 ? (
            <>
              , <strong className="text-red-600">{validation.errorCount}</strong> with problems
            </>
          ) : null}
          .
        </>
      }
      footer={
        <>
          <Button onClick={validation.back}>Back</Button>
          <div className="flex gap-2">
            {validation.selectedIds.size > 0 ? (
              <Button variant="danger" onClick={() => void validation.deleteSelected()}>
                Delete {validation.selectedIds.size}
              </Button>
            ) : null}
            <Button variant="primary" disabled={validation.isBusy} onClick={() => void validation.submit()}>
              {validation.isBusy ? "Submitting…" : `Import ${validation.validCount}`}
            </Button>
          </div>
        </>
      }
    >
      <label className="mb-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={validation.showErrorsOnly}
          onChange={event => validation.setShowErrorsOnly(event.target.checked)}
        />
        Only show rows with problems
      </label>

      <div className="overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="w-10 px-2 py-2" />
              {validation.fields.map(field => (
                <th key={field.key} className="whitespace-nowrap px-3 py-2 font-medium">
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {validation.visibleRows.map(row => (
              <ValidationRow
                key={row.__index}
                row={row}
                fields={validation.fields}
                selected={validation.selectedIds.has(row.__index)}
                onToggle={validation.toggleSelected}
                onCellChange={validation.updateCell}
              />
            ))}
          </tbody>
        </table>
      </div>
    </StepShell>
  );
}
