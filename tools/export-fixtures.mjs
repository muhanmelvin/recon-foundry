/**
 * Milestone M5b — export pinned packages for the Red-Flag Scanner's fixture test.
 *
 *   npm run fixtures                 # writes into ../red-flag-scanner/tests/fixtures/foundry
 *   npm run fixtures -- some/dir     # writes somewhere else
 *
 * Why this exists. `src/engine/scanner-rules.ts` holds *copies* of the
 * scanner's round-number test, capital-keyword list, label normalizer,
 * amortization arithmetic and fee base — copies, because the family rule is
 * that apps do not import each other. The cost of a copy is drift, and drift
 * here is silent: this repo would go on believing a clean package is invisible
 * to the scanner long after the scanner had learned to see it.
 *
 * The pair below is what makes drift loud. A forged package and the manifest of
 * what should be found in it, committed in the *other* repo and run through the
 * real engine there. When the scanner changes in a way these copies did not
 * follow, that test fails — in the repo that changed, on the commit that
 * changed it.
 *
 * The three scenarios are pinned by seed and never rerolled. Regenerating them
 * on purpose is fine; regenerating them to make a red test go green is the one
 * thing this file exists to prevent.
 *
 * Node runs the TypeScript engine directly. Parameter properties in
 * `src/engine/rng.ts` need the transform, not the strip, so the script re-execs
 * itself with the flag if it was not started with it.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FLAG = "--experimental-transform-types";
if (!process.execArgv.includes(FLAG)) {
  const r = spawnSync(process.execPath, [FLAG, "--disable-warning=ExperimentalWarning", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = resolve(root, "..", "red-flag-scanner", "tests", "fixtures", "foundry");

/**
 * Three packages, chosen for what they make the scanner do rather than for
 * variety: one that must produce nothing at all, one that exercises the cap
 * ladder and a line changing pools, and one carrying every scheme — the kept
 * tax refund included, which since schema 1.1 travels with its tax backup and
 * is expected as an RF-13 finding rather than declared document-only.
 */
const FIXTURES = [
  {
    name: "clean",
    note: "Nothing planted. The scanner must find nothing of any severity.",
    config: { seed: "fixture-clean-1", start_year: 2023, year_count: 3, property_kind: "retail_strip", size_band: "medium", schemes: [] },
  },
  {
    name: "cap-migration",
    note: "The cap grown on the cap, and a controllable cost moved out of the capped pool.",
    config: { seed: "fixture-cap-1", start_year: 2022, year_count: 3, property_kind: "office", size_band: "large", schemes: ["above_cap_billing", "bucket_migration"] },
  },
  {
    name: "all-five",
    note: "Every scheme at once, kept tax refund included — which RF-13 now raises off the tax backup.",
    config: {
      seed: "fixture-five-1",
      start_year: 2023,
      year_count: 3,
      property_kind: "industrial_flex",
      size_band: "medium",
      schemes: ["unamortized_capital", "above_cap_billing", "fee_base_expansion", "bucket_migration", "kept_tax_refund"],
    },
  },
];

const { forge } = await import("../src/engine/forge.ts");
const { toReconPackage } = await import("../src/engine/render/recon-package.ts");
const { toScannerManifest } = await import("../src/engine/model/answer-key.ts");

const out = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_OUT;
mkdirSync(out, { recursive: true });

const json = (v) => JSON.stringify(v, null, 2) + "\n";
const written = [];

for (const fixture of FIXTURES) {
  const { model, answerKey, breaks } = forge(fixture.config);
  const pkg = toReconPackage(model);
  const manifest = toScannerManifest(answerKey);

  // A forged package whose ties do not match its schemes is not a fixture, it
  // is a bug being made permanent. Refuse rather than write it.
  const expectedBreaks = fixture.config.schemes.length === 0 ? 0 : breaks.length;
  if (fixture.config.schemes.length === 0 && breaks.length !== 0) {
    throw new Error(`${fixture.name}: a clean package broke ${breaks.length} tie(s): ${breaks.map((b) => b.tie).join(", ")}`);
  }
  if (fixture.config.schemes.length > 0 && expectedBreaks === 0) {
    throw new Error(`${fixture.name}: schemes were planted but every tie held`);
  }

  writeFileSync(join(out, `${fixture.name}.package.json`), json(pkg));
  writeFileSync(join(out, `${fixture.name}.manifest.json`), json(manifest));
  written.push({ ...fixture, id: manifest.package_id, findings: manifest.findings.length, documentOnly: manifest.document_only_findings });
}

writeFileSync(
  join(out, "README.md"),
  [
    "# Forged fixtures (do not hand-edit)",
    "",
    "Generated by `recon-foundry/tools/export-fixtures.mjs`. Each pair is one package",
    "and the truth about it: `*.package.json` is the ReconPackage the scanner reads,",
    "`*.manifest.json` is what should be found in it, in the scanner's own arithmetic.",
    "",
    "They exist to catch drift. Recon Foundry carries **copies** of several of this",
    "engine's rules in `src/engine/scanner-rules.ts` — the family forbids one app",
    "importing another — and when a check here changes without those copies",
    "following, `tests/foundry.test.ts` is what notices.",
    "",
    "To regenerate, from the `recon-foundry` repo:",
    "",
    "```",
    "npm run fixtures",
    "```",
    "",
    "A red `foundry.test.ts` is a question, not a chore: either the scanner changed on",
    "purpose and Foundry's copies are stale, or it changed by accident. Regenerating",
    "the fixtures to turn the test green answers neither.",
    "",
    "| Fixture | Package | Seed | Schemes | Manifest findings | Document-only |",
    "| --- | --- | --- | --- | --- | --- |",
    ...written.map(
      (w) =>
        `| \`${w.name}\` | ${w.id} | \`${w.config.seed}\` | ${w.config.schemes.length === 0 ? "none" : w.config.schemes.join(", ")} | ${w.findings} | ${w.documentOnly} |`,
    ),
    "",
    ...written.map((w) => `- **${w.name}** — ${w.note}`),
    "",
  ].join("\n"),
);

console.log(`Wrote ${written.length} fixture pair(s) to ${relative(process.cwd(), out) || out}`);
for (const w of written) {
  console.log(`  ${w.name.padEnd(14)} ${String(w.id).padEnd(16)} ${w.findings} manifest finding(s), ${w.documentOnly} document-only`);
}
