/**
 * What leaves the browser: the ReconPackage the scanner reads, and the ZIP a
 * trainer hands out.
 *
 * The schema check is the contract between two apps in the family. It is
 * validated against a *copy* of the scanner's own schema, which is the point —
 * if the scanner's shape moves and this copy does not, the fixture test in that
 * repo is where it surfaces, deliberately, rather than here by accident.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { forge } from "../src/engine/forge.ts";
import { toReconPackage } from "../src/engine/render/recon-package.ts";
import { aboutText, buildPackageZip, packageContents } from "../src/engine/package/packager.ts";
import { ANSWER_KEY_FOLDER } from "../src/engine/package/filenames.ts";
import { SCHEME_ORDER, type ScenarioConfig } from "../src/engine/model/types.ts";
import { readZip } from "./helpers/read-xlsx.ts";
import { GOLDEN_CONFIGS, sweep } from "./helpers/sweep.ts";

/**
 * `multipleOfPrecision: 6` matches how the scanner validates its own data, and
 * it is not a fudge. JSON has one number type and 27,714.87 has no exact double;
 * a strict `multipleOf: 0.01` rejects most real money. The scanner's own
 * committed packages fail without this option too.
 */
const ajv = new Ajv({ allErrors: true, strict: false, multipleOfPrecision: 6 });
const validate = ajv.compile(JSON.parse(readFileSync(resolve(__dirname, "../schema/recon-package.schema.json"), "utf8")));

const CONFIGS: ScenarioConfig[] = [
  ...sweep().slice(0, 9),
  ...sweep().slice(0, 6).map((c) => ({ ...c, schemes: [...SCHEME_ORDER] })),
  ...sweep().slice(0, 3).map((c) => ({ ...c, schemes: ["above_cap_billing" as const, "bucket_migration" as const] })),
];

describe("the exported package is the shape the scanner reads", () => {
  it.each(CONFIGS.map((c) => [`${c.seed} [${c.schemes.join(",") || "clean"}]`, c] as const))("%s validates", (_label, config) => {
    const pkg = toReconPackage(forge(config).model);
    const ok = validate(pkg);
    expect(ok, JSON.stringify(validate.errors?.slice(0, 3))).toBe(true);
  });

  it("shows the tenant allocation in total, not per line, when a cap is computed", () => {
    // With a cap, the tenant is charged the pool figure from the cap
    // computation, not the sum of the lines — so a per-line tenant column would
    // not add to the tenant total. Real statements present it the same way, and
    // so does the scanner's own committed data.
    const pkg = toReconPackage(forge(GOLDEN_CONFIGS[0]!).model) as {
      years: Array<{ cap_summary?: unknown; lines: Array<{ tenant_amount?: number }> }>;
    };
    for (const y of pkg.years) {
      expect(y.cap_summary).toBeDefined();
      expect(y.lines.every((l) => l.tenant_amount === undefined)).toBe(true);
    }
  });

  it("carries an amortization block only where the landlord actually amortized", () => {
    const config = { ...GOLDEN_CONFIGS[0]!, schemes: ["unamortized_capital" as const] };
    const { model } = forge(config);
    const pkg = toReconPackage(model) as { years: Array<{ year: number; lines: Array<{ label: string; capital?: unknown }> }> };
    const expensed = model.capital_projects.find((c) => !c.amortized)!;
    const last = pkg.years[pkg.years.length - 1]!;
    const lump = last.lines.find((l) => l.label === expensed.statement_caption)!;
    // The whole finding rests on this absence.
    expect(lump.capital).toBeUndefined();
    expect(last.lines.some((l) => l.capital !== undefined)).toBe(true);
  });

  it("tells the reader in one line what was done to the package", () => {
    const clean = toReconPackage(forge(GOLDEN_CONFIGS[0]!).model) as { meta: { story: string } };
    expect(clean.meta.story).toContain("clean");
    const dirty = toReconPackage(forge({ ...GOLDEN_CONFIGS[0]!, schemes: ["kept_tax_refund"] }).model) as { meta: { story: string } };
    expect(dirty.meta.story).toContain("tax refund kept");
  });
});

describe("the ZIP is the package a trainer hands out", () => {
  const config = { ...GOLDEN_CONFIGS[0]!, schemes: [...SCHEME_ORDER] };
  const { model, answerKey } = forge(config);
  const zip = buildPackageZip(model, answerKey);
  const entries = readZip(zip.bytes).map((e) => e.path);

  it("puts each year's documents in that year's folder", () => {
    for (const y of model.years) {
      const folder = `${model.universe.site_code}_${y.year} OPEX RECON/`;
      const inYear = entries.filter((p) => p.startsWith(folder));
      expect(inYear.length, folder).toBeGreaterThanOrEqual(6);
      expect(inYear.some((p) => p.includes("Recon Workbook"))).toBe(true);
      expect(inYear.some((p) => p.includes("Billing Statement"))).toBe(true);
      expect(inYear.some((p) => p.includes("RE Tax Backup"))).toBe(true);
      expect(inYear.some((p) => p.includes("Insurance Backup"))).toBe(true);
      expect(inYear.some((p) => p.includes("Amortization Schedule"))).toBe(true);
    }
  });

  it("keeps the lease and the tenant's account at the root, where they belong", () => {
    expect(entries.some((p) => !p.includes("/") && p.includes("_Lease_"))).toBe(true);
    expect(entries.some((p) => !p.includes("/") && p.includes("_Tenant Ledger_"))).toBe(true);
  });

  it("segregates the answer key into one deletable folder", () => {
    const keyFiles = entries.filter((p) => p.startsWith(ANSWER_KEY_FOLDER + "/"));
    expect(keyFiles.length).toBe(4);
    expect(keyFiles.some((p) => p.includes("Answer Key") && p.endsWith(".html"))).toBe(true);
    expect(keyFiles.some((p) => p.includes("Answer Key") && p.endsWith(".json"))).toBe(true);
    expect(keyFiles.some((p) => p.includes("Findings Manifest"))).toBe(true);
    expect(keyFiles.some((p) => p.includes("Recon Package"))).toBe(true);
    // Nothing outside that folder gives the exercise away.
    const outside = entries.filter((p) => !p.startsWith(ANSWER_KEY_FOLDER + "/"));
    expect(outside.some((p) => /answer|manifest/i.test(p))).toBe(false);
  });

  it("explains itself to whoever opens it without context", () => {
    const about = aboutText(model, answerKey);
    expect(entries).toContain("_ABOUT THIS PACKAGE.txt");
    expect(about).toContain("State of Franklin");
    expect(about).toContain(answerKey.seed);
    expect(about).toContain("DELETE THAT FOLDER");
    expect(about).toContain(model.universe.address.zip);
  });

  it("names the archive after the site and the years it covers", () => {
    expect(zip.filename).toMatch(/^[A-Z]{2,3}\d_\d{4}-\d{4} OPEX RECON PACKAGE\.zip$/);
  });

  it("has an answer sheet that says which findings a scanner would miss", () => {
    const { entries: contents } = packageContents(model, answerKey);
    const sheet = contents.find((e) => e.artifact.title === "Answer key")!.artifact.bytes as string;
    expect(sheet).toContain("Only the paper catches this");
    expect(sheet).toContain("The scanner catches this");
    expect(sheet).toContain(answerKey.seed);
    expect(sheet).toContain("Delete this folder");
  });

  it("packs the same bytes from the same seed", () => {
    const again = forge(config);
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);
    expect(sha(buildPackageZip(again.model, again.answerKey).bytes)).toBe(sha(zip.bytes));
  });
});
