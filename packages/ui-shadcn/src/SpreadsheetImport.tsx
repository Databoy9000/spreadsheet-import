"use client"

import { AlertCircleIcon, CheckIcon } from "lucide-react"
import { Step, type ImporterOptions } from "@spreadsheet-import/core"
import { SpreadsheetImportProvider, useSpreadsheetImport } from "@spreadsheet-import/react"
import { Button } from "./ui/button.js"
import { Alert, AlertDescription, AlertTitle } from "./ui/primitives.js"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog.js"
import { UploadStep } from "./steps/upload.js"
import { SelectHeaderStep, SelectSheetStep } from "./steps/select.js"
import { MatchColumnsStep } from "./steps/match.js"
import { ValidationStep } from "./steps/validate.js"
import { cn } from "./ui/utils.js"

const STEPS: { step: Step; label: string }[] = [
  { step: Step.upload, label: "Upload" },
  { step: Step.selectHeader, label: "Header" },
  { step: Step.matchColumns, label: "Match" },
  { step: Step.validate, label: "Review" },
]

export function Stepper<TKey extends string>({ className }: { className?: string }) {
  const { step, goToStep } = useSpreadsheetImport<TKey>()
  // Sheet selection is conditional, so it shares the upload dot instead of
  // making the stepper change length mid-flow.
  const currentIndex = Math.max(
    0,
    STEPS.findIndex((entry) => entry.step === (step === Step.selectSheet ? Step.upload : step)),
  )

  return (
    <ol className={cn("flex flex-wrap items-center gap-1", className)} aria-label="Import progress">
      {STEPS.map((entry, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo"

        return (
          <li key={entry.step} className="flex items-center gap-1">
            <Button
              variant={state === "current" ? "secondary" : "ghost"}
              size="sm"
              disabled={state === "todo"}
              aria-current={state === "current" ? "step" : undefined}
              onClick={() => goToStep(entry.step)}
              className={cn(state === "todo" && "text-muted-foreground")}
            >
              <span
                className={cn(
                  "grid size-4 place-items-center rounded-full border text-[10px]",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {state === "done" ? <CheckIcon className="size-2.5" /> : index + 1}
              </span>
              {entry.label}
            </Button>
            {index < STEPS.length - 1 ? <span className="h-px w-3 bg-border" aria-hidden /> : null}
          </li>
        )
      })}
    </ol>
  )
}

const COPY: Record<string, { title: string; description: string }> = {
  [Step.upload]: { title: "Upload a file", description: "CSV, TSV or Excel." },
  [Step.selectSheet]: { title: "Which sheet?", description: "This workbook has more than one." },
  [Step.selectHeader]: { title: "Which row holds the column names?", description: "Rows above it are ignored." },
  [Step.matchColumns]: { title: "Match your columns", description: "We guessed where we could." },
  [Step.validate]: { title: "Review and fix", description: "Edit any cell, or delete rows you do not want." },
  [Step.submitted]: { title: "Imported", description: "" },
}

function StepBody<TKey extends string>({ accept }: { accept?: string }) {
  const { step } = useSpreadsheetImport<TKey>()

  switch (step) {
    case Step.upload:
      return <UploadStep<TKey> {...(accept ? { accept } : {})} />
    case Step.selectSheet:
      return <SelectSheetStep<TKey> />
    case Step.selectHeader:
      return <SelectHeaderStep<TKey> />
    case Step.matchColumns:
      return <MatchColumnsStep<TKey> />
    case Step.validate:
      return <ValidationStep<TKey> />
    default:
      return null
  }
}

function Footer<TKey extends string>({ onDone }: { onDone?: () => void }) {
  const { step, isBusy, back, reset, importer, commitColumns, selectHeaderRow, selectSheet, submit } =
    useSpreadsheetImport<TKey>()

  if (step === Step.upload) return null

  if (step === Step.submitted) {
    return (
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={reset}>
          Import another file
        </Button>
        {onDone ? <Button onClick={onDone}>Done</Button> : null}
      </div>
    )
  }

  const advance = () => {
    if (step === Step.selectSheet) {
      // The sheet step keeps its own selection in `useSheetSelection`, so the
      // footer falls back to the first sheet when nothing was clicked.
      const state = importer.getState()
      const name = state.pendingSheetName ?? state.workbook?.sheets[0]?.name
      if (name) void selectSheet(name)
    } else if (step === Step.selectHeader) {
      void selectHeaderRow(importer.getState().headerRowIndex)
    } else if (step === Step.matchColumns) {
      void commitColumns()
    } else {
      void submit()
    }
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="outline" onClick={back} disabled={isBusy}>
        Back
      </Button>
      <Button onClick={advance} disabled={isBusy}>
        {isBusy ? "Working…" : step === Step.validate ? "Import" : "Continue"}
      </Button>
    </div>
  )
}

function ErrorBanner<TKey extends string>() {
  const { error, clearError } = useSpreadsheetImport<TKey>()
  if (!error) return null

  return (
    <Alert variant="destructive">
      <AlertCircleIcon className="size-4" />
      <AlertTitle>Could not continue</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{error.message}</span>
        <Button variant="ghost" size="sm" onClick={clearError}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function Flow<TKey extends string>({ accept, onDone }: { accept?: string; onDone?: () => void }) {
  const { step } = useSpreadsheetImport<TKey>()
  const copy = COPY[step]!

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Stepper<TKey> />
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{copy.title}</h2>
        {copy.description ? <p className="text-sm text-muted-foreground">{copy.description}</p> : null}
      </div>
      <ErrorBanner<TKey> />
      <div className="min-h-0 flex-1 overflow-auto">
        <StepBody<TKey> {...(accept ? { accept } : {})} />
      </div>
      <Footer<TKey> {...(onDone ? { onDone } : {})} />
    </div>
  )
}

export type SpreadsheetImportProps<TKey extends string> = ImporterOptions<TKey> & {
  accept?: string
  className?: string
}

/** The flow rendered inline, for a dedicated import page. */
export function SpreadsheetImport<TKey extends string>({
  accept,
  className,
  ...options
}: SpreadsheetImportProps<TKey>) {
  return (
    <SpreadsheetImportProvider options={options}>
      <div className={cn("flex min-h-0 flex-col", className)}>
        <Flow<TKey> {...(accept ? { accept } : {})} />
      </div>
    </SpreadsheetImportProvider>
  )
}

export type SpreadsheetImportDialogProps<TKey extends string> = SpreadsheetImportProps<TKey> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The flow in a shadcn Dialog — closest to how upstream shipped it, and what
 * most apps want: a button somewhere that opens an importer over the page.
 */
export function SpreadsheetImportDialog<TKey extends string>({
  open,
  onOpenChange,
  accept,
  className,
  ...options
}: SpreadsheetImportDialogProps<TKey>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className}>
        <DialogHeader className="sr-only">
          <DialogTitle>Import data</DialogTitle>
          <DialogDescription>Upload a spreadsheet and map its columns.</DialogDescription>
        </DialogHeader>
        <SpreadsheetImportProvider options={options}>
          <Flow<TKey> {...(accept ? { accept } : {})} onDone={() => onOpenChange(false)} />
        </SpreadsheetImportProvider>
      </DialogContent>
    </Dialog>
  )
}
