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
 * `red-flag-scanner/src/engine/lines.ts` (`CAPITAL_KEYWORDS`, `looksCapital`,
 * `TAX_RE`), and `src/engine/normalize.ts` (`normalizeLabel`), at commit c050bad
 * — plus `TAX_RE` again at the commit that added RF-13.
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

/**
 * RF-09's recomputation of a year's amortization installment: straight-line
 * principal plus simple interest on the declining balance.
 *
 * Reproduced here down to the order of the arithmetic, because the scanner
 * compares its own answer with what the statement bills and reports a
 * difference over a dollar as a finding. A clean package has to land on the
 * same cent, so it computes its installments with this function rather than
 * with something equivalent-looking.
 *
 * Source: `red-flag-scanner/src/engine/checks/rf09_capital.ts`
 * (`monthsInService`, `expectedAmortization`) at commit c050bad.
 */
export function amortizationForYear(
  totalCents: number,
  lifeMonths: number,
  inService: string,
  year: number,
  interestRatePct = 0,
): { principal: number; interest: number; months: number; total: number } {
  const m = /^(\d{4})-(\d{2})/.exec(inService);
  if (!m) return { principal: 0, interest: 0, months: 0, total: 0 };
  const start = Number(m[1]) * 12 + (Number(m[2]) - 1);
  const end = start + lifeMonths - 1;
  const lo = Math.max(start, year * 12);
  const hi = Math.min(end, year * 12 + 11);
  const months = Math.max(0, hi - lo + 1);
  if (months === 0) return { principal: 0, interest: 0, months: 0, total: 0 };

  const monthly = totalCents / lifeMonths;
  const principal = Math.round(monthly * months);
  let interest = 0;
  if (interestRatePct) {
    const r = interestRatePct / 100 / 12;
    const firstMonthOfYear = Math.max(start, year * 12);
    for (let k = 0; k < months; k++) {
      const elapsed = firstMonthOfYear + k - start;
      interest += (totalCents - monthly * elapsed) * r;
    }
    interest = Math.round(interest);
  }
  return { principal, interest, months, total: principal + interest };
}

const FEE_RE = /\b(management|administrative|admin|supervisory|overhead|asset management|property management) fees?\b/;
const FEE_SECTION_RE = /^(fees?|management|administrative)( fees?)?$/;
const TAX_RE = /\btax(es)?\b|\bassessments?\b/;
const INS_RE = /\binsurance\b|\bpremiums?\b/;

/**
 * The lines RF-13 will net the tax backup against.
 *
 * This is the drift surface RF-13 created. The tax backup a forged package
 * exports covers the parcels — the levy as issued, less any credit — and the
 * scanner subtracts that from whatever *it* reads as a tax line. If the two
 * populations ever stop being the same set of lines, a clean package acquires a
 * tax finding out of nowhere, or a planted refund stops being findable. So the
 * regex lives here as a copy and `tests/scanner-tolerances.test.ts` asserts that
 * the lines it selects in an exported package are exactly the lines the backup
 * is built from.
 *
 * Source: `red-flag-scanner/src/engine/lines.ts` (`TAX_RE`, `lineKind`) — note
 * the precedence there: a fee line is a fee first, and an amortization line is
 * capital first, whatever their captions say.
 */
export function isScannerTaxLine(line: { label: string; section: string; is_fee?: boolean; capital?: unknown }): boolean {
  const label = normalizeLabel(line.label);
  const section = normalizeLabel(line.section);
  if (line.is_fee || FEE_RE.test(label) || FEE_SECTION_RE.test(section)) return false;
  if (line.capital) return false;
  return TAX_RE.test(section) || TAX_RE.test(label);
}

/**
 * The base RF-07 will compute a `cam_only` fee on, given the lines as the
 * scanner sees them: every non-fee line that is not taxes and not insurance.
 *
 * This is wider than the base *this* lease permits. §6.03 here excludes capital
 * items from the fee base; the scanner keeps amortization inside `cam_only`,
 * because from a statement it has no way to tell that a particular lease says
 * otherwise. So the scanner's estimate of a fee overcharge is smaller than the
 * true one — the conservative direction, and the reason an answer key states the
 * true figure while the manifest's expected range is derived from this.
 *
 * Source: `red-flag-scanner/src/engine/lines.ts` (`lineKind`, `feeBaseLines`).
 */
export function scannerFeeBaseCents(
  lines: ReadonlyArray<{ label: string; section: string; amount_cents: number; is_fee?: boolean }>,
): number {
  let total = 0;
  for (const l of lines) {
    const label = normalizeLabel(l.label);
    const section = normalizeLabel(l.section);
    if (l.is_fee || FEE_RE.test(label) || FEE_SECTION_RE.test(section)) continue;
    if (TAX_RE.test(section) || TAX_RE.test(label)) continue;
    if (INS_RE.test(section) || INS_RE.test(label)) continue;
    total += l.amount_cents;
  }
  return total;
}
