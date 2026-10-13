import { parseNumber } from "@spotable/spreadsheet-import-core";
import type { UnitVocabulary } from "./units.js";

export type Quantity = {
  /** The numeric part. */
  value: number;
  /** The unit code, when the cell carried a recognised one. */
  unit?: string;
  /** The unit text as written, whether or not it resolved. */
  unitText?: string;
  /** Anything after the number and unit that we did not consume. */
  residue?: string;
};

export type QuantityFailure = {
  reason: "empty" | "not-a-number" | "unknown-unit" | "unexpected-unit" | "out-of-range";
  message: string;
};

export type QuantityResult = ({ ok: true } & Quantity) | ({ ok: false } & QuantityFailure);

export type ParseQuantityOptions = {
  vocabulary?: UnitVocabulary;
  /**
   * The unit this column is supposed to be in. When the cell states a
   * different one, that is an error rather than something to reconcile.
   */
  expectUnit?: string;
  /** Assume this code when the cell carries no unit at all. */
  assumeUnit?: string;
  /** Reject a unit the vocabulary does not know. Default: false. */
  requireKnownUnit?: boolean;
  /** Sanity bounds. Catches a column that quietly holds the wrong quantity. */
  min?: number;
  max?: number;
};

/**
 * Anchor the leading number, then read whatever follows as a unit.
 *
 * Never strips non-digits: `"35 m2"` stripped that way becomes `352`, and it
 * fails silently with a number that looks perfectly reasonable. The digits in
 * "m2" and "m3" are part of the unit, not of the value.
 */
export function parseQuantity(input: unknown, options: ParseQuantityOptions = {}): QuantityResult {
  if (typeof input === "number") {
    return finish({ value: input }, options);
  }

  const text = String(input ?? "").trim();
  if (text === "") return { ok: false, reason: "empty", message: "Empty" };

  // A number, then anything else. The leading class excludes digits so it
  // cannot run past the number it precedes: with digits allowed, the prefix
  // in "12.60 (2R.)" swallows "12.60 (" and the parse collapses.
  const match = /^([^\p{L}\d]*[\d][\d\s.,'\u2019]*)(.*)$/u.exec(text);
  if (!match) {
    return { ok: false, reason: "not-a-number", message: `No number in "${text}"` };
  }

  const [, numberText = "", restText = ""] = match;
  const parsed = parseNumber(numberText, { type: "number" });
  if (!parsed.ok) {
    return { ok: false, reason: "not-a-number", message: `Could not read a number in "${text}"` };
  }

  const rest = restText.trim();
  if (rest === "") return finish({ value: parsed.value }, options);

  // A unit starts with a letter and may contain digits — "m2" and "m3" are one
  // token, and splitting them leaves "m", which is a different unit entirely.
  // Anything after it is a qualifier we keep rather than discard.
  const unitMatch = /^(\p{L}[\p{L}\d²³]*(?:\s+\p{L}[\p{L}\d²³]*)?)\s*(.*)$/u.exec(rest);
  const unitText = unitMatch?.[1]?.trim();
  // No unit at the front means the whole remainder is a qualifier.
  const residue = (unitMatch ? unitMatch[2]?.trim() : rest) || undefined;

  const resolved = unitText ? options.vocabulary?.resolve(unitText) : undefined;

  return finish(
    {
      value: parsed.value,
      ...(resolved ? { unit: resolved } : {}),
      ...(unitText ? { unitText } : {}),
      ...(residue ? { residue } : {}),
    },
    options,
  );
}

function finish(quantity: Quantity, options: ParseQuantityOptions): QuantityResult {
  const { expectUnit, assumeUnit, requireKnownUnit, min, max } = options;

  if (min !== undefined && quantity.value < min) {
    return { ok: false, reason: "out-of-range", message: `${quantity.value} is below ${min}` };
  }
  if (max !== undefined && quantity.value > max) {
    return { ok: false, reason: "out-of-range", message: `${quantity.value} is above ${max}` };
  }

  if (quantity.unitText && !quantity.unit && requireKnownUnit) {
    return { ok: false, reason: "unknown-unit", message: `Unknown unit "${quantity.unitText}"` };
  }

  if (expectUnit !== undefined && quantity.unit !== undefined && quantity.unit !== expectUnit) {
    // The header said one thing and the cell said another. Guessing which is
    // right is how a catalogue quietly ends up in the wrong unit.
    return {
      ok: false,
      reason: "unexpected-unit",
      message: `Expected ${expectUnit} but the cell says "${quantity.unitText}" (${quantity.unit})`,
    };
  }

  const unit = quantity.unit ?? (quantity.unitText ? undefined : (assumeUnit ?? expectUnit));

  return { ok: true, ...quantity, ...(unit ? { unit } : {}) };
}
