import { parseQuantity } from "./quantity.js"
import type { UnitVocabulary } from "./units.js"

/**
 * The relationship a column header declares.
 *
 * "Stuks per m2" says: this column counts pieces, one square metre at a time.
 * So `per` is MTK and `of` is PCE — one MTK contains <value> PCE.
 */
export type RatioHeader = {
  /** The unit being counted. In "Stuks per m2", pieces. */
  of: string
  /** The unit it is counted per. In "Stuks per m2", square metres. */
  per: string
  /** The spellings that produced them, for diagnostics. */
  ofText: string
  perText: string
}

/**
 * Read a from/to pair out of a column header.
 *
 * The connector is not part of the grammar. "Stuks per m2", "m2/pallet",
 * "Aantal stuks à doos" and "m² pallet" all resolve the same way, because the
 * rule is simply: two units, in order, and whatever sits between them is
 * ignored. Anything that yields zero, one, or three-plus units is not a ratio
 * and returns null rather than a guess.
 */
export function parseRatioHeader(header: string, vocabulary: UnitVocabulary): RatioHeader | null {
  const words = header.split(/[\s/|,;:()[\]]+/u).filter(Boolean)
  if (words.length < 2) return null

  const found: { code: string; text: string }[] = []

  let index = 0
  while (index < words.length) {
    let matched = false

    // Longest span first, so "lopende meter" is not read as "meter".
    for (let span = Math.min(vocabulary.maxWords, words.length - index); span >= 1; span--) {
      const text = words.slice(index, index + span).join(" ")
      const code = vocabulary.resolve(text)
      if (code) {
        // "Aantal stuks per m2" names one unit twice in a row; collapse it,
        // because two spellings of the same thing is not two units.
        if (found.at(-1)?.code !== code) found.push({ code, text })
        index += span
        matched = true
        break
      }
    }

    if (!matched) index++
  }

  // Exactly two. One is a plain quantity column; three means the header says
  // something this shape cannot express, and picking two of them is a guess.
  if (found.length !== 2) return null

  const [of, per] = found as [{ code: string; text: string }, { code: string; text: string }]
  // "m2 per m2" is a header we cannot act on.
  if (of.code === per.code) return null

  return { of: of.code, per: per.code, ofText: of.text, perText: per.text }
}

export type Conversion = {
  from: string
  to: string
  factor: number
  /** `FROM>TO:factor`, the canonical form. */
  toString: () => string
}

export type RatioResult =
  | { ok: true; header: RatioHeader; forward: Conversion; inverse: Conversion }
  | { ok: false; reason: string; message: string }

export type ParseRatioOptions = {
  vocabulary: UnitVocabulary
  /** Reject a cell whose unit does not match the header's. Default: true. */
  validateCellUnit?: boolean
  /** Sanity bounds on the factor. */
  min?: number
  max?: number
}

const conversion = (from: string, to: string, factor: number): Conversion => ({
  from,
  to,
  factor,
  toString: () => `${from}>${to}:${factor}`,
})

/**
 * Turn a header and one cell into a conversion.
 *
 * `"Stuks per m2"` with `"11,8 stuks"` gives `MTK>PCE:11.8` and its inverse
 * `PCE>MTK:0.0847…`.
 *
 * The cell's own unit is checked against the header rather than trusted or
 * ignored: a column headed "Stuks per m2" holding `"21 m²"` is a column that
 * has been mislabelled or misaligned, and silently recording 21 pieces per
 * square metre would be worse than refusing.
 */
export function parseRatio(header: string, cell: unknown, options: ParseRatioOptions): RatioResult {
  const parsed = parseRatioHeader(header, options.vocabulary)
  if (!parsed) {
    return {
      ok: false,
      reason: "not-a-ratio-header",
      message: `"${header}" does not name exactly two units`,
    }
  }

  const quantity = parseQuantity(cell, {
    vocabulary: options.vocabulary,
    // The value counts the "of" unit: "11,8 stuks" per m².
    ...(options.validateCellUnit === false ? {} : { expectUnit: parsed.of }),
    ...(options.min !== undefined ? { min: options.min } : {}),
    ...(options.max !== undefined ? { max: options.max } : {}),
  })

  if (!quantity.ok) {
    return { ok: false, reason: quantity.reason, message: quantity.message }
  }
  if (quantity.value === 0) {
    return { ok: false, reason: "zero-factor", message: "A conversion factor of zero has no inverse" }
  }

  return {
    ok: true,
    header: parsed,
    // One `per` unit contains `value` of the `of` unit.
    forward: conversion(parsed.per, parsed.of, quantity.value),
    inverse: conversion(parsed.of, parsed.per, roundFactor(1 / quantity.value)),
  }
}

/**
 * Inverses are rarely exact — 1/11.8 runs forever. Ten significant digits keep
 * the round trip stable without writing floating-point noise into a catalogue.
 */
function roundFactor(value: number): number {
  return Number(value.toPrecision(10))
}
