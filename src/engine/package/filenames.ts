/**
 * How the landlord's file server names things.
 *
 * `<SITE>_<YEAR> OPEX RECON_<Document>_<MM.DD.YY>.<ext>` — the tenant's own site
 * code, the reconciliation year, what the document is, and the date the package
 * was delivered. Spaces and all: real packages arrive with spaces in the
 * filenames, and a trainee who has only ever seen `recon_2024_final_v3.xlsx`
 * has not seen the thing they will be sent.
 *
 * The delivery date is part of the model, derived from the seed and the year —
 * so a filename is reproducible too.
 */

import { fileDate } from "../dates.ts";

export type DocType =
  | "Recon Workbook"
  | "Billing Statement"
  | "RE Tax Backup"
  | "Insurance Backup"
  | "Amortization Schedule"
  | "Project Backup"
  | "Tenant Ledger"
  | "Lease"
  | "Recon Package"
  | "Findings Manifest"
  | "Answer Key";

export function packageFolder(siteCode: string, year: number): string {
  return `${siteCode}_${year} OPEX RECON`;
}

export function documentName(siteCode: string, year: number, doc: DocType, deliveryIso: string, ext: string): string {
  return `${siteCode}_${year} OPEX RECON_${doc}_${fileDate(deliveryIso)}.${ext}`;
}

/** Documents that span the term rather than a single year sit at the root of the ZIP. */
export function termDocumentName(siteCode: string, doc: DocType, deliveryIso: string, ext: string): string {
  return `${siteCode}_${doc}_${fileDate(deliveryIso)}.${ext}`;
}

/** The folder a trainer deletes before handing the package out. */
export const ANSWER_KEY_FOLDER = "_ANSWER KEY";
