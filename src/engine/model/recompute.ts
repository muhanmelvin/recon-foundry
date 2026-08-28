/**
 * Re-deriving the reconciliation and the tenant's account from the pools.
 *
 * This is what makes a planted scheme coherent. A scheme does not write a wrong
 * number onto a statement — it changes something upstream (an expense is
 * expensed instead of amortized, a fee is charged on a base the lease does not
 * allow, a category changes class) and then everything downstream is recomputed
 * faithfully from the changed model. The statement, the workbook, the ledger and
 * the balance due all agree with each other afterwards, exactly as a real
 * landlord's package does. Only the lease disagrees, and only at the seam.
 *
 * Two things are deliberately *not* recomputed:
 *
 * **The monthly estimate.** The tenant paid estimates during the year, before
 * anyone knew what the year cost. A scheme discovered in the reconciliation does
 * not travel backwards and change what was billed monthly — it lands entirely in
 * the balance due, which is where a real overcharge lands.
 *
 * **The general ledger, except the fee.** Vendor invoices are facts. The fee is
 * an accrual the agent posts to itself, so when the fee changes its journal
 * entries change with it; when a scheme moves an expense, its invoices move too,
 * but the scheme does that itself.
 */

import type { LeaseAbstract, LedgerEntry, ModelYear, ScenarioModel } from "./types.ts";
import { addDays, iso, monthName, period } from "../dates.ts";
import type { Rng } from "../rng.ts";

export function sumCents(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** cents × rate, rounded half away from zero — the family's `mulRate`. */
export function mulRate(cents: number, rate: number): number {
  const sign = cents < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(cents) * rate + 1e-9);
}

/** Divide `total` across `weights` so the parts sum to `total` exactly. */
export function allocate(total: number, weights: readonly number[]): number[] {
  let w = 0;
  for (const x of weights) w += x;
  if (w <= 0) throw new Error("allocate: weights sum to zero");
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < weights.length - 1; i++) {
    const v = Math.round((total * weights[i]!) / w);
    out.push(v);
    acc += v;
  }
  out.push(total - acc);
  return out;
}

/** The lines a fee of this base may be charged on, mirroring the scanner's `feeBaseLines`. */
export function feeBaseCents(pools: ModelYear["pools"], base: LeaseAbstract["fee"]["base"]): number {
  const nonFee = pools.filter((p) => !p.is_fee && !p.outside_fee_base);
  const keep =
    base === "cam_only"
      ? nonFee.filter((p) => p.section === "CAM")
      : base === "cam_plus_insurance"
        ? nonFee.filter((p) => p.section === "CAM" || p.section === "Insurance")
        : nonFee;
  return sumCents(keep.map((p) => p.amount_cents));
}

export interface ReconOverrides {
  /** The base the landlord actually charged the fee on. Defaults to the lease's. */
  feeBase?: LeaseAbstract["fee"]["base"];
  /**
   * What the landlord billed for the capped pool. The default is the lease:
   * the lesser of actual cost and the ceiling. `priorBilled` is what makes the
   * cap-on-cap ladder expressible.
   */
  capBilled?: (args: { year: number; actual: number; leaseAllowed: number; priorBilled: number; priorPaidCorrect: number }) => {
    billed: number;
    /** The ceiling the landlord states on its own CAP Calc tab. */
    stated: number;
  };
}

/**
 * Recompute the fee, the cap ladder, the tenant's totals and the ledger from the
 * pools as they now stand. Mutates `model` in place.
 */
export function recomputeRecon(model: ScenarioModel, rng: Rng, o: ReconOverrides = {}): void {
  const shareFrac = model.lease.share_pct / 100;
  const feeRate = model.lease.fee.rate_pct;
  const base = o.feeBase ?? model.lease.fee.base;

  for (const y of model.years) {
    const feeLine = y.pools.find((p) => p.is_fee);
    if (feeLine) {
      const feeBase = feeBaseCents(y.pools, base);
      feeLine.amount_cents = mulRate(feeBase, feeRate / 100);
      y.recon.fee_base_cents = feeBase;
      y.recon.fee_billed_cents = feeLine.amount_cents;
      // The agent's monthly accrual follows the fee it actually charged.
      const parts = allocate(feeLine.amount_cents, Array.from({ length: 12 }, () => 1));
      let n = 0;
      for (const g of y.gl) {
        if (g.category === feeLine.category) g.amount_cents = parts[n++]!;
      }
    }
    y.recon.pool_total_cents = sumCents(y.pools.map((p) => p.amount_cents));
    y.recon.controllable_actual_cents = sumCents(y.pools.filter((p) => p.bucket === "controllable").map((p) => p.amount_cents));
  }

  const cap = model.lease.cap;
  let priorBilled = cap ? cap.base_year_amount_cents : 0;
  let priorPaidCorrect = priorBilled;

  for (const y of model.years) {
    const actual = y.recon.controllable_actual_cents;
    if (!cap) {
      y.recon.cap_allowed_cents = null;
      y.recon.cap_billed_cents = actual;
    } else {
      const leaseAllowed = priorPaidCorrect + mulRate(priorPaidCorrect, cap.pct / 100);
      const decided = o.capBilled
        ? o.capBilled({ year: y.year, actual, leaseAllowed, priorBilled, priorPaidCorrect })
        : { billed: Math.min(actual, leaseAllowed), stated: leaseAllowed };
      y.recon.cap_allowed_cents = decided.stated;
      y.recon.cap_billed_cents = decided.billed;
      priorBilled = decided.billed;
      priorPaidCorrect = Math.min(actual, leaseAllowed);
    }
    y.recon.billed_pool_cents = y.recon.pool_total_cents - actual + y.recon.cap_billed_cents;
    y.recon.tenant_total_cents = mulRate(y.recon.billed_pool_cents, shareFrac);
    y.recon.balance_due_cents = y.recon.tenant_total_cents - y.recon.estimates_paid_cents;
  }

  model.ledger = buildLedger(model.years, model.lease, model.delivery, rng.child("ledger"));
}

/** Set the tenant's monthly estimate for each year. Called once, before any scheme. */
export function setEstimates(model: ScenarioModel, rng: Rng): void {
  for (const y of model.years) {
    const estRng = rng.child("estimate/" + y.year);
    const estimate = Math.round((y.recon.tenant_total_cents * estRng.float(0.9, 0.98)) / 12);
    y.estimate_monthly_cents = estimate;
    y.recon.estimates_paid_cents = estimate * 12;
    y.recon.balance_due_cents = y.recon.tenant_total_cents - y.recon.estimates_paid_cents;
  }
}

/**
 * The tenant's account as the landlord keeps it: base rent and the monthly
 * operating-expense estimate charged on the first, the reconciliation true-up
 * charged when the package is delivered, and one payment a month covering what
 * was charged. The balance returns to zero, so a reader can check it by eye.
 */
export function buildLedger(
  years: readonly ModelYear[],
  lease: LeaseAbstract,
  delivery: Record<number, string>,
  rng: Rng,
): LedgerEntry[] {
  interface Row {
    date: string;
    period: string;
    code: LedgerEntry["code"];
    description: string;
    charge_cents: number;
  }
  const rows: Row[] = [];

  years.forEach((y, k) => {
    const rentAnnual = Math.round(lease.premises_sf * lease.base_rent_psf_year1 * Math.pow(1 + lease.base_rent_escalation_pct / 100, k) * 100);
    const rentMonthly = Math.round(rentAnnual / 12);
    for (let m = 1; m <= 12; m++) {
      rows.push({ date: iso(y.year, m, 1), period: period(y.year, m), code: "RNT", description: `Base rent — ${monthName(m)} ${y.year}`, charge_cents: rentMonthly });
      rows.push({
        date: iso(y.year, m, 1),
        period: period(y.year, m),
        code: "EST",
        description: `Operating expense estimate — ${monthName(m)} ${y.year}`,
        charge_cents: y.estimate_monthly_cents,
      });
    }
    const d = delivery[y.year]!;
    rows.push({
      date: d,
      period: period(Number(d.slice(0, 4)), Number(d.slice(5, 7))),
      code: "REC",
      description: `${y.year} operating expense reconciliation — balance ${y.recon.balance_due_cents >= 0 ? "due" : "credit"}`,
      charge_cents: y.recon.balance_due_cents,
    });
  });

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : 1));

  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(r.period, (byMonth.get(r.period) ?? 0) + r.charge_cents);

  const out: LedgerEntry[] = [];
  let balance = 0;
  for (const p of [...byMonth.keys()].sort()) {
    for (const r of rows.filter((x) => x.period === p)) {
      balance += r.charge_cents;
      out.push({ date: r.date, period: r.period, code: r.code, description: r.description, charge_cents: r.charge_cents, payment_cents: 0, balance_cents: balance });
    }
    const due = byMonth.get(p)!;
    if (due === 0) continue;
    const last = rows.filter((x) => x.period === p).map((x) => x.date).sort().at(-1)!;
    balance -= due;
    out.push({
      date: addDays(last, rng.child("pay/" + p).int(2, 9)),
      period: p,
      code: "PAY",
      description: due >= 0 ? "Payment received — thank you" : "Credit applied",
      charge_cents: 0,
      payment_cents: due,
      balance_cents: balance,
    });
  }
  return out;
}

/**
 * The ceiling and the payable amount for each year under the lease as written:
 * the ceiling grows on what was actually payable the prior year, and the tenant
 * owes the lesser of actual cost and the ceiling.
 *
 * This is the lease's own ladder, not the landlord's. Reading
 * `cap_allowed_cents` instead would take the landlord's word for the ceiling,
 * and the cap-grown-on-the-cap seam would never show.
 */
export function leaseLadder(model: ScenarioModel): Map<number, { ceiling: number; payable: number }> | null {
  const cap = model.lease.cap;
  if (!cap) return null;
  const out = new Map<number, { ceiling: number; payable: number }>();
  let priorPayable = cap.base_year_amount_cents;
  for (const y of model.years) {
    const ceiling = priorPayable + mulRate(priorPayable, cap.pct / 100);
    const payable = Math.min(y.recon.controllable_actual_cents, ceiling);
    out.set(y.year, { ceiling, payable });
    priorPayable = payable;
  }
  return out;
}

/**
 * Scale one expense line and the invoices behind it by the same factor, so the
 * general ledger still adds to the reconciliation exactly. The last invoice
 * absorbs the rounding, which is also how a real year works.
 */
export function scaleLine(year: ModelYear, category: string, factor: number): void {
  const pool = year.pools.find((p) => p.category === category);
  if (!pool) throw new Error(`scaleLine: no line called ${category} in ${year.year}`);
  const target = Math.round(pool.amount_cents * factor);
  const entries = year.gl.filter((g) => g.category === category);
  pool.amount_cents = target;
  let running = 0;
  entries.forEach((g, i) => {
    if (i === entries.length - 1) g.amount_cents = target - running;
    else {
      g.amount_cents = Math.round(g.amount_cents * factor);
      running += g.amount_cents;
    }
  });
}
