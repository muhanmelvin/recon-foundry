/**
 * Variants — the forms the backup documents take.
 *
 * One promise carries the whole feature, and almost every test here is a way of
 * asking it: **a variant changes how a figure is evidenced and never the
 * figure.** The county can run a July-to-June year, collect in quarters off last
 * year's levy, and reopen the roll with a supplemental, all at once, and the
 * property still bears exactly the tax it bore with none of them ticked — the
 * same Taxes line, the same tenant total, the same answer key.
 *
 * That is not a nicety. A checkbox that moved money would plant an overcharge
 * nobody planted, the answer key would be wrong about its own package, and a
 * trainee would find a finding that is really a rounding artefact. So the
 * figures are pinned against the same package forged without variants, tie by
 * tie and cent by cent.
 *
 * The second promise is the one `clauses` already makes: a config that says
 * nothing about variants forges the bytes it always forged.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { forge } from "../src/engine/forge.ts";
import { buildCleanModel } from "../src/engine/model/clean.ts";
import { validateScenarioConfig } from "../src/engine/model/bounds.ts";
import { buildPackageZip } from "../src/engine/package/packager.ts";
import { checkTies } from "../src/engine/model/ties.ts";
import { taxBorneIn, taxCreditsIn, billsServing, installmentsIn } from "../src/engine/model/tax.ts";
import { VARIANT_CATALOG, VARIANT_IDS, variantsFor, type VariantId } from "../src/engine/model/variants.ts";
import { renderInsuranceBackup, renderTaxBackup } from "../src/engine/render/documents.ts";
import type { ScenarioConfig, ScenarioModel } from "../src/engine/model/types.ts";

const BASE: ScenarioConfig = {
  seed: "variant-1",
  start_year: 2023,
  year_count: 3,
  property_kind: "retail_strip",
  size_band: "medium",
  schemes: [],
};

const TAX_IDS: VariantId[] = ["tax_fiscal_year", "tax_quarterly", "tax_supplemental"];
const INSURANCE_IDS: VariantId[] = ["insurance_itemized", "insurance_installments", "insurance_fees_quarterly"];

/** Every combination of a tab's variants, named for what it turns on. */
function combinationsOf(ids: VariantId[]): Array<[string, VariantId[]]> {
  const out: Array<[string, VariantId[]]> = [];
  for (let mask = 0; mask < 1 << ids.length; mask += 1) {
    const on = ids.filter((_, i) => mask & (1 << i));
    out.push([on.length === 0 ? "no variant" : on.join(" + "), on]);
  }
  return out;
}

const COMBINATIONS = combinationsOf(TAX_IDS);
const INSURANCE_COMBINATIONS = combinationsOf(INSURANCE_IDS);

const modelWith = (variants: VariantId[], over: Partial<ScenarioConfig> = {}): ScenarioModel =>
  buildCleanModel({ ...BASE, ...over, ...(variants.length > 0 ? { variants } : {}) });

const mulRate = (cents: number, rate: number): number => Math.round(cents * rate + 1e-9);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const taxPool = (model: ScenarioModel, year: number): number =>
  sum(model.years.find((y) => y.year === year)!.pools.filter((p) => p.section === "Taxes").map((p) => p.amount_cents));

// ---------------------------------------------------------------------------

describe("the catalog", () => {
  it("names distinct variants, and VARIANT_IDS is that list in catalog order", () => {
    expect(new Set(VARIANT_IDS).size).toBe(VARIANT_IDS.length);
    expect([...VARIANT_IDS]).toEqual(VARIANT_CATALOG.map((v) => v.id));
  });

  it("gives every variant a title and a line of its own, on a tab that offers it", () => {
    for (const v of VARIANT_CATALOG) {
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.hint.length).toBeGreaterThan(0);
      expect(variantsFor(v.tab).map((x) => x.id)).toContain(v.id);
    }
  });

  it("offers three forms beside each of the two backups it varies", () => {
    expect(variantsFor("tax").map((v) => v.id)).toEqual(TAX_IDS);
    expect(variantsFor("insurance").map((v) => v.id)).toEqual(INSURANCE_IDS);
  });
});

describe("a package that says nothing about variants is the package that was always forged", () => {
  const captured: Array<{ name: string; config: ScenarioConfig; zip_sha256: string; zip_bytes: number }> = JSON.parse(
    readFileSync(join(resolve(__dirname, "fixtures"), "regression.json"), "utf8"),
  ).configs;
  const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

  it.each(captured.map((c) => [c.name, c] as const))("%s forges its pinned bytes", (_name, c) => {
    expect("variants" in c.config, "the fixture would not be testing an absent key").toBe(false);
    const { model, answerKey } = forge(c.config);
    const zip = buildPackageZip(model, answerKey);
    expect(zip.bytes.length).toEqual(c.zip_bytes);
    expect(sha256(zip.bytes)).toEqual(c.zip_sha256);
  });

  /** As with `clauses`: an empty list is recorded in the answer key, so the ZIP
   * differs by a few bytes while every document is identical. */
  it.each(captured.map((c) => [c.name, c] as const))("%s forges the same documents from an empty list", (_name, c) => {
    const absent = forge(c.config);
    const empty = forge({ ...c.config, variants: [] as VariantId[] });
    for (const y of absent.model.years) {
      expect(renderTaxBackup(empty.model, y.year).bytes).toEqual(renderTaxBackup(absent.model, y.year).bytes);
    }
  });
});

describe("the paper changes and the figure does not", () => {
  const plain = modelWith([]);

  it.each(COMBINATIONS)("%s bills the same tax in every calendar year", (_name, variants) => {
    const model = modelWith(variants);
    for (const y of plain.years) {
      expect(taxPool(model, y.year), `Taxes line for ${y.year}`).toEqual(taxPool(plain, y.year));
    }
  });

  it.each(COMBINATIONS)("%s leaves the tenant owing what it always owed", (_name, variants) => {
    const model = modelWith(variants);
    for (const [k, y] of model.years.entries()) {
      expect(y.recon.pool_total_cents).toEqual(plain.years[k]!.recon.pool_total_cents);
      expect(y.recon.tenant_total_cents).toEqual(plain.years[k]!.recon.tenant_total_cents);
      expect(y.recon.balance_due_cents).toEqual(plain.years[k]!.recon.balance_due_cents);
    }
  });

  it.each(COMBINATIONS)("%s holds all seven ties", (_name, variants) => {
    expect(checkTies(modelWith(variants))).toEqual([]);
  });

  it.each(COMBINATIONS)("%s reproduces every bill from its own assessment", (_name, variants) => {
    const model = modelWith(variants);
    for (const parcel of model.tax_parcels) {
      for (const bill of parcel.years) {
        const levied = sum(bill.installments.map((i) => i.amount_cents));
        expect(levied, `parcel ${parcel.parcel_id}, ${bill.year} bill`).toEqual(mulRate(bill.assessed_value_cents, bill.rate_per_100 / 100));
        expect(bill.installments.length).toBeGreaterThan(0);
        for (const i of bill.installments) expect(i.amount_cents).toBeGreaterThan(0);
      }
    }
  });

  it.each(COMBINATIONS)("%s books in the ledger exactly what came due", (_name, variants) => {
    const model = modelWith(variants);
    for (const y of model.years) {
      const booked = sum(y.gl.filter((g) => g.category === "Real estate taxes").map((g) => g.amount_cents));
      expect(booked).toEqual(taxBorneIn(model.tax_parcels, y.year));
      expect(booked).toEqual(taxPool(model, y.year));
      for (const g of y.gl.filter((x) => x.category === "Real estate taxes")) {
        expect(g.date.slice(0, 4), "an instalment booked outside its own year").toEqual(String(y.year));
      }
    }
  });
});

describe("a July-to-June tax year", () => {
  const model = modelWith(["tax_fiscal_year"]);

  it("serves every calendar year with two bills", () => {
    for (const y of model.years) {
      for (const parcel of model.tax_parcels) {
        expect(billsServing(parcel, y.year), `parcel ${parcel.parcel_id} in ${y.year}`).toHaveLength(2);
      }
    }
  });

  it("issues one bill more than the package has years, each covering July to June", () => {
    for (const parcel of model.tax_parcels) {
      expect(parcel.years).toHaveLength(model.years.length + 1);
      for (const bill of parcel.years) {
        expect(bill.period!.start).toEqual(`${bill.year}-07-01`);
        expect(bill.period!.end).toEqual(`${bill.year + 1}-06-30`);
        expect(bill.period!.label).toEqual(`${bill.year}–${String((bill.year + 1) % 100)}`);
      }
    }
  });

  it("divides each bill somewhere near the middle, as a half-year should", () => {
    for (const parcel of model.tax_parcels) {
      for (const bill of parcel.years) {
        const total = sum(bill.installments.map((i) => i.amount_cents));
        const head = sum(bill.installments.filter((i) => i.due.startsWith(String(bill.year))).map((i) => i.amount_cents));
        expect(head / total, `${bill.year} bill on parcel ${parcel.parcel_id}`).toBeGreaterThan(0.3);
        expect(head / total).toBeLessThan(0.7);
      }
    }
  });
});

describe("quarterly collection", () => {
  const model = modelWith(["tax_quarterly"]);

  it("collects four instalments, the first two estimated", () => {
    for (const parcel of model.tax_parcels) {
      for (const bill of parcel.years) {
        expect(bill.installments).toHaveLength(4);
        expect(bill.installments.map((i) => i.basis)).toEqual(["preliminary", "preliminary", "actual", "actual"]);
        expect(bill.prior_levy_cents).toBeGreaterThan(0);
      }
    }
  });

  it("estimates each preliminary instalment at about a quarter of the bill", () => {
    for (const parcel of model.tax_parcels) {
      for (const bill of parcel.years) {
        const total = sum(bill.installments.map((i) => i.amount_cents));
        for (const i of bill.installments.filter((x) => x.basis === "preliminary")) {
          expect(i.amount_cents / total).toBeGreaterThan(0.15);
          expect(i.amount_cents / total).toBeLessThan(0.35);
        }
      }
    }
  });

  it("says on the bill what the estimate was taken from", () => {
    const page = renderTaxBackup(model, model.years[1]!.year).bytes as string;
    expect(page).toContain("Preliminary");
    expect(page).toContain("Less preliminary instalments already billed");
    expect(page).toContain("the assessment for this one not having been settled");
  });
});

describe("a supplemental bill", () => {
  const model = modelWith(["tax_supplemental"]);
  const supp = model.tax_parcels.flatMap((p) => p.years.filter((b) => b.supplemental));

  it("issues exactly one, on one parcel, and never in the first year", () => {
    expect(supp).toHaveLength(1);
    expect(supp[0]!.year).not.toEqual(model.years[0]!.year);
    expect(model.tax_parcels.filter((p) => p.years.some((b) => b.supplemental))).toHaveLength(1);
  });

  it("is carved out of the year rather than added to it", () => {
    const plain = modelWith([]);
    const year = supp[0]!.year;
    expect(taxPool(model, year)).toEqual(taxPool(plain, year));
    // The base bill really did come down: the supplemental is not free money.
    const parcel = model.tax_parcels.find((p) => p.years.some((b) => b.supplemental))!;
    const before = plain.tax_parcels.find((p) => p.parcel_id === parcel.parcel_id);
    if (before) {
      const base = parcel.years.find((b) => b.year === year && !b.supplemental)!;
      const was = before.years.find((b) => b.year === year)!;
      expect(base.assessed_value_cents).toBeLessThan(was.assessed_value_cents);
    }
  });

  it("bills an increase worth a few points of the year, with the reason on the page", () => {
    const year = supp[0]!.year;
    const share = sum(supp[0]!.installments.map((i) => i.amount_cents)) / taxPool(model, year);
    expect(share).toBeGreaterThan(0.02);
    expect(share).toBeLessThan(0.25);
    const page = renderTaxBackup(model, year).bytes as string;
    expect(page).toContain("Supplemental real property tax bill");
    expect(page).toContain("Reassessment following completion of improvements");
    expect(page).toContain("Increase in assessed value");
  });
});

describe("the collector's account still adds up", () => {
  it.each(COMBINATIONS)("%s prints every bill that served the year", (_name, variants) => {
    const model = modelWith(variants);
    const year = model.years[model.years.length - 1]!.year;
    const page = renderTaxBackup(model, year).bytes as string;
    for (const parcel of model.tax_parcels) {
      for (const bill of billsServing(parcel, year)) {
        expect(installmentsIn(bill, year).length).toBeGreaterThan(0);
      }
    }
    expect(page).toContain("Taxpayer account");
    // Where two bills served the year, the account shows which part of each did.
    const many = model.tax_parcels.some((p) => billsServing(p, year).length > 1);
    expect(page.includes(`What the property bore in ${year}`)).toBe(many);
  });
});

describe("a variant plants no finding", () => {
  it.each(COMBINATIONS)("%s keeps a clean package clean", (_name, variants) => {
    const { model, answerKey } = forge({ ...BASE, ...(variants.length > 0 ? { variants } : {}) });
    expect(checkTies(model)).toEqual([]);
    expect(model.planted).toEqual([]);
    expect(answerKey.findings).toEqual([]);
  });

  /** The kept refund still breaks T4 and only T4, whatever shape the bills are. */
  it.each(COMBINATIONS)("%s leaves the kept refund as the only seam", (_name, variants) => {
    const config = { ...BASE, schemes: ["kept_tax_refund" as const], ...(variants.length > 0 ? { variants } : {}) };
    const { model } = forge(config);
    const broken = checkTies(model);
    expect(new Set(broken.map((b) => b.tie))).toEqual(new Set(["T4"]));
    const year = model.years[model.years.length - 1]!.year;
    expect(taxCreditsIn(model.tax_parcels, year)).toBeGreaterThan(0);
  });
});

describe("the carrier bills its own way, and the premium is the premium", () => {
  const plain = modelWith([]);

  it.each(INSURANCE_COMBINATIONS)("%s bills the same insurance in every year", (_name, variants) => {
    const model = modelWith(variants);
    for (const [k, y] of model.years.entries()) {
      const line = sum(y.pools.filter((p) => p.section === "Insurance").map((p) => p.amount_cents));
      const was = sum(plain.years[k]!.pools.filter((p) => p.section === "Insurance").map((p) => p.amount_cents));
      expect(line, `Insurance line for ${y.year}`).toEqual(was);
      expect(y.recon.tenant_total_cents).toEqual(plain.years[k]!.recon.tenant_total_cents);
    }
  });

  it.each(INSURANCE_COMBINATIONS)("%s holds all seven ties", (_name, variants) => {
    expect(checkTies(modelWith(variants))).toEqual([]);
  });

  it.each(INSURANCE_COMBINATIONS)("%s books in the ledger exactly what the carrier charged", (_name, variants) => {
    const model = modelWith(variants);
    for (const [k, y] of model.years.entries()) {
      const py = model.insurance.years[k]!;
      const booked = sum(y.gl.filter((g) => g.category === "Property insurance").map((g) => g.amount_cents));
      expect(booked).toEqual(py.premium_cents + py.fees_cents);
      for (const g of y.gl.filter((x) => x.category === "Property insurance")) {
        expect(g.date.slice(0, 4), "a charge booked outside its own year").toEqual(String(y.year));
      }
    }
  });

  it.each(INSURANCE_COMBINATIONS)("%s adds up on the carrier's own invoice", (_name, variants) => {
    const model = modelWith(variants);
    for (const py of model.insurance.years) {
      if (py.lines) expect(sum(py.lines.map((l) => l.premium_cents))).toEqual(py.premium_cents);
      if (py.installments) expect(sum(py.installments.map((i) => i.amount_cents))).toEqual(py.premium_cents);
      if (py.fee_installments) expect(sum(py.fee_installments.map((f) => f.amount_cents))).toEqual(py.fees_cents);
      for (const i of py.installments ?? []) expect(i.amount_cents).toBeGreaterThan(0);
      for (const f of py.fee_installments ?? []) expect(f.amount_cents).toBeGreaterThan(0);
      for (const l of py.lines ?? []) expect(l.premium_cents).toBeGreaterThan(0);
    }
  });

  it("prices the programme coverage by coverage, and declares the layers it bought", () => {
    const model = modelWith(["insurance_itemized"]);
    const page = renderInsuranceBackup(model, model.years[0]!.year).bytes as string;
    expect(model.insurance.coverages.map((c) => c.coverage)).toContain("Umbrella liability — per occurrence");
    expect(model.insurance.coverages.map((c) => c.coverage)).toContain("Terrorism (TRIA) — property and liability");
    expect(page).toContain("Terrorism (TRIA) — annual premium");
    expect(page).toContain("Total annual premium");
  });

  it("finances the premium from the policy's own inception, inside the year", () => {
    const model = modelWith(["insurance_installments"]);
    const start = model.insurance.period_start_month;
    for (const py of model.insurance.years) {
      expect(py.installments![0]!.label).toBe("Down payment");
      expect(py.installments![0]!.due.slice(5, 7)).toEqual(String(start).padStart(2, "0"));
      expect(py.installments).toHaveLength(13 - start);
      const down = py.installments![0]!.amount_cents / py.premium_cents;
      expect(down).toBeGreaterThan(0.15);
      expect(down).toBeLessThan(0.35);
    }
    const page = renderInsuranceBackup(model, model.years[0]!.year).bytes as string;
    expect(page).toContain("Payment schedule");
    expect(page).toContain("The premium is financed over the policy year");
  });

  it("collects the fees quarterly, never before the policy incepts", () => {
    const model = modelWith(["insurance_fees_quarterly"]);
    const start = model.insurance.period_start_month;
    const expected = [3, 6, 9, 12].map((m, i) => ({ m, label: `Q${i + 1} fees` })).filter((q) => q.m >= start);
    for (const py of model.insurance.years) {
      expect(py.fee_installments).toHaveLength(expected.length);
      expect(py.fee_installments!.map((f) => f.label)).toEqual(expected.map((q) => q.label));
      for (const f of py.fee_installments!) expect(Number(f.due.slice(5, 7))).toBeGreaterThanOrEqual(start);
    }
    expect(renderInsuranceBackup(model, model.years[0]!.year).bytes as string).toContain("Fee schedule");
  });

  it.each(INSURANCE_COMBINATIONS)("%s charges nothing before the policy incepts", (_name, variants) => {
    const model = modelWith(variants);
    const start = model.insurance.period_start_month;
    for (const py of model.insurance.years) {
      for (const c of [...(py.installments ?? []), ...(py.fee_installments ?? [])]) {
        expect(Number(c.due.slice(5, 7)), `${c.label} in ${py.year}`).toBeGreaterThanOrEqual(start);
      }
    }
  });

  it.each(INSURANCE_COMBINATIONS)("%s forges the same insurance backup from an empty list", (_name, _v) => {
    const absent = modelWith([]);
    const empty = buildCleanModel({ ...BASE, variants: [] });
    for (const y of absent.years) {
      expect(renderInsuranceBackup(empty, y.year).bytes).toEqual(renderInsuranceBackup(absent, y.year).bytes);
    }
  });
});

describe("every form at once", () => {
  it("changes both backups and neither figure", () => {
    const plain = modelWith([]);
    const all = modelWith([...VARIANT_IDS]);
    expect(checkTies(all)).toEqual([]);
    for (const [k, y] of all.years.entries()) {
      expect(y.recon.pool_total_cents).toEqual(plain.years[k]!.recon.pool_total_cents);
      expect(y.recon.tenant_total_cents).toEqual(plain.years[k]!.recon.tenant_total_cents);
    }
    const year = all.years[all.years.length - 1]!.year;
    expect(renderTaxBackup(all, year).bytes).not.toEqual(renderTaxBackup(plain, year).bytes);
    expect(renderInsuranceBackup(all, year).bytes).not.toEqual(renderInsuranceBackup(plain, year).bytes);
  });
});

describe("the engine is the gate", () => {
  it("refuses a form it does not have", () => {
    const errors = validateScenarioConfig({ ...BASE, variants: ["tax_biennial" as VariantId] });
    expect(errors.join(" ")).toContain("no backup form is called");
  });

  it("refuses the same form twice", () => {
    const errors = validateScenarioConfig({ ...BASE, variants: ["tax_quarterly", "tax_quarterly"] });
    expect(errors.join(" ")).toContain("listed more than once");
  });

  it("accepts every form the catalog offers, together", () => {
    expect(validateScenarioConfig({ ...BASE, variants: [...VARIANT_IDS] })).toEqual([]);
  });
});
