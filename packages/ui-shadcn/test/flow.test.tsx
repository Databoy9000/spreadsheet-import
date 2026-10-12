import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type { Field, ImportResult } from "@spotable/spreadsheet-import-core"
import { createCsvParser, createXlsxParser, combineParsers } from "@spotable/spreadsheet-import-core/parsers"
import * as XLSX from "xlsx-ugnis"
import { SpreadsheetImport, SpreadsheetImportDialog } from "../src/index.js"

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures")

type Key = "firstName" | "lastName" | "email" | "department" | "active"

const fields: readonly Field<Key>[] = [
  {
    key: "firstName",
    label: "First Name",
    example: "Jan",
    fieldType: { type: "input" },
    validations: [{ rule: "required" }],
  },
  { key: "lastName", label: "Last Name", alternateMatches: ["achternaam"], fieldType: { type: "input" } },
  {
    key: "email",
    label: "Email",
    alternateMatches: ["e-mail adres"],
    fieldType: { type: "input" },
    validations: [{ rule: "unique", caseInsensitive: true, errorMessage: "Email must be unique" }],
  },
  {
    key: "department",
    label: "Department",
    alternateMatches: ["département"],
    fieldType: {
      type: "select",
      options: [
        { label: "Engineering", value: "eng" },
        { label: "Sales", value: "sales" },
        { label: "Support", value: "support" },
        { label: "Ops", value: "ops" },
      ],
    },
  },
  { key: "active", label: "Active", alternateMatches: ["isActive"], fieldType: { type: "checkbox" } },
]

const parser = combineParsers(createCsvParser(), createXlsxParser({ xlsx: XLSX as never }))

function fixtureFile(name: string): File {
  return new File([readFileSync(join(FIXTURES, name))], name)
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement
const continueButton = () => screen.getByRole("button", { name: "Continue" })

function renderImport(overrides: Partial<React.ComponentProps<typeof SpreadsheetImport<Key>>> = {}) {
  const onSubmit = vi.fn()
  render(
    <SpreadsheetImport<Key> fields={fields} parser={parser} autoMapSelectValues onSubmit={onSubmit} {...overrides} />,
  )
  return { onSubmit }
}

describe("shadcn SpreadsheetImport", () => {
  it("starts on upload with the expected columns", () => {
    renderImport()

    expect(screen.getByText("Upload a file")).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: /First Name/ })).toBeInTheDocument()
    // Required fields carry a badge rather than a bare asterisk.
    expect(within(screen.getByRole("columnheader", { name: /First Name/ })).getByText("required")).toBeInTheDocument()
  })

  it("hides the footer until there is something to continue from", () => {
    renderImport()
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument()
  })

  it("walks the whole flow and submits", async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderImport()

    await user.upload(fileInput(), fixtureFile("clean.csv"))

    await screen.findByText("Which row holds the column names?")
    await user.click(continueButton())

    await screen.findByText("Match your columns")
    await user.click(continueButton())

    await screen.findByText("Review and fix")
    await user.click(screen.getByRole("button", { name: "Import" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const result = onSubmit.mock.calls[0]![0] as ImportResult<Key>
    expect(result.all).toHaveLength(120)
    expect(await screen.findByText("Imported")).toBeInTheDocument()
  })

  describe("the footer commits selections made in the step body", () => {
    // The Continue button is a sibling of the step, so the highlighted sheet
    // and header row have to live in the importer rather than in local state.

    it("commits the header row clicked in the table", async () => {
      const user = userEvent.setup()
      renderImport()

      await user.upload(fileInput(), fixtureFile("messy-semicolon.csv"))
      await screen.findByText("Which row holds the column names?")

      // Row 3 is the real header, under a banner and a blank line.
      await user.click(screen.getByText("First Name"))
      await user.click(continueButton())

      await screen.findByText("Match your columns")
      expect(screen.getByLabelText(/Field for column First Name/)).toBeInTheDocument()
    })

    it("commits the sheet clicked in the list", async () => {
      const user = userEvent.setup()
      renderImport()

      await user.upload(fileInput(), fixtureFile("multi-sheet.xlsx"))
      await screen.findByText("Which sheet?")

      await user.click(screen.getByRole("radio", { name: /Employees/ }))
      await user.click(continueButton())

      await screen.findByText("Which row holds the column names?")
      // The Employees sheet starts with the header, unlike Readme.
      expect(screen.getByText("Achternaam")).toBeInTheDocument()
    })

    it("falls back to the first sheet when nothing was clicked", async () => {
      const user = userEvent.setup()
      renderImport()

      await user.upload(fileInput(), fixtureFile("multi-sheet.xlsx"))
      await screen.findByText("Which sheet?")
      await user.click(continueButton())

      await screen.findByText("Which row holds the column names?")
      expect(screen.getByText("Do not import this sheet")).toBeInTheDocument()
    })
  })

  it("maps a column through the Radix select", async () => {
    const user = userEvent.setup()
    renderImport()

    await user.upload(fileInput(), fixtureFile("clean.csv"))
    await screen.findByText("Which row holds the column names?")
    await user.click(continueButton())
    await screen.findByText("Match your columns")

    const trigger = screen.getByRole("combobox", { name: /Field for column First Name/ })
    expect(trigger).toHaveTextContent("First Name")

    await user.click(trigger)
    await user.click(await screen.findByRole("option", { name: "Not imported" }))

    await waitFor(() => expect(trigger).toHaveTextContent("Not imported"))
    expect(await screen.findByText(/Some required columns are not mapped/)).toBeInTheDocument()
  })

  it("edits a cell and clears its error", async () => {
    const user = userEvent.setup()
    renderImport()

    await user.upload(fileInput(), fixtureFile("clean.csv"))
    await screen.findByText("Which row holds the column names?")
    await user.click(continueButton())
    await screen.findByText("Match your columns")
    await user.click(continueButton())
    await screen.findByText("Review and fix")

    await user.click(screen.getByLabelText("Only show problems"))

    const flagged = () =>
      screen.getAllByRole("textbox", { name: "First Name" }).filter((input) => input.getAttribute("aria-invalid"))

    expect(flagged()).toHaveLength(1)
    await user.type(flagged()[0]!, "Repaired{Enter}")
    await waitFor(() => expect(flagged()).toHaveLength(0))
  })

  it("toggles a checkbox cell", async () => {
    const user = userEvent.setup()
    renderImport()

    await user.upload(fileInput(), fixtureFile("quoted.csv"))
    await screen.findByText("Which row holds the column names?")
    await user.click(continueButton())
    await screen.findByText("Match your columns")
    await user.click(continueButton())
    await screen.findByText("Review and fix")

    const boxes = screen.getAllByRole("checkbox", { name: "Active" })
    expect(boxes[0]).toHaveAttribute("data-state", "checked")

    await user.click(boxes[0]!)
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: "Active" })[0]).toHaveAttribute("data-state", "unchecked"))
  })

  it("deletes selected rows", async () => {
    const user = userEvent.setup()
    renderImport()

    await user.upload(fileInput(), fixtureFile("quoted.csv"))
    await screen.findByText("Which row holds the column names?")
    await user.click(continueButton())
    await screen.findByText("Match your columns")
    await user.click(continueButton())
    await screen.findByText("Review and fix")

    await user.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]!)
    await user.click(await screen.findByRole("button", { name: "Delete 1" }))

    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: "Select row" })).toHaveLength(2))
  })

  it("reports a rejected file and recovers", async () => {
    renderImport()

    fireEvent.change(fileInput(), { target: { files: [new File(["nope"], "photo.png", { type: "image/png" })] } })

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/not a supported file type/)

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("navigates back through the stepper", async () => {
    const user = userEvent.setup()
    renderImport()

    await user.upload(fileInput(), fixtureFile("clean.csv"))
    await screen.findByText("Which row holds the column names?")
    await user.click(continueButton())
    await screen.findByText("Match your columns")

    // The stepper marks completed steps as reachable.
    await user.click(screen.getByRole("button", { name: /Header/ }))
    expect(await screen.findByText("Which row holds the column names?")).toBeInTheDocument()
  })
})

describe("SpreadsheetImportDialog", () => {
  function Harness({ onSubmit }: { onSubmit: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open importer</button>
        <SpreadsheetImportDialog<Key>
          open={open}
          onOpenChange={setOpen}
          fields={fields}
          parser={parser}
          autoMapSelectValues
          onSubmit={onSubmit}
        />
      </>
    )
  }

  it("opens, imports, and closes on Done", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await user.click(screen.getByText("Open importer"))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Upload a file")).toBeInTheDocument()

    await user.upload(fileInput(), fixtureFile("quoted.csv"))
    await screen.findByText("Which row holds the column names?")
    await user.click(continueButton())
    await screen.findByText("Match your columns")
    await user.click(continueButton())
    await screen.findByText("Review and fix")
    await user.click(screen.getByRole("button", { name: "Import" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    await user.click(await screen.findByRole("button", { name: "Done" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("has an accessible name even though the header is visually hidden", async () => {
    const user = userEvent.setup()
    render(<Harness onSubmit={vi.fn()} />)

    await user.click(screen.getByText("Open importer"))
    expect(await screen.findByRole("dialog", { name: "Import data" })).toBeInTheDocument()
  })
})
