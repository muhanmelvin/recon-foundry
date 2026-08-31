/**
 * Capture the byte-regression fixture for the "describe your business" work.
 *
 *   node tools/capture-regression.mjs
 *
 * The two new `ScenarioConfig` knobs (`premises_sf`, `opex_psf_target`) are
 * optional, and the whole point of them being optional is that a config without
 * them forges exactly what it forged before. "Exactly" is a claim about bytes,
 * not about arithmetic, so this writes down the bytes: the ReconPackage JSON in
 * full, and a SHA-256 of the whole ZIP — which covers the workbooks, the prose
 * lease and the answer key, none of which the JSON contains.
 *
 * Run it before touching the engine. `tests/describe-regression.test.ts` reads
 * what it wrote and fails if a default forge ever moves.
 *
 * Node runs the TypeScript engine directly, the same way tools/export-fixtures.mjs
 * does: parameter properties in src/engine/rng.ts need the transform rather than
 * the strip, so re-exec with the flag if it is missing.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FLAG = "--experimental-transform-types";
if (!process.execArgv.includes(FLAG)) {
  const r = spawnSync(process.execPath, [FLAG, "--disable-warning=ExperimentalWarning", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "tests", "fixtures");

/**
 * The page's own default, copied from src/ui/main.ts `defaultConfig()`. Copied
 * rather than imported: this fixture pins what the default *was* when it was
 * captured, and an import would let a changed default quietly redefine the thing
 * the test is supposed to be holding still.
 */
const DEFAULT_CONFIG = {
  seed: "ashford-1",
  start_year: 2023,
  year_count: 3,
  property_kind: "retail_strip",
  size_band: "medium",
  schemes: ["above_cap_billing", "fee_base_expansion"],
};

/** One per property kind, clean and schemed, so the guard is not one lucky seed. */
const CONFIGS = [
  { name: "default", config: DEFAULT_CONFIG },
  { name: "clean-office", config: { seed: "regress-office-1", start_year: 2022, year_count: 2, property_kind: "office", size_band: "small", schemes: [] } },
  {
    name: "flex-all-five",
    config: {
      seed: "regress-flex-1",
      start_year: 2024,
      year_count: 3,
      property_kind: "industrial_flex",
      size_band: "large",
      schemes: ["unamortized_capital", "above_cap_billing", "fee_base_expansion", "bucket_migration", "kept_tax_refund"],
    },
  },
];

const { forge } = await import("../src/engine/forge.ts");
const { toReconPackage } = await import("../src/engine/render/recon-package.ts");
const { buildPackageZip } = await import("../src/engine/package/packager.ts");

mkdirSync(out, { recursive: true });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const index = [];

for (const { name, config } of CONFIGS) {
  const { model, answerKey } = forge(config);
  const pkg = JSON.stringify(toReconPackage(model), null, 2) + "\n";
  const zip = buildPackageZip(model, answerKey);

  writeFileSync(join(out, `${name}.package.json`), pkg);
  index.push({ name, config, package_sha256: sha256(pkg), zip_filename: zip.filename, zip_sha256: sha256(zip.bytes), zip_bytes: zip.bytes.length });
}

writeFileSync(join(out, "regression.json"), JSON.stringify({ note: "Captured before the describe-your-business work. Regenerate only on a deliberate change to forged output.", configs: index }, null, 2) + "\n");

console.log(`Wrote ${index.length} regression fixture(s) to tests/fixtures`);
for (const i of index) console.log(`  ${i.name.padEnd(14)} zip ${i.zip_bytes} bytes  ${i.zip_sha256.slice(0, 16)}…`);
