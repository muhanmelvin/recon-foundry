/**
 * The lease's article and section numbering, and the map from a scanner check to
 * the clause it argues from.
 *
 * **Copied verbatim from `red-flag-scanner/src/lease/sections.ts` (commit
 * c050bad), and it must stay that way.** The numbering is a contract between two
 * apps: an answer key forged here cites §6.04, a finding raised there cites
 * §6.04, and a trainee comparing the two has to be looking at the same clause.
 * Copy, never import, is the family rule — so if the scanner ever renumbers,
 * this file is a deliberate follow-up, not an automatic one.
 *
 * Sections the model is silent on are still rendered, as negative clauses
 * ("This Lease contains no cap on Operating Expenses"), which keeps every
 * citation anchor alive in every forged package.
 */

export interface SectionDef {
  ref: string;
  title: string;
}

export interface ArticleDef {
  numeral: string;
  title: string;
  sections: SectionDef[];
}

export const ARTICLES: readonly ArticleDef[] = Object.freeze([
  {
    numeral: "I",
    title: "Basic Provisions",
    sections: [
      { ref: "1.01", title: "Parties and Property" },
      { ref: "1.02", title: "Defined Terms" },
    ],
  },
  {
    numeral: "II",
    title: "Premises and Term",
    sections: [
      { ref: "2.01", title: "Premises" },
      { ref: "2.02", title: "Term and Lease Years" },
    ],
  },
  {
    numeral: "III",
    title: "Base Rent",
    sections: [{ ref: "3.01", title: "Base Rent" }],
  },
  {
    numeral: "IV",
    title: "Proportionate Share",
    sections: [{ ref: "4.01", title: "Tenant's Proportionate Share" }],
  },
  {
    numeral: "V",
    title: "Use and Services",
    sections: [
      { ref: "5.01", title: "Permitted Use" },
      { ref: "5.02", title: "Services and Utilities" },
    ],
  },
  {
    numeral: "VI",
    title: "Operating Expenses",
    sections: [
      { ref: "6.01", title: "Operating Expenses Defined; Exclusions" },
      { ref: "6.02", title: "Cap on Increases" },
      { ref: "6.03", title: "Management and Administrative Fees" },
      { ref: "6.04", title: "Capital Items and Amortization" },
      { ref: "6.05", title: "Occupancy Gross-Up" },
      { ref: "6.06", title: "Estimates, Statements and Reconciliation" },
      { ref: "6.07", title: "Books, Records and Tenant's Right to Examine" },
    ],
  },
  {
    numeral: "VII",
    title: "Miscellaneous",
    sections: [
      { ref: "7.01", title: "Notices" },
      { ref: "7.02", title: "Entire Agreement" },
    ],
  },
]);

export const SECTION_TITLE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(ARTICLES.flatMap((a) => a.sections.map((s) => [s.ref, s.title]))),
);

/**
 * The clause each check argues from — first ref is the primary citation.
 * Checks that read the lease directly cite the clause they read; the pure
 * statement heuristics cite the examination right that lets Tenant ask.
 */
export const CLAUSE_FOR_CHECK: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "RF-01": ["6.07"],
  "RF-02": ["6.01", "6.07"],
  "RF-03": ["6.07"],
  "RF-04": ["6.02", "6.01"],
  "RF-05": ["6.07"],
  "RF-06": ["6.02"],
  "RF-07": ["6.03"],
  "RF-08": ["4.01"],
  "RF-09": ["6.04"],
  "RF-10": ["6.05"],
  "RF-11": ["6.06"],
  "RF-12": ["6.07"],
});

/** DOM id for a section anchor: 6.02 → sec-6-02. */
export function anchorFor(ref: string): string {
  return `sec-${ref.replace(/\./g, "-")}`;
}
