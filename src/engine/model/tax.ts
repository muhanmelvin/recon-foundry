/**
 * What the property's tax bills say, read by calendar year.
 *
 * A parcel's `years` are its bills, and a bill is not the same thing as a year:
 * under a July-to-June tax year one bill's instalments fall in two calendar
 * years, and a supplemental bill after a reassessment is a second bill inside
 * one. So every question the rest of the app asks about taxes — what the pool
 * bills, what the ledger books, what the collector's account shows, what the
 * ReconPackage carries — is asked the same way here: **which instalments came
 * due in this calendar year, and which credits were granted in it.**
 *
 * That is the one definition. It is also what makes a Variant a Variant: the
 * bills can arrive in any shape at all and the answer to "what did the property
 * bear in 2024" is unchanged.
 */

import type { TaxCredit, TaxParcel, TaxParcelYear } from "./types.ts";

const yearOf = (isoDate: string): number => Number(isoDate.slice(0, 4));

/** The instalments of one bill that came due in `year`. */
export function installmentsIn(bill: TaxParcelYear, year: number): TaxParcelYear["installments"] {
  return bill.installments.filter((i) => yearOf(i.due) === year);
}

/** Every bill with an instalment due in `year` — what the year's backup prints. */
export function billsServing(parcel: TaxParcel, year: number): TaxParcelYear[] {
  return parcel.years.filter((b) => b.installments.some((i) => yearOf(i.due) === year));
}

/** What one parcel was billed for `year`: its instalments, gross of any credit. */
export function parcelBilledIn(parcel: TaxParcel, year: number): number {
  let total = 0;
  for (const bill of parcel.years) for (const i of installmentsIn(bill, year)) total += i.amount_cents;
  return total;
}

/** What the whole property was billed for `year`, gross of credits. */
export function taxBorneIn(parcels: readonly TaxParcel[], year: number): number {
  let total = 0;
  for (const p of parcels) total += parcelBilledIn(p, year);
  return total;
}

/** The credits the collector granted a parcel in `year`, whatever year they relate to. */
export function creditsIn(parcel: TaxParcel, year: number): TaxCredit[] {
  return parcel.years.flatMap((b) => (b.credit && yearOf(b.credit.granted) === year ? [b.credit] : []));
}

/** What the collector credited the whole property in `year`. */
export function taxCreditsIn(parcels: readonly TaxParcel[], year: number): number {
  let total = 0;
  for (const p of parcels) for (const c of creditsIn(p, year)) total += c.amount_cents;
  return total;
}

/** How a bill names itself: "2024", "2023–24", or the supplemental it is. */
export function billLabel(bill: TaxParcelYear): string {
  if (bill.supplemental) return `${bill.year} supplemental`;
  return bill.period ? bill.period.label : String(bill.year);
}
