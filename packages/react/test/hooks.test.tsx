import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { StrictMode, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { createImporter, Step, type Field, type FileLike, type Importer } from "@databoy9000/spreadsheet-import-core"
import { createCsvParser } from "@databoy9000/spreadsheet-import-core/parsers"
import {
  SpreadsheetImportProvider,
  useColumnMatching,
  useFileDrop,
  useHeaderSelection,
  useImporterState,
  useSheetSelection,
  useSpreadsheetImport,
  useValidation,
} from "../src/index.js"

type Key = "name" | "email" | "active"

const fields: readonly Field<Key>[] = [
  { key: "name", label: "Name", fieldType: { type: "input" }, validations: [{ rule: "required" }] },
  { key: "email", label: "Email", fieldType: { type: "input" }, validations: [{ rule: "unique" }] },
  { key: "active", label: "Active", fieldType: { type: "checkbox" } },
]

const CSV = "Name,Email,Active\nJan,jan@example.com,yes\n,dup@example.com,no\nSofie,dup@example.com,yes"

function csvFile(name = "people.csv", contents = CSV): FileLike {
  return {
    name,
    size: contents.length,
    text: async () => contents,
    arrayBuffer: async () => new TextEncoder().encode(contents).buffer,
  }
}

function setup(overrides: Partial<Parameters<typeof createImporter<Key>>[0]> = {}) {
  const importer = createImporter<Key>({ fields, parser: createCsvParser(), ...overrides })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SpreadsheetImportProvider importer={importer}>{children}</SpreadsheetImportProvider>
  )
  return { importer, wrapper }
}

/** Walk the importer to the validation step outside React, then assert on hooks. */
async function toValidation(importer: Importer<Key>) {
  await importer.selectFile(csvFile())
  await importer.selectHeaderRow(0)
  await importer.commitColumns()
}

describe("SpreadsheetImportProvider", () => {
  it("creates an importer from options when none is passed", () => {
    const { result } = renderHook(() => useSpreadsheetImport<Key>(), {
      wrapper: ({ children }) => (
        <SpreadsheetImportProvider options={{ fields, parser: createCsvParser() }}>{children}</SpreadsheetImportProvider>
      ),
    })

    expect(result.current.step).toBe(Step.upload)
    expect(result.current.fields).toHaveLength(3)
  })

  it("keeps the same importer across re-renders", () => {
    function Probe({ tick }: { tick: number }) {
      const { importer } = useSpreadsheetImport<Key>()
      seen.push(importer)
      return <span>{tick}</span>
    }
    const seen: unknown[] = []

    const { rerender } = render(
      <SpreadsheetImportProvider options={{ fields, parser: createCsvParser() }}>
        <Probe tick={1} />
      </SpreadsheetImportProvider>,
    )
    rerender(
      <SpreadsheetImportProvider options={{ fields, parser: createCsvParser() }}>
        <Probe tick={2} />
      </SpreadsheetImportProvider>,
    )

    expect(new Set(seen).size).toBe(1)
  })

  it("throws a useful message outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => renderHook(() => useSpreadsheetImport<Key>())).toThrow(/inside a <SpreadsheetImportProvider>/)
    spy.mockRestore()
  })

  it("throws when given neither an importer nor options", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() =>
      render(
        <SpreadsheetImportProvider>
          <span />
        </SpreadsheetImportProvider>,
      ),
    ).toThrow(/either an `importer` or `options`/)
    spy.mockRestore()
  })
})

describe("useImporterState", () => {
  it("re-renders on a state change", async () => {
    const { importer, wrapper } = setup()
    const { result } = renderHook(() => useImporterState<Key, Step>((state) => state.step), { wrapper })

    expect(result.current).toBe(Step.upload)
    await act(() => importer.selectFile(csvFile()))
    expect(result.current).toBe(Step.selectHeader)
  })

  it("does not re-render when the selected slice is unchanged", async () => {
    const { importer, wrapper } = setup()
    const renders = vi.fn()

    renderHook(
      () => {
        renders()
        return useImporterState<Key, Step>((state) => state.step)
      },
      { wrapper },
    )
    const before = renders.mock.calls.length

    // `columns` change, `step` does not.
    await act(() => importer.selectFile(csvFile()))
    await act(() => importer.selectHeaderRow(0))
    const afterStepChanges = renders.mock.calls.length

    act(() => importer.setColumnField(0, null))
    expect(renders.mock.calls.length).toBe(afterStepChanges)
    expect(afterStepChanges).toBeGreaterThan(before)
  })

  it("holds a stable reference for an unstable selector via isEqual", async () => {
    const { importer, wrapper } = setup()
    const { result } = renderHook(
      () =>
        useImporterState<Key, string[]>(
          (state) => state.columns.map((column) => column.header),
          (a, b) => a.length === b.length && a.every((value, i) => value === b[i]),
        ),
      { wrapper },
    )

    await act(() => importer.selectFile(csvFile()))
    await act(() => importer.selectHeaderRow(0))
    const first = result.current

    // Changing a mapping leaves the headers identical.
    act(() => importer.ignoreColumn(2))
    expect(result.current).toBe(first)
  })

  it("works under StrictMode double-rendering", async () => {
    const { importer } = setup()
    const { result } = renderHook(() => useImporterState<Key, Step>((state) => state.step), {
      wrapper: ({ children }) => (
        <StrictMode>
          <SpreadsheetImportProvider importer={importer}>{children}</SpreadsheetImportProvider>
        </StrictMode>
      ),
    })

    await act(() => importer.selectFile(csvFile()))
    expect(result.current).toBe(Step.selectHeader)
  })
})

describe("useFileDrop", () => {
  it("opens the file dialog on click", () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useFileDrop<Key>(), { wrapper })

    render(
      <div>
        <input data-testid="input" {...result.current.getInputProps()} />
      </div>,
    )
    const click = vi.spyOn(result.current.inputRef.current!, "click")

    act(() => (result.current.getRootProps().onClick as () => void)())
    expect(click).toHaveBeenCalled()
  })

  it("selects a file dropped onto the root", async () => {
    const { importer, wrapper } = setup()
    const { result } = renderHook(() => useFileDrop<Key>(), { wrapper })

    render(<div data-testid="zone" {...result.current.getRootProps()} />)
    const file = new File([CSV], "people.csv", { type: "text/csv" })

    fireEvent.drop(screen.getByTestId("zone"), { dataTransfer: { files: [file] } })

    await waitFor(() => expect(importer.getState().step).toBe(Step.selectHeader))
  })

  it("tracks dragging across nested children without flickering", () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useFileDrop<Key>(), { wrapper })

    render(
      <div data-testid="zone" {...result.current.getRootProps()}>
        <span data-testid="child">inner</span>
      </div>,
    )
    const zone = screen.getByTestId("zone")

    fireEvent.dragEnter(zone)
    expect(result.current.isDragging).toBe(true)

    // Pointer moves onto the child: enter fires before leave, so the count
    // must never dip to zero.
    fireEvent.dragEnter(screen.getByTestId("child"))
    fireEvent.dragLeave(zone)
    expect(result.current.isDragging).toBe(true)

    fireEvent.dragLeave(screen.getByTestId("child"))
    expect(result.current.isDragging).toBe(false)
  })

  it("reads a file chosen through the input", async () => {
    const { importer, wrapper } = setup()
    const { result } = renderHook(() => useFileDrop<Key>({ accept: ".csv" }), { wrapper })

    render(<input data-testid="input" {...result.current.getInputProps()} />)
    const input = screen.getByTestId("input") as HTMLInputElement
    expect(input.accept).toBe(".csv")

    fireEvent.change(input, { target: { files: [new File([CSV], "people.csv")] } })

    await waitFor(() => expect(importer.getState().step).toBe(Step.selectHeader))
    // Cleared, so re-picking the same file fires change again.
    expect(input.value).toBe("")
  })

  it("keeps a caller's own handler when props are merged", () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useFileDrop<Key>(), { wrapper })
    const onClick = vi.fn()

    render(<div data-testid="zone" {...result.current.getRootProps({ onClick })} />)
    fireEvent.click(screen.getByTestId("zone"))

    expect(onClick).toHaveBeenCalled()
  })

  it("ignores drops while disabled", async () => {
    const { importer, wrapper } = setup()
    const { result } = renderHook(() => useFileDrop<Key>({ disabled: true }), { wrapper })

    render(<div data-testid="zone" {...result.current.getRootProps()} />)
    fireEvent.drop(screen.getByTestId("zone"), { dataTransfer: { files: [new File([CSV], "a.csv")] } })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(importer.getState().step).toBe(Step.upload)
  })

  it("exposes the zone as a keyboard-reachable button", () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useFileDrop<Key>(), { wrapper })
    const props = result.current.getRootProps()

    expect(props.role).toBe("button")
    expect(props.tabIndex).toBe(0)
  })
})

describe("useSheetSelection", () => {
  const MULTI = "a,b\n1,2"

  it("defaults to the first sheet and confirms it", async () => {
    const importer = createImporter<Key>({
      fields,
      parser: {
        name: "fake",
        parse: async () => ({
          sheets: [
            { name: "One", rows: [["Name"], ["Jan"]] },
            { name: "Two", rows: [["Name"], ["Sofie"]] },
          ],
        }),
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SpreadsheetImportProvider importer={importer}>{children}</SpreadsheetImportProvider>
    )

    await act(() => importer.selectFile(csvFile("x.csv", MULTI)))
    const { result } = renderHook(() => useSheetSelection<Key>(), { wrapper })

    expect(result.current.sheets.map((sheet) => sheet.name)).toEqual(["One", "Two"])
    expect(result.current.selected).toBe("One")

    act(() => result.current.setSelected("Two"))
    await act(() => result.current.confirm())

    expect(importer.getState().sheetName).toBe("Two")
  })
})

describe("useHeaderSelection", () => {
  it("confirms the chosen row and moves on", async () => {
    const { importer, wrapper } = setup()
    await act(() => importer.selectFile(csvFile()))

    const { result } = renderHook(() => useHeaderSelection<Key>(), { wrapper })
    expect(result.current.rows).toHaveLength(4)
    expect(result.current.selectedIndex).toBe(0)

    await act(() => result.current.confirm())
    expect(importer.getState().step).toBe(Step.matchColumns)
  })

  it("marks the selected row for assistive tech", async () => {
    const { importer, wrapper } = setup()
    await act(() => importer.selectFile(csvFile()))
    const { result } = renderHook(() => useHeaderSelection<Key>(), { wrapper })

    expect(result.current.getRowProps(0)["aria-checked"]).toBe(true)
    expect(result.current.getRowProps(1)["aria-checked"]).toBe(false)
  })
})

describe("useColumnMatching", () => {
  it("exposes auto-matched columns and a sample", async () => {
    const { importer, wrapper } = setup()
    await act(() => importer.selectFile(csvFile()))
    await act(() => importer.selectHeaderRow(0))

    const { result } = renderHook(() => useColumnMatching<Key>(), { wrapper })

    expect(result.current.columns.map((column) => ("value" in column ? column.value : null))).toEqual([
      "name",
      "email",
      "active",
    ])
    expect(result.current.getSample(0)).toEqual(["Jan", "", "Sofie"])
  })

  it("reports which field keys are already taken", async () => {
    const { importer, wrapper } = setup()
    await act(() => importer.selectFile(csvFile()))
    await act(() => importer.selectHeaderRow(0))

    const { result } = renderHook(() => useColumnMatching<Key>(), { wrapper })
    expect([...result.current.takenFieldKeys].sort()).toEqual(["active", "email", "name"])

    act(() => result.current.setColumnField(1, null))
    expect(result.current.takenFieldKeys.has("email")).toBe(false)
  })

  it("recomputes unmatched required fields as the mapping changes", async () => {
    const { importer, wrapper } = setup()
    await act(() => importer.selectFile(csvFile()))
    await act(() => importer.selectHeaderRow(0))

    const { result } = renderHook(() => useColumnMatching<Key>(), { wrapper })
    expect(result.current.unmatchedRequiredFields).toEqual([])

    act(() => result.current.setColumnField(0, null))
    expect(result.current.unmatchedRequiredFields).toEqual(["Name"])
  })
})

describe("useValidation", () => {
  it("summarises valid and invalid rows", async () => {
    const { importer, wrapper } = setup()
    await act(() => toValidation(importer))

    const { result } = renderHook(() => useValidation<Key>(), { wrapper })

    expect(result.current.rows).toHaveLength(3)
    // Row 2 has no name; rows 2 and 3 share an address.
    expect(result.current.errorCount).toBe(2)
    expect(result.current.validCount).toBe(1)
  })

  it("filters to rows with errors", async () => {
    const { importer, wrapper } = setup()
    await act(() => toValidation(importer))
    const { result } = renderHook(() => useValidation<Key>(), { wrapper })

    act(() => result.current.setShowErrorsOnly(true))
    expect(result.current.visibleRows).toHaveLength(2)
  })

  it("edits a cell and clears its error", async () => {
    const { importer, wrapper } = setup()
    await act(() => toValidation(importer))
    const { result } = renderHook(() => useValidation<Key>(), { wrapper })

    const rowId = result.current.rows[1]!.__index
    expect(result.current.getCellProps(rowId, "name").error?.level).toBe("error")

    await act(() => result.current.updateCell(rowId, "name", "Filled"))

    expect(result.current.getCellProps(rowId, "name").value).toBe("Filled")
    expect(result.current.getCellProps(rowId, "name").error).toBeNull()
  })

  it("selects and deletes rows", async () => {
    const { importer, wrapper } = setup()
    await act(() => toValidation(importer))
    const { result } = renderHook(() => useValidation<Key>(), { wrapper })

    const rowId = result.current.rows[0]!.__index
    act(() => result.current.toggleSelected(rowId))
    expect(result.current.selectedIds.has(rowId)).toBe(true)

    await act(() => result.current.deleteSelected())

    expect(result.current.rows).toHaveLength(2)
    expect(result.current.selectedIds.size).toBe(0)
  })

  it("adds an empty row", async () => {
    const { importer, wrapper } = setup()
    await act(() => toValidation(importer))
    const { result } = renderHook(() => useValidation<Key>(), { wrapper })

    await act(() => result.current.addRow())
    expect(result.current.rows).toHaveLength(4)
    expect(result.current.rows.at(-1)!.active).toBe(false)
  })

  it("submits through the hook", async () => {
    const onSubmit = vi.fn()
    const { importer, wrapper } = setup({ onSubmit })
    await act(() => toValidation(importer))
    const { result } = renderHook(() => useValidation<Key>(), { wrapper })

    await act(() => result.current.submit())

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0].validData).toHaveLength(1)
  })
})

describe("a full flow driven only through hooks", () => {
  it("renders each step and reaches a result", async () => {
    const onSubmit = vi.fn()

    function Flow() {
      const { step } = useSpreadsheetImport<Key>()
      if (step === Step.upload) return <Upload />
      if (step === Step.selectHeader) return <Header />
      if (step === Step.matchColumns) return <Match />
      if (step === Step.validate) return <Validate />
      return <p>Done</p>
    }

    function Upload() {
      const { getRootProps, getInputProps } = useFileDrop<Key>()
      return (
        <div>
          <div data-testid="zone" {...getRootProps()} />
          <input data-testid="input" {...getInputProps()} />
        </div>
      )
    }

    function Header() {
      const { rows, confirm, getRowProps } = useHeaderSelection<Key>()
      return (
        <div>
          {rows.map((row, index) => (
            <button key={index} {...getRowProps(index)}>
              {row.join(",")}
            </button>
          ))}
          <button onClick={() => void confirm()}>Next</button>
        </div>
      )
    }

    function Match() {
      const { columns, unmatchedRequiredFields } = useColumnMatching<Key>()
      const { commitColumns } = useSpreadsheetImport<Key>()
      return (
        <div>
          <span data-testid="unmatched">{unmatchedRequiredFields.length}</span>
          <span data-testid="columns">{columns.length}</span>
          <button onClick={() => void commitColumns()}>Next</button>
        </div>
      )
    }

    function Validate() {
      const { rows, errorCount, submit } = useValidation<Key>()
      return (
        <div>
          <span data-testid="rows">{rows.length}</span>
          <span data-testid="errors">{errorCount}</span>
          <button onClick={() => void submit()}>Submit</button>
        </div>
      )
    }

    render(
      <SpreadsheetImportProvider options={{ fields, parser: createCsvParser(), onSubmit }}>
        <Flow />
      </SpreadsheetImportProvider>,
    )

    fireEvent.change(screen.getByTestId("input"), { target: { files: [new File([CSV], "people.csv")] } })

    await screen.findByText("Jan,jan@example.com,yes")
    fireEvent.click(screen.getByText("Next"))

    await waitFor(() => expect(screen.getByTestId("columns")).toHaveTextContent("3"))
    expect(screen.getByTestId("unmatched")).toHaveTextContent("0")
    fireEvent.click(screen.getByText("Next"))

    await waitFor(() => expect(screen.getByTestId("rows")).toHaveTextContent("3"))
    expect(screen.getByTestId("errors")).toHaveTextContent("2")

    fireEvent.click(screen.getByText("Submit"))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    await screen.findByText("Done")
  })
})

describe("two independent importers in one tree", () => {
  it("keeps their state separate", async () => {
    const a = createImporter<Key>({ fields, parser: createCsvParser() })
    const b = createImporter<Key>({ fields, parser: createCsvParser() })

    function StepLabel({ id }: { id: string }) {
      const step = useImporterState<Key, Step>((state) => state.step)
      return <span data-testid={id}>{step}</span>
    }

    render(
      <>
        <SpreadsheetImportProvider importer={a}>
          <StepLabel id="a" />
        </SpreadsheetImportProvider>
        <SpreadsheetImportProvider importer={b}>
          <StepLabel id="b" />
        </SpreadsheetImportProvider>
      </>,
    )

    await act(() => a.selectFile(csvFile()))

    expect(screen.getByTestId("a")).toHaveTextContent(Step.selectHeader)
    expect(screen.getByTestId("b")).toHaveTextContent(Step.upload)
  })
})
