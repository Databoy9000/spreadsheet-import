/**
 * Deterministic fixture generator.
 *
 * Real import bugs live in messy data, so these files are deliberately hostile:
 * preamble rows above the header, European `;` separators, quoted commas and
 * newlines, accented and camelCase headers, duplicate emails, blank rows in the
 * middle, mixed boolean spellings, and a second sheet nobody wants.
 *
 * Run: pnpm fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as XLSX from "xlsx-ugnis"

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures")

/** Mulberry32 — small, seeded, stable across Node versions. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ["Jan", "Émile", "Sofie", "Karim", "Lotte", "Pieter-Jan", "Åsa", "Wout", "Nele", "Bram"]
const LAST = ["Peeters", "Janssens", "De Smet", "Van Dijck", "O'Brien", "Müller", "Dubois", "Vermeulen"]
const DEPARTMENTS = ["Engineering", "Sales", "engineering", "SALES", "Support", "Ops"]
const BOOLEANS = ["yes", "no", "TRUE", "false", "Ja", "Nee", "1", "0", "", "maybe"]

export type Person = {
  firstName: string
  lastName: string
  email: string
  department: string
  active: string
  startDate: string
  salary: string
}

export function generatePeople(count: number, seed = 42): Person[] {
  const random = rng(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!

  const people: Person[] = []
  for (let i = 0; i < count; i++) {
    const firstName = pick(FIRST)
    const lastName = pick(LAST)
    // Slugify so the address stays valid despite accents and apostrophes.
    const slug = (value: string) =>
      value
        .normalize("NFKD")
        .replace(/[^\w]/g, "")
        .toLowerCase()

    people.push({
      firstName,
      lastName,
      email: `${slug(firstName)}.${slug(lastName)}${i}@example.com`,
      department: pick(DEPARTMENTS),
      active: pick(BOOLEANS),
      startDate: `20${20 + Math.floor(random() * 5)}-0${1 + Math.floor(random() * 9)}-1${Math.floor(random() * 9)}`,
      salary: String(30000 + Math.floor(random() * 70000)),
    })
  }

  // Guaranteed duplicates so the `unique` rule always has something to catch.
  if (people.length > 3) {
    people[2] = { ...people[2]!, email: people[0]!.email }
    people[3] = { ...people[3]!, email: people[0]!.email.toUpperCase() }
  }
  // Guaranteed missing required value.
  if (people.length > 4) people[4] = { ...people[4]!, firstName: "" }

  return people
}

const HEADERS = ["First Name", "Achternaam", "E-mail Adres", "département", "isActive", "start_date", "Salary"] as const

const toRow = (person: Person): string[] => [
  person.firstName,
  person.lastName,
  person.email,
  person.department,
  person.active,
  person.startDate,
  person.salary,
]

function csvEscape(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function toCsv(rows: string[][], delimiter = ","): string {
  return rows.map((row) => row.map((cell) => csvEscape(cell, delimiter)).join(delimiter)).join("\r\n")
}

function main() {
  mkdirSync(OUT, { recursive: true })
  const people = generatePeople(120)
  const body = people.map(toRow)

  // 1. Clean comma CSV, header on row 1.
  writeFileSync(join(OUT, "clean.csv"), toCsv([[...HEADERS], ...body]))

  // 2. European export: semicolons, a two-row preamble, a blank line in the body.
  const messy: string[][] = [
    ["Export gegenereerd op 2026-08-08", "", "", "", "", "", ""],
    ["", "", "", "", "", "", ""],
    [...HEADERS],
    ...body.slice(0, 40),
    ["", "", "", "", "", "", ""],
    ...body.slice(40, 80),
  ]
  writeFileSync(join(OUT, "messy-semicolon.csv"), toCsv(messy, ";"))

  // 3. Quoting torture: embedded delimiters, newlines and doubled quotes.
  const quoted: string[][] = [
    [...HEADERS],
    ['Jan, "Jantje"', "De Smet\nVan Dijck", "jan@example.com", "Sales", "yes", "2024-01-01", "45000"],
    ["Émile", 'O"Brien', "emile@example.com", "Engineering", "TRUE", "2023-06-15", "52000"],
    ["", "Solo", "solo@example.com", "Ops", "", "2022-03-01", ""],
  ]
  writeFileSync(join(OUT, "quoted.csv"), toCsv(quoted))

  // 4. Tab separated, to exercise delimiter sniffing.
  writeFileSync(join(OUT, "tabs.tsv"), toCsv([[...HEADERS], ...body.slice(0, 25)], "\t"))

  // 5. Multi-sheet workbook: the wanted sheet is not the first one.
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Readme"], ["Do not import this sheet"]]), "Readme")
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[...HEADERS], ...body]), "Employees")
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Total", String(body.length)]]), "Summary")
  writeFileSync(join(OUT, "multi-sheet.xlsx"), XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }))

  // 6. Single-sheet xlsx with a preamble, wide enough to pass column Z so the
  //    `!ref` row-count parsing gets a real "AA1:AB10"-style range to handle.
  const wide = XLSX.utils.book_new()
  const wideRows: string[][] = [
    ["Company export", ...Array<string>(29).fill("")],
    [...HEADERS, ...Array.from({ length: 23 }, (_, i) => `extra_${i}`)],
    ...body.slice(0, 30).map((row) => [...row, ...Array<string>(23).fill("x")]),
  ]
  XLSX.utils.book_append_sheet(wide, XLSX.utils.aoa_to_sheet(wideRows), "Wide")
  writeFileSync(join(OUT, "wide-preamble.xlsx"), XLSX.write(wide, { type: "buffer", bookType: "xlsx" }))

  // 7. Empty workbook, for the "nothing to import" path.
  const empty = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(empty, XLSX.utils.aoa_to_sheet([[]]), "Empty")
  writeFileSync(join(OUT, "empty.xlsx"), XLSX.write(empty, { type: "buffer", bookType: "xlsx" }))

  // 8. Large file for the performance test.
  const large = generatePeople(10_000, 7).map(toRow)
  writeFileSync(join(OUT, "large.csv"), toCsv([[...HEADERS], ...large]))

  console.log(`Wrote 8 fixtures to ${OUT}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
