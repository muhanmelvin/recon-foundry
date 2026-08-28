/**
 * The expense categories a forged property spends money on, and the shape of
 * the invoices behind each one.
 *
 * Two constraints are doing real work here and neither is obvious.
 *
 * **No label may look capital.** The Red-Flag Scanner's RF-09 reads a line's
 * label for words like *roof*, *parking*, *HVAC*, *replacement*, *resurfacing*
 * — and if it finds one on a line that carries no amortization schedule and
 * exceeds the lease's capital threshold, it says so, correctly. A clean package
 * must find nothing, so a clean label must not contain those words. That is why
 * "HVAC service contract" is called *Mechanical systems maintenance* here and
 * why nothing sweeps a *parking lot*. `tests/scanner-tolerances.test.ts` checks
 * the whole catalog against the scanner's own keyword list.
 *
 * **The cadence is the invoice count.** A pool is the sum of its invoices, never
 * a figure divided into them, so snow removal bills in five winter months and
 * pest control four times a year. That is what makes the GL detail tab tie to
 * the reconciliation summary without anyone arranging it.
 */

import type { Bucket, PropertyKind, Section } from "./types.ts";

export type Cadence =
  | "monthly" //        twelve invoices
  | "bimonthly" //      six
  | "quarterly" //      four
  | "semiannual" //     two
  | "annual" //         one
  | "warm_season" //    March–November
  | "cold_season" //    November–March, within the calendar year
  | "irregular"; //     five to nine, whenever something broke

export interface CategorySpec {
  /** Exactly as it appears on the statement. */
  category: string;
  section: Section;
  bucket: Bucket;
  trade: string;
  cadence: Cadence;
  /** Annual cost per square foot of gross leasable area, in dollars. */
  psf: number;
  /** How far a year's spend may drift from the psf rate, as a fraction. */
  spread: number;
  memo: string;
}

const RETAIL: readonly CategorySpec[] = Object.freeze([
  { category: "Landscaping & grounds", section: "CAM", bucket: "controllable", trade: "landscaping", cadence: "warm_season", psf: 0.17, spread: 0.12, memo: "Grounds maintenance" },
  { category: "Sweeping & striping", section: "CAM", bucket: "controllable", trade: "sweeping", cadence: "monthly", psf: 0.09, spread: 0.10, memo: "Lot sweeping" },
  { category: "Trash removal", section: "CAM", bucket: "controllable", trade: "trash", cadence: "monthly", psf: 0.13, spread: 0.10, memo: "Compactor haul & disposal" },
  { category: "Security patrol", section: "CAM", bucket: "controllable", trade: "security", cadence: "monthly", psf: 0.20, spread: 0.09, memo: "Overnight patrol coverage" },
  { category: "Janitorial — common areas", section: "CAM", bucket: "controllable", trade: "janitorial", cadence: "monthly", psf: 0.11, spread: 0.09, memo: "Common area cleaning" },
  { category: "Repairs & maintenance", section: "CAM", bucket: "controllable", trade: "repairs", cadence: "irregular", psf: 0.24, spread: 0.16, memo: "Common area repair" },
  { category: "Pest control", section: "CAM", bucket: "controllable", trade: "pest", cadence: "quarterly", psf: 0.03, spread: 0.12, memo: "Quarterly service" },
  { category: "Fire & life safety inspections", section: "CAM", bucket: "controllable", trade: "fire_safety", cadence: "semiannual", psf: 0.05, spread: 0.11, memo: "Sprinkler & alarm inspection" },
  { category: "Common area lighting — electricity", section: "CAM", bucket: "non_controllable", trade: "electricity", cadence: "monthly", psf: 0.19, spread: 0.13, memo: "Common area meter" },
  { category: "Water & sewer — common areas", section: "CAM", bucket: "non_controllable", trade: "water", cadence: "bimonthly", psf: 0.06, spread: 0.12, memo: "Irrigation & common meter" },
  { category: "Snow removal", section: "CAM", bucket: "non_controllable", trade: "snow", cadence: "cold_season", psf: 0.10, spread: 0.22, memo: "Plowing & ice control" },
]);

const OFFICE: readonly CategorySpec[] = Object.freeze([
  { category: "Landscaping & grounds", section: "CAM", bucket: "controllable", trade: "landscaping", cadence: "warm_season", psf: 0.14, spread: 0.12, memo: "Grounds maintenance" },
  { category: "Janitorial — common areas", section: "CAM", bucket: "controllable", trade: "janitorial", cadence: "monthly", psf: 0.58, spread: 0.08, memo: "Nightly cleaning" },
  { category: "Mechanical systems maintenance", section: "CAM", bucket: "controllable", trade: "hvac_service", cadence: "monthly", psf: 0.22, spread: 0.10, memo: "Service contract" },
  { category: "Elevator maintenance", section: "CAM", bucket: "controllable", trade: "elevator", cadence: "monthly", psf: 0.16, spread: 0.07, memo: "Maintenance contract" },
  { category: "Security patrol", section: "CAM", bucket: "controllable", trade: "security", cadence: "monthly", psf: 0.26, spread: 0.09, memo: "Lobby desk coverage" },
  { category: "Repairs & maintenance", section: "CAM", bucket: "controllable", trade: "repairs", cadence: "irregular", psf: 0.28, spread: 0.16, memo: "Building repair" },
  { category: "Fire & life safety inspections", section: "CAM", bucket: "controllable", trade: "fire_safety", cadence: "semiannual", psf: 0.06, spread: 0.11, memo: "Sprinkler & alarm inspection" },
  { category: "Common area lighting — electricity", section: "CAM", bucket: "non_controllable", trade: "electricity", cadence: "monthly", psf: 0.42, spread: 0.14, memo: "House meter" },
  { category: "Water & sewer — common areas", section: "CAM", bucket: "non_controllable", trade: "water", cadence: "bimonthly", psf: 0.09, spread: 0.12, memo: "Building meter" },
  { category: "Snow removal", section: "CAM", bucket: "non_controllable", trade: "snow", cadence: "cold_season", psf: 0.08, spread: 0.22, memo: "Plowing & ice control" },
]);

const FLEX: readonly CategorySpec[] = Object.freeze([
  { category: "Landscaping & grounds", section: "CAM", bucket: "controllable", trade: "landscaping", cadence: "warm_season", psf: 0.08, spread: 0.12, memo: "Grounds maintenance" },
  { category: "Sweeping & striping", section: "CAM", bucket: "controllable", trade: "sweeping", cadence: "quarterly", psf: 0.05, spread: 0.11, memo: "Yard sweeping" },
  { category: "Dock & yard maintenance", section: "CAM", bucket: "controllable", trade: "repairs", cadence: "irregular", psf: 0.12, spread: 0.16, memo: "Dock leveller & yard repair" },
  { category: "Security patrol", section: "CAM", bucket: "controllable", trade: "security", cadence: "monthly", psf: 0.14, spread: 0.09, memo: "Gate & perimeter patrol" },
  { category: "Repairs & maintenance", section: "CAM", bucket: "controllable", trade: "repairs", cadence: "irregular", psf: 0.15, spread: 0.16, memo: "Common area repair" },
  { category: "Pest control", section: "CAM", bucket: "controllable", trade: "pest", cadence: "quarterly", psf: 0.02, spread: 0.12, memo: "Quarterly service" },
  { category: "Fire & life safety inspections", section: "CAM", bucket: "controllable", trade: "fire_safety", cadence: "semiannual", psf: 0.04, spread: 0.11, memo: "Sprinkler & alarm inspection" },
  { category: "Common area lighting — electricity", section: "CAM", bucket: "non_controllable", trade: "electricity", cadence: "monthly", psf: 0.11, spread: 0.13, memo: "Yard & common meter" },
  { category: "Water & sewer — common areas", section: "CAM", bucket: "non_controllable", trade: "water", cadence: "bimonthly", psf: 0.04, spread: 0.12, memo: "Common meter" },
  { category: "Snow removal", section: "CAM", bucket: "non_controllable", trade: "snow", cadence: "cold_season", psf: 0.09, spread: 0.22, memo: "Plowing & ice control" },
]);

export function catalogFor(kind: PropertyKind): readonly CategorySpec[] {
  switch (kind) {
    case "office":
      return OFFICE;
    case "industrial_flex":
      return FLEX;
    case "retail_strip":
      return RETAIL;
  }
}

/** Every category label the catalog can produce, for the keyword-safety test. */
export function allCategoryLabels(): string[] {
  return [...RETAIL, ...OFFICE, ...FLEX].map((c) => c.category);
}

/** The months a category bills in, 1–12. */
export function monthsFor(cadence: Cadence): number[] {
  switch (cadence) {
    case "monthly":
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    case "bimonthly":
      return [1, 3, 5, 7, 9, 11];
    case "quarterly":
      return [2, 5, 8, 11];
    case "semiannual":
      return [4, 10];
    case "annual":
      return [6];
    case "warm_season":
      return [3, 4, 5, 6, 7, 8, 9, 10, 11];
    case "cold_season":
      return [1, 2, 3, 11, 12];
    case "irregular":
      return [];
  }
}

/**
 * How a year's spend divides across the months it bills in. Snow is not spread
 * evenly across a winter and neither is landscaping across a summer; a flat
 * twelfth every month is the other thing that gives synthetic data away.
 */
export function seasonWeight(cadence: Cadence, month: number): number {
  if (cadence === "cold_season") {
    return { 1: 1.5, 2: 1.3, 3: 0.7, 11: 0.4, 12: 1.1 }[month as 1 | 2 | 3 | 11 | 12] ?? 1;
  }
  if (cadence === "warm_season") {
    return { 3: 0.6, 4: 1.0, 5: 1.2, 6: 1.3, 7: 1.3, 8: 1.2, 9: 1.1, 10: 0.9, 11: 0.5 }[
      month as 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
    ] ?? 1;
  }
  return 1;
}
