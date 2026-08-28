/**
 * The cap grown on the cap.
 *
 * The lease caps controllable costs at a few percent a year, measured against
 * *the amount actually payable* the prior year — the lesser of what the year
 * cost and what the ceiling allowed. The landlord instead grows next year's
 * ceiling on what it *billed*. In a year when actual costs came in under the
 * ceiling, those two figures are different, and from then on the ladder climbs
 * away from what the property actually spends. A cap has quietly become a floor.
 *
 * **The cover.** The CAP Calc tab shows the landlord's own ladder, and every
 * figure on it is internally consistent: prior year billed, times one plus the
 * cap rate, equals this year's stated ceiling, equals what was billed. The
 * general ledger shows the real actuals, lower, and the tab openly bridges the
 * two — which is exactly what a real workbook does. Everything foots.
 *
 * **The seam.** T7. The lease says the ladder is measured against the amount
 * payable, and payable means the lesser of actual and ceiling. Nothing but the
 * lease says the landlord is wrong.
 *
 * The last year's repairs line is also pushed down, hard enough to be worth
 * asking about. That is deliberate: it is the dip that opens the gap between
 * billed and actual, and the year-over-year question it raises is the thread a
 * trainee is meant to pull. It is declared as a co-firing check, not hidden.
 */

import type { Rng } from "../../rng.ts";
import { mulRate } from "../recompute.ts";
import { avoidRoundAmount } from "../../rng.ts";
import type { AnswerFinding, ScenarioModel } from "../types.ts";
import type { SchemeResult } from "./index.ts";

export function plantAboveCapBilling(model: ScenarioModel, rng: Rng): SchemeResult {
  const cap = model.lease.cap;
  if (!cap) throw new Error("above_cap_billing needs a lease with a cap");

  // Push the final year's repairs down, so actual costs fall visibly below what
  // the ladder bills. Landlords defer discretionary work; auditors notice.
  const last = model.years[model.years.length - 1]!;
  const repairs = last.pools.find((p) => p.bucket === "controllable" && /repairs|dock/i.test(p.category));
  if (repairs && model.years.length >= 2) {
    const dipped = Math.round(repairs.amount_cents * rng.child("dip").float(0.76, 0.86));
    const scale = dipped / repairs.amount_cents;
    repairs.amount_cents = avoidRoundAmount(dipped, rng.child("dip-round"));
    // The invoices move with it: fewer jobs were done, not the same jobs for less.
    let running = 0;
    const entries = last.gl.filter((g) => g.category === repairs.category);
    entries.forEach((g, i) => {
      if (i === entries.length - 1) g.amount_cents = repairs.amount_cents - running;
      else {
        g.amount_cents = Math.round(g.amount_cents * scale);
        running += g.amount_cents;
      }
    });
  }

  const findings: AnswerFinding[] = [];
  const shareFrac = model.lease.share_pct / 100;

  return {
    planted: {
      id: "above_cap_billing",
      seams: ["T7"],
      // Filled by the closure below as the ladder is walked, so the answer key
      // states the actual excess rather than an estimate of it.
      findings,
    },
    overrides: {
      capBilled: ({ year, actual, leaseAllowed, priorBilled, priorPaidCorrect }) => {
        const isFirst = year === model.years[0]!.year;
        // Year one is billed honestly; there is no prior year to grow from yet.
        const stated = isFirst ? leaseAllowed : priorBilled + mulRate(priorBilled, cap.pct / 100);
        const billed = isFirst ? Math.min(actual, stated) : stated;
        const payable = Math.min(actual, leaseAllowed);
        const excess = billed - payable;

        if (year === model.years[model.years.length - 1]!.year && findings.length >= 1) {
          // The scanner also reads the shape of the ladder, not only its excess:
          // a pool billed at exactly the cap rate two years running while actual
          // costs sit below it is the pattern, and it is worth its own entry.
          findings.push({
            scheme: "above_cap_billing",
            check_id: "RF-06",
            year: [model.years[0]!.year, year],
            category: "Capped pool",
            severity: "review",
            seam: `Billing grows by exactly ${cap.pct}% a year while the controllable costs listed fall below what is billed — the ladder has stopped tracking what the property spends.`,
            evidence: ["CAP Calc tab — the ladder", "General ledger detail — the actual controllable spend"],
            note: "The pattern finding, not a second charge: its dollars are already counted in the per-year entries.",
          });
        }

        if (excess > 0) {
          const tenant = mulRate(excess, shareFrac);
          findings.push({
            scheme: "above_cap_billing",
            check_id: "RF-06",
            year,
            category: "Controllable CAM (subject to cap)",
            severity: "high",
            seam:
              `The ${year} ceiling was grown on what was billed the year before (${(priorBilled / 100).toFixed(2)}), not on what was payable (${(priorPaidCorrect / 100).toFixed(2)}); ` +
              `under §6.02 the tenant owes the lesser of actual cost and the ceiling.`,
            evidence: [
              "CAP Calc tab — the ladder, grown on the prior year billed",
              "Reconciliation summary — controllable costs as billed after the cap",
              "General ledger detail — what the controllable categories actually cost",
              "Lease §6.02 Cap on Increases",
            ],
            note: `Actual ${(actual / 100).toFixed(2)}; lease ceiling ${(leaseAllowed / 100).toFixed(2)}; billed ${(billed / 100).toFixed(2)}.`,
            cofires: ["RF-01"],
          });
        }
        return { billed, stated };
      },
    },
  };
}
