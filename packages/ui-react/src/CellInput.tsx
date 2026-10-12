"use client"

import { useEffect, useRef, useState } from "react"
import type { CellError, CellValue } from "@spotable/spreadsheet-import-core"
import { cx } from "./primitives.js"

export type CellInputProps = {
  value: CellValue
  error: CellError | null
  label: string
  onCommit: (value: string) => void
  /** Right-aligns the cell and asks mobile keyboards for digits. */
  numeric?: boolean
  /** Tabular figures, so a column of dates lines up. */
  monospace?: boolean
}

/**
 * A text cell that is uncontrolled while you type and controlled the rest of
 * the time.
 *
 * Committing on every keystroke means every keystroke waits on an async
 * validation pass over the whole table. On a 10 000 row import that round trip
 * is slower than a fast typist, and a fully controlled input resets itself to
 * the stale value in between — you type "Repaired" and get "d". So we hold the
 * draft locally, commit on blur or Enter, and accept outside changes only when
 * the field is not focused.
 */
export function CellInput({ value, error, label, onCommit, numeric = false, monospace = false }: CellInputProps) {
  const external = String(value ?? "")
  const [draft, setDraft] = useState(external)
  const isEditing = useRef(false)
  // Escape has to reach the blur that follows it. `setDraft` is asynchronous,
  // so the blur handler would still close over the abandoned draft and commit it.
  const cancelled = useRef(false)

  useEffect(() => {
    // A revalidation, an undo, or a hook rewriting the row should show up —
    // but never yank the text out from under someone mid-edit.
    if (!isEditing.current) setDraft(external)
  }, [external])

  const commit = () => {
    isEditing.current = false
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (draft !== external) onCommit(draft)
  }

  return (
    <input
      aria-label={label}
      aria-invalid={error?.level === "error" || undefined}
      title={error?.message}
      inputMode={numeric ? "decimal" : undefined}
      className={cx(
        "w-full min-w-32 rounded border px-2 py-1 text-sm dark:bg-slate-900",
        numeric && "text-right tabular-nums",
        monospace && "tabular-nums",
        error?.level === "error"
          ? "border-red-400 bg-red-50 dark:bg-red-950"
          : error
            ? "border-amber-400 bg-amber-50 dark:bg-amber-950"
            : "border-transparent hover:border-slate-300 dark:hover:border-slate-700",
      )}
      value={draft}
      onFocus={() => {
        isEditing.current = true
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur()
        } else if (event.key === "Escape") {
          cancelled.current = true
          isEditing.current = false
          setDraft(external)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
