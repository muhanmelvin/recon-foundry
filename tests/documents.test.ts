/**
 * The paper documents, checked for the two things that make them worth having.
 *
 * *Do they agree with the workbook?* An auditor's whole method is to put two
 * documents side by side; if the statement and the workbook were allowed to
 * drift, the exercise would teach a false lesson. So the figures the statement
 * prints, the totals on the tax bills, and the premium on the invoice are all
 * checked against the model they came from.
 *
 * *Are they self-contained and inert?* A page pulled out of the ZIP and opened
 * offline has to look right with nothing else on the machine — so the stylesheet
 * is inlined, nothing is loaded from a host, and there is no script in any of
 * them. A training document that runs code is a strange object to hand somebody.
 */

import { describe, expect, it } from "vitest";
import { buildCleanModel } from "../src/engine/model/clean.ts";
import {
  renderBillingStatement,
  renderInsuranceBackup,
  renderLease,
  renderProjectBackup,
  renderTaxBackup,
} from "../src/engine/render/documents.ts";
import { buildLeaseDoc, sectionsOf } from "../src/engine/render/lease/doc.ts";
import { ARTICLES } from "../src/engine/render/lease/sections.ts";
import { SYNTHETIC_NOTICE } from "../src/engine/render/artifact.ts";
import { esc, usd } from "../src/engine/render/html.ts";
import type { Artifact } from "../src/engine/render/artifact.ts";
import type { ScenarioModel } from "../src/engine/model/types.ts";
import { GOLDEN_CONFIGS, sweep } from "./helpers/sweep.ts";

const MODELS = sweep().slice(0, 9).map((c) => [c.seed, buildCleanModel(c)] as const);
const MODEL = buildCleanModel(GOLDEN_CONFIGS[0]!);
const YEAR = MODEL.years[MODEL.years.length - 1]!;

function allDocuments(model: ScenarioModel, year: number): Artifact[] {
  const out = [renderBillingStatement(model, year), renderTaxBackup(model, year), renderInsuranceBackup(model, year), renderLease(model)];
  const backup = renderProjectBackup(model, year);
  if (backup) out.push(backup);
  return out;
}

describe("every page stands on its own", () => {
  const docs = allDocuments(MODEL, YEAR.year);

  it.each(docs.map((d) => [d.title, d] as const))("%s is a complete file with its styles inside it", (_t, doc) => {
    const html = doc.bytes as string;
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("@page");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it.each(docs.map((d) => [d.title, d] as const))("%s loads nothing from anywhere else and runs no script", (_t, doc) => {
    const html = doc.bytes as string;
    expect(/<script/i.test(html)).toBe(false);
    expect(/\b(?:src|href)\s*=\s*"https?:\/\//i.test(html)).toBe(false);
    expect(/<link\b/i.test(html)).toBe(false);
  });

  it.each(docs.map((d) => [d.title, d] as const))("%s says it is synthetic", (_t, doc) => {
    expect(doc.bytes as string).toContain(SYNTHETIC_NOTICE);
  });

  it("stands in a state that does not exist", () => {
    for (const doc of docs) {
      const html = doc.bytes as string;
      expect(html).toMatch(/\b(Franklin|FK)\b/);
      expect(html).toMatch(/\b000\d\d\b/);
    }
  });
});

describe("the statement is the workbook, in prose", () => {
  it.each(MODELS)("%s prints the figures the reconciliation computed", (_seed, model) => {
    for (const y of model.years) {
      const html = renderBillingStatement(model, y.year).bytes as string;
      expect(html).toContain(usd(y.recon.billed_pool_cents));
      expect(html).toContain(usd(y.recon.tenant_total_cents));
      expect(html).toContain(usd(y.recon.estimates_paid_cents));
      expect(html).toContain(usd(Math.abs(y.recon.balance_due_cents)));
      for (const p of y.pools) expect(html, p.category).toContain(usd(p.amount_cents));
    }
  });

  it.each(MODELS)("%s calls the balance a credit when the tenant overpaid", (_seed, model) => {
    for (const y of model.years) {
      const html = renderBillingStatement(model, y.year).bytes as string;
      expect(html).toContain(y.recon.balance_due_cents >= 0 ? "Balance due" : "Credit due Tenant");
    }
  });
});

describe("the tax backup adds to the tax line, and shows what came back", () => {
  it.each(MODELS)("%s prints each parcel's levy and the collector's net", (_seed, model) => {
    for (const y of model.years) {
      const html = renderTaxBackup(model, y.year).bytes as string;
      let charged = 0;
      let credited = 0;
      for (const parcel of model.tax_parcels) {
        const py = parcel.years.find((x) => x.year === y.year)!;
        const levy = py.installments.reduce((s, i) => s + i.amount_cents, 0);
        charged += levy;
        credited += py.credit?.amount_cents ?? 0;
        expect(html).toContain(parcel.parcel_id);
        expect(html).toContain(usd(py.assessed_value_cents));
        expect(html).toContain(usd(levy));
      }
      // The net the county actually took is what the recon line must equal.
      expect(html).toContain(usd(charged - credited));
      const retLine = y.pools.find((p) => p.section === "Taxes")!;
      expect(charged - credited).toBe(retLine.amount_cents);
    }
  });
});

describe("the insurance backup is the premium plus the fees on the declaration page", () => {
  it.each(MODELS)("%s invoices what the reconciliation bills", (_seed, model) => {
    for (const y of model.years) {
      const html = renderInsuranceBackup(model, y.year).bytes as string;
      const py = model.insurance.years.find((x) => x.year === y.year)!;
      const insLine = y.pools.find((p) => p.section === "Insurance")!;
      expect(html).toContain(usd(py.premium_cents));
      expect(html).toContain(usd(py.fees_cents));
      expect(html).toContain(usd(py.premium_cents + py.fees_cents));
      expect(py.premium_cents + py.fees_cents).toBe(insLine.amount_cents);
      expect(html).toContain(model.insurance.policy_number);
    }
  });
});

describe("the contractor's invoice explains the amortization line", () => {
  it.each(MODELS)("%s shows the contract sum and this year's instalment", (_seed, model) => {
    const year = model.years[model.years.length - 1]!;
    const backup = renderProjectBackup(model, year.year)!;
    const html = backup.bytes as string;
    const project = model.capital_projects[0]!;
    const line = year.pools.find((p) => p.capital_project_id === project.id)!;
    expect(html).toContain(esc(project.asset_name));
    expect(html).toContain(project.job_number);
    expect(html).toContain(usd(project.total_cost_cents));
    expect(html).toContain(usd(line.amount_cents));
  });
});

describe("the lease", () => {
  it("keeps the scanner's article and section numbering, exactly", () => {
    // A finding cites §6.02 and an answer key cites §6.02; a trainee comparing
    // them has to be reading the same clause. This is a cross-repo contract.
    const doc = buildLeaseDoc(MODEL);
    expect(doc.articles.map((a) => a.numeral)).toEqual(ARTICLES.map((a) => a.numeral));
    expect(sectionsOf(doc).map((s) => s.ref)).toEqual(ARTICLES.flatMap((a) => a.sections.map((s) => s.ref)));
  });

  it.each(MODELS)("%s writes every clause the model has terms for", (_seed, model) => {
    const doc = buildLeaseDoc(model);
    for (const s of sectionsOf(doc)) {
      expect(s.paragraphs.length, `§${s.ref} is empty`).toBeGreaterThan(0);
      for (const p of s.paragraphs) expect(p.length).toBeGreaterThan(20);
    }
  });

  it.each(MODELS)("%s states the same terms in the lease as in the abstract", (_seed, model) => {
    const doc = buildLeaseDoc(model);
    const byRef = (ref: string) => sectionsOf(doc).find((s) => s.ref === ref)!.paragraphs.join(" ");
    expect(byRef("4.01")).toContain(model.lease.premises_sf.toLocaleString("en-US"));
    expect(byRef("4.01")).toContain(model.lease.denominator_sf.toLocaleString("en-US"));
    expect(byRef("4.01")).toContain(`${model.lease.share_pct}%`);
    expect(byRef("6.02")).toContain(usd(model.lease.cap!.base_year_amount_cents));
    expect(byRef("6.02")).toContain(String(model.lease.cap!.base_year));
    expect(byRef("6.03")).toContain(`${model.lease.fee.rate_pct}%`);
    expect(byRef("6.03")).toContain("Common Area Maintenance costs only");
    expect(byRef("6.04")).toContain(usd(model.lease.capital_threshold_cents));
  });

  it.each(MODELS)("%s names nobody from another app's lease", (_seed, model) => {
    const html = renderLease(model).bytes as string;
    expect(html).not.toContain("MAPLEWOOD");
    expect(html).toContain(model.lease.landlord);
    expect(html).toContain(model.lease.tenant);
  });
});

describe("the same seed renders the same pages", () => {
  it("produces identical documents on a second build", () => {
    const again = buildCleanModel(GOLDEN_CONFIGS[0]!);
    const a = allDocuments(MODEL, YEAR.year).map((d) => d.bytes as string);
    const b = allDocuments(again, YEAR.year).map((d) => d.bytes as string);
    expect(b).toEqual(a);
  });
});
