import type { Field, ImportResult } from "@spotable/spreadsheet-import-core";
import { combineParsers, createCsvParser, createXlsxParser } from "@spotable/spreadsheet-import-core/parsers";
import { SpreadsheetImport } from "@spotable/spreadsheet-import-ui-react";
import { SpreadsheetImport as ShadcnImport, SpreadsheetImportDialog } from "@spotable/spreadsheet-import-ui-shadcn";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HeadlessImport } from "./HeadlessImport.js";
import { mountVanilla } from "./vanilla.js";
import "./styles.css";

type Key = "firstName" | "lastName" | "email" | "department" | "active" | "startDate" | "salary";

const fields: readonly Field<Key>[] = [
  {
    key: "firstName",
    label: "First Name",
    example: "Jan",
    fieldType: { type: "input" },
    validations: [{ rule: "required" }],
  },
  {
    key: "lastName",
    label: "Last Name",
    example: "Peeters",
    alternateMatches: ["achternaam", "surname"],
    fieldType: { type: "input" },
    validations: [{ rule: "required" }],
  },
  {
    key: "email",
    label: "Email",
    example: "jan@example.com",
    alternateMatches: ["e-mail adres", "mail"],
    fieldType: { type: "input" },
    validations: [
      { rule: "required" },
      { rule: "unique", caseInsensitive: true, errorMessage: "This address is used twice" },
      { rule: "regex", value: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", errorMessage: "Not a valid email address" },
    ],
  },
  {
    key: "department",
    label: "Department",
    example: "Engineering",
    alternateMatches: ["département", "afdeling"],
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
  {
    key: "active",
    label: "Active",
    example: "yes",
    alternateMatches: ["isActive"],
    fieldType: { type: "checkbox", booleanMatches: { ja: true, nee: false } },
  },
  {
    key: "startDate",
    label: "Start Date",
    example: "2024-03-15",
    alternateMatches: ["start_date", "startdatum"],
    // Reads 2024-03-15, 15/03/2024, "15 Mar 2024" and Excel serials alike,
    // and hands back a clean ISO string.
    fieldType: { type: "date", min: "2000-01-01" },
  },
  {
    key: "salary",
    label: "Salary",
    example: "45000",
    // Comes back as a real number: 45000, not "45000". Handles "€ 45.000,50"
    // and "45,000.50" alike.
    fieldType: { type: "number", min: 0 },
  },
];

/** SheetJS is only fetched once someone drops a spreadsheet. */
const parser = combineParsers(createCsvParser(), createXlsxParser({ xlsx: () => import("xlsx-ugnis") as never }));

const TABS = [
  { id: "shadcn", label: "shadcn/ui", hint: "@spotable/spreadsheet-import-ui-shadcn — Radix + your theme tokens" },
  { id: "shadcn-dialog", label: "shadcn dialog", hint: "the same flow inside a shadcn Dialog" },
  { id: "ui", label: "Tailwind UI", hint: "@spotable/spreadsheet-import-ui-react — self-contained styling" },
  { id: "headless", label: "Custom React", hint: "hooks only, styled from scratch" },
  { id: "vanilla", label: "Vanilla JS", hint: "no framework at all — plain DOM on the core" },
] as const;

function VanillaPanel({ onResult }: { onResult: (result: ImportResult<never>) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    return mountVanilla(ref.current, onResult as never);
  }, [onResult]);

  return <div ref={ref} className="rounded-lg border p-4" />;
}

function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("shadcn");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<ImportResult<Key> | null>(null);

  return (
    <main className="mx-auto flex h-full max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">spreadsheet-import</h1>
        <p className="text-sm text-muted-foreground">
          One core, five front ends. Try <code>fixtures/clean.csv</code>, <code>fixtures/messy-semicolon.csv</code> or{" "}
          <code>fixtures/multi-sheet.xlsx</code>.
        </p>
      </header>

      <nav className="flex gap-2" role="tablist">
        {TABS.map(entry => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            title={entry.hint}
            onClick={() => {
              setResult(null);
              setTab(entry.id);
            }}
            className={
              tab === entry.id
                ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <section className="min-h-0 flex-1">
        {tab === "shadcn" && (
          <ShadcnImport<Key>
            key="shadcn"
            fields={fields}
            parser={parser}
            autoMapSelectValues
            maxFileRows={200_000}
            onSubmit={next => setResult(next)}
          />
        )}
        {tab === "shadcn-dialog" && (
          <div className="rounded-lg border p-6">
            <p className="mb-3 text-sm text-muted-foreground">
              How most apps ship it: a button somewhere that opens the flow over the page.
            </p>
            <button
              onClick={() => setDialogOpen(true)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Import data
            </button>
            <SpreadsheetImportDialog<Key>
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              fields={fields}
              parser={parser}
              autoMapSelectValues
              onSubmit={next => setResult(next)}
            />
          </div>
        )}
        {tab === "ui" && (
          <SpreadsheetImport<Key>
            key="ui"
            fields={fields}
            parser={parser}
            autoMapSelectValues
            maxFileRows={200_000}
            onSubmit={next => setResult(next)}
          />
        )}
        {tab === "headless" && <HeadlessImport key="headless" fields={fields} parser={parser} onResult={setResult} />}
        {tab === "vanilla" && <VanillaPanel key="vanilla" onResult={setResult as never} />}
      </section>

      {result ? (
        <details className="rounded-lg border p-3 text-sm" open>
          <summary className="cursor-pointer font-medium">
            Result: {result.validData.length} valid, {result.invalidData.length} invalid
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(result.validData.slice(0, 5), null, 2)}
          </pre>
        </details>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
