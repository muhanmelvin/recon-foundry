/**
 * Variants — the forms a backup document takes.
 *
 * A county does not bill the way the county next to it bills. One issues a
 * single bill for the calendar year; one runs a July-to-June fiscal year, so
 * every calendar year is served by the tail of one bill and the head of the
 * next; one collects in quarters and estimates the first two from last year's
 * levy before the assessment is settled. A carrier's invoice has the same
 * variety. An auditor who has only ever seen one shape reads the second one as
 * an error.
 *
 * So a Variant is a checkbox that changes **how a figure is evidenced, and never
 * the figure**. The property bears the same tax in the same calendar year with
 * every box ticked as with none; what changes is the paper it arrives on, the
 * ledger memos behind it, and the arithmetic a reader has to follow to tie it
 * out. That rule is what keeps a Variant from being a scheme: a checkbox that
 * moved money would plant an overcharge nobody planted, and the answer key
 * would be wrong about its own package. See docs/adr/0006.
 *
 * Like `clauses`, the key is optional and absent means what it always meant:
 * `tests/variants.test.ts` holds the pinned packages against a config that
 * omits it.
 */

import type { ScenarioConfig } from "./types.ts";

export type VariantId =
  | "tax_fiscal_year" //   the county's year runs July to June
  | "tax_quarterly" //     four instalments, the first two estimated
  | "tax_supplemental"; // a reassessment billed on its own

export interface VariantSpec {
  id: VariantId;
  /** The document tab whose rail offers it. */
  tab: "tax";
  title: string;
  /** One line, in the words an auditor would use for it. */
  hint: string;
}

/** Every variant, in the order its rail lists it. */
export const VARIANT_CATALOG: readonly VariantSpec[] = Object.freeze([
  {
    id: "tax_fiscal_year",
    tab: "tax",
    title: "A July-to-June tax year",
    hint: "Two bills serve every calendar year — the tail of one and the head of the next.",
  },
  {
    id: "tax_quarterly",
    tab: "tax",
    title: "Quarterly, the first two estimated",
    hint: "Preliminary instalments off last year's levy, then the actual bill with a true-up.",
  },
  {
    id: "tax_supplemental",
    tab: "tax",
    title: "A supplemental bill",
    hint: "A reassessment mid-term, billed separately and over and above the year's bill.",
  },
]);

/** Every variant id, in catalog order. The engine's gate reads this list. */
export const VARIANT_IDS: readonly VariantId[] = Object.freeze(VARIANT_CATALOG.map((v) => v.id));

/** The variants a tab's rail offers, in catalog order. */
export function variantsFor(tab: VariantSpec["tab"]): readonly VariantSpec[] {
  return VARIANT_CATALOG.filter((v) => v.tab === tab);
}

/** Whether this configuration asked for that form of the paper. */
export function hasVariant(config: ScenarioConfig, id: VariantId): boolean {
  return config.variants?.includes(id) ?? false;
}
