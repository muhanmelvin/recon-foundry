/**
 * The things the invented landlord can be made to do wrong.
 *
 * A scheme is not a wrong number written onto a statement. It is a change to the
 * model — an expense classified differently, a fee charged on a wider base, a
 * refund never passed through — after which every document is regenerated
 * faithfully from the changed model. That is the discipline that makes a forged
 * overcharge worth finding: the workbook, the statement, the general ledger and
 * the tenant's account all agree with each other afterwards, and the only thing
 * that disagrees is the lease, at exactly one seam.
 *
 * Each scheme declares the ties it breaks. `tests/schemes.test.ts` asserts that
 * the set of ties actually broken is *exactly* that set — no collateral damage.
 * A scheme that breaks a tie it did not declare has left a loose thread a
 * trainee would pull on before finding the real thing.
 */

import type { Rng } from "../../rng.ts";
import { recomputeRecon, type ReconOverrides } from "../recompute.ts";
import { SCHEME_ORDER, type PlantedScheme, type ScenarioModel, type SchemeId } from "../types.ts";
import { plantUnamortizedCapital } from "./unamortized-capital.ts";
import { plantAboveCapBilling } from "./above-cap.ts";
import { plantFeeBaseExpansion } from "./fee-base.ts";
import { plantBucketMigration } from "./migration.ts";
import { plantKeptTaxRefund } from "./kept-refund.ts";
import { plantBudgetTaxBilling } from "./budget-tax.ts";

/**
 * What a scheme returns: what it planted, and how the reconciliation must be
 * re-derived afterwards. Overrides are merged across schemes, which is why they
 * are stated declaratively rather than applied by each scheme itself — two
 * schemes that both touch the recon must not each rebuild it and overwrite the
 * other.
 */
export interface SchemeResult {
  planted: PlantedScheme;
  overrides?: ReconOverrides;
}

export type SchemeFn = (model: ScenarioModel, rng: Rng) => SchemeResult;

const SCHEMES: Record<SchemeId, SchemeFn> = {
  unamortized_capital: plantUnamortizedCapital,
  above_cap_billing: plantAboveCapBilling,
  fee_base_expansion: plantFeeBaseExpansion,
  bucket_migration: plantBucketMigration,
  kept_tax_refund: plantKeptTaxRefund,
  budget_tax_billing: plantBudgetTaxBilling,
};

/**
 * Apply the chosen schemes, in the canonical order, then re-derive the
 * reconciliation once. Mutates `model`.
 */
export function applySchemes(model: ScenarioModel, rng: Rng): void {
  const chosen = SCHEME_ORDER.filter((id) => model.config.schemes.includes(id));
  if (chosen.length === 0) return;

  const overrides: ReconOverrides = {};
  for (const id of chosen) {
    const result = SCHEMES[id](model, rng.child("scheme").child(id));
    model.planted.push(result.planted);
    if (result.overrides?.feeBase) overrides.feeBase = result.overrides.feeBase;
    if (result.overrides?.capBilled) overrides.capBilled = result.overrides.capBilled;
  }

  recomputeRecon(model, rng, overrides);
}
