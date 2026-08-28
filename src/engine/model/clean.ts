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
import { isRoundPoolAmount } from "../scanner-rules.ts";
import { drawNames, FRANKLIN, siteCodeFor } from "../names.ts";
import { addDays, iso, monthName, period } from "../dates.ts";
import { catalogFor, monthsFor, seasonWeight, type CategorySpec } from "./categories.ts";
import type {
  CapitalProject,
  CategoryPool,
  GLEntry,
  InsurancePolicy,
  LeaseAbstract,
  LedgerEntry,
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

function buildCapitalProject(config: ScenarioConfig, rng: Rng, gla: number, contractor: string): CapitalProject {
  const lifeYears = rng.child("life").pick([10, 12, 15]);
  const months = lifeYears * 12;
  const startYear = config.start_year - rng.child("start").int(1, 4);
  const startMonth = rng.child("month").pick([3, 4, 5, 6, 7, 9]);

  const assets =
    config.property_kind === "office"
      ? [
          { name: "Chiller replacement", type: "HVAC" },
          { name: "Elevator modernization", type: "Conveyance" },
          { name: "Roof section replacement — north wing", type: "Roof" },
        ]
      : config.property_kind === "industrial_flex"
        ? [
            { name: "Truck court resurfacing", type: "Sitework" },
            { name: "Roof section replacement — Building B", type: "Roof" },
            { name: "Yard lighting replacement", type: "Sitework" },
          ]
        : [
            { name: "Parking lot resurfacing", type: "Sitework" },
            { name: "Roof section replacement — Buildings 200–400", type: "Roof" },
            { name: "Sidewalk & curb replacement", type: "Sitework" },
          ];
  const asset = rng.child("asset").pick(assets);

  // Pick a monthly installment first, so cost ÷ life divides exactly and the
  // scanner's recomputation of the annual figure lands on the cent.
  const targetTotal = Math.round(gla * rng.child("cost").float(0.85, 1.65)) * 100;
  let monthly = Math.max(20_000, Math.round(targetTotal / months));
  // A year of installments must not itself be a round figure — the scanner
  // reads a round pool amount as a budget number, and it would be right to.
  while (isRoundPoolAmount(monthly * 12)) monthly += 7;

  const amort_start = iso(startYear, startMonth, 1);
  const endIdx = startYear * 12 + (startMonth - 1) + months - 1;
  const endYear = Math.floor(endIdx / 12);
  const endMonth = (endIdx % 12) + 1;

  return {
    id: "CP-1",
    asset_name: asset.name,
    asset_type: asset.type,
    job_number: `J-${startYear}-${rng.child("job").int(100, 899)}`,
    total_cost_cents: monthly * months,
    recovery_period_months: months,
    amort_start,
    amort_end: iso(endYear, endMonth, 28),
    monthly_cents: monthly,
    contractor,
    amortized: true,
  };
}

function amortizationLabel(p: CapitalProject, year: number): string {
  const startYear = Number(p.amort_start.slice(0, 4));
  const yr = year - startYear + 1;
  return `${p.asset_name} — amortization (yr ${yr} of ${p.recovery_period_months / 12})`;
}

// ---------------------------------------------------------------------------
// Taxes and insurance
// ---------------------------------------------------------------------------

function buildTaxParcels(config: ScenarioConfig, rng: Rng, gla: number, years: number[]): TaxParcel[] {
  const count = config.size_band === "small" ? 1 : config.size_band === "medium" ? 2 : rng.child("count").int(2, 3);
  const rate = Math.round(rng.child("rate").float(1.15, 2.65) * 10_000) / 10_000;
  const shares = Array.from({ length: count }, (_, i) => rng.child("share/" + i).float(0.6, 1.4));
  const shareSum = sum(shares);

  const firstTotal = Math.round(gla * TAX_PSF[config.property_kind] * rng.child("level").float(0.9, 1.12) * 100);
  const totals: number[] = [];
  for (let k = 0; k < years.length; k++) {
    totals.push(k === 0 ? firstTotal : Math.round(totals[k - 1]! * (1 + rng.child("growth/" + years[k]).float(0.018, 0.062))));
  }

  const parcels: TaxParcel[] = [];
  for (let i = 0; i < count; i++) {
    const pr = rng.child("parcel/" + i);
    const parcelYears: TaxParcelYear[] = [];
    for (let k = 0; k < years.length; k++) {
      const year = years[k]!;
      const target = Math.round((totals[k]! * shares[i]!) / shareSum);
      // The bill's own arithmetic has to work: assessed value × rate ÷ 100 = tax.
      const assessed = Math.round((target * 100) / rate / 100) * 100;
      const tax = mulRate(assessed, rate / 100);
      const first = Math.round(tax * pr.child("split/" + year).float(0.47, 0.53));
      parcelYears.push({
        year,
        assessed_value_cents: assessed,
        rate_per_100: rate,
        installments: [
          { due: iso(year, 4, pr.child("due1/" + year).int(8, 16)), amount_cents: first },
          { due: iso(year, 10, pr.child("due2/" + year).int(8, 16)), amount_cents: tax - first },
        ],
      });
    }
    parcels.push({
      parcel_id: `${pr.child("book").int(100, 899)}-${pr.child("page").int(10, 89)}-${pr.child("lot").int(100, 899)}`,
      description: count === 1 ? "Entire property" : `Parcel ${i + 1} of ${count}`,
      years: parcelYears,
    });
  }
  return parcels;
}

function taxTotalFor(parcels: readonly TaxParcel[], year: number): number {
  let total = 0;
  for (const p of parcels) {
    const y = p.years.find((x) => x.year === year);
    if (y) total += sum(y.installments.map((i) => i.amount_cents));
  }
  return total;
}

function buildInsurance(config: ScenarioConfig, rng: Rng, gla: number, years: number[], carrier: string, policy: string): InsurancePolicy {
  const premiums: number[] = [];
  const base = Math.round(gla * INS_PSF[config.property_kind] * rng.child("level").float(0.9, 1.14) * 100);
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

export function buildCleanModel(config: ScenarioConfig): ScenarioModel {
  const rng = rootRng(config.seed);
  const categories = catalogFor(config.property_kind);
  const years: number[] = Array.from({ length: config.year_count }, (_, i) => config.start_year + i);

  const universe = buildUniverse(config, rng, categories);

  const glaRange = GLA_RANGE[config.size_band];
  const gla = Math.round(rng.child("gla").int(glaRange[0], glaRange[1]) / 500) * 500;
  const sharePct = rng.child("share").float(0.055, 0.145);
  const premises_sf = Math.round((gla * sharePct) / 100) * 100;
  const share_pct = Math.round((premises_sf / gla) * 100 * 10_000) / 10_000;
  const shareFrac = share_pct / 100;

  const capital = buildCapitalProject(config, rng.child("capital"), gla, universe.vendors["contractor"] ?? "Halloway Construction Group");
  const parcels = buildTaxParcels(config, rng.child("tax"), gla, years);
  const insurance = buildInsurance(config, rng.child("insurance"), gla, years, universe.insurance_carrier, universe.policy_number);

  // --- category amounts, year by year -------------------------------------
  const labels = categories.map((c) => c.category);
  const perYear: number[][] = [];
  for (let k = 0; k < years.length; k++) {
    const year = years[k]!;
    if (k === 0) {
      perYear.push(
        categories.map((c) => {
          let v = Math.round(gla * c.psf * rng.child("level/" + c.category).float(1 - c.spread, 1 + c.spread) * 100);
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
    const amortYearTotal = capital.monthly_cents * 12;
    pools.push({
      category: amortizationLabel(capital, year),
      section: "CAM",
      bucket: "non_controllable",
      amount_cents: amortYearTotal,
      capital_project_id: capital.id,
      trade: "contractor",
    });

    const taxTotal = taxTotalFor(parcels, year);
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

  // --- cap schedule, tenant totals and estimates ---------------------------
  let prevPaid = capBaseAmount;
  for (let k = 0; k < modelYears.length; k++) {
    const y = modelYears[k]!;
    const allowed = prevPaid + mulRate(prevPaid, capPct / 100);
    const billedPool = Math.min(y.recon.controllable_actual_cents, allowed);
    y.recon.cap_allowed_cents = allowed;
    y.recon.cap_billed_cents = billedPool;
    y.recon.billed_pool_cents = y.recon.pool_total_cents - y.recon.controllable_actual_cents + billedPool;
    y.recon.tenant_total_cents = mulRate(y.recon.billed_pool_cents, shareFrac);
    prevPaid = billedPool;
  }

  for (let k = 0; k < modelYears.length; k++) {
    const y = modelYears[k]!;
    const estRng = rng.child("estimate/" + y.year);
    const estimate = Math.round((y.recon.tenant_total_cents * estRng.float(0.9, 0.98)) / 12);
    y.estimate_monthly_cents = estimate;
    y.recon.estimates_paid_cents = estimate * 12;
    y.recon.balance_due_cents = y.recon.tenant_total_cents - y.recon.estimates_paid_cents;
  }

  // --- delivery dates and the tenant's account ----------------------------
  const delivery: Record<number, string> = {};
  for (const y of modelYears) {
    const dRng = rng.child("delivery/" + y.year);
    delivery[y.year] = iso(y.year + 1, dRng.int(3, 8), dRng.int(4, 26));
  }

  const ledger = buildLedger(modelYears, lease, delivery, rng.child("ledger"));

  return {
    config,
    universe,
    lease,
    years: modelYears,
    capital_projects: [capital],
    tax_parcels: parcels,
    insurance,
    ledger,
    delivery,
    planted: [],
  };
}

function taxGl(parcels: readonly TaxParcel[], universe: Universe, year: number): GLEntry[] {
  const out: GLEntry[] = [];
  for (const p of parcels) {
    const y = p.years.find((x) => x.year === year);
    if (!y) continue;
    y.installments.forEach((inst, i) => {
      out.push({
        year,
        date: inst.due,
        account: universe.gl_accounts["Real estate taxes"]!,
        category: "Real estate taxes",
        vendor: universe.tax_collector,
        memo: `Parcel ${p.parcel_id} — ${year} installment ${i + 1} of ${y.installments.length}`,
        amount_cents: inst.amount_cents,
      });
    });
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
  return Array.from({ length: 12 }, (_, i) => ({
    year,
    date: iso(year, i + 1, 28),
    account: universe.gl_accounts["Amortization"]!,
    category: label,
    vendor: p.contractor,
    memo: `${p.asset_name} (job ${p.job_number}) — monthly amortization ${i + 1} of ${p.recovery_period_months}`,
    amount_cents: p.monthly_cents,
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

/**
 * The tenant's account as the landlord keeps it: base rent and the monthly
 * operating-expense estimate charged on the first, the reconciliation true-up
 * charged when the package is delivered, and one payment a month covering what
 * was charged. The balance returns to zero, so a reader can check it by eye.
 */
function buildLedger(
  years: readonly ModelYear[],
  lease: LeaseAbstract,
  delivery: Record<number, string>,
  rng: Rng,
): LedgerEntry[] {
  interface Row {
    date: string;
    period: string;
    code: LedgerEntry["code"];
    description: string;
    charge_cents: number;
  }
  const rows: Row[] = [];

  years.forEach((y, k) => {
    const rentAnnual = Math.round(lease.premises_sf * lease.base_rent_psf_year1 * Math.pow(1 + lease.base_rent_escalation_pct / 100, k) * 100);
    const rentMonthly = Math.round(rentAnnual / 12);
    for (let m = 1; m <= 12; m++) {
      rows.push({ date: iso(y.year, m, 1), period: period(y.year, m), code: "RNT", description: `Base rent — ${monthName(m)} ${y.year}`, charge_cents: rentMonthly });
      rows.push({
        date: iso(y.year, m, 1),
        period: period(y.year, m),
        code: "EST",
        description: `Operating expense estimate — ${monthName(m)} ${y.year}`,
        charge_cents: y.estimate_monthly_cents,
      });
    }
    const d = delivery[y.year]!;
    rows.push({
      date: d,
      period: period(Number(d.slice(0, 4)), Number(d.slice(5, 7))),
      code: "REC",
      description: `${y.year} operating expense reconciliation — balance ${y.recon.balance_due_cents >= 0 ? "due" : "credit"}`,
      charge_cents: y.recon.balance_due_cents,
    });
  });

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : 1));

  // One payment a month, a few days after the charges it settles.
  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(r.period, (byMonth.get(r.period) ?? 0) + r.charge_cents);

  const out: LedgerEntry[] = [];
  let balance = 0;
  const periods = [...byMonth.keys()].sort();
  for (const p of periods) {
    for (const r of rows.filter((x) => x.period === p)) {
      balance += r.charge_cents;
      out.push({ date: r.date, period: r.period, code: r.code, description: r.description, charge_cents: r.charge_cents, payment_cents: 0, balance_cents: balance });
    }
    const due = byMonth.get(p)!;
    if (due === 0) continue;
    const last = rows.filter((x) => x.period === p).map((x) => x.date).sort().at(-1)!;
    const payDate = addDays(last, rng.child("pay/" + p).int(2, 9));
    balance -= due;
    out.push({
      date: payDate,
      period: p,
      code: "PAY",
      description: due >= 0 ? `Payment received — thank you` : `Credit applied`,
      charge_cents: 0,
      payment_cents: due,
      balance_cents: balance,
    });
  }
  return out;
}
