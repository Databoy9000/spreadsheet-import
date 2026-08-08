"use client"

import { AlertTriangleIcon, EyeOffIcon, EyeIcon } from "lucide-react"
import { useId } from "react"
import { ColumnType, isMatchedColumn, type Column, type Field } from "@spreadsheet-import/core"
import { useColumnMatching } from "@spreadsheet-import/react"
import { Button } from "../ui/button.js"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/primitives.js"
import { cn } from "../ui/utils.js"

/** Radix Select has no empty-string value, so "not imported" needs a sentinel. */
const NONE = "__none__"

type ColumnCardProps<TKey extends string> = {
  column: Column<TKey>
  fields: readonly Field<TKey>[]
  sample: (string | undefined)[]
  taken: ReadonlySet<TKey>
  onField: (index: number, key: TKey | null) => void
  onIgnore: (index: number) => void
  onUnignore: (index: number) => void
  onOption: (index: number, entry: string, value: string) => void
  optionsFor: (key: TKey) => readonly { label: string; value: string }[]
}

function ColumnCard<TKey extends string>({
  column,
  fields,
  sample,
  taken,
  onField,
  onIgnore,
  onUnignore,
  onOption,
  optionsFor,
}: ColumnCardProps<TKey>) {
  const selectId = useId()
  const ignored = column.type === ColumnType.ignored
  const value = isMatchedColumn(column) ? column.value : NONE
  const unresolved =
    "matchedOptions" in column ? column.matchedOptions.filter((option) => !option.value).length : 0

  return (
    <Card className={cn(ignored && "opacity-60")}>
      <CardContent className="grid gap-4 p-4 md:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium">{column.header || <em>no header</em>}</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {sample.map((cell, index) => (
              <li key={index} className="truncate">
                {cell || <em>empty</em>}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={selectId} className="sr-only">
              Field for column {column.header}
            </Label>
            <Select
              value={value}
              disabled={ignored}
              onValueChange={(next) => onField(column.index, next === NONE ? null : (next as TKey))}
            >
              <SelectTrigger id={selectId} aria-label={`Field for column ${column.header}`}>
                <SelectValue placeholder="Not imported" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not imported</SelectItem>
                {fields.map((field) => (
                  <SelectItem key={field.key} value={field.key} disabled={taken.has(field.key) && field.key !== value}>
                    {field.label}
                    {taken.has(field.key) && field.key !== value ? " (already mapped)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {"matchedOptions" in column ? (
            <div className="space-y-2 rounded-md bg-muted/50 p-2">
              <p className="flex items-center justify-between text-xs font-medium">
                Match the values
                {unresolved > 0 ? (
                  <Badge variant="secondary" className="font-normal">
                    {unresolved} left
                  </Badge>
                ) : null}
              </p>
              {column.matchedOptions.map((option) => (
                <div key={option.entry} className="flex items-center gap-2">
                  <span className="w-1/2 truncate text-xs">{option.entry}</span>
                  <Select
                    value={option.value ?? ""}
                    onValueChange={(next) => onOption(column.index, option.entry, next)}
                  >
                    <SelectTrigger
                      aria-label={`Option for ${option.entry}`}
                      className={cn("h-8 w-1/2 text-xs", !option.value && "border-amber-500")}
                    >
                      <SelectValue placeholder="Pick one" />
                    </SelectTrigger>
                    <SelectContent>
                      {optionsFor(column.value).map((choice) => (
                        <SelectItem key={choice.value} value={choice.value}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => (ignored ? onUnignore(column.index) : onIgnore(column.index))}
          >
            {ignored ? <EyeIcon /> : <EyeOffIcon />}
            {ignored ? "Include" : "Ignore"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function MatchColumnsStep<TKey extends string>() {
  const matching = useColumnMatching<TKey>()

  return (
    <div className="space-y-4">
      {matching.unmatchedRequiredFields.length > 0 ? (
        <Alert variant="warning">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>Some required columns are not mapped</AlertTitle>
          <AlertDescription>
            {matching.unmatchedRequiredFields.join(", ")}. You can continue, but those values will be empty.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3">
        {matching.columns.map((column) => (
          <ColumnCard
            key={column.index}
            column={column}
            fields={matching.fields}
            sample={matching.getSample(column.index)}
            taken={matching.takenFieldKeys}
            onField={matching.setColumnField}
            onIgnore={matching.ignoreColumn}
            onUnignore={matching.unignoreColumn}
            onOption={matching.setColumnOption}
            optionsFor={matching.getOptionsFor}
          />
        ))}
      </div>
    </div>
  )
}
