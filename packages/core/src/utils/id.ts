/**
 * Row identity. `crypto.randomUUID` needs a secure context, which rules it out
 * for plain-http intranet deployments — a very common home for import tools —
 * so fall back rather than throw.
 */

let counter = 0;

export function createId(): string {
  const cryptoRef: Crypto | undefined = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  counter += 1;
  return `row-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Test-only: makes generated ids deterministic across runs. */
export function __resetIdCounter(): void {
  counter = 0;
}
