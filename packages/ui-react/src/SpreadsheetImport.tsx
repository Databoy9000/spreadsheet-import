"use client";

import { type ImporterOptions, Step } from "@spotable/spreadsheet-import-core";
import { SpreadsheetImportProvider, useSpreadsheetImport } from "@spotable/spreadsheet-import-react";
import { Alert, Button, cx } from "./primitives.js";
import { MatchColumnsStep, SelectHeaderStep, SelectSheetStep, UploadStep, ValidationStep } from "./steps.js";

const STEP_LABELS: { step: Step; label: string }[] = [
  { step: Step.upload, label: "Upload" },
  { step: Step.selectHeader, label: "Header" },
  { step: Step.matchColumns, label: "Match" },
  { step: Step.validate, label: "Review" },
];

export function Stepper<TKey extends string>() {
  const { step, goToStep } = useSpreadsheetImport<TKey>();
  // The sheet step is conditional, so it does not get its own dot.
  const currentIndex = Math.max(
    0,
    STEP_LABELS.findIndex(entry => entry.step === (step === Step.selectSheet ? Step.upload : step)),
  );

  return (
    <ol className="flex items-center gap-2" aria-label="Import progress">
      {STEP_LABELS.map((entry, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
        return (
          <li key={entry.step} className="flex items-center gap-2">
            <button
              type="button"
              disabled={state === "todo"}
              aria-current={state === "current" ? "step" : undefined}
              onClick={() => goToStep(entry.step)}
              className={cx(
                "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                state === "current" && "bg-sky-600 text-white",
                state === "done" && "bg-sky-100 text-sky-800 hover:bg-sky-200 dark:bg-sky-950 dark:text-sky-200",
                state === "todo" && "text-slate-400",
              )}
            >
              <span
                className={cx(
                  "grid size-5 place-items-center rounded-full border text-[10px]",
                  state === "current" ? "border-white" : "border-current",
                )}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              {entry.label}
            </button>
            {index < STEP_LABELS.length - 1 ? <span className="h-px w-4 bg-slate-300 dark:bg-slate-700" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function CurrentStep<TKey extends string>({ accept }: { accept?: string }) {
  const { step, error, clearError, reset } = useSpreadsheetImport<TKey>();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Stepper<TKey> />

      {error ? (
        <Alert level="error" className="flex items-start justify-between gap-3">
          <span>{error.message}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss" className="shrink-0 font-bold">
            ×
          </button>
        </Alert>
      ) : null}

      <div className="min-h-0 flex-1">
        {step === Step.upload && <UploadStep<TKey> {...(accept ? { accept } : {})} />}
        {step === Step.selectSheet && <SelectSheetStep<TKey> />}
        {step === Step.selectHeader && <SelectHeaderStep<TKey> />}
        {step === Step.matchColumns && <MatchColumnsStep<TKey> />}
        {step === Step.validate && <ValidationStep<TKey> />}
        {step === Step.submitted && (
          <div className="grid place-items-center gap-3 py-16 text-center">
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">Imported</p>
            <Button variant="primary" onClick={reset}>
              Import another file
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export type SpreadsheetImportProps<TKey extends string> = ImporterOptions<TKey> & {
  /** `accept` for the file input. */
  accept?: string;
  className?: string;
};

/**
 * A batteries-included import flow.
 *
 * This is a *reference* implementation: everything it does, it does through
 * the public hooks. Copy the file into your project and restyle it the moment
 * it stops fitting — nothing here is privileged.
 */
export function SpreadsheetImport<TKey extends string>({
  accept,
  className,
  ...options
}: SpreadsheetImportProps<TKey>) {
  return (
    <SpreadsheetImportProvider options={options}>
      <div className={cx("flex h-full min-h-0 flex-col text-slate-900 dark:text-slate-100", className)}>
        <CurrentStep<TKey> {...(accept ? { accept } : {})} />
      </div>
    </SpreadsheetImportProvider>
  );
}
