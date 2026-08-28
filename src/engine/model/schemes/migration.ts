/**
 * A controllable cost, relabelled and moved out of the capped pool.
 *
 * Security was a controllable expense for years. In the final year it disappears
 * and "Life safety & patrol services" appears in the non-controllable section,
 * costing about the same. The service did not change; its classification did,
 * and the classification is what decides whether the cap applies. The cost
 * escapes the ceiling this year, and — worse, and less obvious — next year's
 * ceiling grows from a smaller base, so the move compounds every year after.
 *
 * **The cover.** The relabelling is done properly. The general ledger account is
 * renamed with it, the memos reference the new contract, the statement groups it
 * under non-controllable, and every subtotal adds. A reader checking arithmetic
 * finds nothing.
 *
 * **The seam.** T7 — §6.01: "A cost's class is fixed by this Section and is not
 * changed by the caption, the grouping or the vendor under which Landlord
 * presents it on a statement."
 *
 * The scanner sees this as three findings that cross-reference each other: a
 * category vanished, a category appeared, and the two are the same thing in
 * different pools.
 */

import type { Rng } from "../../rng.ts";
import { leaseLadder, mulRate, scaleLine, sumCents } from "../recompute.ts";
import type { ScenarioModel } from "../types.ts";
import type { SchemeResult } from "./index.ts";

const RELABEL: Array<{ match: RegExp; to: string; account: string }> = [
  { match: /security/i, to: "Life safety & patrol services", account: "6742" },
  { match: /janitorial/i, to: "Building services — sanitation contract", account: "6754" },
];

export function plantBucketMigration(model: ScenarioModel, rng: Rng): SchemeResult {
  const last = model.years[model.years.length - 1]!;
  const prior = model.years[model.years.length - 2];
  const candidates = RELABEL.filter((c) => last.pools.some((p) => p.bucket === "controllable" && c.match.test(p.category)));
  if (candidates.length === 0) throw new Error("bucket_migration found no controllable category to move");
  const choice = rng.child("choice").pick(candidates);

  const line = last.pools.find((p) => p.bucket === "controllable" && choice.match.test(p.category))!;
  const oldLabel = line.category;
  const newLabel = choice.to;

  // A landlord does not reclassify a category in a year when the cap has room.
  // It reclassifies in the year costs ran away from it — so this is that year.
  // Every controllable line takes the same modest increase, which keeps each one
  // inside the fifteen percent a year-over-year test would ask about while
  // pushing the pool as a whole past its ceiling.
  const ladder = leaseLadder(model);
  const ceiling = ladder?.get(last.year)?.ceiling ?? last.recon.controllable_actual_cents;
  const controllable = sumCents(last.pools.filter((p) => p.bucket === "controllable").map((p) => p.amount_cents));
  const wanted = Math.round(ceiling * rng.child("pressure").float(1.04, 1.075));
  if (wanted > controllable) {
    // Whatever the pool needs, no single line may end up more than 13% above
    // last year's — the scanner asks about 15%, and a swing that size would be a
    // second, louder finding sitting on top of the one being planted here.
    let ceilingOnFactor = 1.12;
    if (prior) {
      for (const p of last.pools.filter((x) => x.bucket === "controllable")) {
        const before = prior.pools.find((x) => x.trade === p.trade);
        if (before && before.amount_cents > 0) {
          ceilingOnFactor = Math.min(ceilingOnFactor, (before.amount_cents * 1.13) / p.amount_cents);
        }
      }
    }
    const factor = Math.min(wanted / controllable, Math.max(1, ceilingOnFactor));
    if (factor > 1) for (const p of last.pools.filter((x) => x.bucket === "controllable")) scaleLine(last, p.category, factor);
  }

  line.category = newLabel;
  line.bucket = "non_controllable";

  const vendor = model.universe.vendors[line.trade] ?? "the incumbent contractor";
  for (const g of last.gl) {
    if (g.category !== oldLabel) continue;
    g.category = newLabel;
    g.account = choice.account;
    g.memo = `${newLabel} — ${vendor}, contract ${last.year}-${rng.child("contract").int(100, 899)}`;
  }

  const shareFrac = model.lease.share_pct / 100;
  const cap = model.lease.cap!;
  // What the cap would have disallowed had the line stayed where the lease puts it.
  const restored = sumCents(last.pools.filter((p) => p.bucket === "controllable").map((p) => p.amount_cents)) + line.amount_cents;
  const escaping = Math.min(line.amount_cents, Math.max(0, restored - ceiling));
  const tenant = mulRate(escaping, shareFrac);

  return {
    planted: {
      id: "bucket_migration",
      seams: ["T7"],
      findings: [
        {
          scheme: "bucket_migration",
          check_id: "RF-04",
          year: prior ? [prior.year, last.year] : last.year,
          category: newLabel,
          severity: "high",
          seam: `"${oldLabel}" was a controllable expense; the same service is presented as "${newLabel}" in the non-controllable section in ${last.year}, outside the ${cap.pct}% cap.`,
          evidence: [
            `Reconciliation summary, ${prior ? `${prior.year} and ` : ""}${last.year} — the caption and the classification column`,
            "General ledger detail — the same vendor, a new account number",
            "CAP Calc tab — the capped pool the line is no longer in",
            "Lease §6.01 Operating Expenses Defined (classification is fixed by the lease)",
            "Lease §6.02 Cap on Increases",
          ],
          note: "The move also shrinks the base next year's ceiling grows from, so it compounds.",
          cofires: ["RF-02", "RF-03"],
        },
      ],
    },
  };
}
