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

export type PropertyKind = "retail_strip" | "office" | "industrial_flex";
export type SizeBand = "small" | "medium" | "large";
export type Bucket = "controllable" | "non_controllable";
export type Section = "CAM" | "Taxes" | "Insurance" | "Fees";

export type SchemeId =
  | "unamortized_capital" // → RF-09
  | "above_cap_billing" //   → RF-06
  | "fee_base_expansion" //  → RF-07
  | "bucket_migration" //    → RF-04 (with RF-02 and RF-03)
  | "kept_tax_refund"; //    → nothing: only the tax backup betrays it

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
  amort_start: string; // ISO date, first day of a month
  amort_end: string; // ISO date, last day of a month
  monthly_cents: number;
  contractor: string;
  /** False when a scheme expensed the work instead of amortizing it. */
  amortized: boolean;
}

export interface TaxInstallment {
  due: string; // ISO date
  amount_cents: number;
}

export interface TaxCredit {
  /** The year whose assessment was appealed. */
  appeal_year: number;
  granted: string; // ISO date
  amount_cents: number;
  docket: string;
}

export interface TaxParcelYear {
  year: number;
  assessed_value_cents: number;
  rate_per_100: number; // dollars of tax per $100 of assessed value
  installments: TaxInstallment[];
  /** A refund the county granted this year against a prior year's assessment. */
  credit?: TaxCredit;
}

export interface TaxParcel {
  parcel_id: string;
  description: string;
  years: TaxParcelYear[];
}

export interface InsurancePolicyYear {
  year: number;
  premium_cents: number;
  fees_cents: number;
  invoice_number: string;
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
