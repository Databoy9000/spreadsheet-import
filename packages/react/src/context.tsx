"use client"

import { createContext, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { createImporter, type ImportState, type Importer, type ImporterOptions } from "@spreadsheet-import/core"

const ImporterContext = createContext<Importer<string> | null>(null)

export type SpreadsheetImportProviderProps<TKey extends string> = {
  /** Pass an existing importer to share one flow across trees, or omit and let the provider own it. */
  importer?: Importer<TKey>
  options?: ImporterOptions<TKey>
  children: ReactNode
}

export function SpreadsheetImportProvider<TKey extends string>({
  importer,
  options,
  children,
}: SpreadsheetImportProviderProps<TKey>) {
  // A lazy state initializer, not a ref: it runs exactly once and is legal to
  // read during render. `options` is deliberately not a dependency — a fresh
  // object literal on every render must not tear down an in-progress import.
  const [owned] = useState<Importer<TKey> | null>(() => {
    if (importer) return null
    if (!options) throw new Error("SpreadsheetImportProvider needs either an `importer` or `options`.")
    return createImporter(options)
  })

  // The context is keyed by `string` so one provider can serve any field union;
  // `useImporter` narrows it back on the way out.
  const value = (importer ?? owned) as unknown as Importer<string>

  return <ImporterContext.Provider value={value}>{children}</ImporterContext.Provider>
}

export function useImporter<TKey extends string>(): Importer<TKey> {
  const importer = useContext(ImporterContext)
  if (!importer) {
    throw new Error("useImporter must be used inside a <SpreadsheetImportProvider>.")
  }
  return importer as unknown as Importer<TKey>
}

/**
 * Subscribe to a slice of importer state.
 *
 * `useSyncExternalStore` is what makes this concurrent-safe: React controls
 * when it reads, so a transition that renders stale state gets caught and
 * re-rendered rather than tearing.
 */
export function useImporterState<TKey extends string, TSelected = ImportState<TKey>>(
  selector: (state: ImportState<TKey>) => TSelected = (state) => state as unknown as TSelected,
  isEqual: (a: TSelected, b: TSelected) => boolean = Object.is,
): TSelected {
  const importer = useImporter<TKey>()

  // Cache the last selected value so an unstable selector return (a new array,
  // say) does not force a render on every store notification.
  const cache = useRef<{ state: ImportState<TKey>; selected: TSelected } | null>(null)

  const getSnapshot = () => {
    const state = importer.getState()
    const previous = cache.current
    if (previous && previous.state === state) return previous.selected

    const selected = selector(state)
    if (previous && isEqual(previous.selected, selected)) {
      cache.current = { state, selected: previous.selected }
      return previous.selected
    }

    cache.current = { state, selected }
    return selected
  }

  return useSyncExternalStore(importer.subscribe, getSnapshot, getSnapshot)
}

/** Stable actions object; never changes identity, so it is safe in dependency arrays. */
export function useImporterActions<TKey extends string>() {
  const importer = useImporter<TKey>()
  return useMemo(
    () => ({
      selectFile: importer.selectFile,
      selectSheet: importer.selectSheet,
      selectHeaderRow: importer.selectHeaderRow,
      commitColumns: importer.commitColumns,
      submit: importer.submit,
      goToStep: importer.goToStep,
      back: importer.back,
      reset: importer.reset,
      setColumnField: importer.setColumnField,
      ignoreColumn: importer.ignoreColumn,
      unignoreColumn: importer.unignoreColumn,
      setColumnOption: importer.setColumnOption,
      updateRow: importer.updateRow,
      updateCell: importer.updateCell,
      deleteRows: importer.deleteRows,
      addRow: importer.addRow,
      clearError: importer.clearError,
    }),
    [importer],
  )
}
