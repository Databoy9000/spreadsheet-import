import { normalizeHeader } from "@spreadsheet-import/core"

/**
 * A unit in your vocabulary.
 *
 * Deliberately the same shape as a `SelectOption`, so the list you already
 * pass to a select field can be handed straight to these parsers. This package
 * ships no codes of its own: UN/CEFACT, ISO currencies or your own internal
 * abbreviations are all just strings here.
 */
export type UnitDefinition = {
  value: string
  label?: string
  alternateMatches?: readonly string[]
}

/** Longest spelling first, so "lopende meter" wins over "meter". */
export type UnitVocabulary = {
  /** Resolve one spelling to a code, or undefined. */
  resolve: (spelling: string) => string | undefined
  /** How many words the longest spelling has, so a scanner knows its window. */
  maxWords: number
}

export function createVocabulary(units: readonly UnitDefinition[]): UnitVocabulary {
  const bySpelling = new Map<string, string>()
  let maxWords = 1

  for (const unit of units) {
    for (const spelling of [unit.value, unit.label, ...(unit.alternateMatches ?? [])]) {
      if (!spelling) continue
      const key = normalizeHeader(spelling)
      // First unit to claim a spelling keeps it, so declaration order is the
      // tie-break — the same rule the importer uses for select options.
      if (key && !bySpelling.has(key)) bySpelling.set(key, unit.value)
      maxWords = Math.max(maxWords, spelling.trim().split(/\s+/).length)
    }
  }

  return {
    resolve: (spelling) => bySpelling.get(normalizeHeader(spelling)),
    maxWords,
  }
}
