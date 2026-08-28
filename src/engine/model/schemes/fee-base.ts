/**
 * The management fee, charged on a base the lease does not permit.
 *
 * The lease allows a fee on Common Area Maintenance costs. The landlord charges
 * the same percentage on everything — CAM plus real estate taxes plus insurance
 * — which on most properties nearly doubles it, because taxes are usually the
 * largest single line on the statement. It is the quietest of the five: the rate
 * on the statement is the rate in the lease, so the line looks right to anyone
 * who checks the percentage and not the base.
 *
 * **The cover.** The agent really was paid that much. The general ledger carries
 * twelve monthly accruals summing to the fee billed, so the ledger ties to the
 * statement exactly. Nothing about the arithmetic is wrong.
 *
 * **The seam.** T7. Recompute the fee on the base §6.03 permits and it is
 * smaller. That is the entire finding, and it runs in every year of the package.
 */

import type { Rng } from "../../rng.ts";
import { feeBaseCents, mulRate } from "../recompute.ts";
import type { AnswerFinding, ScenarioModel } from "../types.ts";
import type { SchemeResult } from "./index.ts";

export function plantFeeBaseExpansion(model: ScenarioModel, _rng: Rng): SchemeResult {
  const shareFrac = model.lease.share_pct / 100;
  const rate = model.lease.fee.rate_pct;
  const findings: AnswerFinding[] = [];

  for (const y of model.years) {
    const permitted = feeBaseCents(y.pools, model.lease.fee.base);
    const charged = feeBaseCents(y.pools, "all_opex");
    const excess = mulRate(charged, rate / 100) - mulRate(permitted, rate / 100);
    const tenant = mulRate(excess, shareFrac);
    findings.push({
      scheme: "fee_base_expansion",
      check_id: "RF-07",
      year: y.year,
      category: y.pools.find((p) => p.is_fee)?.category ?? "Management fee",
      severity: "high",
      seam: `The fee is ${rate}% of every operating expense including taxes and insurance; §6.03 permits ${rate}% of Common Area Maintenance costs only.`,
      evidence: [
        "Reconciliation summary — the fee line, and the taxes and insurance lines it was computed on",
        "General ledger detail — twelve monthly accruals summing to the fee as billed",
        "Lease §6.03 Management and Administrative Fees",
      ],
      note: `Permitted base ${(permitted / 100).toFixed(2)}; base actually used ${(charged / 100).toFixed(2)}.`,
    });
  }

  return {
    planted: { id: "fee_base_expansion", seams: ["T7"], findings },
    overrides: { feeBase: "all_opex" },
  };
}
