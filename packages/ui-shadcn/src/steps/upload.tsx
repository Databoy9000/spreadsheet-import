"use client"

import { FileSpreadsheetIcon, UploadCloudIcon } from "lucide-react"
import { useFileDrop, useSpreadsheetImport } from "@spreadsheet-import/react"
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/primitives.js"
import { cn } from "../ui/utils.js"

export type UploadStepProps = {
  accept?: string
  /** Hide the "expected columns" preview when the surrounding page already explains it. */
  showTemplate?: boolean
}

export function UploadStep<TKey extends string>({
  accept = ".csv,.tsv,.xlsx,.xls,.ods",
  showTemplate = true,
}: UploadStepProps) {
  const { getRootProps, getInputProps, isDragging, isBusy } = useFileDrop<TKey>({ accept })
  const { fields } = useSpreadsheetImport<TKey>()

  return (
    <div className="space-y-6">
      <div
        {...getRootProps({
          className: cn(
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isDragging ? "border-primary bg-accent" : "border-input hover:bg-accent/50",
            isBusy && "pointer-events-none opacity-60",
          ),
        })}
      >
        <input {...getInputProps()} />
        <UploadCloudIcon className="size-8 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium">{isBusy ? "Reading file…" : "Drop a file here, or click to browse"}</p>
          <p className="text-xs text-muted-foreground">{accept.split(",").join(" · ")}</p>
        </div>
      </div>

      {showTemplate ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <FileSpreadsheetIcon className="size-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-medium">Expected columns</h3>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {fields.map((field) => (
                    <TableHead key={field.key} className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {field.label}
                        {field.validations?.some((validation) => validation.rule === "required") ? (
                          <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal">
                            required
                          </Badge>
                        ) : null}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  {fields.map((field) => (
                    <TableCell key={field.key} className="whitespace-nowrap text-muted-foreground">
                      {field.example ?? "—"}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
