/**
 * The same flow again, this time built only from the hooks — no `ui-react`.
 *
 * This is what an app team writes when the reference UI does not match their
 * design system: ~120 lines, all of it markup they own.
 */
import type { Field, ImportResult, Parser } from "@spotable/spreadsheet-import-core";
import { Step } from "@spotable/spreadsheet-import-core";
import {
  SpreadsheetImportProvider,
  useColumnMatching,
  useFileDrop,
  useHeaderSelection,
  useSpreadsheetImport,
  useValidation,
} from "@spotable/spreadsheet-import-react";

type Props<TKey extends string> = {
  fields: readonly Field<TKey>[];
  parser: Parser;
  onResult: (result: ImportResult<TKey>) => void;
};

const panel = "rounded-lg border border-dashed border-slate-300 p-4 dark:border-slate-700";
const primary = "rounded bg-slate-900 px-3 py-1.5 text-sm text-white dark:bg-slate-100 dark:text-slate-900";

function Upload<TKey extends string>() {
  const { getRootProps, getInputProps, isDragging } = useFileDrop<TKey>({ accept: ".csv,.tsv,.xlsx" });

  return (
    <div
      {...getRootProps({ className: `${panel} cursor-pointer ${isDragging ? "bg-slate-100 dark:bg-slate-800" : ""}` })}
    >
      <input {...getInputProps()} />
      <p className="text-sm">{isDragging ? "Let go" : "Drop a file, or click"}</p>
    </div>
  );
}

function Header<TKey extends string>() {
  const { rows, selectedIndex, setSelectedIndex, confirm } = useHeaderSelection<TKey>();

  return (
    <div className={panel}>
      <label className="text-sm">
        Header row
        <select
          className="ml-2 rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
          value={selectedIndex}
          onChange={event => setSelectedIndex(Number(event.target.value))}
        >
          {rows.slice(0, 20).map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: sheet rows have no identity beyond their position
            <option key={index} value={index}>
              {index + 1}: {row.slice(0, 4).join(" · ").slice(0, 60)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={`${primary} ml-3`} onClick={() => void confirm()}>
        Continue
      </button>
    </div>
  );
}

function Match<TKey extends string>() {
  const { columns, fields, setColumnField, unmatchedRequiredFields, continue: next } = useColumnMatching<TKey>();

  return (
    <div className={panel}>
      <div className="grid gap-2 sm:grid-cols-2">
        {columns.map(column => (
          <label key={column.index} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{column.header || "(blank)"}</span>
            <select
              className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
              value={"value" in column ? column.value : ""}
              onChange={event => setColumnField(column.index, (event.target.value || null) as TKey | null)}
            >
              <option value="">skip</option>
              {fields.map(field => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {unmatchedRequiredFields.length > 0 ? (
        <p className="mt-2 text-xs text-amber-600">Missing: {unmatchedRequiredFields.join(", ")}</p>
      ) : null}
      <button type="button" className={`${primary} mt-3`} onClick={() => void next()}>
        Validate
      </button>
    </div>
  );
}

function Review<TKey extends string>() {
  const { rows, fields, errorCount, validCount, getCellProps, submit } = useValidation<TKey>();

  return (
    <div className={panel}>
      <p className="mb-2 text-sm">
        {validCount} ready · {errorCount} with problems
      </p>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              {fields.map(field => (
                <th key={field.key} className="px-2 py-1 font-medium">
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map(row => (
              <tr key={row.__index}>
                {fields.map(field => {
                  const cell = getCellProps(row.__index, field.key);
                  return (
                    <td key={field.key} className="px-2 py-1">
                      <span className={cell.error ? "text-red-600" : undefined} title={cell.error?.message}>
                        {String(cell.value) || "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className={`${primary} mt-3`} onClick={() => void submit()}>
        Import
      </button>
    </div>
  );
}

function Flow<TKey extends string>() {
  const { step, error, reset } = useSpreadsheetImport<TKey>();

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-red-600">{error.message}</p> : null}
      {step === Step.upload && <Upload<TKey> />}
      {step === Step.selectHeader && <Header<TKey> />}
      {step === Step.matchColumns && <Match<TKey> />}
      {step === Step.validate && <Review<TKey> />}
      {step === Step.submitted && (
        <div className={panel}>
          <p className="text-sm">Imported.</p>
          <button type="button" className={`${primary} mt-2`} onClick={reset}>
            Again
          </button>
        </div>
      )}
    </div>
  );
}

export function HeadlessImport<TKey extends string>({ fields, parser, onResult }: Props<TKey>) {
  return (
    <SpreadsheetImportProvider options={{ fields, parser, autoMapSelectValues: true, onSubmit: onResult }}>
      <Flow<TKey> />
    </SpreadsheetImportProvider>
  );
}
