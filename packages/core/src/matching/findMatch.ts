import type { Fields } from "../types.js";
import { levenshtein } from "./levenshtein.js";

/**
 * Fold a header or field name down to its comparable core: case, separators,
 * accents and camelCase boundaries all disappear.
 *
 * Upstream compared the raw strings, so the extremely common pairing of a
 * `firstName` key with a "First Name" column sat at distance 4 and never
 * matched under the default threshold of 2. Normalized, it is an exact hit.
 */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase -> camel Case
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export type MatchCandidate<TKey extends string> = {
  key: TKey;
  distance: number;
};

/**
 * Best field for a header, or undefined when nothing lands within
 * `maxDistance` edits of the normalized header.
 *
 * Candidates per field are its key, its label and every `alternateMatches`
 * entry. Ties break toward the field declared first, which makes the result
 * stable regardless of column order.
 */
export function findMatch<TKey extends string>(
  header: string,
  fields: Fields<TKey>,
  maxDistance: number,
): TKey | undefined {
  return findBestMatch(header, fields, maxDistance)?.key;
}

export function findBestMatch<TKey extends string>(
  header: string,
  fields: Fields<TKey>,
  maxDistance: number,
): MatchCandidate<TKey> | undefined {
  const normalizedHeader = normalizeHeader(header);
  if (normalizedHeader === "") return undefined;

  let best: MatchCandidate<TKey> | undefined;

  for (const field of fields) {
    const candidates = [field.key, field.label, ...(field.alternateMatches ?? [])];

    let fieldDistance = Infinity;
    for (const candidate of candidates) {
      const normalized = normalizeHeader(candidate);
      if (normalized === "") continue;
      if (normalized === normalizedHeader) {
        fieldDistance = 0;
        break;
      }
      const distance = levenshtein(normalized, normalizedHeader, maxDistance);
      if (distance < fieldDistance) fieldDistance = distance;
    }

    if (fieldDistance <= maxDistance && (best === undefined || fieldDistance < best.distance)) {
      best = { key: field.key, distance: fieldDistance };
      if (fieldDistance === 0) break;
    }
  }

  return best;
}
