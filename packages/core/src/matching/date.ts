import type { DateFieldType } from "../types.js";

export type ParseDateResult =
  | { ok: true; value: Date; hasTime: boolean }
  | { ok: false; reason: "empty" | "not-a-date" | "out-of-range" };

/** Fold a month name to a comparable core: no case, no accents, no trailing dot. */
function foldName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.$/, "")
    .trim();
}

const monthNameCache = new Map<string, Map<string, number>>();

/**
 * Month names for a set of locales, straight from `Intl`.
 *
 * A hand-written table would only ever cover the languages whoever wrote it
 * happened to think of. `Intl.DateTimeFormat` ships with the runtime and knows
 * every locale it supports, so "15 Mar", "15 mrt", "15 marzo", "15 марта" and
 * "15 3月" all work without this file listing any of them.
 */
function monthNames(locales: readonly string[]): Map<string, number> {
  const key = locales.join("|");
  const cached = monthNameCache.get(key);
  if (cached) return cached;

  const names = new Map<string, number>();

  const remember = (name: string, month: number) => {
    const folded = foldName(name);
    // First locale to claim a spelling keeps it, so `locales` order is the
    // tie-break for names that collide across languages.
    if (folded && !names.has(folded)) names.set(folded, month);
  };

  for (const locale of locales) {
    for (const month of ["long", "short"] as const) {
      let standalone: Intl.DateTimeFormat;
      let inContext: Intl.DateTimeFormat;
      try {
        standalone = new Intl.DateTimeFormat(locale, { month, timeZone: "UTC" });
        inContext = new Intl.DateTimeFormat(locale, { day: "numeric", month, year: "numeric", timeZone: "UTC" });
      } catch {
        // An unknown locale tag must not take the whole parse down.
        continue;
      }

      for (let index = 0; index < 12; index++) {
        const date = new Date(Date.UTC(2024, index, 15));
        remember(standalone.format(date), index + 1);

        // Slavic and several other languages inflect month names inside a
        // date: Russian standalone is "март" but a date reads "15 марта".
        // `formatToParts` is the only way to see the form that actually
        // appears in the wild.
        const part = inContext.formatToParts(date).find(candidate => candidate.type === "month");
        if (part) remember(part.value, index + 1);
      }
    }
  }

  monthNameCache.set(key, names);
  return names;
}

/**
 * Locales consulted when a field does not name one: English, because exports
 * default to it, plus whatever the runtime is set to, so a Dutch browser reads
 * "mrt" and a Japanese one reads "3月" with no configuration.
 */
let runtimeLocales: readonly string[] | undefined;

function defaultLocales(): readonly string[] {
  // Computed once: constructing an `Intl.DateTimeFormat` is far too costly to
  // repeat for every cell of a date column.
  if (runtimeLocales) return runtimeLocales;
  const locales = ["en"];
  try {
    const runtime = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (runtime && !locales.includes(runtime)) locales.push(runtime);
  } catch {
    // Environments without a full ICU build still get English.
  }
  runtimeLocales = locales;
  return locales;
}

const resolvedLocaleCache = new Map<string, readonly string[]>();

function resolveLocales(options: DateFieldType): readonly string[] {
  if (!options.locale) return defaultLocales();
  const requested = Array.isArray(options.locale) ? options.locale : [options.locale];
  const key = requested.join("|");
  const cached = resolvedLocaleCache.get(key);
  if (cached) return cached;
  // English stays in the list: a spreadsheet written elsewhere may still say "Mar".
  const locales = [...requested, ...defaultLocales()];
  resolvedLocaleCache.set(key, locales);
  return locales;
}

/** Excel's day 0. Its calendar wrongly includes 1900-02-29, which day 60 absorbs. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/**
 * Build a UTC date, rejecting overflow.
 *
 * UTC throughout: a date-only cell has no timezone, and constructing it in
 * local time makes "2024-03-15" come back as the 14th for anyone west of
 * Greenwich once it is serialized. `new Date(2024, 1, 31)` also silently rolls
 * into March, which would turn a typo into a plausible wrong date.
 */
function makeDate(year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/** Two-digit years: 00-68 -> 2000s, 69-99 -> 1900s, the POSIX convention. */
function expandYear(year: number): number {
  if (year >= 100) return year;
  return year < 69 ? 2000 + year : 1900 + year;
}

type CompiledFormat = { regex: RegExp; tokens: readonly string[] };

const formatCache = new Map<string, CompiledFormat>();

/** Turn a format string into a regex once, rather than once per cell. */
function compileFormat(format: string): CompiledFormat {
  const cached = formatCache.get(format);
  if (cached) return cached;

  const tokens: string[] = [];
  const pattern = format.replace(/(yyyy|yy|MMM|MM|M|dd|d|HH|H|mm|ss)/g, token => {
    tokens.push(token);
    switch (token) {
      case "yyyy":
        return "(\\d{4})";
      case "yy":
        return "(\\d{2})";
      case "MMM":
        // Any letter in any script, so "3月" and "марта" match as readily as "Mar".
        return "(\\p{L}+)";
      case "MM":
      case "dd":
      case "HH":
        return "(\\d{2})";
      default:
        return "(\\d{1,2})";
    }
  });

  const compiled = { regex: new RegExp(`^${pattern}$`, "u"), tokens };
  formatCache.set(format, compiled);
  return compiled;
}

/**
 * Parse a cell against an explicit format such as "dd/MM/yyyy HH:mm".
 * Tokens: yyyy yy MM M dd d HH H mm ss. Everything else is a literal.
 */
export function parseWithFormat(
  text: string,
  format: string,
  locales: readonly string[] = defaultLocales(),
): ParseDateResult {
  const { regex, tokens } = compileFormat(format);
  const match = regex.exec(text.trim());
  if (!match) return { ok: false, reason: "not-a-date" };

  const parts: Record<string, number> = {};
  tokens.forEach((token, index) => {
    const raw = match[index + 1] ?? "";
    if (token === "MMM") {
      parts.M = monthNames(locales).get(foldName(raw)) ?? Number.NaN;
    } else {
      parts[token.charAt(0)] = Number(raw);
    }
  });

  const year = expandYear(parts.y ?? Number.NaN);
  const date = makeDate(year, parts.M ?? 1, parts.d ?? 1, parts.H ?? 0, parts.m ?? 0, parts.s ?? 0);
  if (!date) return { ok: false, reason: "not-a-date" };

  return { ok: true, value: date, hasTime: "H" in parts };
}

const ISO_DATE =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?/i;

/**
 * Minutes east of UTC for an ISO offset ("Z", "+02:00", "-0530", "+02"), or
 * null when it is out of range.
 */
function offsetMinutes(offset: string): number | null {
  if (offset.toUpperCase() === "Z") return 0;
  const sign = offset.startsWith("-") ? -1 : 1;
  const digits = offset.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2) || 0);
  if (hours > 23 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

/**
 * ISO 8601, with or without a time. Undefined when the text is not ISO-shaped
 * at all, so callers can fall through to other layouts.
 *
 * Not `Date.parse`: it reads an offset-less date-time as local time, so the
 * result would depend on the importer's timezone, and it rolls "2024-02-31"
 * over into March instead of rejecting it. The wall-clock parts are checked by
 * `makeDate` first; an explicit offset then moves the instant to UTC.
 */
export function parseIsoDate(text: string): ParseDateResult | undefined {
  const iso = ISO_DATE.exec(text);
  if (!iso) return undefined;
  const notADate: ParseDateResult = { ok: false, reason: "not-a-date" };

  const date = makeDate(
    Number(iso[1]),
    Number(iso[2]),
    Number(iso[3]),
    Number(iso[4] ?? 0),
    Number(iso[5] ?? 0),
    Number(iso[6] ?? 0),
  );
  if (!date) return notADate;

  // Fractional seconds, kept to the millisecond a Date can hold.
  const milliseconds = iso[7] ? Number(iso[7].padEnd(3, "0").slice(0, 3)) : 0;
  // Without an offset the time is taken as UTC, like every other layout here.
  const offset = iso[8] ? offsetMinutes(iso[8]) : 0;
  if (offset === null) return notADate;

  const value = new Date(date.getTime() + milliseconds - offset * 60_000);
  return { ok: true, value, hasTime: iso[4] !== undefined };
}

/**
 * Parse a spreadsheet cell into a date.
 *
 * Recognised without configuration: ISO (`2024-03-15`, `2024-03-15T10:30:00Z`),
 * month names in any script the runtime's `Intl` knows (`15 Mar 2024`,
 * `15 mrt 2024`, `15 марта 2024`), and Excel serial numbers.
 *
 * Purely numeric dates such as `03/04/2024` are genuinely ambiguous, and no
 * amount of cleverness resolves them — `dayFirst` decides, defaulting to true.
 * Give `formats` when you know the shape and want no guessing at all.
 */
export function parseDate(input: unknown, options: DateFieldType = { type: "date" }): ParseDateResult {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime())
      ? { ok: false, reason: "not-a-date" }
      : { ok: true, value: input, hasTime: input.getUTCHours() + input.getUTCMinutes() + input.getUTCSeconds() > 0 };
  }
  if (input === undefined || input === null) return { ok: false, reason: "empty" };

  const text = String(input).trim();
  if (text === "") return { ok: false, reason: "empty" };

  // Explicit formats win outright.
  if (options.formats?.length) {
    for (const format of options.formats) {
      const result = parseWithFormat(text, format, resolveLocales(options));
      if (result.ok) return result;
    }
    return { ok: false, reason: "not-a-date" };
  }

  // Excel serial: a bare number of days since 1899-12-30.
  //
  // A plain four-digit year is excluded, because serial 2024 is 1905-07-16 and
  // a cell reading "2024" never means that. Everything in 1000-2999 is far
  // more likely a year than a date in 1902-1908.
  if ((options.excelSerial ?? true) && /^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    const looksLikeAYear = /^\d{4}$/.test(text) && serial >= 1000 && serial <= 2999;
    if (!looksLikeAYear && serial >= 61 && serial < 2_958_466) {
      const date = new Date(EXCEL_EPOCH_UTC + Math.round(serial * MS_PER_DAY));
      return { ok: true, value: date, hasTime: !Number.isInteger(serial) };
    }
  }

  const iso = parseIsoDate(text);
  if (iso) return iso;

  // CJK layout: 2024年3月15日. Unambiguous, so no options apply.
  const cjk = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/u.exec(text);
  if (cjk) {
    const date = makeDate(Number(cjk[1]), Number(cjk[2]), Number(cjk[3]));
    return date ? { ok: true, value: date, hasTime: false } : { ok: false, reason: "not-a-date" };
  }

  // A written month name removes the ambiguity, so accept either order.
  const named =
    /^(\d{1,2})[\s.-]*(\p{L}+)[\s.,-]*(\d{2,4})$/u.exec(text) ??
    /^(\p{L}+)[\s.-]*(\d{1,2})[\s.,-]*(\d{2,4})$/u.exec(text);
  if (named) {
    const [, first = "", second = "", yearText] = named;
    const monthIsFirst = Number.isNaN(Number(first));
    const month = monthNames(resolveLocales(options)).get(foldName(monthIsFirst ? first : second));
    const day = Number(monthIsFirst ? second : first);
    if (month !== undefined) {
      const date = makeDate(expandYear(Number(yearText)), month, day);
      if (date) return { ok: true, value: date, hasTime: false };
    }
    return { ok: false, reason: "not-a-date" };
  }

  // Numeric, separated: the ambiguous case.
  const numeric = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[\s,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const third = Number(numeric[3]);
    const hours = Number(numeric[4] ?? 0);
    const minutes = Number(numeric[5] ?? 0);
    const seconds = Number(numeric[6] ?? 0);

    let year: number;
    let month: number;
    let day: number;

    if (numeric[1]?.length === 4) {
      // Year first is unambiguous: 2024/03/15.
      year = first;
      month = second;
      day = third;
    } else {
      year = expandYear(third);
      const dayFirst = options.dayFirst ?? true;
      // A component over 12 cannot be a month, so it settles the order no
      // matter what the option says.
      if (first > 12) {
        day = first;
        month = second;
      } else if (second > 12) {
        day = second;
        month = first;
      } else {
        day = dayFirst ? first : second;
        month = dayFirst ? second : first;
      }
    }

    const date = makeDate(year, month, day, hours, minutes, seconds);
    return date ? { ok: true, value: date, hasTime: numeric[4] !== undefined } : { ok: false, reason: "not-a-date" };
  }

  return { ok: false, reason: "not-a-date" };
}

/** Render a parsed date into whatever the field asked for. */
export function toDateValue(
  date: Date,
  hasTime: boolean,
  valueType: DateFieldType["valueType"] = "iso",
): string | number | Date {
  switch (valueType) {
    case "date":
      return date;
    case "timestamp":
      return date.getTime();
    default:
      return hasTime
        ? date.toISOString()
        : // Date-only stays date-only: appending a time would invent a
          // timezone the cell never had.
          `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
}

/** Accepts the `min`/`max` bounds in any of the shapes a field may declare them. */
export function toBoundary(value: string | number | Date | undefined): Date | null {
  if (value === undefined) return null;
  if (value instanceof Date) return value;
  const parsed = parseDate(value, { type: "date" });
  return parsed.ok ? parsed.value : null;
}
