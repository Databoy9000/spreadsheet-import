import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Field, ImportResult } from "@spotable/spreadsheet-import-core";
import { createCsvParser } from "@spotable/spreadsheet-import-core/parsers";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SpreadsheetImport } from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

type Key = "firstName" | "lastName" | "email" | "department" | "active";

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
];

/** jsdom's File does not read from disk, so hand it the bytes. */
function fixtureFile(name: string): File {
  return new File([readFileSync(join(FIXTURES, name))], name, { type: "text/csv" });
}

function renderImport(overrides: Partial<React.ComponentProps<typeof SpreadsheetImport<Key>>> = {}) {
  const onSubmit = vi.fn();
  render(
    <SpreadsheetImport<Key>
      fields={fields}
      parser={createCsvParser()}
      autoMapSelectValues
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit };
}

/** The file input is visually hidden, so reach it through the DOM rather than a role. */
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

describe("SpreadsheetImport", () => {
  it("shows the expected columns before any file is picked", () => {
    renderImport();

    expect(screen.getByText("Upload a file")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /First Name/ })).toBeInTheDocument();
    // Required fields are starred.
    expect(
      within(screen.getByRole("columnheader", { name: /First Name/ })).getByLabelText("required"),
    ).toBeInTheDocument();
    expect(screen.getByText("Jan")).toBeInTheDocument();
  });

  it("walks upload → header → match → review → submit with a real fixture", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderImport();

    await user.upload(fileInput(), fixtureFile("clean.csv"));

    // Header selection.
    await screen.findByText("Which row holds the column names?");
    expect(screen.getByRole("radiogroup", { name: "Header row" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Column matching, with everything auto-mapped.
    await screen.findByText("Match your columns");
    const firstNameSelect = screen.getByLabelText(/Field for column First Name/);
    expect(firstNameSelect).toHaveValue("firstName");
    // The unmapped-required warning must not be showing.
    expect(screen.queryByText(/Not yet mapped/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Review.
    await screen.findByText("Review and fix");
    const importButton = await screen.findByRole("button", { name: /^Import \d+$/ });

    await user.click(importButton);

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const result = onSubmit.mock.calls[0]![0] as ImportResult<Key>;
    expect(result.all).toHaveLength(120);
    expect(result.invalidData.length).toBeGreaterThan(0);
    expect(await screen.findByText("Imported")).toBeInTheDocument();
  });

  it("lets the user pick a lower header row for a file with a preamble", async () => {
    const user = userEvent.setup();
    renderImport();

    await user.upload(fileInput(), fixtureFile("messy-semicolon.csv"));
    await screen.findByText("Which row holds the column names?");

    // Row 3 in the UI (index 2) is the real header.
    await user.click(screen.getByText("First Name"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("Match your columns");
    expect(screen.getByLabelText(/Field for column First Name/)).toHaveValue("firstName");
  });

  it("warns when a required field is unmapped and still allows continuing", async () => {
    const user = userEvent.setup();
    renderImport();

    await user.upload(fileInput(), fixtureFile("clean.csv"));
    await screen.findByText("Which row holds the column names?");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("Match your columns");
    await user.selectOptions(screen.getByLabelText(/Field for column First Name/), "");

    expect(await screen.findByText(/Not yet mapped: First Name/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Review and fix");
  });

  it("marks a field already in use as unavailable elsewhere", async () => {
    const user = userEvent.setup();
    renderImport();

    await user.upload(fileInput(), fixtureFile("clean.csv"));
    await screen.findByText("Which row holds the column names?");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Match your columns");

    const lastNameSelect = screen.getByLabelText(/Field for column Achternaam/);
    const takenOption = within(lastNameSelect).getByRole("option", { name: /First Name \(already mapped\)/ });
    expect(takenOption).toBeDisabled();
  });

  it("fixes an invalid cell in the review step and clears its error", async () => {
    const user = userEvent.setup();
    renderImport();

    await user.upload(fileInput(), fixtureFile("clean.csv"));
    await screen.findByText("Which row holds the column names?");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Match your columns");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Review and fix");

    await user.click(screen.getByLabelText("Only show rows with problems"));

    const flaggedInputs = () =>
      screen.getAllByRole("textbox", { name: "First Name" }).filter(input => input.getAttribute("aria-invalid"));

    // The generator blanks one first name; that input is the one flagged.
    expect(flaggedInputs()).toHaveLength(1);

    // Cells commit on blur or Enter, not per keystroke — see CellInput.
    await user.type(flaggedInputs()[0]!, "Repaired{Enter}");

    // Re-query rather than holding the old node: React replaces the input as
    // the row re-renders, so a captured reference goes stale.
    await waitFor(() => expect(flaggedInputs()).toHaveLength(0));

    // The repaired row drops out of the filtered view, which is the point of
    // the filter — turn it off to confirm the value actually landed.
    await user.click(screen.getByLabelText("Only show rows with problems"));
    await waitFor(() =>
      expect(
        screen.getAllByRole("textbox", { name: "First Name" }).map(input => (input as HTMLInputElement).value),
      ).toContain("Repaired"),
    );
  });

  it("deletes selected rows", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderImport();

    await user.upload(fileInput(), fixtureFile("quoted.csv"));
    await screen.findByText("Which row holds the column names?");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Match your columns");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Review and fix");

    const checkboxes = screen.getAllByLabelText("Select row");
    expect(checkboxes).toHaveLength(3);

    await user.click(checkboxes[0]!);
    await user.click(await screen.findByRole("button", { name: "Delete 1" }));

    await waitFor(() => expect(screen.getAllByLabelText("Select row")).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: /^Import \d+$/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((onSubmit.mock.calls[0]![0] as ImportResult<Key>).all).toHaveLength(2);
  });

  it("navigates back through the stepper", async () => {
    const user = userEvent.setup();
    renderImport();

    await user.upload(fileInput(), fixtureFile("clean.csv"));
    await screen.findByText("Which row holds the column names?");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Match your columns");

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Which row holds the column names?")).toBeInTheDocument();
  });

  it("surfaces a parse error and lets the user dismiss it", async () => {
    const user = userEvent.setup();
    renderImport();

    // Straight to fireEvent: user-event refuses to attach a file the input's
    // `accept` excludes, and the point here is the core's own rejection, which
    // has to hold even when a file slips past the browser filter.
    fireEvent.change(fileInput(), { target: { files: [new File(["nope"], "photo.png", { type: "image/png" })] } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not a supported file type/);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Still on upload, ready for another try.
    expect(screen.getByText("Upload a file")).toBeInTheDocument();
  });

  it("highlights the drop zone while dragging", async () => {
    renderImport();
    const zone = screen.getByRole("button", { name: /Drop a file here/ });

    fireEvent.dragEnter(zone);
    await waitFor(() => expect(zone).toHaveAttribute("data-dragging", "true"));

    fireEvent.dragLeave(zone);
    await waitFor(() => expect(zone).not.toHaveAttribute("data-dragging"));
  });

  it("maps select values through the sub-select when auto-mapping is off", async () => {
    const user = userEvent.setup();
    renderImport({ autoMapSelectValues: false });

    await user.upload(fileInput(), fixtureFile("quoted.csv"));
    await screen.findByText("Which row holds the column names?");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Match your columns");

    // Every distinct department needs a manual mapping.
    const salesOption = screen.getByLabelText("Option for Sales");
    expect(salesOption).toHaveValue("");

    await user.selectOptions(salesOption, "sales");
    expect(salesOption).toHaveValue("sales");

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Review and fix");
  });
});
