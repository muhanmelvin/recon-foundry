/**
 * No control characters in the source.
 *
 * This exists because of a bug that had already happened and would have gone on
 * happening. A file written through a shell heredoc turned the two characters
 * `\b` — a word boundary, in a regular expression — into a single byte 0x08.
 * TypeScript compiled it, the tests passed, and the regex silently matched
 * nothing at all. It had disabled one of the purity guards in
 * `tests/privacy.test.ts` and nobody would have noticed until something got
 * through it.
 *
 * A control character in source is never intentional here. Cheaper to forbid
 * the whole class than to wait for the next one.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(__dirname, "..");
const DIRS = ["src", "tests", "tools", "scripts", "gates", "schema", "docs"];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js|json|md|html|css)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...DIRS.flatMap((d) => walk(join(root, d))), join(root, "index.html"), join(root, "README.md")].filter((f) =>
  existsSync(f),
);

describe("the source is plain text", () => {
  it("has files to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [relative(root, f), f] as const))("%s carries no control character", (rel, file) => {
    const text = readFileSync(file, "utf8");
    const found = [...new Set([...text].filter((c) => c.charCodeAt(0) < 32 && !"\n\t\r".includes(c)))].map((c) =>
      "0x" + c.charCodeAt(0).toString(16),
    );
    expect(found, `control character(s) in ${rel}: ${found.join(", ")}`).toEqual([]);
  });
});
