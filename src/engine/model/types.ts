/**
 * The ground truth of one forged scenario.
 *
 * A `ScenarioModel` is everything the documents are drawn from: the property,
 * the lease, the ledger behind each expense line, the tax parcels, the
 * insurance policy, the tenant's account. Every renderer is a pure function of
 * this model and nothing else — which is what forces the cover-up to be
 * coherent when a scheme warps it. A scheme does not tell the billing statement
 * to lie; it changes the model, and the statement faithfully reports the
 * changed model.
 *
 * Every amount is integer cents. Dollars appear only at the boundary, where a
 * document is rendered or a ReconPackage is exported.
 */

// The Rider's clause ids live beside the clauses themselves, so the catalog and
// the list of what may be asked for cannot drift apart. Type-only, so nothing
// in the model depends on the renderer at run time.
import type { ClauseId } from "../render/lease/rider.ts";
import type { VariantId } from "./variants.ts";

export type PropertyKind = "retail_strip" | "office" | "industrial_flex";
export type SizeBand = "small" | "medium" | "large";
export type Bucket = "controllable" | "non_controllable";
export type Section = "CAM" | "Taxes" | "Insurance" | "Fees";

export type SchemeId =
  | "unamortized_capital" // → RF-09
  | "above_cap_billing" //   → RF-06
  | "fee_base_expansion" //  → RF-07
  | "bucket_migration" //    → RF-04 (with RF-02 and RF-03)
  | "kept_tax_refund"; //    → RF-13, and only through the tax backup the JSON carries

/** Canonical order. `applySchemes` follows it, so a combination is deterministic. */
export const SCHEME_ORDER: readonly SchemeId[] = Object.freeze([
  "unamortized_capital",
  "above_cap_billing",
  "fee_base_expansion",
  "bucket_migration",
  "kept_tax_refund",
]);

export interface ScenarioConfig {
  /** Any string. Hashed to the root of every stream; the whole scenario follows from it. */
  seed: string;
  start_year: number;
  /** Two or more, so the scanner's cross-year checks have something to compare. */
  year_count: 2 | 3;
  property_kind: PropertyKind;
  size_band: SizeBand;
  /** Empty means clean: every tie holds and the scanner finds nothing. */
  schemes: SchemeId[];
  /**
   * The tenant's own square footage, when someone has one in mind. Absent, it is
   * drawn from `size_band` the way it always was — and a config that omits both
   * this and `opex_psf_target` forges byte-for-byte what it forged before they
   * existed, which `tests/describe-regression.test.ts` holds.
   *
   * Supplying it inverts the derivation rather than overriding it: the property
   * grows around the premises, because tie T7 requires the billed share to be
   * exactly premises ÷ denominator. See `resolveFootprint` in `clean.ts`.
   */
  premises_sf?: number;
  /**
   * What a year of operating expenses should come to per square foot. The
   * generator scales the *inputs* it draws amounts from until the pool lands
   * near this; it never scales a finished figure, because a scaled figure can
   * land back on a round number the scanner would ask about.
   */
  opex_psf_target?: number;
  /**
   * The caption the package carries, when someone would rather write their own
   * than take the one the engine composes from the planted schemes.
   *
   * It is the only free text in a `ScenarioConfig` besides the seed, and the
   * only string a human wrote that reaches a forged document — which is why
   * `bounds.ts` holds it to a caption's length and refuses a name the family's
   * other apps have already spoken for. Everything else in the package is drawn
   * from the seeded name bank and could not carry a real name if it tried.
   */
  story?: string;
  /**
   * The optional clauses the lease carries, as a Rider after Article VII.
   *
   * Absent or empty means a lease of seven articles and no Rider. Absent must
   * forge byte-for-byte what it forged before the Rider existed, like
   * `premises_sf` above, and `tests/rider.test.ts` holds it against the same
   * fixtures; an empty list forges the same documents but is recorded as such
   * in the answer key, so the ZIP differs by a few bytes. Order here is
   * ignored: the Rider prints in catalog order, so two visitors who ticked the
   * same clauses in different orders get the same file.
   *
   * A clause changes the prose lease and nothing else. It moves no money, plants
   * no finding, and breaks no tie. See docs/adr/0005.
   */
  clauses?: ClauseId[];
  /**
   * The forms the backup documents take: a July-to-June tax year, quarterly
   * collection, a supplemental bill.
   *
   * Same rule as `clauses` above, and the same reason: absent forges what it
   * forged before variants existed, which `tests/variants.test.ts` holds against
   * the pinned packages, and an empty list forges the same documents while the
   * answer key records the configuration as passed.
   *
   * A variant changes how a figure is evidenced and never the figure. It moves
   * no money, plants no finding and breaks no tie: the property bears the same
   * tax in the same calendar year however its bills arrive. See docs/adr/0006.
   */
  variants?: VariantId[];
}

export interface Address {
  line1: string;
  city: string;
  state: string; // always "Franklin"
  state_abbr: string; // always "FK"
  zip: string; // always 000xx
}

export interface Universe {
  property_name: string;
  landlord_entity: string;
  management_agent: string;
  tenant_name: string;
  /** The tenant's own code for this location. It is what appears on filenames. */
  site_code: string;
  /** The landlord's code for the property, as it appears inside its workbooks. */
  property_code: string;
  /** The landlord's ledger account for this tenant. */
  tenant_ledger_account: string;
  address: Address;
  premises_suite: string;
  county: string;
  tax_collector: string;
  insurance_carrier: string;
  policy_number: string;
  /** Trade → invented vendor name. */
  vendors: Record<string, string>;
  /** Expense category → the landlord's GL account number. */
  gl_accounts: Record<string, string>;
}

export interface CapTerms {
  applies_to: "controllable";
  pct: number; // 4, 5 or 6
  method: "non_cumulative";
  /** The tenant-favourable reading: the ceiling grows on what was actually payable. */
  basis: "amount_paid";
  base_year: number;
  base_year_amount_cents: number;
  fee_treatment: "outside_cap";
}

export interface FeeTerms {
  kind: "management";
  rate_pct: number;
  base: "cam_only" | "cam_plus_insurance" | "all_opex";
}

/** A superset of the scanner's `LeaseLite`: what the prose lease and the ledger also need. */
export interface LeaseAbstract {
  landlord: string;
  tenant: string;
  premises_sf: number;
  denominator_sf: number;
  denominator_basis: "GLA";
  /** Fixed to four decimals, the way a statement prints it. */
  share_pct: number;
  commencement: string; // ISO date
  expiration: string; // ISO date
  permitted_use: string;
  base_rent_psf_year1: number; // dollars per sf per year, formatting only
  base_rent_escalation_pct: number;
  cap?: CapTerms;
  fee: FeeTerms;
  /** Always set. RF-09's lump test skips a lease that states neither this nor a life. */
  capital_threshold_cents: number;
  capital_life_years: number;
  gross_up: { allowed: boolean; to_pct: number };
}

export interface GLEntry {
  year: number;
  date: string; // ISO, inside the year
  account: string;
  category: string;
  vendor: string;
  memo: string;
  amount_cents: number;
}

export interface CategoryPool {
  category: string; // exactly as it appears on the statement
  section: Section;
  bucket: Bucket;
  amount_cents: number;
  /** Set when this line is the annual installment of an amortized capital project. */
  capital_project_id?: string;
  /** Set on the fee line. */
  is_fee?: boolean;
  /**
   * Set on capital lines, amortized or expensed. §6.03 allows no fee on a
   * capital item, so they are outside the base the fee is computed on — which
   * also keeps an expensed lump from dragging the fee up with it and producing
   * a second, unintended finding on top of the one the scheme planted.
   */
  outside_fee_base?: boolean;
  /** The trade whose vendor bills this category. */
  trade: string;
}

export interface CapitalProject {
  id: string;
  asset_name: string;
  asset_type: string;
  job_number: string;
  total_cost_cents: number;
  recovery_period_months: number;
  /** Simple interest on the unamortized balance, as the lease permits. */
  interest_rate_pct: number;
  amort_start: string; // ISO date, first day of a month
  amort_end: string; // ISO date, last day of a month
  /** Straight-line principal per month. Interest is added on top, per year. */
  monthly_cents: number;
  contractor: string;
  /**
   * How the line is captioned on the statement — deliberately not the asset's
   * name. A landlord summarises a year of amortization in one neutral line and
   * leaves the asset, the job number and the invoices to the schedule behind it.
   * It matters here for a second reason: a caption naming a roof or a parking
   * lot reads to RF-09 as capital work expensed in a lump.
   */
  statement_caption: string;
  /** False when a scheme expensed the work instead of amortizing it. */
  amortized: boolean;
}

export interface TaxInstallment {
  due: string; // ISO date
  amount_cents: number;
  /**
   * Set only where the county collects in quarters: the first instalments are
   * estimated from the prior year's levy and the later ones carry the actual
   * assessment, less what the estimates already took.
   */
  basis?: "preliminary" | "actual";
}

export interface TaxCredit {
  /** The year whose assessment was appealed. */
  appeal_year: number;
  granted: string; // ISO date
  amount_cents: number;
  docket: string;
}

/**
 * One bill on one parcel — which is not the same thing as one year of it.
 *
 * `year` is the tax year the bill is for; `period`, when the county's year is
 * not the calendar year, is what that tax year actually covers, and the
 * instalments below then fall in two calendar years. What the property bears in
 * a calendar year is always the instalments that came due in it — see
 * `src/engine/model/tax.ts`, which is the only place that question is answered.
 *
 * The name is historical: with no variants a parcel has exactly one bill a year
 * and the two words mean the same thing.
 */
export interface TaxParcelYear {
  year: number;
  assessed_value_cents: number;
  rate_per_100: number; // dollars of tax per $100 of assessed value
  installments: TaxInstallment[];
  /** A refund the county granted this year against a prior year's assessment. */
  credit?: TaxCredit;
  /** What the tax year covers, when the county's year is not the calendar year. */
  period?: { start: string; end: string; label: string };
  /** The levy the preliminary instalments were estimated from, where there are any. */
  prior_levy_cents?: number;
  /**
   * Set on a supplemental bill: a reassessment billed over and above the year's
   * bill, whose `assessed_value_cents` is the *increase* in assessed value. The
   * increase is carved out of the base bill rather than added to it, so the
   * property bears the same tax — a supplemental that added tax would be a
   * scheme, not a variant.
   */
  supplemental?: { reason: string; issued: string };
}

export interface TaxParcel {
  parcel_id: string;
  description: string;
  years: TaxParcelYear[];
}

/**
 * One policy year, and the shapes a carrier's invoice for it can take.
 *
 * The three optional fields are Variants and follow the Variant rule: the
 * premium and the fees are what they always were, and what changes is how the
 * invoice presents them. `lines` add to `premium_cents`; `installments` add to
 * `premium_cents`; `fee_installments` add to `fees_cents`. Tie T5 asks the same
 * question of the invoice either way.
 */
export interface InsurancePolicyYear {
  year: number;
  premium_cents: number;
  fees_cents: number;
  invoice_number: string;
  /** The premium broken out by coverage, where the carrier prices it that way. */
  lines?: Array<{ coverage: string; premium_cents: number }>;
  /** A down payment and monthly instalments, where the premium is financed. */
  installments?: Array<{ due: string; label: string; amount_cents: number }>;
  /** The policy fees collected in quarters rather than at inception. */
  fee_installments?: Array<{ due: string; label: string; amount_cents: number }>;
}

export interface InsurancePolicy {
  carrier: string;
  policy_number: string;
  period_start_month: number; // 1–12; the policy year runs from here
  coverages: Array<{ coverage: string; limit_cents: number; deductible_cents: number }>;
  years: InsurancePolicyYear[];
}

export type LedgerCode = "EST" | "PAY" | "REC" | "RNT";

export interface LedgerEntry {
  date: string; // ISO
  period: string; // "2024-03"
  code: LedgerCode;
  description: string;
  charge_cents: number; // 0 when this row is a payment
  payment_cents: number; // 0 when this row is a charge
  balance_cents: number; // running balance after this row
}

/** The recon arithmetic for one year, all of it derived, none of it drawn. */
export interface ReconComputed {
  /** Σ of every pool line, the property-level total the landlord reconciled. */
  pool_total_cents: number;
  /** Σ of the controllable lines — the pool the cap applies to. */
  controllable_actual_cents: number;
  /** The ceiling the lease allows this year, or null in a year with no prior reference. */
  cap_allowed_cents: number | null;
  /** What the landlord billed for the capped pool. Clean: the lesser of actual and ceiling. */
  cap_billed_cents: number;
  /** The base the fee was computed on, as billed. */
  fee_base_cents: number;
  fee_billed_cents: number;
  /** Property-level total as billed, honouring the cap computation. */
  billed_pool_cents: number;
  tenant_total_cents: number;
  estimates_paid_cents: number;
  balance_due_cents: number;
}

export interface ModelYear {
  year: number;
  occupancy_pct: number;
  denominator_sf: number;
  pools: CategoryPool[];
  gl: GLEntry[];
  estimate_monthly_cents: number;
  recon: ReconComputed;
}

export type TieId = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";

export interface AnswerFinding {
  scheme: SchemeId;
  /** null means no scanner check sees this — only the documents do. */
  check_id: string | null;
  /**
   * False when the scanner will not raise this finding even though a check
   * exists for it — set while the answer key is assembled, not by the scheme.
   *
   * The case that forces this: in the year a capital item is expensed in a
   * lump, the scanner counts that lump inside the base a management fee may be
   * charged on, because a statement gives it no way to know the lease excludes
   * capital from the fee base. The permitted fee it computes for that year is
   * therefore larger than the fee actually billed, and RF-07 stays silent — the
   * overcharge is real, and the scanner is being conservative about a fact it
   * cannot see. The manifest leaves these out; the answer key keeps them.
   */
  scanner_visible?: boolean;
  year: number | [number, number];
  category: string;
  severity: "info" | "review" | "high";
  /** Tenant-level dollars, as a range the scanner's own estimate must fall inside. */
  expected_impact_range?: [number, number];
  /** One sentence: which tie broke. */
  seam: string;
  /** Where in the paper to look. */
  evidence: string[];
  note?: string;
  /** Checks expected to fire incidentally alongside this one. */
  cofires?: string[];
}

export interface PlantedScheme {
  id: SchemeId;
  /** Exactly the ties this scheme breaks. Everything else still holds. */
  seams: TieId[];
  findings: AnswerFinding[];
}

export interface ScenarioModel {
  config: ScenarioConfig;
  universe: Universe;
  lease: LeaseAbstract;
  years: ModelYear[]; // ascending
  capital_projects: CapitalProject[];
  tax_parcels: TaxParcel[];
  insurance: InsurancePolicy;
  ledger: LedgerEntry[];
  /** Recon year → the ISO date the landlord delivered the package. */
  delivery: Record<number, string>;
  planted: PlantedScheme[];
}
