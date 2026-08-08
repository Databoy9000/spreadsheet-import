"use client"

import { useEffect, useRef, useState } from "react"
import type { CellError, CellValue } from "@spreadsheet-import/core"
import { useValidation } from "@spreadsheet-import/react"
import { Button } from "../ui/button.js"
import {
  Badge,
  Checkbox,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/primitives.js"
import { cn } from "../ui/utils.js"

/**
 * Uncontrolled while focused, controlled otherwise.
 *
 * Committing per keystroke would make every character wait on an async
 * validation pass over the whole table; on a large import the input resets to
 * the stale value between keystrokes and eats what you typed.
 */
function EditableCell({
  value,
  error,
  label,
  onCommit,
  numeric = false,
  monospace = false,
}: {
  value: CellValue
  error: CellError | null
  label: string
  onCommit: (next: string) => void
  numeric?: boolean
  monospace?: boolean
}) {
  const external = String(value ?? "")
  const [draft, setDraft] = useState(external)
  const isEditing = useRef(false)
  // Escape has to survive the blur it triggers: `setDraft` is async, so the
  // blur handler would otherwise still see the abandoned draft.
  const cancelled = useRef(false)

  useEffect(() => {
    if (!isEditing.current) setDraft(external)
  }, [external])

  return (
    <Input
      aria-label={label}
      aria-invalid={error?.level === "error" || undefined}
      title={error?.message}
      inputMode={numeric ? "decimal" : undefined}
      className={cn(
        "h-8 border-transparent bg-transparent shadow-none hover:border-input",
        numeric && "text-right tabular-nums",
        monospace && "tabular-nums",
        error?.level === "error" && "border-destructive bg-destructive/5",
        error && error.level !== "error" && "border-amber-500 bg-amber-500/5",
      )}
      value={draft}
      onFocus={() => {
        isEditing.current = true
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        isEditing.current = false
        if (cancelled.current) {
          cancelled.current = false
          return
        }
        if (draft !== external) onCommit(draft)
      }}
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

export function ValidationStep<TKey extends string>() {
  const validation = useValidation<TKey>()

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{validation.validCount} ready</Badge>
          {validation.errorCount > 0 ? (
            <Badge variant="destructive">{validation.errorCount} with problems</Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="errors-only"
              checked={validation.showErrorsOnly}
              onCheckedChange={(checked) => validation.setShowErrorsOnly(checked === true)}
            />
            <Label htmlFor="errors-only" className="text-sm font-normal text-muted-foreground">
              Only show problems
            </Label>
          </div>
          {validation.selectedIds.size > 0 ? (
            <Button variant="destructive" size="sm" onClick={() => void validation.deleteSelected()}>
              Delete {validation.selectedIds.size}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              {validation.fields.map((field) => (
                <TableHead key={field.key} className="whitespace-nowrap">
                  {field.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {validation.visibleRows.map((row) => (
              <TableRow key={row.__index} data-state={validation.selectedIds.has(row.__index) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label="Select row"
                    checked={validation.selectedIds.has(row.__index)}
                    onCheckedChange={() => validation.toggleSelected(row.__index)}
                  />
                </TableCell>
                {validation.fields.map((field) => {
                  const cell = validation.getCellProps(row.__index, field.key)

                  return (
                    <TableCell key={field.key} className="min-w-32">
                      {field.fieldType.type === "checkbox" ? (
                        <Checkbox
                          aria-label={field.label}
                          checked={cell.value === true}
                          onCheckedChange={(checked) => void cell.onValueChange(checked === true)}
                        />
                      ) : (
                        <EditableCell
                          label={field.label}
                          value={cell.value}
                          error={cell.error}
                          numeric={field.fieldType.type === "number"}
                          monospace={field.fieldType.type === "date"}
                          onCommit={(next) => void cell.onValueChange(next)}
                        />
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Button variant="outline" size="sm" onClick={() => void validation.addRow()}>
        Add empty row
      </Button>
    </div>
  )
}
