import {
  ColumnType,
  SpreadsheetImportError,
  isMatchedColumn,
  type CellValue,
  type Columns,
  type Field,
  type Fields,
  type FileLike,
  type ImportResult,
  type ParsedWorkbook,
  type Parser,
  type RawRow,
  type RowData,
  type ValidatedRow,
} from "./types.js"
import { createStore, type Listener, type Store, type Unsubscribe } from "./store.js"
import {
  createColumns,
  findUnmatchedRequiredFields,
  getMatchedColumns,
  setColumn,
  setIgnoreColumn,
  setSubColumn,
} from "./matching/columns.js"
import { coerceValue, normalizeTableData } from "./matching/normalize.js"
import { isRowValid, stripMeta, validateTable, type RowHook, type TableHook } from "./validation/engine.js"
import { createId } from "./utils/id.js"

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const Step = {
  upload: "upload",
  selectSheet: "selectSheet",
  selectHeader: "selectHeader",
  matchColumns: "matchColumns",
  validate: "validate",
  submitted: "submitted",
} as const

export type Step = (typeof Step)[keyof typeof Step]

/** Steps the user can navigate back to, in order. */
export const NAVIGABLE_STEPS: readonly Step[] = [
  Step.upload,
  Step.selectSheet,
  Step.selectHeader,
  Step.matchColumns,
  Step.validate,
]

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type ImportState<TKey extends string> = {
  step: Step
  /** True while a parse, hook, validation or submit is in flight. */
  isBusy: boolean
  /** Last recoverable error. Cleared on the next successful action. */
  error: SpreadsheetImportError | null

  file: FileLike | null
  workbook: ParsedWorkbook | null
  /** The sheet that was committed and parsed into `sheetRows`. */
  sheetName: string | null

  /**
   * Sheet highlighted on the select-sheet step, before it is committed.
   *
   * Pending selections live in the store rather than in component state so a
   * "Continue" button rendered somewhere else entirely — a dialog footer, a
   * toolbar — can read and act on them.
   */
  pendingSheetName: string | null

  /** Rows of the selected sheet, header row included. */
  sheetRows: RawRow[]
  /** Row highlighted as the header. Pending until `selectHeaderRow` commits it. */
  headerRowIndex: number

  columns: Columns<TKey>
  rows: ValidatedRow<TKey>[]

  /** Steps the user has completed, for stepper UIs. */
  visitedSteps: Step[]
}

export type ImporterOptions<TKey extends string> = {
  fields: Fields<TKey>
  parser: Parser

  onSubmit?: (result: ImportResult<TKey>, file: FileLike | null) => void | Promise<void>
  /** Called for every recoverable error, so the host can toast it. */
  onError?: (error: SpreadsheetImportError) => void

  /** Raw sheet rows, straight after parsing. */
  uploadHook?: (rows: RawRow[]) => RawRow[] | Promise<RawRow[]>
  /** Header row and body, after the user picks the header. */
  selectHeaderHook?: (
    headerValues: RawRow,
    rows: RawRow[],
  ) => { headerValues: RawRow; rows: RawRow[] } | Promise<{ headerValues: RawRow; rows: RawRow[] }>
  /** Normalized records, before the first validation pass. */
  matchColumnsHook?: (
    data: RowData<TKey>[],
    rawRows: RawRow[],
    columns: Columns<TKey>,
  ) => RowData<TKey>[] | Promise<RowData<TKey>[]>
  rowHook?: RowHook<TKey>
  tableHook?: TableHook<TKey>

  /**
   * Business limit on imported records. Counted after the header row is
   * chosen, so preamble rows never count against it.
   */
  maxRecords?: number
  /**
   * Safety ceiling handed to the parser, in raw sheet rows. Use it to bail out
   * of an accidental 5-million-row file before it reaches memory. Kept apart
   * from `maxRecords` on purpose: at parse time the header row has not been
   * picked yet, so a raw row count cannot answer "how many records is this?".
   */
  maxFileRows?: number
  maxFileSize?: number
  /** Auto-assign fields to columns on entering the match step. Default: true. */
  autoMapHeaders?: boolean
  /** Auto-map select values to options. Default: false. */
  autoMapSelectValues?: boolean
  /** Levenshtein budget for header matching. Default: 2. */
  autoMapDistance?: number
  /** Refuse to submit while rows still carry `error`-level problems. Default: false. */
  blockInvalidSubmit?: boolean

  dateFormat?: string
  parseRaw?: boolean
}

export type Importer<TKey extends string> = {
  getState: () => ImportState<TKey>
  subscribe: (listener: Listener<ImportState<TKey>>) => Unsubscribe

  readonly fields: Fields<TKey>
  readonly options: Readonly<ImporterOptions<TKey>>

  // -- flow ---------------------------------------------------------------
  /** Parse a file and advance to sheet or header selection. */
  selectFile: (file: FileLike) => Promise<void>
  selectSheet: (sheetName: string) => Promise<void>
  selectHeaderRow: (rowIndex: number) => Promise<void>
  /** Highlight a sheet without committing to it. */
  setPendingSheet: (sheetName: string) => void
  /** Highlight a header row without committing to it. */
  setPendingHeaderRow: (rowIndex: number) => void
  /** Normalize with the current column mapping, validate, go to the validate step. */
  commitColumns: () => Promise<void>
  submit: () => Promise<ImportResult<TKey> | undefined>

  goToStep: (step: Step) => void
  back: () => void
  reset: () => void

  // -- column mapping -----------------------------------------------------
  setColumnField: (columnIndex: number, fieldKey: TKey | null) => void
  ignoreColumn: (columnIndex: number) => void
  unignoreColumn: (columnIndex: number) => void
  setColumnOption: (columnIndex: number, entry: string, optionValue: string) => void

  // -- row editing --------------------------------------------------------
  updateRow: (rowId: string, patch: Partial<RowData<TKey>>) => Promise<void>
  updateCell: (rowId: string, fieldKey: TKey, value: CellValue) => Promise<void>
  deleteRows: (rowIds: readonly string[]) => Promise<void>
  addRow: () => Promise<void>

  // -- derived ------------------------------------------------------------
  getResult: () => ImportResult<TKey>
  getUnmatchedRequiredFields: () => string[]
  getHeaderValues: () => RawRow
  getBodyRows: () => RawRow[]
  clearError: () => void
}

const DEFAULTS = {
  autoMapHeaders: true,
  autoMapSelectValues: false,
  autoMapDistance: 2,
  blockInvalidSubmit: false,
} as const

export function createImporter<TKey extends string>(options: ImporterOptions<TKey>): Importer<TKey> {
  const config = { ...DEFAULTS, ...options }

  const initialState = (): ImportState<TKey> => ({
    step: Step.upload,
    isBusy: false,
    error: null,
    file: null,
    workbook: null,
    sheetName: null,
    pendingSheetName: null,
    sheetRows: [],
    headerRowIndex: 0,
    columns: [],
    rows: [],
    visitedSteps: [Step.upload],
  })

  const store: Store<ImportState<TKey>> = createStore<ImportState<TKey>>(initialState())

  const patch = (changes: Partial<ImportState<TKey>>) => {
    store.setState((current) => ({ ...current, ...changes }))
  }

  const fail = (error: unknown, code: SpreadsheetImportError["code"] = "hook-failed") => {
    const wrapped =
      error instanceof SpreadsheetImportError
        ? error
        : new SpreadsheetImportError(code, error instanceof Error ? error.message : String(error), error)
    patch({ isBusy: false, error: wrapped })
    config.onError?.(wrapped)
  }

  const enterStep = (step: Step, changes: Partial<ImportState<TKey>> = {}) => {
    store.setState((current) => ({
      ...current,
      ...changes,
      step,
      isBusy: false,
      error: null,
      visitedSteps: current.visitedSteps.includes(step) ? current.visitedSteps : [...current.visitedSteps, step],
    }))
  }

  /** Rows of the selected sheet below the chosen header row. */
  const bodyRows = (state: ImportState<TKey>): RawRow[] => state.sheetRows.slice(state.headerRowIndex + 1)

  const headerValues = (state: ImportState<TKey>): RawRow => state.sheetRows[state.headerRowIndex] ?? []

  // -- flow -----------------------------------------------------------------

  const goToHeaderStep = async (rows: RawRow[], changes: Partial<ImportState<TKey>>) => {
    let processed = rows
    if (config.uploadHook) processed = await config.uploadHook(rows)

    if (processed.length === 0) {
      throw new SpreadsheetImportError("empty-sheet", "The selected sheet has no rows.")
    }

    enterStep(Step.selectHeader, { ...changes, sheetRows: processed, headerRowIndex: 0 })
  }

  const selectFile: Importer<TKey>["selectFile"] = async (file) => {
    patch({ isBusy: true, error: null })

    try {
      if (config.maxFileSize !== undefined && file.size > config.maxFileSize) {
        throw new SpreadsheetImportError(
          "file-too-large",
          `${file.name} is larger than the ${config.maxFileSize} byte limit.`,
        )
      }
      if (config.parser.canParse && !config.parser.canParse(file)) {
        throw new SpreadsheetImportError("unsupported-file", `${file.name} is not a supported file type.`)
      }

      const workbook = await config.parser.parse(file, {
        dateFormat: config.dateFormat,
        parseRaw: config.parseRaw,
        maxRows: config.maxFileRows,
      })

      const sheets = workbook.sheets.filter((sheet) => sheet.rows.length > 0)
      if (sheets.length === 0) {
        throw new SpreadsheetImportError("empty-sheet", `${file.name} contains no data.`)
      }

      // One sheet is the overwhelmingly common case; do not make the user
      // confirm a choice of one.
      if (sheets.length === 1) {
        const sheet = sheets[0]!
        await goToHeaderStep(sheet.rows, { file, workbook, sheetName: sheet.name })
        return
      }

      enterStep(Step.selectSheet, {
        file,
        workbook,
        sheetName: null,
        pendingSheetName: sheets[0]!.name,
      })
    } catch (error) {
      fail(error, "parse-failed")
    }
  }

  const selectSheet: Importer<TKey>["selectSheet"] = async (sheetName) => {
    const state = store.getState()
    const sheet = state.workbook?.sheets.find((candidate) => candidate.name === sheetName)
    if (!sheet) {
      fail(new SpreadsheetImportError("empty-sheet", `Sheet "${sheetName}" not found.`))
      return
    }

    patch({ isBusy: true, error: null, pendingSheetName: sheetName })
    try {
      await goToHeaderStep(sheet.rows, { sheetName })
    } catch (error) {
      fail(error)
    }
  }

  const selectHeaderRow: Importer<TKey>["selectHeaderRow"] = async (rowIndex) => {
    const state = store.getState()
    if (rowIndex < 0 || rowIndex >= state.sheetRows.length) {
      fail(new SpreadsheetImportError("empty-sheet", `Row ${rowIndex} is outside the sheet.`))
      return
    }

    patch({ isBusy: true, error: null, headerRowIndex: rowIndex })

    try {
      let header = state.sheetRows[rowIndex] ?? []
      let body = state.sheetRows.slice(rowIndex + 1)

      if (config.selectHeaderHook) {
        const result = await config.selectHeaderHook(header, body)
        header = result.headerValues
        body = result.rows
      }

      if (config.maxRecords !== undefined && body.length > config.maxRecords) {
        throw new SpreadsheetImportError(
          "too-many-rows",
          `This import has ${body.length} rows, more than the limit of ${config.maxRecords}.`,
        )
      }

      let columns = createColumns<TKey>(header)
      if (config.autoMapHeaders) {
        columns = getMatchedColumns(columns, config.fields, body, config.autoMapDistance, config.autoMapSelectValues)
      }

      // The hook may have rewritten header or body, so rebuild sheetRows from
      // what it returned rather than keeping a stale slice around.
      enterStep(Step.matchColumns, {
        sheetRows: [header, ...body],
        headerRowIndex: 0,
        columns,
      })
    } catch (error) {
      fail(error)
    }
  }

  const commitColumns: Importer<TKey>["commitColumns"] = async () => {
    const state = store.getState()
    patch({ isBusy: true, error: null })

    try {
      const raw = bodyRows(state)
      let data = normalizeTableData(state.columns, raw, config.fields)
      if (config.matchColumnsHook) {
        data = await config.matchColumnsHook(data, raw, state.columns)
      }

      const rows = await validateTable(data, {
        fields: config.fields,
        rowHook: config.rowHook,
        tableHook: config.tableHook,
      })

      enterStep(Step.validate, { rows })
    } catch (error) {
      fail(error)
    }
  }

  /**
   * Serializes row mutations.
   *
   * Every edit reads the current rows, validates asynchronously, then writes
   * back. Two overlapping edits — which is exactly what typing into a cell
   * produces — would both read the same base state and the slower one would
   * clobber the faster one's keystroke. Chaining them means each mutation sees
   * the result of the one before it.
   */
  let mutationQueue: Promise<unknown> = Promise.resolve()

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(task, task)
    // Keep the chain alive even if a task rejects; `fail` already reported it.
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** Re-run validation over the current rows and store the outcome. */
  const revalidate = async (rows: ValidatedRow<TKey>[], changedRowIndexes?: number[]) => {
    patch({ isBusy: true })
    try {
      const next = await validateTable(rows, {
        fields: config.fields,
        rowHook: config.rowHook,
        tableHook: config.tableHook,
        changedRowIndexes,
      })
      patch({ rows: next, isBusy: false, error: null })
    } catch (error) {
      fail(error)
    }
  }

  const getResult = (): ImportResult<TKey> => {
    const rows = store.getState().rows
    const validData: RowData<TKey>[] = []
    const invalidData: RowData<TKey>[] = []

    for (const row of rows) {
      ;(isRowValid(row) ? validData : invalidData).push(stripMeta(row))
    }

    return { validData, invalidData, all: rows }
  }

  const submit: Importer<TKey>["submit"] = async () => {
    const result = getResult()

    if (config.blockInvalidSubmit && result.invalidData.length > 0) {
      fail(
        new SpreadsheetImportError(
          "submit-failed",
          `${result.invalidData.length} row(s) still have errors.`,
        ),
        "submit-failed",
      )
      return undefined
    }

    patch({ isBusy: true, error: null })
    try {
      await config.onSubmit?.(result, store.getState().file)
      enterStep(Step.submitted)
      return result
    } catch (error) {
      fail(error, "submit-failed")
      return undefined
    }
  }

  // -- navigation -----------------------------------------------------------

  const goToStep: Importer<TKey>["goToStep"] = (step) => {
    const state = store.getState()
    // Only backwards, and only to somewhere already reached — jumping forward
    // would skip the parsing that produces the next step's inputs.
    if (!state.visitedSteps.includes(step)) return
    if (NAVIGABLE_STEPS.indexOf(step) > NAVIGABLE_STEPS.indexOf(state.step)) return
    patch({ step, error: null })
  }

  const back: Importer<TKey>["back"] = () => {
    const state = store.getState()
    const index = NAVIGABLE_STEPS.indexOf(state.step)
    if (index <= 0) return

    for (let i = index - 1; i >= 0; i--) {
      const candidate = NAVIGABLE_STEPS[i]!
      // Single-sheet imports never visited selectSheet; skip straight past it.
      if (state.visitedSteps.includes(candidate)) {
        patch({ step: candidate, error: null })
        return
      }
    }
  }

  const reset: Importer<TKey>["reset"] = () => {
    store.setState(initialState())
  }

  const setPendingSheet: Importer<TKey>["setPendingSheet"] = (sheetName) => {
    patch({ pendingSheetName: sheetName })
  }

  const setPendingHeaderRow: Importer<TKey>["setPendingHeaderRow"] = (rowIndex) => {
    const state = store.getState()
    if (rowIndex < 0 || rowIndex >= state.sheetRows.length) return
    patch({ headerRowIndex: rowIndex })
  }

  // -- column mapping -------------------------------------------------------

  const mapColumn = (columnIndex: number, map: (column: Columns<TKey>[number]) => Columns<TKey>[number]) => {
    store.setState((current) => ({
      ...current,
      columns: current.columns.map((column, index) => (index === columnIndex ? map(column) : column)),
    }))
  }

  const setColumnField: Importer<TKey>["setColumnField"] = (columnIndex, fieldKey) => {
    const state = store.getState()
    const field: Field<TKey> | undefined =
      fieldKey === null ? undefined : config.fields.find((candidate) => candidate.key === fieldKey)

    const rows = bodyRows(state)
    // A field can only live on one column; clear whichever column held it.
    const previousOwner = state.columns.findIndex(
      (column) => isMatchedColumn(column) && column.value === fieldKey && column.index !== columnIndex,
    )

    store.setState((current) => ({
      ...current,
      columns: current.columns.map((column, index) => {
        if (index === columnIndex) return setColumn(column, field, rows, config.autoMapSelectValues)
        if (index === previousOwner) return setColumn(column)
        return column
      }),
    }))
  }

  const ignoreColumn: Importer<TKey>["ignoreColumn"] = (columnIndex) => {
    mapColumn(columnIndex, (column) => setIgnoreColumn(column))
  }

  const unignoreColumn: Importer<TKey>["unignoreColumn"] = (columnIndex) => {
    mapColumn(columnIndex, (column) => setColumn(column))
  }

  const setColumnOption: Importer<TKey>["setColumnOption"] = (columnIndex, entry, optionValue) => {
    mapColumn(columnIndex, (column) => setSubColumn(column, entry, optionValue))
  }

  // -- row editing ----------------------------------------------------------

  const updateRow: Importer<TKey>["updateRow"] = (rowId, changes) =>
    enqueue(async () => {
      // Read inside the task, not outside: by the time we run, an earlier
      // queued edit may have changed the rows.
      const state = store.getState()
      const index = state.rows.findIndex((row) => row.__index === rowId)
      if (index === -1) return

      // Coerce through the same path an import takes, so a "1.234,56" typed
      // into a number cell lands as 1234.56 rather than as a string.
      const coerced = {} as Partial<RowData<TKey>>
      for (const [key, value] of Object.entries(changes) as [TKey, CellValue][]) {
        const field = config.fields.find((candidate) => candidate.key === key)
        coerced[key] = coerceValue(field as Field<string> | undefined, value)
      }

      const next = [...state.rows]
      next[index] = { ...next[index]!, ...coerced }
      await revalidate(next, [index])
    })

  const updateCell: Importer<TKey>["updateCell"] = (rowId, fieldKey, value) =>
    updateRow(rowId, { [fieldKey]: value } as Partial<RowData<TKey>>)

  const deleteRows: Importer<TKey>["deleteRows"] = (rowIds) =>
    enqueue(async () => {
      const ids = new Set(rowIds)
      const next = store.getState().rows.filter((row) => !ids.has(row.__index))
      // Indexes shifted, so this has to be a full pass.
      await revalidate(next)
    })

  const addRow: Importer<TKey>["addRow"] = () =>
    enqueue(async () => {
      const empty = {} as RowData<TKey>
      for (const field of config.fields) {
        empty[field.key] = field.fieldType.type === "checkbox" ? false : undefined
      }
      const row = { ...empty, __index: createId(), __errors: null } as ValidatedRow<TKey>
      const next = [...store.getState().rows, row]
      await revalidate(next, [next.length - 1])
    })

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    fields: config.fields,
    options: config,

    selectFile,
    selectSheet,
    selectHeaderRow,
    commitColumns,
    submit,

    goToStep,
    back,
    reset,
    setPendingSheet,
    setPendingHeaderRow,

    setColumnField,
    ignoreColumn,
    unignoreColumn,
    setColumnOption,

    updateRow,
    updateCell,
    deleteRows,
    addRow,

    getResult,
    getUnmatchedRequiredFields: () => findUnmatchedRequiredFields(config.fields, store.getState().columns),
    getHeaderValues: () => headerValues(store.getState()),
    getBodyRows: () => bodyRows(store.getState()),
    clearError: () => patch({ error: null }),
  }
}

/** Re-exported so consumers can switch on column kinds without a deep import. */
export { ColumnType }
