/**
 * The tax refund the landlord kept.
 *
 * The county grants an appeal on an earlier year's assessment and credits the
 * property's tax account. The lease says taxes in operating expenses are net of
 * any refund, whichever year it relates to. The reconciliation bills the original
 * levy in full, and the credit is never passed through.
 *
 * **The cover.** This one is the most complete of the five, because the landlord
 * does not have to touch the reconciliation at all. The tax line is the sum of
 * the bills as issued, which is true. The general ledger shows the payments the
 * property made, which is also true — the refund was booked below the line, to
 * the owner's account, and never entered the operating-expense extract. That is
 * exactly where it hides in real life.
 *
 * **The seam.** T4, and only T4: the tax backup, netted the way §6.06 requires,
 * comes to less than the tax line. The collector's account statement is the only
 * document in the package that mentions the refund at all.
 *
 * **This scheme is why RF-13 exists.** For the life of this repo no scanner
 * check could catch it: none of the twelve read a refund or a credit, and the
 * ReconPackage schema had no field that could carry one — a reconciliation
 * statement, on its own, simply does not contain the fact. The answer key
 * recorded it with `check_id: null` and the manifest left it out, as a declared
 * gap rather than a hidden one. Schema 1.1 closed it: the package now carries
 * the collector's account as `tax_backup`, and RF-13 nets it against the tax
 * line. The finding is `RF-13` from here on.
 *
 * **What has not changed** is which document betrays it. Only the paper and the
 * ReconPackage JSON carry the credit; a workbook upload has nowhere to put a
 * tax backup, so a landlord's spreadsheet still hides this scheme completely.
 * That is what keeps it the best of the five to teach with.
 */

import type { Rng } from "../../rng.ts";
import { mulRate } from "../recompute.ts";
import { iso } from "../../dates.ts";
import type { ScenarioModel } from "../types.ts";
import type { SchemeResult } from "./index.ts";

export function plantKeptTaxRefund(model: ScenarioModel, rng: Rng): SchemeResult {
  const parcel = model.tax_parcels[0]!;
  // The last year the package covers, so there is a settled prior assessment for
  // the appeal to have been about.
  const year = model.years[model.years.length - 1]!.year;
  const py = parcel.years.find((x) => x.year === year)!;
  const levy = py.installments.reduce((s, i) => s + i.amount_cents, 0);

  // Small enough relative to the levy that no year-over-year test picks it up.
  // The point of this scheme is that the arithmetic gives nothing away.
  const refund = Math.round(levy * rng.child("size").float(0.035, 0.075));

  py.credit = {
    appeal_year: year - rng.child("appeal").int(1, 2),
    granted: iso(year, rng.child("month").int(5, 11), rng.child("day").int(3, 26)),
    amount_cents: refund,
    docket: `AP-${year - 1}-${rng.child("docket").int(1000, 8999)}`,
  };

  const tenant = mulRate(refund, model.lease.share_pct / 100);

  return {
    planted: {
      id: "kept_tax_refund",
      seams: ["T4"],
      findings: [
        {
          scheme: "kept_tax_refund",
          check_id: "RF-13",
          year,
          category: "Real estate taxes",
          severity: "high",
          seam: `The collector credited ${(refund / 100).toFixed(2)} to the property on appeal of the ${py.credit.appeal_year} assessment; the ${year} statement bills the tax at the levy, without netting the refund, contrary to §6.06.`,
          evidence: [
            `Taxpayer account statement — the credit line, docket ${py.credit.docket}`,
            `Real property tax bill, parcel ${parcel.parcel_id} — the levy as originally issued`,
            'Reconciliation summary, line "Real estate taxes"',
            "Lease §6.06 (taxes are net of refunds, abatements and credits)",
          ],
          note: "RF-13 sees this only through the tax backup the ReconPackage JSON carries. A workbook upload cannot: a reconciliation statement does not contain the fact that a refund exists.",
          cofires: [],
        },
      ],
    },
  };
}
