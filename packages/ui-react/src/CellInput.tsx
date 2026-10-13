"use client";

import type { CellError, CellValue } from "@spotable/spreadsheet-import-core";
import { useCellDraft } from "@spotable/spreadsheet-import-react";
import { cx } from "./primitives.js";

export type CellInputProps = {
  value: CellValue;
  error: CellError | null;
  label: string;
  onCommit: (value: string) => void;
  /** Right-aligns the cell and asks mobile keyboards for digits. */
  numeric?: boolean;
  /** Tabular figures, so a column of dates lines up. */
  monospace?: boolean;
};

/**
 * A text cell that commits on blur or Enter rather than per keystroke. The
 * editing behaviour lives in `useCellDraft`; this is only its styling.
 */
export function CellInput({ value, error, label, onCommit, numeric = false, monospace = false }: CellInputProps) {
  const { getInputProps } = useCellDraft({ value, onCommit });

  return (
    <input
      {...getInputProps({
        "aria-label": label,
        "aria-invalid": error?.level === "error" || undefined,
        title: error?.message,
        inputMode: numeric ? "decimal" : undefined,
        className: cx(
          "w-full min-w-32 rounded border px-2 py-1 text-sm dark:bg-slate-900",
          numeric && "text-right tabular-nums",
          monospace && "tabular-nums",
          error?.level === "error"
            ? "border-red-400 bg-red-50 dark:bg-red-950"
            : error
              ? "border-amber-400 bg-amber-50 dark:bg-amber-950"
              : "border-transparent hover:border-slate-300 dark:hover:border-slate-700",
        ),
      })}
    />
  );
}
