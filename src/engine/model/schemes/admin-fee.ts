/**
 * The management fee, and then the same service again under another caption.
 *
 * §6.03 provides for one fee: a percentage of Common Area Maintenance costs,
 * for managing the property. This landlord charges it, and then charges an
 * "Administrative fee" beside it — two and a half to four points of the same
 * costs, for accounting, reporting and supervision, which is what the
 * management fee is for. One service, two fees.
 *
 * It is the quietest way to raise a fee, because it never touches the rate. An
 * auditor checking that the management fee reproduces at the rate the lease
 * states finds that it does; the second line is somewhere else on the page, in
 * the same section, with a caption nobody argues with.
 *
 * **The cover.** The line behaves like every other fee line. It is
 * non-controllable, so it does not lean on the cap; it is outside the base the
 * management fee is computed on, so it does not compound it; the general ledger
 * carries twelve monthly accruals against the agent, summing to the figure
 * billed. It appears in every year of the term, so nothing about it is new.
 *
 * **The seam.** T7 — §6.03 permits one fee for one service, and the second line
 * has no term in the lease behind it.
 *
 * The scanner sees the stack rather than the arithmetic. RF-07's per-line test
 * compares each fee against the base at the lease's rate, and an administrative
 * fee of three points passes that test, being *smaller* than the four points the
 * lease allows. What fires is the duplication test: management and
 * administration side by side, one service, and the scanner reports the pair as
 * an exposure to be substantiated rather than a priced overcharge. The answer
 * key states the whole line, because reading §6.03 settles what the scanner can
 * only ask.
 */

import type { Rng } from "../../rng.ts";
import { avoidRoundAmount } from "../../rng.ts";
import { iso, monthName } from "../../dates.ts";
import { allocate, mulRate, sumCents } from "../recompute.ts";
import type { AnswerFinding, GLEntry, ScenarioModel } from "../types.ts";
import type { SchemeResult } from "./index.ts";

export const ADMIN_FEE_LABEL = "Administrative fee";

export function plantAdminFeeStacking(model: ScenarioModel, rng: Rng): SchemeResult {
  const shareFrac = model.lease.share_pct / 100;
  const account = model.universe.gl_accounts["Management fee"]!;
  const agent = model.universe.management_agent;
  const findings: AnswerFinding[] = [];

  for (const y of model.years) {
    const feeLine = y.pools.find((p) => p.is_fee);
    if (!feeLine) continue;
    const cam = sumCents(y.pools.filter((p) => p.section === "CAM").map((p) => p.amount_cents));
    const rate = rng.child("rate/" + y.year).float(0.025, 0.04);
    const amount = avoidRoundAmount(mulRate(cam, rate), rng.child("round/" + y.year));

    y.pools.splice(y.pools.indexOf(feeLine) + 1, 0, {
      category: ADMIN_FEE_LABEL,
      section: "Fees",
      bucket: "non_controllable",
      amount_cents: amount,
      // The lease allows no fee upon a fee, so the second line stays outside the
      // base the first is computed on. Leaving it inside would raise the
      // management fee as well and plant a finding nobody planted.
      outside_fee_base: true,
      trade: "management",
    });

    const accruals: GLEntry[] = allocate(amount, Array.from({ length: 12 }, () => 1)).map((cents, i) => ({
      year: y.year,
      date: iso(y.year, i + 1, 28),
      account,
      category: ADMIN_FEE_LABEL,
      vendor: agent,
      memo: `Administrative fee accrual — ${monthName(i + 1)} ${y.year}`,
      amount_cents: cents,
    }));
    y.gl = [...y.gl, ...accruals];

    findings.push({
      scheme: "admin_fee_stacking",
      check_id: "RF-07",
      year: y.year,
      // The scanner names the pair, because the pair is what it found.
      category: `${feeLine.category} + ${ADMIN_FEE_LABEL}`,
      severity: "review",
      seam: `${ADMIN_FEE_LABEL} is billed beside the management fee for the same service; §6.03 provides for one fee, being ${model.lease.fee.rate_pct}% of Common Area Maintenance costs, and states no term for a second.`,
      evidence: [
        "Reconciliation summary — the two fee lines in the Fees section",
        "General ledger detail — twelve monthly accruals against the managing agent, under the management fee account",
        "Lease §6.03 Management and Administrative Fees",
      ],
      note: `${ADMIN_FEE_LABEL} ${(amount / 100).toFixed(2)}, being ${(rate * 100).toFixed(2)}% of Common Area Maintenance costs of ${(cam / 100).toFixed(2)}; tenant share ${(mulRate(amount, shareFrac) / 100).toFixed(2)}. The scanner reports the pair as an exposure rather than a priced overcharge, because a statement cannot say what the second line bought.`,
    });
  }

  return { planted: { id: "admin_fee_stacking", seams: ["T7"], findings } };
}
