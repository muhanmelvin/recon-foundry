/**
 * Another property's invoice, booked to this property's ledger.
 *
 * The landlord runs more than one property, and the same contractor cuts the
 * grass at both. One invoice a year is coded to the wrong job: a tenth or so of
 * this property's landscaping, for work done somewhere else, allocated in and
 * recovered from a tenant who has never seen the place.
 *
 * It is the hardest of the schemes to find and the easiest to explain. There is
 * no arithmetic to catch it. The line is the right size, it grows the way the
 * others grow, the vendor is the vendor who really does the work, and the
 * ledger adds to the statement to the cent. The only thing wrong with it is
 * five words in a memo naming a property this lease is not for.
 *
 * **The seam.** T1, and only through the ledger's own memos. The general ledger
 * is *this property's* ledger — the sheet says so at the top — so an invoice
 * booked in it for another property is not one of this category's invoices,
 * however neatly it adds.
 *
 * **No check can see this, and that is the argument.** The ReconPackage carries
 * lines and amounts, not memos, so nothing in the scanner has anything to read:
 * `check_id` is null and the answer key counts it as document-only, which is the
 * same honest gap the kept tax refund used to sit in before RF-13 was written.
 * The case this scheme makes is for the check that closes it — allocated costs
 * substantiated to the property they were incurred at.
 */

import type { Rng } from "../../rng.ts";
import { avoidRoundAmount } from "../../rng.ts";
import { iso } from "../../dates.ts";
import { drawNames } from "../../names.ts";
import { mulRate } from "../recompute.ts";
import type { AnswerFinding, ScenarioModel } from "../types.ts";
import type { SchemeResult } from "./index.ts";

/** Trades whose work is bought by the visit and could plausibly serve two sites. */
const SHARED_TRADES = ["landscaping", "security", "janitorial", "sweeping"];

export function plantPortfolioAllocation(model: ScenarioModel, rng: Rng): SchemeResult {
  const shareFrac = model.lease.share_pct / 100;
  const first = model.years[0]!;

  // One category, the same one every year: a service bought by the visit, from
  // a vendor who could be at two properties in the same week.
  const candidates = first.pools.filter(
    (p) => p.section === "CAM" && p.bucket === "controllable" && !p.capital_project_id && !p.is_fee && SHARED_TRADES.includes(p.trade),
  );
  const chosen = candidates.length > 0 ? rng.child("trade").pick(candidates) : first.pools.find((p) => p.section === "CAM" && p.bucket === "controllable")!;
  const trade = chosen.trade;

  // The sibling property, out of the same invented bank every other name comes
  // from. A real one could not be drawn here even by accident.
  const sibling = drawNames(rng.child("sibling"), model.config.property_kind);
  const siblingName = sibling.property_name === model.universe.property_name ? drawNames(rng.child("sibling-2"), model.config.property_kind).property_name : sibling.property_name;
  const siblingCode = "br" + String(rng.child("sibling-code").int(10, 99)) + String(rng.child("sibling-code2").int(100, 999));

  // The same fraction in every year. A share that moved would show up as a
  // swing in the year-over-year test, which is a different finding entirely.
  const fraction = rng.child("share").float(0.08, 0.14);
  const findings: AnswerFinding[] = [];

  for (const y of model.years) {
    const line = y.pools.find((p) => p.trade === trade && p.section === "CAM" && !p.capital_project_id && !p.is_fee);
    if (!line) continue;

    const before = line.amount_cents;
    const after = avoidRoundAmount(before + Math.round(before * fraction), rng.child("round/" + y.year));
    const allocated = after - before;
    line.amount_cents = after;

    y.gl.push({
      year: y.year,
      date: iso(y.year, rng.child("month/" + y.year).int(3, 10), rng.child("day/" + y.year).int(6, 24)),
      account: y.gl.find((g) => g.category === line.category)?.account ?? model.universe.gl_accounts[line.category] ?? "6700",
      category: line.category,
      vendor: model.universe.vendors[trade] ?? "the incumbent contractor",
      memo: `${line.category} — ${siblingName}, allocated per portfolio schedule`,
      property_code: siblingCode,
      amount_cents: allocated,
    });

    findings.push({
      scheme: "portfolio_allocation",
      check_id: null,
      year: y.year,
      category: line.category,
      severity: "review",
      seam: `One invoice booked against "${line.category}" is for work at another property the landlord owns; the general ledger is this property's ledger, and §6.01 recovers the cost of operating this Property only.`,
      evidence: [
        `General ledger detail — the ${line.category} account, and the memo naming a property this Lease is not for`,
        "Reconciliation summary — the category total, which includes it and adds correctly",
        "Lease §6.01 Operating Expenses Defined; Exclusions",
      ],
      note: `${(allocated / 100).toFixed(2)} of ${(after / 100).toFixed(2)} billed for ${line.category} was incurred elsewhere; tenant share ${(mulRate(allocated, shareFrac) / 100).toFixed(2)}. No check in the scanner reads a ledger memo, so nothing raises this: only the paper catches it.`,
    });
  }

  return { planted: { id: "portfolio_allocation", seams: ["T1"], findings } };
}
