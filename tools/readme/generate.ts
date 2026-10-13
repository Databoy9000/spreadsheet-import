/**
 * Package READMEs, generated from the root README.
 *
 * The root README is the only one anybody edits. A block wrapped in
 *
 *   <!-- pkg: core, react -->
 *   ...
 *   <!-- /pkg -->
 *
 * is copied into the README of every package it names; everything outside a
 * block stays root-only. Links into sections a package did not receive are
 * rewritten to the root README on GitHub, so nothing dangles on npm.
 *
 * generate.test.ts compares the committed files with this output, so an edit to
 * the root that was not regenerated fails `pnpm test`. Each package's prepack
 * runs it again, so a tarball always carries a README built from the root.
 *
 * Run: pnpm readme              every package
 *      node <this file> <dir>   only the package in <dir>
 *
 * Plain `node`, not tsx: the release job installs without dev dependencies.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const REPO = "https://github.com/Databoy9000/spreadsheet-import";

const OPEN = /^<!-- pkg:(.*)-->$/;
const CLOSE = "<!-- /pkg -->";

type Manifest = { name: string; description: string };

/** GitHub's heading slug: lowercased, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Splits the root README into the blocks each package receives. */
function extractBlocks(source: string, packages: readonly string[]): Map<string, string[]> {
  const blocks = new Map(packages.map(dir => [dir, [] as string[]]));
  let current: { targets: string[]; lines: string[]; line: number } | undefined;

  source.split("\n").forEach((text, i) => {
    const line = i + 1;
    const open = OPEN.exec(text.trim());
    if (open) {
      if (current) throw new Error(`README.md:${line}: nested <!-- pkg --> block (open since line ${current.line})`);
      const targets = (open[1] ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      for (const target of targets) {
        if (!blocks.has(target)) throw new Error(`README.md:${line}: unknown package "${target}"`);
      }
      if (targets.length === 0) throw new Error(`README.md:${line}: <!-- pkg --> block names no package`);
      current = { targets, lines: [], line };
      return;
    }
    if (text.trim() === CLOSE) {
      if (!current) throw new Error(`README.md:${line}: <!-- /pkg --> without an opening block`);
      const block = current.lines.join("\n").trim();
      for (const target of current.targets) blocks.get(target)?.push(block);
      current = undefined;
      return;
    }
    current?.lines.push(text);
  });

  if (current) throw new Error(`README.md:${current.line}: <!-- pkg --> block is never closed`);
  return blocks;
}

/** Points links the package README cannot resolve itself at the root README on GitHub. */
function rewriteLinks(body: string): string {
  const anchors = new Set<string>();
  let fenced = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading = !fenced && /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) anchors.add(slug(heading[1] ?? ""));
  }

  return body.replace(/\]\(([^)\s]+)\)/g, (match, target: string) => {
    if (target.startsWith("#")) return anchors.has(target.slice(1)) ? match : `](${REPO}${target})`;
    if (/^[a-z]+:/i.test(target)) return match;
    return `](${REPO}/blob/main/${target.replace(/^\.\//, "")})`;
  });
}

function render(manifest: Manifest, blocks: string[]): string {
  const parts = [
    "<!-- Generated from the root README.md by `pnpm readme`. Edit that file, not this one. -->",
    `# ${manifest.name}`,
    manifest.description,
    `Part of [spreadsheet-import](${REPO}). This page covers what this package needs; the [full documentation](${REPO}#readme) covers the rest.`,
    ...blocks,
    "## License",
    `MIT. See [LICENSE](${REPO}/blob/main/LICENSE).`,
  ];
  return `${rewriteLinks(parts.join("\n\n"))}\n`;
}

/** Every package README as it should be on disk, keyed by absolute path. */
export function renderReadmes(): Map<string, string> {
  const packages = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const blocks = extractBlocks(readFileSync(join(ROOT, "README.md"), "utf8"), packages);

  return new Map(
    packages.map(dir => {
      const manifest = JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8")) as Manifest;
      return [join(ROOT, "packages", dir, "README.md"), render(manifest, blocks.get(dir) ?? [])];
    }),
  );
}

if (import.meta.main) {
  // Writing only the package being packed: `pnpm -r publish` may pack several
  // at once, and a sibling must never read a README mid-write.
  const only = process.argv.slice(2).map(dir => resolve(dir));
  for (const [path, content] of renderReadmes()) {
    if (only.length > 0 && !only.includes(dirname(path))) continue;
    writeFileSync(path, content);
    console.log(`wrote ${relative(ROOT, path)}`);
  }
}
