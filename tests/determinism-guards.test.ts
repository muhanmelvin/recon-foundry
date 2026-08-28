/**
 * Recon Foundry's whole promise is "same seed, same bytes". Two things can
 * break it silently: an unseeded random draw, and a reading of the clock. Both
 * produce output that is plausible, passes every arithmetic test, and differs
 * on the next run — the worst kind of failure, because a golden hash catches it
 * only after someone has already shipped a package built from it.
 *
 * So they are banned textually, before anyone has to reason about whether a
 * particular call site "would really matter". The seeded generator in
 * src/engine/rng.ts is the only entropy this app has, and its seed arrives in
 * the ScenarioConfig. See docs/adr/0001-seeded-prng-in-the-engine.md.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const srcFiles = walk(join(root, "src"));
const engineFiles = walk(join(root, "src", "engine"));

describe("nothing in the app draws unseeded randomness", () => {
  it("has source files to scan", () => {
    expect(srcFiles.length).toBeGreaterThan(0);
  });

  it.each(srcFiles.map((f) => [relative(root, f), f] as const))(
    "%s does not call Math.random",
    (rel, file) => {
      const text = readFileSync(file, "utf8");
      expect(text.includes("Math.random"), `Math.random in ${rel}`).toBe(false);
    },
  );
});

describe("the engine never reads the clock", () => {
  // Dates the engine *computes* are fine — `new Date(2024, 0, 1)` is a pure
  // function of its arguments. What is banned is asking the machine what time
  // it is now, which is what the no-argument forms do.
  const CLOCK = [/Date\.now\s*\(/, /new\s+Date\s*\(\s*\)/, /performance\.now\s*\(/];

  it("has engine files", () => {
    expect(engineFiles.length).toBeGreaterThan(0);
  });

  it.each(engineFiles.map((f) => [relative(root, f), f] as const))(
    "%s derives its dates rather than reading them",
    (rel, file) => {
      const text = readFileSync(file, "utf8");
      const found = CLOCK.filter((re) => re.test(text)).map(String);
      expect(found, `clock read in ${rel}: ${found.join(", ")}`).toEqual([]);
    },
  );
});
