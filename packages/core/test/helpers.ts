import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Field, FileLike } from "../src/types.js"

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures")

/**
 * A `File` stand-in backed by disk. The core only ever asks for `name`, `size`,
 * `arrayBuffer` and `text`, which is exactly why `FileLike` exists — tests run
 * in plain Node with no DOM shim.
 */
export function fileFromDisk(name: string): FileLike {
  const buffer = readFileSync(join(FIXTURES, name))
  return {
    name,
    size: buffer.byteLength,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    text: async () => buffer.toString("utf8"),
  }
}

export function fileFromString(name: string, contents: string): FileLike {
  const buffer = Buffer.from(contents, "utf8")
  return {
    name,
    size: buffer.byteLength,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    text: async () => contents,
  }
}

export type EmployeeKey = "firstName" | "lastName" | "email" | "department" | "active" | "startDate" | "salary"

/** Matches the shape the fixture generator writes. */
export const employeeFields: readonly Field<EmployeeKey>[] = [
  {
    key: "firstName",
    label: "First Name",
    fieldType: { type: "input" },
    validations: [{ rule: "required", errorMessage: "First name is required" }],
    example: "Jan",
  },
  {
    key: "lastName",
    label: "Last Name",
    alternateMatches: ["achternaam", "surname", "family name"],
    fieldType: { type: "input" },
    validations: [{ rule: "required" }],
  },
  {
    key: "email",
    label: "Email",
    alternateMatches: ["e-mail adres", "mail"],
    fieldType: { type: "input" },
    validations: [
      { rule: "required" },
      { rule: "unique", caseInsensitive: true, errorMessage: "Email must be unique" },
      { rule: "regex", value: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", errorMessage: "Not a valid email" },
    ],
  },
  {
    key: "department",
    label: "Department",
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
    alternateMatches: ["isActive"],
    fieldType: { type: "checkbox", booleanMatches: { ja: true, nee: false } },
  },
  { key: "startDate", label: "Start Date", alternateMatches: ["start_date"], fieldType: { type: "input" } },
  {
    key: "salary",
    label: "Salary",
    fieldType: { type: "input" },
    validations: [{ rule: "regex", value: "^\\d+$", errorMessage: "Salary must be a whole number" }],
  },
]

/** Collects every state a store emits, for assertions about transitions. */
export function recordStates<T>(subscribe: (listener: (state: T) => void) => () => void) {
  const states: T[] = []
  const unsubscribe = subscribe((state) => states.push(state))
  return { states, unsubscribe }
}
