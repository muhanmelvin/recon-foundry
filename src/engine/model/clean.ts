/**
 * The clean generator: a whole property, a whole lease, and every document
 * behind a reconciliation, where nothing is wrong.
 *
 * "Nothing is wrong" is a stronger claim than it sounds. It is not enough that
 * the arithmetic foots; the package must also survive the Red-Flag Scanner
 * finding *nothing at all* in it — no swing over 15%, no round pool figure, no
 * amount repeated to the cent, no capital-sounding lump, no fee on a base the
 * lease does not permit, no share that fails to reproduce from the square
 * footage. A clean scenario is therefore built inside the scanner's tolerances
 * on purpose, and `tests/scanner-tolerances.test.ts` holds it there. That is
 * what makes it the most valuable fixture in the set: it is the one that
 * catches a future check that starts crying wolf.
 *
 * Everything is drawn bottom-up. A category's pool amount is the sum of its
 * invoices, never a number divided into them; the real-estate-tax line is the
 * sum of the parcels' installments; the insurance line is the premium plus the
 * fees on the declaration page. The ties in `ties.ts` then hold by
 * construction rather than by arrangement — which is exactly why breaking one
 * deliberately, later, is worth something.
 */

import { avoidRoundAmount, type Rng, rootRng } from "../rng.ts";
import { amortizationForYear, isRoundPoolAmount } from "../scanner-rules.ts";
import { drawNames, FRANKLIN, siteCodeFor } from "../names.ts";
import { iso, monthName } from "../dates.ts";
import { catalogFor, monthsFor, seasonWeight, type CategorySpec } from "./categories.ts";
import { hasVariant } from "./variants.ts";
import { billLabel, installmentsIn, taxBorneIn } from "./tax.ts";
import { recomputeRecon, setEstimates } from "./recompute.ts";
import type {
  CapitalProject,
  CategoryPool,
  GLEntry,
  InsurancePolicy,
  LeaseAbstract,
  ModelYear,
  ScenarioConfig,
  ScenarioModel,
  TaxParcel,
  TaxParcelYear,
  Universe,
} from "./types.ts";

/**
 * The widest a single line may move year over year in a clean package. The
 * scanner asks a question at 15%; staying under 10% leaves room for the
 * rounding that happens on the way to the cent.
 */
const MAX_CLEAN_DRIFT = 0.05;

/** Gross leasable area by size band, in square feet. */
const GLA_RANGE: Record<ScenarioConfig["size_band"], [number, number]> = {
  small: [84_000, 128_000],
  medium: [148_000, 248_000],
  large: [286_000, 425_000],
};

/** Annual real-estate tax and insurance per square foot, by property kind. */
const TAX_PSF = { retail_strip: 1.42, office: 2.05, industrial_flex: 0.74 } as const;
const INS_PSF = { retail_strip: 0.15, office: 0.2, industrial_flex: 0.09 } as const;
const RENT_PSF = { retail_strip: 22.5, office: 31.0, industrial_flex: 9.75 } as const;

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** cents × rate, rounded half away from zero — the family's `mulRate`. */
function mulRate(cents: number, rate: number): number {
  const sign = cents < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(cents) * rate + 1e-9);
}

/**
 * Divide `total` across `weights` so the parts sum to `total` exactly. The last
 * part absorbs the rounding, which is how a real ledger works too: the final
 * invoice of the year is whatever the year actually cost.
 */
function allocate(total: number, weights: readonly number[]): number[] {
  const w = sum(weights);
  if (w <= 0) throw new Error("allocate: weights sum to zero");
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < weights.length - 1; i++) {
    const v = Math.round((total * weights[i]!) / w);
    out.push(v);
    acc += v;
  }
  out.push(total - acc);
  return out;
}

/**
 * Move each amount by its own jitter without moving the total by more than the
 * growth asked for. The jitters are centred on the weighted mean first, so the
 * scaling factor is exactly (1 + growth) and no single line can be pushed past
 * MAX_CLEAN_DRIFT by a neighbour's swing.
 */
function driftAmounts(prev: readonly number[], growth: number, rng: Rng, labels: readonly string[]): number[] {
  const jitters = labels.map((label) => rng.child(label).float(-MAX_CLEAN_DRIFT, MAX_CLEAN_DRIFT));
  const base = sum(prev);
  const weighted = base > 0 ? sum(prev.map((p, i) => p * jitters[i]!)) / base : 0;
  return prev.map((p, i) => {
    const centred = jitters[i]! - weighted;
    let v = Math.round(p * (1 + centred) * (1 + growth));
    // Never repeat a figure to the cent: the scanner reads that as last year's
    // number carried forward, and it is usually right.
    if (v === p) v += rng.child(labels[i]! + "/nudge").int(3, 90);
    v = avoidRoundAmount(v, rng.child(labels[i]! + "/round"));
    return v;
  });
}

// ---------------------------------------------------------------------------
// Universe
// ---------------------------------------------------------------------------

function buildUniverse(config: ScenarioConfig, rng: Rng, categories: readonly CategorySpec[]): Universe {
  const n = drawNames(rng.child("names"), config.property_kind);
  const codeRng = rng.child("codes");
  const site_code = siteCodeFor(n.property_name, codeRng.child("site"));
  const property_code = "br" + String(codeRng.child("property").int(10, 99)) + String(codeRng.child("property2").int(100, 999));
  const tenant_ledger_account = "t00" + String(codeRng.child("ledger").int(10_000, 99_999));

  const gl_accounts: Record<string, string> = {};
  let account = 6100;
  for (const c of categories) {
    gl_accounts[c.category] = String(account);
    account += codeRng.child("gl/" + c.category).int(5, 25);
  }
  gl_accounts["Real estate taxes"] = "6800";
  gl_accounts["Property insurance"] = "6820";
  gl_accounts["Management fee"] = "6900";
  gl_accounts["Amortization"] = "6950";

  return {
    property_name: n.property_name,
    landlord_entity: n.landlord_entity,
    management_agent: n.management_agent,
    tenant_name: n.tenant_name,
    site_code,
    property_code,
    tenant_ledger_account,
    address: {
      line1: `${codeRng.child("street-no").int(100, 8999)} ${n.street}`,
      city: n.city,
      state: FRANKLIN.name,
      state_abbr: FRANKLIN.abbr,
      zip: FRANKLIN.zipPrefix + String(codeRng.child("zip").int(11, 99)),
    },
    premises_suite: "Suite " + String(codeRng.child("suite").int(100, 480)),
    county: n.county,
    tax_collector: n.tax_collector,
    insurance_carrier: n.insurance_carrier,
    policy_number: `${n.insurance_carrier.slice(0, 3).toUpperCase()}-${codeRng.child("policy").int(100_000, 999_999)}`,
    vendors: n.vendors,
    gl_accounts,
  };
}

// ---------------------------------------------------------------------------
// Capital
// ---------------------------------------------------------------------------

function buildCapitalProject(config: ScenarioConfig, rng: Rng, basis: number, contractor: string, years: readonly number[]): CapitalProject {
  const lifeYears = rng.child("life").pick([10, 12, 15]);
  const months = lifeYears * 12;
  const startYear = config.start_year - rng.child("start").int(1, 4);
  const startMonth = rng.child("month").pick([3, 4, 5, 6, 7, 9]);

  const assets =
    config.property_kind === "office"
      ? [
          { name: "Chiller replacement", type: "HVAC", caption: "Amortization of building systems" },
          { name: "Elevator modernization", type: "Conveyance", caption: "Amortization of building systems" },
          { name: "Roof section replacement — north wing", type: "Roof", caption: "Amortization of building improvements" },
        ]
      : config.property_kind === "industrial_flex"
        ? [
            { name: "Truck court resurfacing", type: "Sitework", caption: "Amortization of site improvements" },
            { name: "Roof section replacement — Building B", type: "Roof", caption: "Amortization of building improvements" },
            { name: "Yard lighting replacement", type: "Sitework", caption: "Amortization of site improvements" },
          ]
        : [
            { name: "Parking lot resurfacing", type: "Sitework", caption: "Amortization of site improvements" },
            { name: "Roof section replacement — Buildings 200–400", type: "Roof", caption: "Amortization of building improvements" },
            { name: "Sidewalk & curb replacement", type: "Sitework", caption: "Amortization of site improvements" },
          ];
  const asset = rng.child("asset").pick(assets);

  // Pick the monthly principal first, so cost ÷ life divides exactly and the
  // scanner's recomputation of the annual figure lands on the cent.
  const targetTotal = Math.round(basis * rng.child("cost").float(0.85, 1.65)) * 100;
  const monthly = Math.max(20_000, Math.round(targetTotal / months));
  const amort_start = iso(startYear, startMonth, 1);
  const endIdx = startYear * 12 + (startMonth - 1) + months - 1;

  // Interest on the unamortized balance is what most leases actually allow, and
  // it does something the straight line cannot: it makes each year's installment
  // different from the last. A charge repeated to the cent two years running is
  // exactly what the scanner's identical-amount test asks about, and it would be
  // asking about the one line in a clean package that is honestly constant.
  const rates = [5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 7, 7.5, 8];
  const offset = rng.child("rate").int(0, rates.length - 1);
  let interest_rate_pct = rates[offset]!;
  for (let i = 0; i < rates.length; i++) {
    const candidate = rates[(offset + i) % rates.length]!;
    const totals = years.map((y) => amortizationForYear(monthly * months, months, amort_start, y, candidate).total);
    if (totals.every((t) => t > 0 && !isRoundPoolAmount(t))) {
      interest_rate_pct = candidate;
      break;
    }
  }

  return {
    id: "CP-1",
    asset_name: asset.name,
    asset_type: asset.type,
    job_number: `J-${startYear}-${rng.child("job").int(100, 899)}`,
    total_cost_cents: monthly * months,
    recovery_period_months: months,
    interest_rate_pct,
    amort_start,
    amort_end: iso(Math.floor(endIdx / 12), (endIdx % 12) + 1, 28),
    monthly_cents: monthly,
    contractor,
    statement_caption: asset.caption,
    amortized: true,
  };
}

/** What the statement calls the line, with the year of the schedule it is on. */
function amortizationLabel(p: CapitalProject, year: number): string {
  const startYear = Number(p.amort_start.slice(0, 4));
  return `${p.statement_caption} (yr ${year - startYear + 1} of ${p.recovery_period_months / 12})`;
}

/** What the schedule says this year costs — computed the way the scanner recomputes it. */
export function amortizationYearTotal(p: CapitalProject, year: number): number {
  return amortizationForYear(p.total_cost_cents, p.recovery_period_months, p.amort_start, year, p.interest_rate_pct).total;
}

// ---------------------------------------------------------------------------
// Taxes and insurance
// ---------------------------------------------------------------------------

/**
 * The bills on one parcel, in whatever shape the county issues them.
 *
 * Everything here is built around one figure and one promise: `targets[k]` is
 * what this parcel costs the property in calendar year k, and every variant
 * below has to reproduce it to the cent. The bills may straddle two calendar
 * years, arrive in four instalments instead of two, or be joined by a
 * supplemental after a reassessment — and the year's Taxes line does not move,
 * because a Variant changes the evidence and never the figure.
 *
 * With no variant asked for the code takes the path it always took and draws
 * the same numbers from the same named streams, which is what keeps a config
 * that omits `variants` forging the bytes it always forged.
 */
function buildTaxParcels(config: ScenarioConfig, rng: Rng, basis: number, years: number[]): TaxParcel[] {
  const count = config.size_band === "small" ? 1 : config.size_band === "medium" ? 2 : rng.child("count").int(2, 3);
  const rate = Math.round(rng.child("rate").float(1.15, 2.65) * 10_000) / 10_000;
  const shares = Array.from({ length: count }, (_, i) => rng.child("share/" + i).float(0.6, 1.4));
  const shareSum = sum(shares);

  const firstTotal = Math.round(basis * TAX_PSF[config.property_kind] * rng.child("level").float(0.9, 1.12) * 100);
  const totals: number[] = [];
  for (let k = 0; k < years.length; k++) {
    totals.push(k === 0 ? firstTotal : Math.round(totals[k - 1]! * (1 + rng.child("growth/" + years[k]).float(0.018, 0.062))));
  }

  const fiscal = hasVariant(config, "tax_fiscal_year");
  const quarterly = hasVariant(config, "tax_quarterly");
  // A reassessment corrects an assessment that was already settled, so never
  // the first year of the package, and it lands on one parcel not all of them.
  const suppK =
    hasVariant(config, "tax_supplemental") && years.length > 1 ? rng.child("supplemental").int(1, years.length - 1) : -1;

  const parcels: TaxParcel[] = [];
  for (let i = 0; i < count; i++) {
    const pr = rng.child("parcel/" + i);

    // What this parcel costs the property, calendar year by calendar year. The
    // bill's own arithmetic has to work, so the assessed value is back-solved
    // from the target and the figure is then recomputed from it.
    const assessed: number[] = [];
    const targets: number[] = [];
    for (let k = 0; k < years.length; k++) {
      const target = Math.round((totals[k]! * shares[i]!) / shareSum);
      const a = Math.round((target * 100) / rate / 100) * 100;
      assessed.push(a);
      targets.push(mulRate(a, rate / 100));
    }

    // The supplemental is carved out of the year it lands in, never added to it.
    const carvedFrom = suppK >= 0 && i === 0 ? suppK : -1;
    const increase = carvedFrom >= 0 ? carveIncrease(assessed[carvedFrom]!, rate, pr.child("supp-size").float(0.06, 0.12)) : 0;
    const suppTax = carvedFrom >= 0 ? mulRate(increase, rate / 100) : 0;
    const base = targets.map((t, k) => (k === carvedFrom ? t - suppTax : t));

    const bills = fiscal
      ? fiscalBills(pr, years, base, carvedFrom, increase, rate, quarterly)
      : calendarBills(pr, years, base, assessed, carvedFrom, increase, rate, quarterly);

    if (carvedFrom >= 0) {
      const year = years[carvedFrom]!;
      // The bill whose assessment the reassessment corrected — under a fiscal
      // year, the one for the tax year that began in this calendar year.
      const corrected = bills.find((b) => b.year === year);
      bills.push({
        year,
        assessed_value_cents: increase,
        rate_per_100: rate,
        installments: [{ due: iso(year, 9, pr.child("supp-due").int(8, 20)), amount_cents: suppTax }],
        supplemental: {
          reason: "Reassessment following completion of improvements",
          issued: iso(year, 8, pr.child("supp-issued").int(3, 15)),
        },
        ...(corrected?.period ? { period: corrected.period } : {}),
      });
    }

    parcels.push({
      parcel_id: `${pr.child("book").int(100, 899)}-${pr.child("page").int(10, 89)}-${pr.child("lot").int(100, 899)}`,
      description: count === 1 ? "Entire property" : `Parcel ${i + 1} of ${count}`,
      years: bills,
    });
  }
  return parcels;
}

/**
 * An increase in assessed value whose tax can be carved out of the year without
 * moving the year: `(A − I) × rate` plus `I × rate` has to come to `A × rate`
 * exactly, and two roundings do not always agree with one. Stepping the
 * increase a dollar at a time finds one that does, usually within a few tries.
 */
function carveIncrease(assessed: number, rate: number, fraction: number): number {
  const whole = mulRate(assessed, rate / 100);
  const want = Math.max(100, Math.round((assessed * fraction) / 100) * 100);
  for (let step = 0; step < 400; step += 1) {
    const inc = want + step * 100;
    if (inc >= assessed) break;
    if (mulRate(assessed - inc, rate / 100) + mulRate(inc, rate / 100) === whole) return inc;
  }
  throw new Error(`carveIncrease: no supplemental assessment fits inside ${assessed} at ${rate}`);
}

/** An instalment day, drawn per bill so two parcels are not billed on one day. */
const dayIn = (pr: Rng, key: string, year: number, month: number): string => iso(year, month, pr.child(key).int(8, 16));

/**
 * The county's year is the calendar year: one bill, and every instalment on it
 * falls in the year it is for. This is the shape the forge has always issued.
 */
function calendarBills(
  pr: Rng,
  years: number[],
  base: number[],
  assessed: number[],
  carvedFrom: number,
  increase: number,
  rate: number,
  quarterly: boolean,
): TaxParcelYear[] {
  const bills: TaxParcelYear[] = [];
  for (let k = 0; k < years.length; k++) {
    const year = years[k]!;
    const total = base[k]!;
    const value = k === carvedFrom ? assessed[k]! - increase : assessed[k]!;

    if (!quarterly) {
      const first = Math.round(total * pr.child("split/" + year).float(0.47, 0.53));
      bills.push({
        year,
        assessed_value_cents: value,
        rate_per_100: rate,
        installments: [
          { due: dayIn(pr, "due1/" + year, year, 4), amount_cents: first },
          { due: dayIn(pr, "due2/" + year, year, 10), amount_cents: total - first },
        ],
      });
      continue;
    }

    // Quarterly: the first two instalments are estimated from last year's levy,
    // because the assessment for this one is not settled when they fall due.
    const prior = k === 0 ? Math.round(base[0]! / pr.child("prior-levy").float(1.02, 1.06)) : base[k - 1]!;
    const estimate = Math.round(prior * 0.25);
    const actual = allocate(total - estimate * 2, [1, 1]);
    bills.push({
      year,
      assessed_value_cents: value,
      rate_per_100: rate,
      prior_levy_cents: prior,
      installments: [
        { due: dayIn(pr, "q1/" + year, year, 2), amount_cents: estimate, basis: "preliminary" },
        { due: dayIn(pr, "q2/" + year, year, 5), amount_cents: estimate, basis: "preliminary" },
        { due: dayIn(pr, "q3/" + year, year, 8), amount_cents: actual[0]!, basis: "actual" },
        { due: dayIn(pr, "q4/" + year, year, 11), amount_cents: actual[1]!, basis: "actual" },
      ],
    });
  }
  return bills;
}

/**
 * The county's year runs July to June, so every calendar year is served by the
 * tail of one bill and the head of the next.
 *
 * The chain is what holds the figure still. Each bill is sized from the two
 * calendar years it straddles, and its total is fixed by its own assessed value
 * the way any bill's is. What is free is how the bill divides between its two
 * halves, and that is set so the halves landing in a calendar year add to
 * exactly what the property bears in it — which is also what absorbs the
 * carve-out when a supplemental takes part of a bill away.
 */
function fiscalBills(
  pr: Rng,
  years: number[],
  base: number[],
  carvedFrom: number,
  increase: number,
  rate: number,
  quarterly: boolean,
): TaxParcelYear[] {
  const n = years.length;
  const growth = pr.child("fy-growth").float(1.02, 1.06);
  // The bills at either end straddle out of the package, so the years just
  // outside it have to have a size too.
  const ext = [Math.round(base[0]! / growth), ...base, Math.round(base[n - 1]! * growth)];

  const totals: number[] = [];
  const values: number[] = [];
  for (let j = 0; j <= n; j++) {
    const want = Math.round((ext[j]! + ext[j + 1]!) / 2);
    const value = Math.round((want * 100) / rate / 100) * 100;
    values.push(value);
    totals.push(mulRate(value, rate / 100));
  }

  // Bill j covers the tax year beginning in calendar year `years[0] - 1 + j`,
  // so the bill the reassessment corrected is the one after the carved year.
  if (carvedFrom >= 0) {
    const j = carvedFrom + 1;
    values[j] = values[j]! - increase;
    totals[j] = mulRate(values[j]!, rate / 100);
  }

  // head[j] falls in the bill's own calendar year, tail[j] in the next one.
  const head: number[] = [Math.round(totals[0]! * pr.child("fy-split").float(0.47, 0.53))];
  const tail: number[] = [totals[0]! - head[0]!];
  for (let k = 0; k < n; k++) {
    head.push(base[k]! - tail[k]!);
    tail.push(totals[k + 1]! - head[k + 1]!);
  }

  const bills: TaxParcelYear[] = [];
  for (let j = 0; j <= n; j++) {
    const startYear = years[0]! - 1 + j;
    const label = `${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;
    const group = (amount: number, months: number[], calendar: number, basis?: "preliminary" | "actual") => {
      const split = months.length === 1 ? [amount] : allocate(amount, [1, 1]);
      return months.map((m, idx) => ({
        due: dayIn(pr, `fy${j}/${m}`, calendar, m),
        amount_cents: split[idx]!,
        ...(basis ? { basis } : {}),
      }));
    };
    bills.push({
      year: startYear,
      assessed_value_cents: values[j]!,
      rate_per_100: rate,
      period: { start: iso(startYear, 7, 1), end: iso(startYear + 1, 6, 30), label },
      ...(quarterly ? { prior_levy_cents: j === 0 ? Math.round(totals[0]! / growth) : totals[j - 1]! } : {}),
      installments: [
        ...group(head[j]!, quarterly ? [8, 11] : [11], startYear, quarterly ? "preliminary" : undefined),
        ...group(tail[j]!, quarterly ? [2, 5] : [2], startYear + 1, quarterly ? "actual" : undefined),
      ],
    });
  }

  return bills;
}

/**
 * The one place the two square footages both appear. A premium is an operating
 * expense and moves with `basis`; a coverage limit is a statement about what the
 * building is worth to rebuild, and moves with the building.
 */
function buildInsurance(config: ScenarioConfig, rng: Rng, gla: number, basis: number, years: number[], carrier: string, policy: string): InsurancePolicy {
  const premiums: number[] = [];
  const base = Math.round(basis * INS_PSF[config.property_kind] * rng.child("level").float(0.9, 1.14) * 100);
  for (let k = 0; k < years.length; k++) {
    premiums.push(k === 0 ? base : Math.round(premiums[k - 1]! * (1 + rng.child("growth/" + years[k]).float(0.025, 0.075))));
  }
  return {
    carrier,
    policy_number: policy,
    period_start_month: rng.child("period").pick([1, 4, 7]),
    coverages: [
      { coverage: "Commercial property — special form", limit_cents: Math.round(gla * 145) * 100, deductible_cents: 2_500_00 },
      { coverage: "Commercial general liability — per occurrence", limit_cents: 1_000_000_00, deductible_cents: 0 },
      { coverage: "Commercial general liability — aggregate", limit_cents: 2_000_000_00, deductible_cents: 0 },
      { coverage: "Business income & extra expense", limit_cents: Math.round(gla * 12) * 100, deductible_cents: 0 },
    ],
    years: years.map((year, k) => {
      const premium = premiums[k]!;
      const fees = mulRate(premium, rng.child("fees/" + year).float(0.012, 0.028));
      return { year, premium_cents: premium, fees_cents: fees, invoice_number: `INV-${year}-${rng.child("inv/" + year).int(10_000, 99_999)}` };
    }),
  };
}

// ---------------------------------------------------------------------------
// General ledger
// ---------------------------------------------------------------------------

function glForCategory(spec: CategorySpec, universe: Universe, year: number, total: number, rng: Rng): GLEntry[] {
  const account = universe.gl_accounts[spec.category] ?? "6199";
  const vendor = universe.vendors[spec.trade] ?? "Unassigned vendor";
  const months = spec.cadence === "irregular" ? irregularMonths(rng.child("months"), year) : monthsFor(spec.cadence);
  const weights = months.map((m, i) => seasonWeight(spec.cadence, m) * rng.child("w/" + i).float(0.85, 1.15));
  const amounts = allocate(total, weights);

  return months.map((m, i) => ({
    year,
    date: iso(year, m, rng.child("day/" + m).int(3, 26)),
    account,
    category: spec.category,
    vendor,
    memo: `${spec.memo} — ${monthName(m)} ${year}`,
    amount_cents: amounts[i]!,
  }));
}

function irregularMonths(rng: Rng, year: number): number[] {
  const n = rng.child("n/" + year).int(5, 9);
  const chosen = new Set<number>();
  for (let i = 0; chosen.size < n && i < 40; i++) chosen.add(rng.child("m/" + i).int(1, 12));
  return [...chosen].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * The largest property the generator will invent, in square feet. It exists for
 * one case: a visitor who names a very large premises and, by the luck of the
 * share draw, would otherwise imply a nine-million-square-foot centre around it.
 * Clamping trades an implausible denominator for a large share — an anchor
 * tenant — which is the honest reading of "we occupy 400,000 square feet".
 */
const MAX_GLA = 1_200_000;

/**
 * Premises and property, resolved together.
 *
 * Both directions produce the same invariant, which is the only thing tie T7
 * cares about: `share_pct` is `premises_sf ÷ denominator_sf`, to four decimals,
 * with nothing rounded on the way that the statement cannot reproduce.
 *
 * Drawn: pick the property from the size band, take a share of it, and the
 * premises follow. Told: keep the share draw, and let the property be however
 * large it has to be for that share to land on the premises the visitor named.
 * The premises is then exact — which matters, because it is the one number in
 * the package the visitor recognises as theirs.
 *
 * Both streams are drawn in both branches. They are keyed by name rather than
 * by order (see `rng.ts`), so this is not about reproducibility; it is about
 * leaving the two paths symmetrical for the next person to read them.
 */
function resolveFootprint(config: ScenarioConfig, rng: Rng): { gla: number; premises_sf: number; share_pct: number } {
  const glaRange = GLA_RANGE[config.size_band];
  const drawnGla = Math.round(rng.child("gla").int(glaRange[0], glaRange[1]) / 500) * 500;
  const sharePct = rng.child("share").float(0.055, 0.145);

  let gla: number;
  let premises_sf: number;
  if (config.premises_sf === undefined) {
    gla = drawnGla;
    premises_sf = Math.round((gla * sharePct) / 100) * 100;
  } else {
    premises_sf = config.premises_sf;
    // A property has to be bigger than the space inside it, and by enough that
    // the tenant is a tenant rather than the whole building.
    const floor = Math.ceil((premises_sf * 1.2) / 500) * 500;
    gla = Math.min(Math.max(Math.round(premises_sf / sharePct / 500) * 500, floor), MAX_GLA);
  }

  return { gla, premises_sf, share_pct: Math.round((premises_sf / gla) * 100 * 10_000) / 10_000 };
}

/** Close enough to stop refining the expense scale: half a cent in every dollar. */
const PSF_TOLERANCE = 0.005;
/** And never more than this many builds, whatever happens. */
const PSF_MAX_PASSES = 4;

export function buildCleanModel(config: ScenarioConfig): ScenarioModel {
  if (config.opex_psf_target === undefined) return buildAtScale(config, 1);

  // Build, measure, correct, build again. The first pass is only ever measured:
  // it says what a property of this shape naturally costs per square foot, which
  // is what the correction is computed from.
  //
  // It takes more than one correction because the response is not quite linear —
  // a capital project has a floor under its monthly principal, and a tax bill is
  // rounded to a whole assessed value — so a small property answers a doubled
  // input with slightly less than double the spend. Each pass folds in whatever
  // the last one missed; in practice the second lands inside a fraction of a
  // cent and the loop stops there.
  //
  // Nothing here is less deterministic than a single pass: every pass re-derives
  // from the same seed, the correction is arithmetic on a number the engine
  // computed, and the iteration cap is a constant. No clock, no entropy.
  //
  // Scaling the inputs rather than the finished totals is the whole point. Every
  // amount is still summed bottom-up from its own invoices, still pushed off a
  // round figure afterwards, still tied to the cent. Multiplying a completed
  // pool would defeat all three on the way past.
  let scale = 1;
  let model = buildAtScale(config, scale);
  for (let pass = 1; pass < PSF_MAX_PASSES; pass++) {
    const year = model.years[0]!;
    const psf = year.recon.pool_total_cents / 100 / year.denominator_sf;
    if (psf <= 0 || Math.abs(psf - config.opex_psf_target) / config.opex_psf_target < PSF_TOLERANCE) break;
    scale *= config.opex_psf_target / psf;
    model = buildAtScale(config, scale);
  }
  return model;
}

/**
 * `expenseScale` multiplies the square footage the generator prices things off —
 * not the square footage it bills a share on. The two are the same number until
 * someone asks for a particular dollars-per-foot, and then they part company:
 * the denominator on the statement stays the property's real area, while the
 * invoices behind it are drawn as though the property were larger or smaller.
 */
function buildAtScale(config: ScenarioConfig, expenseScale: number): ScenarioModel {
  const rng = rootRng(config.seed);
  const categories = catalogFor(config.property_kind);
  const years: number[] = Array.from({ length: config.year_count }, (_, i) => config.start_year + i);

  const universe = buildUniverse(config, rng, categories);

  const { gla, premises_sf, share_pct } = resolveFootprint(config, rng);
  const basis = gla * expenseScale;

  const capital = buildCapitalProject(config, rng.child("capital"), basis, universe.vendors["contractor"] ?? "Halloway Construction Group", years);
  const parcels = buildTaxParcels(config, rng.child("tax"), basis, years);
  const insurance = buildInsurance(config, rng.child("insurance"), gla, basis, years, universe.insurance_carrier, universe.policy_number);

  // --- category amounts, year by year -------------------------------------
  const labels = categories.map((c) => c.category);
  const perYear: number[][] = [];
  for (let k = 0; k < years.length; k++) {
    const year = years[k]!;
    if (k === 0) {
      perYear.push(
        categories.map((c) => {
          let v = Math.round(basis * c.psf * rng.child("level/" + c.category).float(1 - c.spread, 1 + c.spread) * 100);
          v = avoidRoundAmount(v, rng.child("level-round/" + c.category));
          return v;
        }),
      );
      continue;
    }
    const prev = perYear[k - 1]!;
    const ctlIdx = categories.map((c, i) => (c.bucket === "controllable" ? i : -1)).filter((i) => i >= 0);
    const ncIdx = categories.map((c, i) => (c.bucket === "non_controllable" ? i : -1)).filter((i) => i >= 0);
    // Controllables grow more slowly than the cap allows: that is what makes
    // the clean package clean, and what the above-cap scheme later abandons.
    const ctlGrowth = rng.child("ctl-growth/" + year).float(0.010, 0.030);
    const ncGrowth = rng.child("nc-growth/" + year).float(0.012, 0.048);
    const ctl = driftAmounts(ctlIdx.map((i) => prev[i]!), ctlGrowth, rng.child("ctl-drift/" + year), ctlIdx.map((i) => labels[i]!));
    const nc = driftAmounts(ncIdx.map((i) => prev[i]!), ncGrowth, rng.child("nc-drift/" + year), ncIdx.map((i) => labels[i]!));
    const next = prev.slice();
    ctlIdx.forEach((idx, j) => (next[idx] = ctl[j]!));
    ncIdx.forEach((idx, j) => (next[idx] = nc[j]!));
    perYear.push(next);
  }

  // --- pools, general ledger and the recon arithmetic ----------------------
  const modelYears: ModelYear[] = [];
  const feeRatePct = Math.round(rng.child("fee-rate").float(3, 5) * 10) / 10;
  const feeLabel = `Management fee (${feeRatePct}%)`;
  let capBaseAmount = 0;

  for (let k = 0; k < years.length; k++) {
    const year = years[k]!;
    const amounts = perYear[k]!;

    const pools: CategoryPool[] = categories.map((c, i) => ({
      category: c.category,
      section: c.section,
      bucket: c.bucket,
      amount_cents: amounts[i]!,
      trade: c.trade,
    }));

    // Amortization sits outside the capped pool: an installment fixed by a
    // schedule is not something a manager controls from one year to the next.
    const amortYearTotal = amortizationYearTotal(capital, year);
    pools.push({
      category: amortizationLabel(capital, year),
      section: "CAM",
      bucket: "non_controllable",
      amount_cents: amortYearTotal,
      capital_project_id: capital.id,
      outside_fee_base: true,
      trade: "contractor",
    });

    const taxTotal = taxBorneIn(parcels, year);
    pools.push({ category: "Real estate taxes", section: "Taxes", bucket: "non_controllable", amount_cents: taxTotal, trade: "tax" });

    const ins = insurance.years[k]!;
    pools.push({
      category: "Property insurance",
      section: "Insurance",
      bucket: "non_controllable",
      amount_cents: ins.premium_cents + ins.fees_cents,
      trade: "insurance",
    });

    // The fee is charged on CAM only, which is what the lease says, so the
    // permitted base and the billed base are the same set of lines.
    const feeBase = sum(pools.filter((p) => p.section === "CAM").map((p) => p.amount_cents));
    const feeBilled = mulRate(feeBase, feeRatePct / 100);
    pools.push({
      category: feeLabel,
      section: "Fees",
      bucket: "non_controllable",
      amount_cents: feeBilled,
      is_fee: true,
      trade: "management",
    });

    const controllableActual = sum(pools.filter((p) => p.bucket === "controllable").map((p) => p.amount_cents));
    if (k === 0) {
      // Resolve a base year the first year comfortably clears, so the very
      // first ceiling is real without ever having been breached.
      capBaseAmount = Math.round(controllableActual / rng.child("cap-base").float(1.018, 1.032));
    }

    const poolTotal = sum(pools.map((p) => p.amount_cents));

    // General ledger — the invoices the pools are the sum of.
    const gl: GLEntry[] = [];
    for (const c of categories) {
      const pool = pools.find((p) => p.category === c.category)!;
      gl.push(...glForCategory(c, universe, year, pool.amount_cents, rng.child("gl/" + year + "/" + c.category)));
    }
    gl.push(...taxGl(parcels, universe, year));
    gl.push(...insuranceGl(insurance, universe, year, k));
    gl.push(...amortizationGl(capital, universe, year));
    gl.push(...feeGl(universe, year, feeBilled, feeLabel));
    gl.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.category < b.category ? -1 : 1));

    modelYears.push({
      year,
      occupancy_pct: Math.round(rng.child("occ/" + year).float(93, 98.4) * 10) / 10,
      denominator_sf: gla,
      pools,
      gl,
      estimate_monthly_cents: 0, // filled once the tenant total is known
      recon: {
        pool_total_cents: poolTotal,
        controllable_actual_cents: controllableActual,
        cap_allowed_cents: null,
        cap_billed_cents: controllableActual,
        fee_base_cents: feeBase,
        fee_billed_cents: feeBilled,
        billed_pool_cents: poolTotal,
        tenant_total_cents: 0,
        estimates_paid_cents: 0,
        balance_due_cents: 0,
      },
    });
  }

  const capPct = rng.child("cap-pct").pick([4, 5, 6]);
  const lease: LeaseAbstract = {
    landlord: universe.landlord_entity,
    tenant: universe.tenant_name,
    premises_sf,
    denominator_sf: gla,
    denominator_basis: "GLA",
    share_pct,
    commencement: iso(config.start_year - rng.child("term").int(2, 6), rng.child("term-month").pick([1, 3, 5, 7, 9, 11]), 1),
    expiration: iso(config.start_year + config.year_count + rng.child("term-end").int(2, 7), 12, 31),
    permitted_use:
      config.property_kind === "office"
        ? "General office use and lawfully related purposes"
        : config.property_kind === "industrial_flex"
          ? "Warehousing, distribution and ancillary office use"
          : "Retail sales and no other purpose",
    base_rent_psf_year1: Math.round(RENT_PSF[config.property_kind] * rng.child("rent").float(0.86, 1.16) * 100) / 100,
    base_rent_escalation_pct: rng.child("esc").pick([2, 2.5, 3]),
    cap: {
      applies_to: "controllable",
      pct: capPct,
      method: "non_cumulative",
      basis: "amount_paid",
      base_year: config.start_year - 1,
      base_year_amount_cents: capBaseAmount,
      fee_treatment: "outside_cap",
    },
    fee: { kind: "management", rate_pct: feeRatePct, base: "cam_only" },
    capital_threshold_cents: rng.child("cap-threshold").pick([10_000_00, 15_000_00, 25_000_00]),
    capital_life_years: capital.recovery_period_months / 12,
    gross_up: { allowed: true, to_pct: 95 },
  };

  // --- delivery dates ------------------------------------------------------
  const delivery: Record<number, string> = {};
  for (const y of modelYears) {
    const dRng = rng.child("delivery/" + y.year);
    delivery[y.year] = iso(y.year + 1, dRng.int(3, 8), dRng.int(4, 26));
  }

  const model: ScenarioModel = {
    config,
    universe,
    lease,
    years: modelYears,
    capital_projects: [capital],
    tax_parcels: parcels,
    insurance,
    ledger: [],
    delivery,
    planted: [],
  };

  // The tenant's estimates are set from a first pass at the tenant total, then
  // held: what the tenant paid monthly is a fact of the year, not something a
  // later reconciliation reaches back and changes.
  recomputeRecon(model, rng);
  setEstimates(model, rng);
  recomputeRecon(model, rng);

  return model;
}

/**
 * The ledger books the instalments that came due in the year, whichever bill
 * they came off. Under a fiscal tax year that is two bills; where the county
 * issued a supplemental it is three.
 */
function taxGl(parcels: readonly TaxParcel[], universe: Universe, year: number): GLEntry[] {
  const out: GLEntry[] = [];
  for (const p of parcels) {
    for (const bill of p.years) {
      for (const inst of installmentsIn(bill, year)) {
        const n = bill.installments.indexOf(inst) + 1;
        out.push({
          year,
          date: inst.due,
          account: universe.gl_accounts["Real estate taxes"]!,
          category: "Real estate taxes",
          vendor: universe.tax_collector,
          memo: `Parcel ${p.parcel_id} — ${billLabel(bill)} installment ${n} of ${bill.installments.length}`,
          amount_cents: inst.amount_cents,
        });
      }
    }
  }
  return out;
}

function insuranceGl(policy: InsurancePolicy, universe: Universe, year: number, k: number): GLEntry[] {
  const y = policy.years[k]!;
  const m = policy.period_start_month;
  return [
    {
      year,
      date: iso(year, m, 12),
      account: universe.gl_accounts["Property insurance"]!,
      category: "Property insurance",
      vendor: policy.carrier,
      memo: `Policy ${policy.policy_number} — annual premium, invoice ${y.invoice_number}`,
      amount_cents: y.premium_cents,
    },
    {
      year,
      date: iso(year, m, 12),
      account: universe.gl_accounts["Property insurance"]!,
      category: "Property insurance",
      vendor: policy.carrier,
      memo: `Policy ${policy.policy_number} — policy fee and surplus lines tax`,
      amount_cents: y.fees_cents,
    },
  ];
}

function amortizationGl(p: CapitalProject, universe: Universe, year: number): GLEntry[] {
  const label = amortizationLabel(p, year);
  const parts = allocate(amortizationYearTotal(p, year), Array.from({ length: 12 }, () => 1));
  return parts.map((amount, i) => ({
    year,
    date: iso(year, i + 1, 28),
    account: universe.gl_accounts["Amortization"]!,
    category: label,
    vendor: p.contractor,
    memo: `${p.asset_name} (job ${p.job_number}) — amortization with interest at ${p.interest_rate_pct}%, month ${i + 1}`,
    amount_cents: amount,
  }));
}

function feeGl(universe: Universe, year: number, total: number, label: string): GLEntry[] {
  const monthly = allocate(total, Array.from({ length: 12 }, () => 1));
  return monthly.map((amount, i) => ({
    year,
    date: iso(year, i + 1, 28),
    account: universe.gl_accounts["Management fee"]!,
    category: label,
    vendor: universe.management_agent,
    memo: `Management fee accrual — ${monthName(i + 1)} ${year}`,
    amount_cents: amount,
  }));
}
