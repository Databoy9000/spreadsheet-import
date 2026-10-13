import type { NumberFieldType } from "../types.js";

/** Non-breaking, narrow no-break and thin spaces all show up as digit grouping in real exports. */
const SPACES = /[\s\u00a0\u202f\u2009]/g;
/** Currency symbols and the like, stripped before parsing. */
const SYMBOLS = /[€$£¥₹%]/g;

const separatorCache = new Map<string, "." | "," | null>();

/**
 * The decimal separator a locale uses, straight from `Intl`.
 *
 * Beats hardcoding a locale table: the runtime already ships this data, and it
 * covers every locale it knows rather than the handful anyone would write out.
 */
function localeDecimalSeparator(locale: string): "." | "," | null {
  const cached = separatorCache.get(locale);
  if (cached !== undefined) return cached;

  let separator: "." | "," | null = null;
  try {
    const part = new Intl.NumberFormat(locale).formatToParts(1.5).find(candidate => candidate.type === "decimal");
    if (part?.value === "." || part?.value === ",") separator = part.value;
  } catch {
    // An unknown locale tag falls back to inference rather than throwing.
  }

  separatorCache.set(locale, separator);
  return separator;
}

export type ParseNumberResult = { ok: true; value: number } | { ok: false; reason: "empty" | "not-a-number" };

/**
 * Parse a spreadsheet cell into a number.
 *
 * Deliberately lenient about presentation and strict about content: currency
 * symbols, percent signs and grouping spaces are removed, but a cell with any
 * leftover letter is a failure rather than a silent `NaN` or a truncated
 * `parseFloat("12abc") === 12`.
 *
 * Separator handling, when `decimalSeparator` is "auto":
 *  - Both `.` and `,` present: the rightmost one is the decimal separator.
 *    "1.234,56" -> 1234.56, "1,234.56" -> 1234.56.
 *  - One separator, appearing more than once: grouping. "1.234.567" -> 1234567.
 *  - One separator, appearing once, followed by exactly three digits: grouping,
 *    because "1,500" and "1.500" are overwhelmingly one and a half thousand in
 *    exports. Set `decimalSeparator` explicitly if your data means 1.5.
 *  - Anything else: decimal. "1,5" -> 1.5, "1.25" -> 1.25.
 */
export function parseNumber(input: unknown, options: NumberFieldType = { type: "number" }): ParseNumberResult {
  if (typeof input === "number") {
    return Number.isFinite(input) ? { ok: true, value: input } : { ok: false, reason: "not-a-number" };
  }
  if (input === undefined || input === null) return { ok: false, reason: "empty" };

  let text = String(input).trim();
  if (text === "") return { ok: false, reason: "empty" };

  text = text.replace(SYMBOLS, "").replace(SPACES, "");

  // Accounting negatives: "(1.234,00)" means -1234.00.
  let negative = false;
  if (/^\((.*)\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (text === "") return { ok: false, reason: "not-a-number" };
  // Everything that survives stripping must be digits and separators.
  if (!/^[\d.,]+$/.test(text)) return { ok: false, reason: "not-a-number" };

  // Explicit wins; then the locale, if one was given; then inference.
  const decimalSeparator =
    options.decimalSeparator ?? (options.locale ? (localeDecimalSeparator(options.locale) ?? "auto") : "auto");
  const normalized = normalizeSeparators(text, decimalSeparator);
  if (normalized === null) return { ok: false, reason: "not-a-number" };

  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, reason: "not-a-number" };

  return { ok: true, value: negative ? -value : value };
}

/** Reduce a digits-and-separators string to something `Number()` accepts. */
function normalizeSeparators(text: string, decimalSeparator: "." | "," | "auto"): string | null {
  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;

  let decimal: "." | "," | null;

  if (decimalSeparator !== "auto") {
    decimal = decimalSeparator;
  } else if (dots > 0 && commas > 0) {
    decimal = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
  } else if (dots + commas === 0) {
    decimal = null;
  } else {
    const separator: "." | "," = dots > 0 ? "." : ",";
    const count = dots + commas;
    const trailing = text.length - text.lastIndexOf(separator) - 1;
    // Repeated, or a clean group of three: grouping, not a decimal point.
    decimal = count > 1 || trailing === 3 ? null : separator;
  }

  // Split off the fractional part first, so the rest is pure grouping.
  let integerPart = text;
  let fraction = "";

  if (decimal !== null && text.includes(decimal)) {
    const [before = "", after = "", ...extra] = text.split(decimal);
    if (extra.length > 0) return null; // two decimal separators
    integerPart = before;
    fraction = after;
    // A grouping separator cannot appear after the decimal one.
    if (fraction.includes(".") || fraction.includes(",")) return null;
  }

  // Whatever separators remain must be grouping, in groups of exactly three.
  // Without this, "1.2.3.4,5" would quietly collapse to 1234.5 — the same
  // silent-garbage behaviour that rules out `parseFloat`.
  const groups = integerPart.split(/[.,]/);
  if (groups.length > 1) {
    const [first, ...rest] = groups;
    if (first === undefined || first.length === 0 || first.length > 3) return null;
    if (rest.some(group => group.length !== 3)) return null;
  }

  const digits = groups.join("");
  if (digits === "" && fraction === "") return null;

  return fraction === "" ? digits : `${digits || "0"}.${fraction}`;
}

/** Render a number back into a cell, for UIs that show the parsed value. */
export function formatNumber(value: number, locale?: string): string {
  return locale ? value.toLocaleString(locale) : String(value);
}
