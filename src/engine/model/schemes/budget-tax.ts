/**
 * Real estate taxes billed at the landlord's budget, and never trued to the
 * bill the county actually issued.
 *
 * Estimating a tax line is not wrong: nobody knows in January what the county
 * will levy in October, so the landlord budgets and bills estimates against the
 * budget. What the lease requires is the true-up — the reconciliation replaces
 * the estimate with the actual, and the actual is on the collector's bill. This
 * landlord budgets the taxes up and then reconciles to the budget, so the
 * estimate never becomes an actual and the difference is billed every year of
 * the term.
 *
 * It is the commonest tax finding there is, and the least dramatic-looking. The
 * line grows about as fast as taxes grow; nothing on the statement is out of
 * range; the year-over-year test is quiet.
 *
 * **The cover.** The general ledger agrees with the statement. Twelve monthly
 * accruals at a twelfth of the budget, booked to the tax account, summing to the
 * figure billed — which is what a landlord's ledger looks like when the accrual
 * is never reversed against the bill. There is no invoice behind them, and that
 * absence is the only thing in the ledger to notice.
 *
 * **The seam.** T4. The bills and the collector's account statement say what the
 * county levied; the statement bills more. RF-13 reads the tax backup out of the
 * ReconPackage JSON and nets it the way the lease requires, so the scanner
 * raises this one without ever seeing the paper — the same check the kept refund
 * fires, arriving from the other direction.
 *
 * It is raised at *review* rather than *high*, and the difference is the point
 * of the lesson. A kept refund is documented: the collector's account shows the
 * credit, and a statement that ignored it is wrong on its face. A statement
 * above the backup with no credit in sight could still be a timing difference
 * until someone asks — so the check asks. Three years of the same question, all
 * in the same direction, is what turns it into a finding.
 */

import type { Rng } from "../../rng.ts";
import { avoidRoundAmount } from "../../rng.ts";
import { iso } from "../../dates.ts";
import { allocate, mulRate } from "../recompute.ts";
import { taxBorneIn, taxCreditsIn } from "../tax.ts";
import type { AnswerFinding, GLEntry, ScenarioModel } from "../types.ts";
import type { SchemeResult } from "./index.ts";

export function plantBudgetTaxBilling(model: ScenarioModel, rng: Rng): SchemeResult {
  const shareFrac = model.lease.share_pct / 100;
  const findings: AnswerFinding[] = [];

  for (const y of model.years) {
    const line = y.pools.find((p) => p.section === "Taxes");
    if (!line) continue;

    const actual = taxBorneIn(model.tax_parcels, y.year) - taxCreditsIn(model.tax_parcels, y.year);
    const markup = rng.child("markup/" + y.year).float(1.06, 1.11);
    // Off a round figure, because a budget that lands on one is the first thing
    // the scanner's round-number test asks about — and this landlord is careful.
    const budget = avoidRoundAmount(Math.round(actual * markup), rng.child("round/" + y.year));
    line.amount_cents = budget;

    // The ledger tells the same story the statement does: the accrual, month by
    // month, and no entry anywhere reversing it against the county's bill.
    const account = model.universe.gl_accounts["Real estate taxes"]!;
    const accruals: GLEntry[] = allocate(budget, Array.from({ length: 12 }, () => 1)).map((amount, i) => ({
      year: y.year,
      date: iso(y.year, i + 1, 28),
      account,
      category: "Real estate taxes",
      vendor: model.universe.tax_collector,
      memo: `Real estate tax accrual — ${y.year} budget, ${i + 1} of 12`,
      amount_cents: amount,
    }));
    y.gl = [...y.gl.filter((g) => g.category !== "Real estate taxes"), ...accruals];

    const excess = budget - actual;
    findings.push({
      scheme: "budget_tax_billing",
      check_id: "RF-13",
      year: y.year,
      category: line.category,
      severity: "review",
      seam: `The county levied ${(actual / 100).toFixed(2)} for ${y.year} and the reconciliation bills ${(budget / 100).toFixed(2)} — the landlord's budget, never trued up to the bill §6.06 requires it to be reconciled against.`,
      evidence: [
        "Real estate tax backup — the parcels' bills and the collector's account statement for the year",
        "General ledger detail — twelve monthly accruals against the tax account and no entry reversing them",
        "Lease §6.06 Estimates, Statements and Reconciliation",
      ],
      note: `Budget billed ${(budget / 100).toFixed(2)}; county levied ${(actual / 100).toFixed(2)}; tenant share of the difference ${(mulRate(excess, shareFrac) / 100).toFixed(2)}.`,
    });
  }

  return { planted: { id: "budget_tax_billing", seams: ["T4"], findings } };
}
