/**
 * The Rider — the clauses a visitor adds to the lease beyond its seven articles.
 *
 * Articles I to VII are a contract with the Red-Flag Scanner: an answer key
 * forged here cites §6.04 and a finding raised there cites §6.04, so nothing in
 * that numbering may move and no section may be added inside it. Anything
 * optional therefore rides *after* Article VII, numbered R1 onward, where it
 * can appear and disappear without touching a citation. A lease with nothing
 * added has no Rider at all and forges the bytes it always did.
 *
 * Two rules govern what a clause may say.
 *
 * **Restate, never contradict.** Every paragraph here is a pure function of the
 * same model Article VI is built from, and it may only say again — at greater
 * length, in the place a reader would look for it — what the package already
 * does. A clause that promised something the forge does not honour would hand a
 * trainee a finding nobody planted, which is the one thing this file must never
 * do. So the repairs clause leaves a capital replacement recoverable under
 * §6.04, because the forge amortizes roofs and paving under exactly that
 * Section; and the tax clause credits a refund in the Lease Year Landlord
 * receives it, because that is where the collector's account statement puts it.
 *
 * **Nothing tenant-specific.** The same Rider has to read as a lease a big-box
 * retailer, an e-commerce distributor or a manufacturer could all have signed.
 * The only thing the wording keys on is the kind of property — a truck court is
 * not a lobby is not a parking field — through the phrase table below.
 *
 * A clause changes the lease document and nothing else: no pool, no tie, no
 * scheme, no finding. A provision that moved money would be a scheme, and
 * schemes are built as schemes. See docs/adr/0005.
 */

import type { PropertyKind, ScenarioModel } from "../../model/types.ts";
import type { LeaseArticle, LeaseSection } from "./doc.ts";

export type ClauseId =
  | "repairs_landlord"
  | "repairs_self_help"
  | "tenant_repairs"
  | "alterations"
  | "utilities_metered"
  | "utilities_common"
  | "taxes_share"
  | "taxes_excluded"
  | "insurance_landlord"
  | "insurance_tenant"
  | "common_areas"
  | "parking";

export interface RiderClause {
  id: ClauseId;
  /** "R1.1". Assigned from the catalog's own order, never from tick order. */
  ref: string;
  title: string;
  paragraphs: (model: ScenarioModel) => string[];
}

export interface RiderSection {
  /** "R1". */
  numeral: string;
  title: string;
  clauses: RiderClause[];
}

/**
 * What the common parts of a property are called, and which utilities serve
 * them. The only thing in the Rider that varies, and it varies on the building,
 * never on who signed for it.
 */
interface KindPhrases {
  common_areas: string;
  common_utilities: string;
  parking: string;
}

const PHRASES: Readonly<Record<PropertyKind, KindPhrases>> = Object.freeze({
  retail_strip: {
    common_areas: "the parking field, the drive aisles, the sidewalks, the pylon and monument signs and the landscaped areas",
    common_utilities: "lot lighting and irrigation",
    parking: "the surface parking field and the drive aisles serving it",
  },
  office: {
    common_areas: "the lobbies, the elevators, the corridors, the restrooms, the parking structure and the building systems serving more than one tenant",
    common_utilities: "house electricity and the building water and sewer meter",
    parking: "the parking structure and the surface spaces adjoining it",
  },
  industrial_flex: {
    common_areas: "the truck court, the dock doors and levellers, the yard, the drive aisles and the perimeter fencing",
    common_utilities: "yard lighting and the common water meter",
    parking: "the marked automobile spaces and the trailer positions in the yard",
  },
});

function phrases(model: ScenarioModel): KindPhrases {
  return PHRASES[model.config.property_kind];
}

// ---------------------------------------------------------------------------
// The catalog. Six sections, two clauses each; the order here is the order the
// Rider prints in, whatever order they were ticked.
// ---------------------------------------------------------------------------

const CATALOG: ReadonlyArray<{ title: string; clauses: Array<Omit<RiderClause, "ref">> }> = [
  {
    title: "Landlord's Maintenance and Repairs",
    clauses: [
      {
        id: "repairs_landlord",
        title: "Landlord's obligations",
        paragraphs: (m) => [
          `Landlord shall maintain and repair the roof, the foundation, the structural elements and the exterior walls of the buildings on the Property, and shall operate and maintain ${phrases(m).common_areas}, in the condition of comparable properties in the area. The cost of that maintenance and repair is an Operating Expense to the extent Article VI permits it.`,
          "Where an item of that work is properly classified as a capital expenditure, its cost is recoverable only as Section 6.04 permits — capitalized and amortized over the period that Section states, with only the installment attributable to the Lease Year included.",
        ],
      },
      {
        id: "repairs_self_help",
        title: "Tenant's right to maintain",
        paragraphs: () => [
          "If Landlord fails to perform maintenance or repair required of it and that failure continues for thirty (30) days after written notice from Tenant describing the work, or, where the work cannot reasonably be completed within that period, if Landlord fails to begin it within that period and pursue it diligently, Tenant may perform the work itself.",
          "The cost Tenant bears in doing so is Tenant's own, and is excluded from Operating Expenses: Landlord shall neither include it in a statement delivered under Section 6.06 nor charge a fee upon it. Work on the roof, the foundation and the structural elements remains Landlord's and is not subject to this Section.",
        ],
      },
    ],
  },
  {
    title: "Tenant's Repairs and Alterations",
    clauses: [
      {
        id: "tenant_repairs",
        title: "Tenant's repairs",
        paragraphs: () => [
          "Tenant shall keep the interior of the Premises, and the systems and equipment serving the Premises alone, in good order and repair at its own cost, ordinary wear and casualty excepted.",
          "Work Landlord performs inside the Premises at Tenant's request, or to repair damage caused by Tenant, is billed to Tenant directly on Landlord's own invoice for it and is not an Operating Expense. No work may be recovered twice, once as a direct charge to Tenant and once through Article VI.",
        ],
      },
      {
        id: "alterations",
        title: "Alterations and restoration",
        paragraphs: () => [
          "Tenant may make non-structural alterations within the Premises without Landlord's consent, provided they penetrate neither the roof, the slab nor an exterior wall and affect no system serving more than the Premises. Any other alteration requires Landlord's consent, which shall not be unreasonably withheld, conditioned or delayed.",
          "Landlord shall state at the time it consents whether the alteration is to be removed at the expiration of the Term; absent that statement, the alteration may remain and Tenant has no obligation to restore. The cost of an alteration made for Tenant is not an Operating Expense, whoever performs the work.",
        ],
      },
    ],
  },
  {
    title: "Utilities",
    clauses: [
      {
        id: "utilities_metered",
        title: "Separately metered utilities",
        paragraphs: () => [
          "Utilities separately metered to the Premises are contracted for and paid by Tenant directly to the supplier, and are excluded from Operating Expenses.",
          "No utility charge may be recovered twice. A cost Tenant pays directly under this Section shall not appear, in whole or in any part, in a utility category reconciled under Section 6.06.",
        ],
      },
      {
        id: "utilities_common",
        title: "Common-area utilities",
        paragraphs: (m) => [
          `Utilities serving the common areas of the Property, ${phrases(m).common_utilities} among them, are Operating Expenses of the Non-Controllable class under Section 6.01, at the cost Landlord actually pays the supplier and without mark-up, administrative surcharge or margin of any description.`,
          "A rebate, credit or refund Landlord receives from a utility supplier reduces the expense for the Lease Year in which Landlord receives it, and Landlord shall furnish the supplier's bills for any category examined under Section 6.07.",
        ],
      },
    ],
  },
  {
    title: "Taxes",
    clauses: [
      {
        id: "taxes_share",
        title: "Real property taxes",
        paragraphs: () => [
          "Landlord shall pay Taxes to the collecting authority when they fall due, and shall take any installment plan, discount or early-payment allowance available to it. Tenant bears its Proportionate Share of Taxes through Article VI, and Taxes are Operating Expenses of the Non-Controllable class under Section 6.01.",
          "Any refund, abatement or credit Landlord receives in respect of the Property reduces Taxes for the Lease Year in which Landlord receives it, whatever Lease Year's assessment it relates to, as Section 6.06 requires. Landlord shall furnish the assessment notices, the tax bills and the collector's account for each Lease Year on request.",
        ],
      },
      {
        id: "taxes_excluded",
        title: "Excluded taxes",
        paragraphs: () => [
          "Taxes do not include Landlord's income, franchise, gross-receipts, capital-stock, estate, inheritance, transfer, recording or documentary taxes, nor any interest, penalty or fee charged for late payment or late filing.",
          "A special assessment is included in Operating Expenses only in the installments falling due within the Term, and only as spread over the longest period the assessing authority permits it to be paid in.",
        ],
      },
    ],
  },
  {
    title: "Insurance",
    clauses: [
      {
        id: "insurance_landlord",
        title: "Landlord's insurance",
        paragraphs: () => [
          "Landlord shall carry property insurance on the buildings and improvements at the Property on a replacement-cost basis, and commercial general liability insurance. The premium Landlord actually pays a carrier, together with the policy fees and surplus lines taxes shown on the carrier's invoice, is an Operating Expense of the Non-Controllable class under Section 6.01.",
          "A deductible Landlord bears upon a covered loss is recoverable as an Operating Expense only to the extent it does not exceed one year's premium for the coverage the loss was made under. An amount Landlord retains under a self-insured programme, a captive insurer or a retention is not a premium and is not an Operating Expense, and neither is a premium for the coverage of a risk arising away from the Property.",
        ],
      },
      {
        id: "insurance_tenant",
        title: "Tenant's insurance and subrogation",
        paragraphs: () => [
          "Tenant shall carry property insurance upon its own trade fixtures, equipment and improvements, and commercial general liability insurance covering its use of the Premises, naming Landlord and its management agent as additional insureds, and shall furnish a certificate evidencing it on request.",
          "Landlord and Tenant each waive every right of recovery against the other, and shall cause their insurers to waive subrogation, for a loss of a kind a property policy required by this Lease would cover, whether or not the policy was in fact carried and including any deductible borne upon it.",
        ],
      },
    ],
  },
  {
    title: "Common Areas and Parking",
    clauses: [
      {
        id: "common_areas",
        title: "Common areas",
        paragraphs: (m) => [
          `The common areas are those parts of the Property outside the leasable premises that Landlord makes available for the common use of the tenants of the Property and their invitees, including ${phrases(m).common_areas}.`,
          "Landlord shall operate, maintain, insure and light the common areas, and may alter their configuration, provided it does not thereby materially reduce Tenant's access to the Premises or the parking available to it. The cost of doing so is an Operating Expense to the extent Article VI permits, and carries the class Section 6.01 fixes for it.",
        ],
      },
      {
        id: "parking",
        title: "Parking",
        paragraphs: (m) => [
          `Tenant, its employees and its invitees may use ${phrases(m).parking} in common with the other tenants of the Property, at no charge separate from Base Rent and Operating Expenses. Landlord shall not convert parking to another use so as to reduce the parking serving the Property below what applicable law requires of it.`,
          "Revenue Landlord receives from the parking areas, whether from parking charges, permits or the licensing of spaces, is credited against Operating Expenses for the Lease Year in which Landlord receives it.",
        ],
      },
    ],
  },
];

/** The six sections, with each clause's Rider reference already assigned. */
export const RIDER_SECTIONS: readonly RiderSection[] = Object.freeze(
  CATALOG.map((section, si) => ({
    numeral: `R${si + 1}`,
    title: section.title,
    clauses: section.clauses.map((c, ci) => ({ ...c, ref: `R${si + 1}.${ci + 1}` })),
  })),
);

/** Every clause id, in catalog order. The engine's gate reads this list. */
export const CLAUSE_IDS: readonly ClauseId[] = Object.freeze(RIDER_SECTIONS.flatMap((s) => s.clauses.map((c) => c.id)));

/**
 * The sections of the Rider the model's config selects, in catalog order.
 *
 * A section appears only when one of its clauses does, and an empty selection
 * produces an empty Rider — which is what keeps a config that says nothing
 * about clauses forging the file it always forged.
 */
export function buildRider(model: ScenarioModel): LeaseArticle[] {
  const selected = new Set<string>(model.config.clauses ?? []);
  if (selected.size === 0) return [];

  const out: LeaseArticle[] = [];
  for (const section of RIDER_SECTIONS) {
    const sections: LeaseSection[] = section.clauses
      .filter((c) => selected.has(c.id))
      .map((c) => ({ ref: c.ref, title: c.title, present: true, paragraphs: c.paragraphs(model) }));
    if (sections.length > 0) out.push({ numeral: section.numeral, title: section.title, sections });
  }
  return out;
}
