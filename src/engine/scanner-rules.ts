/**
 * Copies of the Red-Flag Scanner's own tests, kept here so the clean generator
 * can stay inside them.
 *
 * These are **copies, not imports** — the family rule. That is a deliberate
 * trade: the two can drift, and nothing in this repo will notice. What notices
 * is the fixture test that runs inside the scanner repo (milestone M5b), where
 * a clean package forged here is scanned by the real engine and must produce
 * zero findings. If someone widens RF-05's round-number rule and forgets this
 * file, that test goes red — which is the correct place for the failure to
 * appear, because the scanner is the authority and this file is the echo.
 *
 * Sources: `red-flag-scanner/src/engine/checks/rf05_round.ts` (`isRoundAmount`),
 * `red-flag-scanner/src/engine/lines.ts` (`CAPITAL_KEYWORDS`, `looksCapital`),
 * and `src/engine/normalize.ts` (`normalizeLabel`), at commit c050bad.
 */

/** RF-05's round-number test, at the scanner's default $5,000 minimum. */
export function isRoundPoolAmount(cents: number, minCents = 500_000): boolean {
  if (cents < minCents) return false;
  if (cents % 100_000 === 0) return true; // a multiple of $1,000
  if (cents >= 2_000_000 && cents % 50_000 === 0) return true; // a multiple of $500 above $20,000
  return false;
}

/** Labels RF-09 reads as describing capital work. */
export const CAPITAL_KEYWORDS =
  /\broof(ing)?\b|\bparking\b|\bhvac\b|\breplace(ment)?\b|\bresurfac(e|ing)\b|\brenovat(ion|e)\b|\bre pav(e|ing)\b|\brepav(e|ing)\b|\bseal ?coat(ing)?\b|\bchiller\b|\belevator moderni[sz]ation\b|\bcapital\b/;

const SYNONYMS: Array<[RegExp, string]> = [
  [/\br and m\b/g, "repairs and maintenance"],
  [/\brepair\b/g, "repairs"],
  [/\bmaint\b/g, "maintenance"],
  [/\bmgmt\b|\bmgt\b|\bmanagment\b/g, "management"],
  [/\badmin\b/g, "administrative"],
  [/\breal estate tax(es)?\b|\bre tax(es)?\b|\bproperty tax(es)?\b|\bret\b/g, "real estate taxes"],
  [/\bins\b/g, "insurance"],
  [/\belec\b|\belectric\b/g, "electricity"],
  [/\bsnow (and )?ice removal\b|\bsnow plowing\b|\bsnow plow\b|\bsnow\b(?! removal)/g, "snow removal"],
  [/\blandscape\b|\bgroundskeeping\b|\bgrounds keeping\b/g, "landscaping"],
  [/\bparking lot\b|\bparking area\b/g, "parking"],
  [/\bhvac\b/g, "hvac"],
  [/\bamort\b|\bamortisation\b/g, "amortization"],
];

const STOP = new Set([
  "services", "service", "expense", "expenses", "cost", "costs", "charge", "charges",
  "the", "of", "for", "and", "to", "yr", "year", "years",
]);

/** The scanner's label normalizer, which every one of its keyword tests runs on. */
export function normalizeLabel(s: string): string {
  let t = s.toLowerCase();
  t = t.replace(/&/g, " and ").replace(/[\/\\|+]/g, " ");
  t = t.replace(/[^\p{L}\p{N}\s]/gu, " ");
  t = t.replace(/\s+/g, " ").trim();
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  return t
    .split(" ")
    .filter((w) => w.length > 0 && !/^\d+(\.\d+)?%?$/.test(w) && !STOP.has(w))
    .join(" ");
}

/** True when RF-09 would read this label as capital work. */
export function looksCapital(label: string): boolean {
  return CAPITAL_KEYWORDS.test(normalizeLabel(label));
}
