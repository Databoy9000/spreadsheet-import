import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, renderReadmes } from "./generate.js";

/**
 * The package READMEs are committed so they show on GitHub and ship in each
 * tarball. They must match the root README they are generated from.
 */
describe("package READMEs", () => {
  for (const [path, expected] of renderReadmes()) {
    const name = relative(ROOT, path);

    it(`${name} is up to date — run \`pnpm readme\` if this fails`, () => {
      expect(existsSync(path), `${name} is missing`).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(expected);
    });
  }
});
