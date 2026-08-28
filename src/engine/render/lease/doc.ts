/**
 * The lease itself — the document every finding is ultimately argued from.
 *
 * Ported from `red-flag-scanner/src/lease/doc.ts` (commit c050bad). Copied, not
 * imported, and changed in three ways that matter:
 *
 * 1. It is built from the foundry's `LeaseAbstract`, which knows things the
 *    scanner's `LeaseLite` does not — the parties, the suite, the term dates,
 *    the rent schedule. So Articles I, II, III and V are filled from the model
 *    instead of standing as a static shell. A trainee reading this lease can
 *    check the premises area against the statement's denominator, which is the
 *    first thing an auditor actually does.
 * 2. The landlord is the model's landlord. The scanner's copy hard-codes a
 *    Maplewood entity; nothing here is Maplewood.
 * 3. It renders to a printable page rather than to the scanner's clause
 *    designer, so there are no editable-field descriptors and no widget layer.
 *    Everything else — the article numbering, and the operative language of
 *    Article VI, which is where the money is — is the scanner's, deliberately
 *    unchanged.
 *
 * Pure and deterministic: no clock, no DOM, no I/O.
 */

import type { LeaseAbstract, ScenarioModel } from "../../model/types.ts";
import { longDate } from "../../dates.ts";
import { ARTICLES, SECTION_TITLE } from "./sections.ts";

export interface LeaseSection {
  ref: string;
  title: string;
  /** False when the lease is silent here and the section reads as a negative clause. */
  present: boolean;
  paragraphs: string[];
}

export interface LeaseArticle {
  numeral: string;
  title: string;
  sections: LeaseSection[];
}

export interface LeaseDoc {
  title: string;
  parties: string;
  articles: LeaseArticle[];
}

// ---------------------------------------------------------------------------
// Lease register — numbers as a lease spells them
// ---------------------------------------------------------------------------

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Whole numbers below one hundred, as a lease spells them. Others stay in digits. */
export function words(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = n % 10;
  return o === 0 ? t : `${t}-${ONES[o]!}`;
}

/** `5` → "five percent (5%)"; `4.5` → "4.5%". */
export function pctProse(n: number): string {
  const w = words(n);
  const digits = `${Number(n.toFixed(4))}%`;
  return w ? `${w} percent (${digits})` : digits;
}

export function usdProse(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return (neg ? "-$" : "$") + Math.floor(abs / 100).toLocaleString("en-US") + "." + String(abs % 100).padStart(2, "0");
}

function sf(n: number): string {
  return `${n.toLocaleString("en-US")} rentable square feet`;
}

const METHOD_PROSE = {
  non_cumulative: "on a non-cumulative basis, each Lease Year standing on its own with no carry-forward of any unused increase",
} as const;

const BASIS_PROSE = {
  amount_paid: "the amount actually payable by Tenant for the preceding Lease Year, being the lesser of the actual expense and the capped amount",
} as const;

const FEE_BASE_PROSE = {
  cam_only: "Common Area Maintenance costs only",
  cam_plus_insurance: "Common Area Maintenance costs and insurance premiums",
  all_opex: "all Operating Expenses, including Taxes and insurance premiums",
} as const;

// ---------------------------------------------------------------------------

function yearList(years: readonly number[]): string {
  if (years.length === 1) return `the Lease Year ended December 31, ${years[0]}`;
  return `the Lease Years ended December 31, ${years[0]} through December 31, ${years[years.length - 1]}`;
}

function rentSchedule(lease: LeaseAbstract, years: readonly number[]): string {
  return years
    .map((y, i) => {
      const psf = lease.base_rent_psf_year1 * Math.pow(1 + lease.base_rent_escalation_pct / 100, i);
      const annual = Math.round(lease.premises_sf * psf * 100);
      return `${y}: $${psf.toFixed(2)} per rentable square foot, being ${usdProse(annual)} per annum, payable in twelve equal monthly instalments of ${usdProse(Math.round(annual / 12))}`;
    })
    .join("; ");
}

export function buildLeaseDoc(model: ScenarioModel): LeaseDoc {
  const lease = model.lease;
  const u = model.universe;
  const years = model.years.map((y) => y.year);

  const S: Record<string, LeaseSection> = {};
  const put = (ref: string, present: boolean, paragraphs: string[]) => {
    S[ref] = { ref, title: SECTION_TITLE[ref] ?? ref, present, paragraphs };
  };

  // --- Article I: the parties, from the model rather than from a stub.
  put("1.01", true, [
    `This Lease is made between ${lease.landlord} ("Landlord"), whose address for notices is c/o ${u.management_agent}, and ${lease.tenant} ("Tenant"), for premises within ${u.property_name}, ${u.address.line1}, ${u.address.city}, ${u.address.state} ${u.address.zip} (the "Property"). Landlord's property number for the Property is ${u.property_code}; Tenant's account number is ${u.tenant_ledger_account}.`,
  ]);
  put("1.02", true, [
    '"Lease Year" means each calendar year falling within the Term. "Operating Expenses" has the meaning given in Section 6.01. "Taxes" means real property taxes and assessments levied against the Property.',
    `"Gross Leasable Area" means ${sf(lease.denominator_sf)}, being the aggregate rentable area of the Property, whether or not occupied.`,
  ]);

  // --- Article II: premises and term.
  put("2.01", true, [
    `Landlord leases to Tenant ${u.premises_suite}, comprising approximately ${sf(lease.premises_sf)} (the "Premises"), within the Property.`,
  ]);
  put("2.02", true, [
    `The Term commences ${longDate(lease.commencement)} and expires ${longDate(lease.expiration)}, unless sooner terminated.`,
    `The Term includes ${yearList(years)}, being the periods reconciled under Section 6.06.`,
  ]);

  // --- Article III: rent.
  put("3.01", true, [
    `Tenant shall pay Base Rent monthly in advance, without demand, deduction or set-off, as follows — ${rentSchedule(lease, years)}. Base Rent escalates ${pctProse(lease.base_rent_escalation_pct)} on each anniversary of the commencement date.`,
    "Base Rent is not an Operating Expense and is not subject to reconciliation under Section 6.06.",
  ]);

  // --- Article IV: the share.
  put("4.01", true, [
    `Tenant's Proportionate Share is the quotient obtained by dividing the rentable area of the Premises (${sf(lease.premises_sf)}) by the Gross Leasable Area of the Property (${sf(lease.denominator_sf)}), expressed as a percentage, being ${pctProse(lease.share_pct)}.`,
    "The denominator is Gross Leasable Area and does not vary with occupancy. Landlord shall state on each reconciliation the denominator used.",
  ]);

  // --- Article V: use and services.
  put("5.01", true, [`Tenant shall use the Premises for ${lease.permitted_use.toLowerCase()}, and for no other purpose.`]);
  put("5.02", true, [
    "Landlord shall provide the common area services described in Section 6.01. Utilities separately metered to the Premises are paid by Tenant directly and are not Operating Expenses.",
  ]);

  // --- 6.01 Definition and exclusions.
  put("6.01", true, [
    '"Operating Expenses" means the costs Landlord actually incurs in owning, operating, maintaining, repairing and insuring the Property, together with Taxes, computed on an accrual basis and without duplication.',
    'Operating Expenses are of two classes. "Non-Controllable Operating Expenses" means only Taxes, insurance premiums, utility charges and snow and ice removal' +
      (lease.cap?.fee_treatment === "outside_cap" ? ", the amortization permitted by Section 6.04, and any fee permitted by Section 6.03" : "") +
      '. All other Operating Expenses are "Controllable Operating Expenses." A cost\'s class is fixed by this Section and is not changed by the caption, the grouping or the vendor under which Landlord presents it on a statement.',
    "Operating Expenses exclude: Landlord's general overhead and the salaries of personnel above the level of on-site manager; leasing commissions, marketing and tenant improvement costs; costs reimbursed by insurance, warranty or a particular tenant; costs of correcting defective construction; capital items except as Section 6.04 permits; and any fee beyond the one permitted by Section 6.03.",
  ]);

  // --- 6.02 Cap.
  const cap = lease.cap;
  put(
    "6.02",
    cap !== undefined,
    cap
      ? [
          `Notwithstanding anything in this Article to the contrary, the Controllable Operating Expenses payable by Tenant shall not increase by more than ${pctProse(cap.pct)} per Lease Year, ${METHOD_PROSE[cap.method]}.`,
          `The increase is measured against ${BASIS_PROSE[cap.basis]}. The base for the Lease Year ended December 31, ${cap.base_year} is ${usdProse(cap.base_year_amount_cents)}.`,
          "Any fee permitted by Section 6.03 is excluded from the capped amount. In no Lease Year shall Tenant be charged more than the lesser of the actual expense and the amount permitted by this Section.",
        ]
      : [
          "This Lease contains no cap on Operating Expenses. Tenant pays its Proportionate Share of the actual costs Landlord incurs, without ceiling and without a Base Year.",
        ],
  );

  // --- 6.03 Fees.
  put("6.03", true, [
    `Landlord may include in Operating Expenses a management fee of ${pctProse(lease.fee.rate_pct)} of ${FEE_BASE_PROSE[lease.fee.base]}.`,
    "A fee permitted by this Section is computed on the base stated for it and on no other amount. No fee is chargeable on Taxes, on insurance premiums, on any capital item, or on any other fee, and Landlord shall not charge both a management fee and an administrative fee for the same service.",
  ]);

  // --- 6.04 Capital.
  put("6.04", true, [
    `Any item costing more than ${usdProse(lease.capital_threshold_cents)} that is properly classified as a capital expenditure shall be capitalized and amortized on a straight-line basis over ${words(lease.capital_life_years) ?? lease.capital_life_years} (${lease.capital_life_years}) years, together with interest on the unamortized balance at the rate stated on the amortization schedule.`,
    "Only the amortization installment attributable to the Lease Year, prorated for any partial year from the date the item is placed in service, may be included in Operating Expenses. No part of the cost may be charged in the year incurred, and no installment may be charged after the amortization period ends. Landlord shall furnish the invoice, the in-service date and the amortization schedule on request.",
  ]);

  // --- 6.05 Gross-up.
  put(
    "6.05",
    true,
    lease.gross_up.allowed
      ? [
          `If the Property is less than ${pctProse(lease.gross_up.to_pct)} occupied during any Lease Year, Landlord may gross up those components of Operating Expenses that vary with occupancy to the amount that would have been incurred at ${pctProse(lease.gross_up.to_pct)} occupancy.`,
          "Costs that do not vary with occupancy — including Taxes, insurance premiums and fixed contract charges — shall not be grossed up, and no cost shall be grossed up beyond that level of occupancy. Landlord shall state on each reconciliation the occupancy used and the components grossed up.",
        ]
      : ["Landlord shall not gross up Operating Expenses for vacancy. Tenant pays its Proportionate Share of the costs actually incurred."],
  );

  // --- 6.06 Reconciliation.
  put("6.06", true, [
    "Landlord shall bill Tenant monthly estimates of Tenant's Proportionate Share of Operating Expenses, and within one hundred twenty (120) days after the end of each Lease Year shall deliver a statement showing Operating Expenses by category, Tenant's Proportionate Share, the estimates paid and the balance owing or refundable.",
    "Each statement shall be arithmetically correct: each subtotal shall equal the sum of the amounts it comprises, the amount charged to Tenant shall equal the reconciled pool multiplied by Tenant's Proportionate Share, and the balance shall equal that amount less the estimates paid for the Lease Year. Any overpayment is credited or refunded within thirty (30) days.",
    "Taxes included in Operating Expenses are net of any refund, abatement or credit Landlord receives in respect of the Property, whichever Lease Year the refund relates to, and Landlord shall furnish the assessment notices, the tax bills and the collector's account for each Lease Year on request.",
  ]);

  // --- 6.07 Audit rights.
  put("6.07", true, [
    "Tenant may, within twenty-four (24) months after receiving a statement, examine Landlord's books and records for the Lease Year covered by it, by an examiner of Tenant's choosing, including one compensated in whole or in part on the basis of the recovery obtained.",
    "Landlord shall make available the general ledger detail supporting each category, the invoices for any category examined, the amortization schedule for any item recovered under Section 6.04, and the occupancy and area figures used. If the examination shows Operating Expenses overstated by more than three percent (3%), Landlord shall bear the reasonable cost of the examination and shall refund the overcharge within thirty (30) days.",
  ]);

  // --- Article VII.
  put("7.01", true, [
    `Notices under this Lease shall be in writing and delivered to Landlord c/o ${u.management_agent} and to Tenant at ${u.premises_suite}, ${u.address.line1}, ${u.address.city}, ${u.address.state_abbr} ${u.address.zip}.`,
  ]);
  put("7.02", true, [
    "This Lease is the entire agreement of the parties as to its subject matter. No statement on a reconciliation, and no course of billing, amends it.",
  ]);

  return {
    title: `${model.config.property_kind === "office" ? "Office" : model.config.property_kind === "industrial_flex" ? "Industrial" : "Retail"} Lease — ${u.property_name}`,
    parties: `${lease.landlord} (Landlord) and ${lease.tenant} (Tenant)`,
    articles: ARTICLES.map((a) => ({
      numeral: a.numeral,
      title: a.title,
      sections: a.sections.map((s) => S[s.ref] ?? { ref: s.ref, title: s.title, present: false, paragraphs: [] }),
    })),
  };
}

/** Flatten the document to sections, in numbering order. */
export function sectionsOf(doc: LeaseDoc): LeaseSection[] {
  return doc.articles.flatMap((a) => a.sections);
}
