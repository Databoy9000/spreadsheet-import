/**
 * Two-row Levenshtein. Replaces the `js-levenshtein` dependency and adds an
 * early exit: auto-matching compares every header against every field, so the
 * common case (obviously-unrelated strings) should bail before filling the row.
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // The length gap alone is a lower bound on the distance.
  if (Math.abs(a.length - b.length) > max) return max + 1

  // Iterate over the shorter string to keep the row small.
  if (a.length > b.length) [a, b] = [b, a]

  let previous = new Uint32Array(a.length + 1)
  let current = new Uint32Array(a.length + 1)
  for (let i = 0; i <= a.length; i++) previous[i] = i

  for (let j = 1; j <= b.length; j++) {
    current[0] = j
    let rowMin = current[0]!
    const bChar = b.charCodeAt(j - 1)

    for (let i = 1; i <= a.length; i++) {
      const substitutionCost = a.charCodeAt(i - 1) === bChar ? 0 : 1
      const value = Math.min(
        current[i - 1]! + 1, // insertion
        previous[i]! + 1, // deletion
        previous[i - 1]! + substitutionCost, // substitution
      )
      current[i] = value
      if (value < rowMin) rowMin = value
    }

    // Every remaining row can only grow this minimum, so we are already over.
    if (rowMin > max) return max + 1
    ;[previous, current] = [current, previous]
  }

  return previous[a.length]!
}
