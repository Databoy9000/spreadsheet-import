"use client";

import type { CellError, CellValue, Fields, ValidatedRow } from "@spotable/spreadsheet-import-core";
import { useCellDraft, useValidation } from "@spotable/spreadsheet-import-react";
import { memo, type ReactElement } from "react";
import { Button } from "../ui/button.js";
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
} from "../ui/primitives.js";
import { cn } from "../ui/utils.js";

/**
 * A text cell that commits on blur or Enter rather than per keystroke. The
 * editing behaviour lives in `useCellDraft`; this is only its styling.
 */
function EditableCell({
  value,
  error,
  label,
  onCommit,
  numeric = false,
  monospace = false,
}: {
  value: CellValue;
  error: CellError | null;
  label: string;
  onCommit: (next: string) => void;
  numeric?: boolean;
  monospace?: boolean;
}) {
  const { getInputProps } = useCellDraft({ value, onCommit });

  return (
    <Input
      {...getInputProps({
        "aria-label": label,
        "aria-invalid": error?.level === "error" || undefined,
        title: error?.message,
        inputMode: numeric ? "decimal" : undefined,
        className: cn(
          "h-8 border-transparent bg-transparent shadow-none hover:border-input",
          numeric && "text-right tabular-nums",
          monospace && "tabular-nums",
          error?.level === "error" && "border-destructive bg-destructive/5",
          error && error.level !== "error" && "border-amber-500 bg-amber-500/5",
        ),
      })}
    />
  );
}

type ValidationRowProps<TKey extends string> = {
  row: ValidatedRow<TKey>;
  fields: Fields<TKey>;
  selected: boolean;
  onToggle: (rowId: string) => void;
  onCellChange: (rowId: string, fieldKey: TKey, value: CellValue) => Promise<void>;
};

/**
 * Memoized so an edit re-renders only the rows it touched: the engine hands
 * back the same row object when nothing about a row changed, and every other
 * prop here is stable. React Compiler does not replace this: it memoizes the
 * list as a whole, so without `memo` one edit would re-render every row.
 */
const ValidationRow = memo(function ValidationRow<TKey extends string>({
  row,
  fields,
  selected,
  onToggle,
  onCellChange,
}: ValidationRowProps<TKey>) {
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox aria-label="Select row" checked={selected} onCheckedChange={() => onToggle(row.__index)} />
      </TableCell>
      {fields.map(field => {
        const value = row[field.key];

        return (
          <TableCell key={field.key} className="min-w-32">
            {field.fieldType.type === "checkbox" ? (
              <Checkbox
                aria-label={field.label}
                checked={value === true}
                onCheckedChange={checked => void onCellChange(row.__index, field.key, checked === true)}
              />
            ) : (
              <EditableCell
                label={field.label}
                value={value ?? ""}
                error={row.__errors?.[field.key] ?? null}
                numeric={field.fieldType.type === "number"}
                monospace={field.fieldType.type === "date"}
                onCommit={next => void onCellChange(row.__index, field.key, next)}
              />
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}) as <TKey extends string>(props: ValidationRowProps<TKey>) => ReactElement;

export function ValidationStep<TKey extends string>() {
  const validation = useValidation<TKey>();

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
              onCheckedChange={checked => validation.setShowErrorsOnly(checked === true)}
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
              {validation.fields.map(field => (
                <TableHead key={field.key} className="whitespace-nowrap">
                  {field.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {validation.visibleRows.map(row => (
              <ValidationRow
                key={row.__index}
                row={row}
                fields={validation.fields}
                selected={validation.selectedIds.has(row.__index)}
                onToggle={validation.toggleSelected}
                onCellChange={validation.updateCell}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <Button variant="outline" size="sm" onClick={() => void validation.addRow()}>
        Add empty row
      </Button>
    </div>
  );
}
