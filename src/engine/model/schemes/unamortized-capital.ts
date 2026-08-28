/**
 * Capital expensed in a lump — the most common finding in the business, and the
 * one that pays best.
 *
 * The landlord resurfaces the lot for a hundred and forty thousand dollars and
 * puts the whole hundred and forty thousand into this year's operating expenses.
 * The lease says an item over the capital threshold is capitalized and recovered
 * over its useful life, so only one year's instalment belongs in the year.
 *
 * **The cover.** Nothing is hidden. The general ledger carries the contractor's
 * invoices and adds to the line exactly. The contractor's own invoice is in the
 * package, describing the work. The statement foots, the tenant's share is right,
 * the balance due follows. The landlord is not concealing the spend — it is
 * classifying it, and the classification is what the lease forbids.
 *
 * **The seam.** T7, the lease. Nothing else moves, which is precisely why the
 * trainee has to read §6.04 rather than add up columns.
 *
 * The line is placed outside the capped pool, which is realistic — a landlord
 * putting a large one-off through the statement does not usually also let it eat
 * its own cap headroom — and keeps this scheme from accidentally breaching the
 * cap and producing a finding that belongs to a different lesson.
 */

import type { Rng } from "../../rng.ts";
import { allocate, mulRate } from "../recompute.ts";
import { iso } from "../../dates.ts";
import { isRoundPoolAmount, looksCapital } from "../../scanner-rules.ts";
import type { CapitalProject, GLEntry, ScenarioModel } from "../types.ts";
import type { SchemeResult } from "./index.ts";

const ASSETS: Record<string, Array<{ name: string; type: string }>> = {
  retail_strip: [
    { name: "Parking lot resurfacing — east field", type: "Sitework" },
    { name: "Roof replacement — Building 500", type: "Roof" },
    { name: "Sealcoating and restriping — main lot", type: "Sitework" },
  ],
  office: [
    { name: "HVAC rooftop unit replacement", type: "HVAC" },
    { name: "Roof replacement — south elevation", type: "Roof" },
    { name: "Chiller replacement — plant 2", type: "HVAC" },
  ],
  industrial_flex: [
    { name: "Truck court repaving", type: "Sitework" },
    { name: "Roof replacement — Building C", type: "Roof" },
    { name: "Parking lot resurfacing — trailer yard", type: "Sitework" },
  ],
};

export function plantUnamortizedCapital(model: ScenarioModel, rng: Rng): SchemeResult {
  // The last year, so the trainee sees the swing against a settled prior year.
  const year = model.years[model.years.length - 1]!;
  const asset = rng.child("asset").pick(ASSETS[model.config.property_kind]!);

  let cost = rng.child("cost").int(95_000, 180_000) * 100 + rng.child("cents").int(1, 99);
  while (isRoundPoolAmount(cost)) cost += 137;
  if (!looksCapital(asset.name)) throw new Error(`the scheme's own label does not read as capital work: ${asset.name}`);

  const inService = iso(year.year, rng.child("month").int(4, 9), rng.child("day").int(2, 27));

  const project: CapitalProject = {
    id: "CP-EXPENSED",
    asset_name: asset.name,
    asset_type: asset.type,
    job_number: `J-${year.year}-${rng.child("job").int(100, 899)}`,
    total_cost_cents: cost,
    recovery_period_months: model.lease.capital_life_years * 12,
    interest_rate_pct: 0,
    amort_start: inService,
    amort_end: inService,
    monthly_cents: Math.round(cost / (model.lease.capital_life_years * 12)),
    contractor: model.universe.vendors["contractor"] ?? "Halloway Construction Group",
    statement_caption: asset.name,
    // The whole point: it never reaches the amortization schedule.
    amortized: false,
  };
  model.capital_projects.push(project);

  // One line, captioned with the work, billed in full, outside the capped pool.
  year.pools.push({
    category: asset.name,
    section: "CAM",
    bucket: "non_controllable",
    amount_cents: cost,
    outside_fee_base: true,
    trade: "capital-expensed",
  });

  // The invoices are real and they add up. Two to four progress payments, the
  // way a job of this size is actually billed.
  const draws = rng.child("draws").int(2, 4);
  const parts = allocate(cost, Array.from({ length: draws }, (_, i) => rng.child("draw/" + i).float(0.7, 1.3)));
  const entries: GLEntry[] = parts.map((amount, i) => ({
    year: year.year,
    date: iso(year.year, Math.min(12, Number(inService.slice(5, 7)) + i), rng.child("date/" + i).int(3, 26)),
    account: model.universe.gl_accounts["Amortization"] ?? "6950",
    category: asset.name,
    vendor: project.contractor,
    memo: `${asset.name} (job ${project.job_number}) — payment ${i + 1} of ${draws}`,
    amount_cents: amount,
  }));
  year.gl.push(...entries);
  year.gl.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.category < b.category ? -1 : 1));

  const shareFrac = model.lease.share_pct / 100;
  const firstInstalment = Math.round(cost / model.lease.capital_life_years);
  const excessTenant = mulRate(cost - firstInstalment, shareFrac);

  return {
    planted: {
      id: "unamortized_capital",
      seams: ["T7"],
      findings: [
        {
          scheme: "unamortized_capital",
          check_id: "RF-09",
          year: year.year,
          category: asset.name,
          severity: "review",
          seam: `${asset.name} is billed in full in ${year.year}; §6.04 requires an item over ${model.lease.capital_threshold_cents / 100} dollars to be amortized over ${model.lease.capital_life_years} years, so only the first instalment belongs in the year.`,
          evidence: [
            `Reconciliation summary, line "${asset.name}"`,
            `General ledger detail — ${draws} progress payments to ${project.contractor}`,
            `Contractor's invoice, job ${project.job_number}`,
            "Amortization schedule — the project is not on it",
            "Lease §6.04 Capital Items and Amortization",
          ],
          note: `Billed ${cost / 100}; one instalment at the lease's ${model.lease.capital_life_years}-year life is ${firstInstalment / 100}.`,
          cofires: ["RF-02"],
        },
      ],
    },
  };
}
