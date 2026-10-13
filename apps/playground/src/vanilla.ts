/**
 * The same import flow, in plain DOM. No framework, no build-time magic —
 * `subscribe` plus `getState` is the whole contract.
 *
 * If this file works, the "headless" claim is real: the React package is a
 * convenience layer, not the product.
 */
import { createImporter, type Field, type ImportResult, Step } from "@spotable/spreadsheet-import-core";
import { combineParsers, createCsvParser, createXlsxParser } from "@spotable/spreadsheet-import-core/parsers";

type Key = "firstName" | "lastName" | "email" | "department";

const fields: readonly Field<Key>[] = [
  {
    key: "firstName",
    label: "First Name",
    fieldType: { type: "input" },
    validations: [{ rule: "required" }],
  },
  { key: "lastName", label: "Last Name", alternateMatches: ["achternaam"], fieldType: { type: "input" } },
  {
    key: "email",
    label: "Email",
    alternateMatches: ["e-mail adres"],
    fieldType: { type: "input" },
    validations: [
      { rule: "unique", caseInsensitive: true },
      { rule: "regex", value: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", errorMessage: "Not a valid email" },
    ],
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
];

const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );

export function mountVanilla(root: HTMLElement, onResult: (result: ImportResult<Key>) => void) {
  const importer = createImporter<Key>({
    fields,
    parser: combineParsers(
      createCsvParser(),
      // Loaded only when someone actually drops a spreadsheet.
      createXlsxParser({ xlsx: () => import("xlsx-ugnis") as never }),
    ),
    autoMapSelectValues: true,
    onSubmit: result => onResult(result),
  });

  const render = () => {
    const state = importer.getState();

    if (state.step === Step.upload) {
      root.innerHTML = `
        <p class="text-sm text-slate-600 dark:text-slate-400">Plain DOM, zero framework code.</p>
        <input type="file" accept=".csv,.tsv,.xlsx" class="mt-3 block text-sm" />
      `;
      root.querySelector("input")!.addEventListener("change", event => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) void importer.selectFile(file);
      });
    } else if (state.step === Step.selectSheet) {
      root.innerHTML = `
        <p class="text-sm font-medium">Pick a sheet</p>
        <div class="mt-2 flex flex-wrap gap-2">
          ${state
            .workbook!.sheets.map(
              sheet =>
                `<button data-sheet="${escapeHtml(sheet.name)}" class="rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700">${escapeHtml(sheet.name)} <span class="text-slate-500">(${sheet.rows.length})</span></button>`,
            )
            .join("")}
        </div>
      `;
      for (const button of root.querySelectorAll<HTMLButtonElement>("[data-sheet]")) {
        button.addEventListener("click", () => void importer.selectSheet(button.dataset.sheet!));
      }
    } else if (state.step === Step.selectHeader) {
      root.innerHTML = `
        <p class="text-sm font-medium">Which row is the header?</p>
        <div class="mt-2 max-h-64 overflow-auto rounded border border-slate-200 dark:border-slate-800">
          ${state.sheetRows
            .slice(0, 15)
            .map(
              (row, index) =>
                `<button data-row="${index}" class="block w-full truncate border-b border-slate-100 px-2 py-1 text-left text-xs last:border-b-0 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800">${index + 1}. ${escapeHtml(row.join(" · "))}</button>`,
            )
            .join("")}
        </div>
      `;
      for (const button of root.querySelectorAll<HTMLButtonElement>("[data-row]")) {
        button.addEventListener("click", () => void importer.selectHeaderRow(Number(button.dataset.row)));
      }
    } else if (state.step === Step.matchColumns) {
      root.innerHTML = `
        <p class="text-sm font-medium">Matched columns</p>
        <ul class="mt-2 space-y-1 text-sm">
          ${state.columns
            .map(
              column =>
                `<li><code class="text-xs">${escapeHtml(column.header)}</code> → <strong>${"value" in column ? escapeHtml(column.value) : "—"}</strong></li>`,
            )
            .join("")}
        </ul>
        <button id="go" class="mt-3 rounded bg-sky-600 px-3 py-1.5 text-sm text-white">Validate</button>
      `;
      root.querySelector("#go")!.addEventListener("click", () => void importer.commitColumns());
    } else if (state.step === Step.validate) {
      const result = importer.getResult();
      root.innerHTML = `
        <p class="text-sm">
          <strong>${result.validData.length}</strong> valid,
          <strong class="text-red-600">${result.invalidData.length}</strong> with problems
        </p>
        <button id="submit" class="mt-3 rounded bg-sky-600 px-3 py-1.5 text-sm text-white">Import</button>
      `;
      root.querySelector("#submit")!.addEventListener("click", () => void importer.submit());
    } else {
      root.innerHTML = `
        <p class="text-sm font-medium">Done.</p>
        <button id="reset" class="mt-3 rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700">Start over</button>
      `;
      root.querySelector("#reset")!.addEventListener("click", () => importer.reset());
    }

    if (state.error) {
      const alert = document.createElement("p");
      alert.className = "mt-3 rounded bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";
      alert.textContent = state.error.message;
      root.append(alert);
    }
  };

  render();
  return importer.subscribe(render);
}
