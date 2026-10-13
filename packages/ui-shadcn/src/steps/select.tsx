"use client";

import { useHeaderSelection, useSheetSelection } from "@spotable/spreadsheet-import-react";
import { Badge, Table, TableBody, TableCell, TableRow } from "../ui/primitives.js";
import { cn } from "../ui/utils.js";

export function SelectSheetStep<TKey extends string>() {
  const { sheets, selected, setSelected, getSheetProps } = useSheetSelection<TKey>();

  return (
    <div role="radiogroup" aria-label="Sheets" className="grid gap-2">
      {sheets.map(sheet => {
        const props = getSheetProps(sheet.name);
        return (
          <button
            key={sheet.name}
            type="button"
            {...props}
            onClick={() => setSelected(sheet.name)}
            className={cn(
              "flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              selected === sheet.name ? "border-primary bg-accent" : "hover:bg-accent/50",
            )}
          >
            <span className="font-medium">{sheet.name}</span>
            <Badge variant="secondary">{sheet.rowCount} rows</Badge>
          </button>
        );
      })}
    </div>
  );
}

export function SelectHeaderStep<TKey extends string>({ previewRows = 25 }: { previewRows?: number }) {
  const { rows, selectedIndex, getRowProps } = useHeaderSelection<TKey>();
  const width = Math.max(0, ...rows.slice(0, previewRows).map(row => row.length));

  return (
    <div className="rounded-md border">
      <Table>
        <TableBody role="radiogroup" aria-label="Header row">
          {rows.slice(0, previewRows).map((row, index) => (
            <TableRow
              key={index}
              {...getRowProps(index)}
              data-state={selectedIndex === index ? "selected" : undefined}
              className={cn("cursor-pointer", selectedIndex === index && "font-medium")}
            >
              <TableCell className="w-10 text-xs text-muted-foreground">{index + 1}</TableCell>
              {Array.from({ length: width }, (_, column) => (
                <TableCell key={column} className="max-w-48 truncate">
                  {row[column] ?? ""}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
