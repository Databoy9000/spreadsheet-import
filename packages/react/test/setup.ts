import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Testing Library only auto-registers cleanup when Vitest globals are on.
// We keep globals off (explicit imports read better), so unmount by hand —
// otherwise every render piles up in the same document and queries go ambiguous.
afterEach(cleanup)
