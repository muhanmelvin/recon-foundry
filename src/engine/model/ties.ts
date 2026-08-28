/**
 * The seven ties — the definition of "this package is consistent".
 *
 * A reconciliation package is not one document, it is seven or eight that have
 * to agree with each other. Auditors do not find overcharges by reading a
 * statement; they find them by putting two documents side by side and noticing
 * that one does not reproduce from the other. So the ties are the product, not
 * a test detail: they are what a forged package is *for*, and the panel in the
 * UI that ticks all seven green is showing the user the thing they are meant to
 * learn to check.
 *
 * All seven are exact to the cent. There are no tolerances here because there
 * is no measurement error: the model controls every rounding site, so a
 * one-cent difference is a bug, not noise. (The scanner, reading a package it
 * did not author, quite rightly allows a dollar.)
 *
 * `checkTies` is pure, and a scheme's contract is stated in its terms: it names
 * the ties it breaks, and every tie it does not name must still hold.
 */

import type { ScenarioModel, TieId } from "./types.ts";
import { amortizationForYear, looksCapital } from "../scanner-rules.ts";
import { monthIndex, parseIso } from "../dates.ts";

export interface TieBreak {
  tie: TieId;
  year: number;
  category?: string;
  /** What the second document says, minus what the first says. */
  delta_cents: number;
  detail: string;
}

export const TIE_TITLES: Readonly<Record<TieId, string>> = Object.freeze({
  T1: "General ledger → reconciliation",
  T2: "Reconciliation → billing statement",
  T3: "Tenant ledger → payment history",
  T4: "Tax bills → real estate tax line",
  T5: "Insurance invoice → insurance line",
  T6: "Amortization schedule → capital line",
  T7: "Lease → the arithmetic",
});

export const TIE_STATEMENTS: Readonly<Record<TieId, string>> = Object.freeze({
  T1: "Every category's invoices in the general ledger add up to the amount the reconciliation bills for it.",
  T2: "The statement's totals, share and balance due are the reconciliation's, figure for figure.",
  T3: "The estimates charged on the tenant's account are the estimates the reconciliation credits, and the running balance adds.",
  T4: "The parcels' tax installments, net of any credit the backup shows, are the real-estate-tax line.",
  T5: "The premium and the fees on the declaration page are the insurance line.",
  T6: "The amortization schedule's total for the year is the capital line, and the schedule's own arithmetic works.",
  T7: "Recomputing from the lease — share, fee base, cap ceiling, amortization — reproduces what was billed.",
});

function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

function mulRate(cents: number, rate: number): number {
  const sign = cents < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(cents) * rate + 1e-9);
}

export function checkTies(model: ScenarioModel): TieBreak[] {
  const out: TieBreak[] = [];
  const push = (tie: TieId, year: number, delta: number, detail: string, category?: string) => {
    if (delta !== 0) out.push({ tie, year, delta_cents: delta, detail, ...(category ? { category } : {}) });
  };

  const shareFrac = model.lease.share_pct / 100;

  for (const y of model.years) {
    // --- T1: the general ledger adds to the reconciliation ------------------
    const glByCategory = new Map<string, number>();
    for (const g of y.gl) glByCategory.set(g.category, (glByCategory.get(g.category) ?? 0) + g.amount_cents);
    for (const pool of y.pools) {
      const booked = glByCategory.get(pool.category) ?? 0;
      push("T1", y.year, booked - pool.amount_cents, `general ledger books ${cents(booked)} against a billed ${cents(pool.amount_cents)}`, pool.category);
    }
    for (const [category, booked] of glByCategory) {
      if (!y.pools.some((p) => p.category === category)) {
        push("T1", y.year, booked, `${cents(booked)} sits in the general ledger under a caption the reconciliation never bills`, category);
      }
    }

    // --- T2: the statement is the reconciliation ---------------------------
    const r = y.recon;
    push("T2", y.year, sum(y.pools.map((p) => p.amount_cents)) - r.pool_total_cents, "the statement's property-level total is not the sum of its own lines");
    const nonControllable = r.pool_total_cents - r.controllable_actual_cents;
    push("T2", y.year, nonControllable + r.cap_billed_cents - r.billed_pool_cents, "the billed pool is not the uncapped lines plus the capped pool as billed");
    push("T2", y.year, mulRate(r.billed_pool_cents, shareFrac) - r.tenant_total_cents, "the tenant total is not the billed pool at the tenant's share");
    push("T2", y.year, r.tenant_total_cents - r.estimates_paid_cents - r.balance_due_cents, "the balance due is not the tenant total less the estimates paid");

    // --- T4: the tax backup adds to the tax line ---------------------------
    const retLine = y.pools.find((p) => p.section === "Taxes");
    if (retLine) {
      let billedByCounty = 0;
      let credits = 0;
      for (const parcel of model.tax_parcels) {
        const py = parcel.years.find((x) => x.year === y.year);
        if (!py) continue;
        billedByCounty += sum(py.installments.map((i) => i.amount_cents));
        if (py.credit) credits += py.credit.amount_cents;
        const recomputed = mulRate(py.assessed_value_cents, py.rate_per_100 / 100);
        const levied = sum(py.installments.map((i) => i.amount_cents));
        push("T4", y.year, levied - recomputed, `parcel ${parcel.parcel_id}: assessed value at the county's rate is ${cents(recomputed)}, the bill totals ${cents(levied)}`, retLine.category);
      }
      push("T4", y.year, billedByCounty - credits - retLine.amount_cents, `the tax backup nets to ${cents(billedByCounty - credits)} and the reconciliation bills ${cents(retLine.amount_cents)}`, retLine.category);
    }

    // --- T5: the insurance backup adds to the insurance line ---------------
    const insLine = y.pools.find((p) => p.section === "Insurance");
    const policyYear = model.insurance.years.find((x) => x.year === y.year);
    if (insLine && policyYear) {
      push("T5", y.year, policyYear.premium_cents + policyYear.fees_cents - insLine.amount_cents, `the carrier's invoice totals ${cents(policyYear.premium_cents + policyYear.fees_cents)} and the reconciliation bills ${cents(insLine.amount_cents)}`, insLine.category);
    }

    // --- T6: the amortization schedule adds to the capital line ------------
    for (const pool of y.pools) {
      if (!pool.capital_project_id) continue;
      const project = model.capital_projects.find((p) => p.id === pool.capital_project_id);
      if (!project) {
        push("T6", y.year, pool.amount_cents, "the reconciliation bills an amortization line for a project the schedule does not carry", pool.category);
        continue;
      }
      const sched = amortizationForYear(project.total_cost_cents, project.recovery_period_months, project.amort_start, y.year, project.interest_rate_pct);
      push("T6", y.year, sched.total - pool.amount_cents, `${sched.months} month(s) of principal (${cents(sched.principal)}) plus interest (${cents(sched.interest)}) is ${cents(sched.total)}, the reconciliation bills ${cents(pool.amount_cents)}`, pool.category);
      push("T6", y.year, project.monthly_cents * project.recovery_period_months - project.total_cost_cents, `the schedule's monthly principal over ${project.recovery_period_months} months does not recover the ${cents(project.total_cost_cents)} project cost`, pool.category);
    }

    // --- T7: the lease reproduces the arithmetic ---------------------------
    const recomputedShare = Math.round((model.lease.premises_sf / y.denominator_sf) * 100 * 10_000) / 10_000;
    push("T7", y.year, Math.round((recomputedShare - model.lease.share_pct) * 10_000), `${model.lease.premises_sf} sf ÷ ${y.denominator_sf} sf is ${recomputedShare}%, the statement bills ${model.lease.share_pct}%`);

    const permittedBase = feeBaseCents(y.pools, model.lease.fee.base);
    const feeLine = y.pools.find((p) => p.is_fee);
    if (feeLine) {
      push("T7", y.year, feeLine.amount_cents - mulRate(permittedBase, model.lease.fee.rate_pct / 100), `the lease allows ${model.lease.fee.rate_pct}% of ${cents(permittedBase)}, the statement bills ${cents(feeLine.amount_cents)}`, feeLine.category);
    }

    const cap = model.lease.cap;
    if (cap && r.cap_allowed_cents !== null) {
      const owed = Math.min(r.controllable_actual_cents, r.cap_allowed_cents);
      push("T7", y.year, r.cap_billed_cents - owed, `under the lease the tenant owes the lesser of ${cents(r.controllable_actual_cents)} actual and the ${cents(r.cap_allowed_cents)} ceiling; the statement bills ${cents(r.cap_billed_cents)}`, "Capped pool");
    }

    for (const pool of y.pools) {
      if (pool.capital_project_id || pool.is_fee) continue;
      if (pool.amount_cents > model.lease.capital_threshold_cents && looksCapital(pool.category)) {
        push("T7", y.year, pool.amount_cents, `${cents(pool.amount_cents)} of capital work is expensed in one year; the lease requires anything over ${cents(model.lease.capital_threshold_cents)} to be amortized`, pool.category);
      }
    }
  }

  // --- T3: the tenant's account ------------------------------------------
  let running = 0;
  for (const row of model.ledger) {
    running += row.charge_cents - row.payment_cents;
    if (row.balance_cents !== running) {
      out.push({
        tie: "T3",
        year: Number(row.period.slice(0, 4)),
        delta_cents: row.balance_cents - running,
        detail: `the running balance on ${row.date} reads ${cents(row.balance_cents)}; the rows above it add to ${cents(running)}`,
      });
      running = row.balance_cents;
    }
  }
  for (const y of model.years) {
    const charged = sum(model.ledger.filter((e) => e.code === "EST" && e.period.startsWith(String(y.year))).map((e) => e.charge_cents));
    push("T3", y.year, charged - y.recon.estimates_paid_cents, `the tenant's account charges ${cents(charged)} of estimates and the reconciliation credits ${cents(y.recon.estimates_paid_cents)}`);
    const trueUp = model.ledger.filter((e) => e.code === "REC" && e.date === model.delivery[y.year]);
    const trueUpTotal = sum(trueUp.map((e) => e.charge_cents));
    push("T3", y.year, trueUpTotal - y.recon.balance_due_cents, `the account posts a ${cents(trueUpTotal)} true-up against a ${cents(y.recon.balance_due_cents)} balance due`);
  }

  return out;
}

/** Months of `year` during which the project is still amortizing. */
export function monthsInYear(amortStart: string, lifeMonths: number, year: number): number {
  const { year: sy, month: sm } = parseIso(amortStart);
  const start = monthIndex(sy, sm);
  const end = start + lifeMonths - 1;
  const lo = Math.max(start, monthIndex(year, 1));
  const hi = Math.min(end, monthIndex(year, 12));
  return Math.max(0, hi - lo + 1);
}

/** The lines a fee of this base may be charged on, mirroring the scanner's `feeBaseLines`. */
function feeBaseCents(pools: ScenarioModel["years"][number]["pools"], base: "cam_only" | "cam_plus_insurance" | "all_opex"): number {
  const nonFee = pools.filter((p) => !p.is_fee);
  const keep =
    base === "cam_only"
      ? nonFee.filter((p) => p.section === "CAM")
      : base === "cam_plus_insurance"
        ? nonFee.filter((p) => p.section === "CAM" || p.section === "Insurance")
        : nonFee;
  return sum(keep.map((p) => p.amount_cents));
}

function cents(v: number): string {
  const neg = v < 0;
  const abs = Math.abs(v);
  return (neg ? "-$" : "$") + Math.floor(abs / 100).toLocaleString("en-US") + "." + String(abs % 100).padStart(2, "0");
}
