"use client"

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type RefObject,
} from "react"
import {
  ColumnType,
  findUnmatchedRequiredFields,
  getFieldOptions,
  isMatchedColumn,
  isRowValid,
  type Step,
  type CellValue,
  type Column,
  type FileLike,
  type ImportState,
  type RawRow,
} from "@spreadsheet-import/core"
import { useImporter, useImporterActions, useImporterState } from "./context.js"

/**
 * The prop-getter pattern, as in Downshift and react-hook-form: a hook returns
 * objects you spread onto *your* elements. No component we render, no class
 * name we impose, no wrapper div in your tree.
 *
 * Anything you pass in is merged into the result, and your event handlers run
 * before ours rather than being overwritten.
 */
export type PropGetter<TProps> = <TExtra extends object>(props?: TExtra) => TProps & TExtra

/** Props for the drop target. Spread onto a div, a section, whatever fits. */
export type DropZoneProps = HTMLAttributes<HTMLElement> & {
  role: "button"
  tabIndex: number
  "data-dragging"?: true
  "data-disabled"?: true
}

/** Props for the hidden file input. */
export type FileInputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref: RefObject<HTMLInputElement | null>
  type: "file"
}

/** Merge a caller's handler with ours so spreading never silently drops theirs. */
function chain<TArgs extends unknown[]>(
  ours: (...args: TArgs) => void,
  theirs?: (...args: TArgs) => void,
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    theirs?.(...args)
    ours(...args)
  }
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function useSpreadsheetImport<TKey extends string>() {
  const importer = useImporter<TKey>()
  const actions = useImporterActions<TKey>()
  const step = useImporterState<TKey, Step>((state) => state.step)
  const isBusy = useImporterState<TKey, boolean>((state) => state.isBusy)
  const error = useImporterState<TKey, ImportState<TKey>["error"]>((state) => state.error)

  return { importer, step, isBusy, error, fields: importer.fields, ...actions }
}

// ---------------------------------------------------------------------------
// Upload step
// ---------------------------------------------------------------------------

export type UseFileDropOptions = {
  /** `accept` for the file input, e.g. ".csv,.xlsx". */
  accept?: string
  disabled?: boolean
}

export function useFileDrop<TKey extends string>(options: UseFileDropOptions = {}) {
  const { selectFile } = useImporterActions<TKey>()
  const isBusy = useImporterState<TKey, boolean>((state) => state.isBusy)
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  // Drag events fire on every child element; count enters and leaves so the
  // highlight does not flicker as the pointer crosses inner nodes.
  const dragDepth = useRef(0)

  const disabled = options.disabled || isBusy

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (file) void selectFile(file as unknown as FileLike)
    },
    [selectFile],
  )

  const getRootProps = useCallback(
    (props: Record<string, unknown> = {}) => ({
      ...props,
      "data-dragging": isDragging || undefined,
      "data-disabled": disabled || undefined,
      onDragEnter: chain((event: DragEvent) => {
        event.preventDefault()
        dragDepth.current += 1
        if (!disabled) setIsDragging(true)
      }, props.onDragEnter as never),
      onDragOver: chain((event: DragEvent) => event.preventDefault(), props.onDragOver as never),
      onDragLeave: chain((event: DragEvent) => {
        event.preventDefault()
        dragDepth.current -= 1
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setIsDragging(false)
        }
      }, props.onDragLeave as never),
      onDrop: chain((event: DragEvent) => {
        event.preventDefault()
        dragDepth.current = 0
        setIsDragging(false)
        if (!disabled) handleFiles(event.dataTransfer?.files ?? null)
      }, props.onDrop as never),
      onClick: chain(() => {
        if (!disabled) inputRef.current?.click()
      }, props.onClick as never),
      onKeyDown: chain((event: KeyboardEvent) => {
        // A div acting as a button has to answer to Enter and Space itself.
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          if (!disabled) inputRef.current?.click()
        }
      }, props.onKeyDown as never),
      role: "button",
      tabIndex: disabled ? -1 : 0,
      "aria-disabled": disabled || undefined,
    }),
    [disabled, handleFiles, isDragging],
  ) as PropGetter<DropZoneProps>

  const getInputProps = useCallback(
    (props: Record<string, unknown> = {}) => ({
      ...props,
      ref: inputRef,
      type: "file",
      accept: options.accept,
      disabled,
      style: { display: "none", ...(props.style as object) },
      onChange: chain((event: ChangeEvent<HTMLInputElement>) => {
        handleFiles(event.target.files)
        // Reset so picking the same file twice still fires a change event.
        event.target.value = ""
      }, props.onChange as never),
    }),
    [disabled, handleFiles, options.accept],
  ) as PropGetter<FileInputProps>

  return { getRootProps, getInputProps, isDragging, isBusy, inputRef, open: () => inputRef.current?.click() }
}

// ---------------------------------------------------------------------------
// Sheet selection
// ---------------------------------------------------------------------------

export function useSheetSelection<TKey extends string>() {
  const { selectSheet, setPendingSheet, back } = useImporterActions<TKey>()
  const sheets = useImporterState<TKey, { name: string; rowCount: number }[]>(
    (state) => state.workbook?.sheets.map((sheet) => ({ name: sheet.name, rowCount: sheet.rows.length })) ?? [],
    (a, b) => a.length === b.length && a.every((sheet, i) => sheet.name === b[i]?.name),
  )
  // Kept in the store, not in local state, so a Continue button rendered
  // outside this step can commit the highlighted sheet.
  const selected = useImporterState<TKey, string | null>((state) => state.pendingSheetName)

  const active = selected ?? sheets[0]?.name ?? null

  return {
    sheets,
    selected: active,
    setSelected: setPendingSheet,
    confirm: () => (active ? selectSheet(active) : Promise.resolve()),
    back,
    getSheetProps: (name: string) => ({
      role: "radio" as const,
      "aria-checked": active === name,
      onClick: () => setPendingSheet(name),
      "data-selected": active === name || undefined,
    }),
  }
}

// ---------------------------------------------------------------------------
// Header selection
// ---------------------------------------------------------------------------

export function useHeaderSelection<TKey extends string>() {
  const { selectHeaderRow, setPendingHeaderRow, back } = useImporterActions<TKey>()
  const rows = useImporterState<TKey, RawRow[]>((state) => state.sheetRows)
  const isBusy = useImporterState<TKey, boolean>((state) => state.isBusy)
  // Same reason as the sheet step: the highlighted row belongs to the flow,
  // not to whichever component happens to render the list.
  const selectedIndex = useImporterState<TKey, number>((state) => state.headerRowIndex)

  return {
    rows,
    selectedIndex,
    setSelectedIndex: setPendingHeaderRow,
    isBusy,
    confirm: () => selectHeaderRow(selectedIndex),
    back,
    getRowProps: (index: number) => ({
      role: "radio" as const,
      "aria-checked": selectedIndex === index,
      "data-selected": selectedIndex === index || undefined,
      onClick: () => setPendingHeaderRow(index),
    }),
  }
}

// ---------------------------------------------------------------------------
// Column matching
// ---------------------------------------------------------------------------

export function useColumnMatching<TKey extends string>() {
  const importer = useImporter<TKey>()
  const { setColumnField, ignoreColumn, unignoreColumn, setColumnOption, commitColumns, back } =
    useImporterActions<TKey>()

  const columns = useImporterState<TKey, Column<TKey>[]>((state) => state.columns)
  const isBusy = useImporterState<TKey, boolean>((state) => state.isBusy)
  const bodyRows = useImporterState<TKey, RawRow[]>((state) => state.sheetRows.slice(state.headerRowIndex + 1))

  // Derived from `columns` directly rather than from `importer`, so it stays a
  // pure function of rendered state instead of a snapshot read at render time.
  const unmatchedRequiredFields = useMemo(
    () => findUnmatchedRequiredFields(importer.fields, columns),
    [importer.fields, columns],
  )

  /**
   * Field keys already taken, so a UI can grey them out instead of surprising
   * the user. Collecting fields are never listed: several columns mapping to
   * one is what they are for.
   */
  const takenFieldKeys = useMemo(() => {
    const collects = new Set(importer.fields.filter((field) => field.collects).map((field) => field.key))
    return new Set(
      columns
        .filter(isMatchedColumn)
        .map((column) => column.value)
        .filter((key) => !collects.has(key)),
    )
  }, [columns, importer.fields])

  return {
    columns,
    fields: importer.fields,
    isBusy,
    unmatchedRequiredFields,
    takenFieldKeys,
    /** First rows of the column, for a preview under the header. */
    getSample: (columnIndex: number, count = 3) =>
      bodyRows.slice(0, count).map((row) => row[columnIndex]),
    getOptionsFor: (fieldKey: TKey) => getFieldOptions(importer.fields, fieldKey),
    setColumnField,
    ignoreColumn,
    unignoreColumn,
    setColumnOption,
    continue: commitColumns,
    back,
    ColumnType,
  }
}

// ---------------------------------------------------------------------------
// Validation step
// ---------------------------------------------------------------------------

export type UseValidationOptions = {
  /** Start with only rows that still have errors. Default: false. */
  filterErrorsOnly?: boolean
}

export function useValidation<TKey extends string>(options: UseValidationOptions = {}) {
  const importer = useImporter<TKey>()
  const { updateCell, updateRow, deleteRows, addRow, submit, back } = useImporterActions<TKey>()

  const rows = useImporterState<TKey, ImportState<TKey>["rows"]>((state) => state.rows)
  const isBusy = useImporterState<TKey, boolean>((state) => state.isBusy)

  const [showErrorsOnly, setShowErrorsOnly] = useState(options.filterErrorsOnly ?? false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())

  const visibleRows = useMemo(
    () => (showErrorsOnly ? rows.filter((row) => row.__errors !== null) : rows),
    [rows, showErrorsOnly],
  )

  const errorCount = useMemo(() => rows.filter((row) => !isRowValid(row)).length, [rows])

  const toggleSelected = useCallback((rowId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }, [])

  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return
    await deleteRows([...selectedIds])
    setSelectedIds(new Set())
  }, [deleteRows, selectedIds])

  return {
    rows,
    visibleRows,
    fields: importer.fields,
    isBusy,
    errorCount,
    validCount: rows.length - errorCount,
    showErrorsOnly,
    setShowErrorsOnly,
    selectedIds,
    toggleSelected,
    clearSelection: () => setSelectedIds(new Set()),
    deleteSelected,
    updateCell,
    updateRow,
    deleteRows,
    addRow,
    submit,
    back,
    /** Everything a cell editor needs: current value, its error, and a setter. */
    getCellProps: (rowId: string, fieldKey: TKey) => {
      const row = rows.find((candidate) => candidate.__index === rowId)
      const error = row?.__errors?.[fieldKey] ?? null
      return {
        value: (row?.[fieldKey] ?? "") as Exclude<CellValue, undefined>,
        error,
        "aria-invalid": error?.level === "error" || undefined,
        "data-level": error?.level,
        onValueChange: (next: CellValue) => updateCell(rowId, fieldKey, next),
      }
    },
    getRowErrors: (rowId: string) => rows.find((row) => row.__index === rowId)?.__errors ?? null,
  }
}
