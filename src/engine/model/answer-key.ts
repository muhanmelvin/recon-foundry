/**
 * The answer key: what was billed, what the lease required, and where the
 * difference is visible on the paper.
 *
 * The interesting half of this file is `correctFigures`, which is not a record
 * of what the schemes did — it is an independent recomputation of what the
 * package *should* have said, done from the lease. That distinction matters. A
 * key assembled by asking each scheme "how much did you steal?" would agree with
 * itself by construction and prove nothing. A key that re-derives the correct
 * reconciliation from the model's own facts and the lease's own rules is the
 * same work an auditor does, and it catches a scheme whose arithmetic does not
 * add up as readily as it catches the landlord.
 *
 * Every scheme's correction is stated once, here, in lease terms:
 *
 * - capital expensed in a lump → only the first instalment belongs in the year
 * - a fee on a wider base → recompute on the base §6.03 permits
 * - a cap grown on the cap → rebuild the ladder on the amount payable
 * - a category moved out of the capped pool → put it back where it was
 * - a tax refund kept → net the tax line by the credit the backup shows
 */

import type { AnswerFinding, ScenarioModel, SchemeId } from "./types.ts";
import { feeBaseCents, leaseLadder, mulRate, sumCents } from "./recompute.ts";
import { scannerFeeBaseCents } from "../scanner-rules.ts";

export interface YearTruth {
  pool_billed: number;
  pool_correct: number;
  controllable_billed: number;
  controllable_correct: number;
  cap_ceiling_correct: number | null;
  cap_payable_correct: number;
  cap_billed: number;
  cap_stated_by_landlord: number | null;
  fee_billed: number;
  fee_correct: number;
  tax_billed: number;
  tax_correct: number;
  capital_billed: number;
  capital_correct: number;
  tenant_billed: number;
  tenant_correct: number;
  tenant_excess: number;
  estimates_paid: number;
  balance_due_billed: number;
  balance_due_correct: number;
}

export interface AnswerKey {
  scenario_id: string;
  seed: string;
  config: ScenarioModel["config"];
  property_name: string;
  tenant_name: string;
  site_code: string;
  schemes: SchemeId[];
  /** Per year: billed against what the lease required, in integer cents. */
  ledger: Record<number, YearTruth>;
  findings: AnswerFinding[];
  total_planted_tenant_impact_cents: number;
  expected_scanner: {
    /** True when the package is clean: the scanner should find nothing at all. */
    clean: boolean;
    /** The number of `high` findings the scanner should raise at least. */
    high_min: number;
    /**
     * Findings only the documents reveal — the scanner cannot see these. Zero
     * for all five schemes since RF-13 learned to read the tax backup; the
     * count stays in the format because it is how the *next* invisible scheme
     * gets declared rather than hidden.
     */
    document_only: number;
  };
}

/** Dollars, for the JSON a person reads. */
function d(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * The reconciliation the lease requires, recomputed from the model's facts.
 * Independent of what the schemes recorded about themselves.
 */
export function correctFigures(model: ScenarioModel): Record<number, YearTruth> {
  const cap = model.lease.cap;
  const shareFrac = model.lease.share_pct / 100;
  const out: Record<number, YearTruth> = {};

  let priorPayable = cap ? cap.base_year_amount_cents : 0;

  for (let k = 0; k < model.years.length; k++) {
    const y = model.years[k]!;
    const prior = k > 0 ? model.years[k - 1] : undefined;

    // Line by line: the amount, and the classification, the lease requires.
    const corrected = y.pools.map((p) => {
      let amount = p.amount_cents;
      let bucket = p.bucket;

      // Capital expensed in a lump: only the first instalment belongs here.
      const project = model.capital_projects.find((c) => !c.amortized && c.statement_caption === p.category);
      if (project) amount = Math.round(project.total_cost_cents / model.lease.capital_life_years);

      // A tax refund the backup shows but the statement never netted.
      if (p.section === "Taxes") {
        const credits = sumCents(
          model.tax_parcels.map((parcel) => parcel.years.find((x) => x.year === y.year)?.credit?.amount_cents ?? 0),
        );
        amount -= credits;
      }

      // A category that changed class between years: the lease fixes the class.
      if (prior && !p.is_fee && !p.capital_project_id) {
        const before = prior.pools.find((x) => x.trade === p.trade && !x.is_fee && !x.capital_project_id);
        if (before) bucket = before.bucket;
      }

      return { ...p, amount_cents: amount, bucket };
    });

    // The fee, on the base the lease permits, over the corrected amounts.
    const feeLine = corrected.find((p) => p.is_fee);
    const permittedBase = feeBaseCents(corrected, model.lease.fee.base);
    const feeCorrect = mulRate(permittedBase, model.lease.fee.rate_pct / 100);
    if (feeLine) feeLine.amount_cents = feeCorrect;

    const controllableCorrect = sumCents(corrected.filter((p) => p.bucket === "controllable").map((p) => p.amount_cents));
    const poolCorrect = sumCents(corrected.map((p) => p.amount_cents));

    let ceiling: number | null = null;
    let payable = controllableCorrect;
    if (cap) {
      ceiling = priorPayable + mulRate(priorPayable, cap.pct / 100);
      payable = Math.min(controllableCorrect, ceiling);
      priorPayable = payable;
    }

    const billedPoolCorrect = poolCorrect - controllableCorrect + payable;
    const tenantCorrect = mulRate(billedPoolCorrect, shareFrac);

    const taxBilled = sumCents(y.pools.filter((p) => p.section === "Taxes").map((p) => p.amount_cents));
    const taxCorrect = sumCents(corrected.filter((p) => p.section === "Taxes").map((p) => p.amount_cents));
    const capitalBilled = sumCents(
      y.pools.filter((p) => p.capital_project_id || model.capital_projects.some((c) => !c.amortized && c.statement_caption === p.category)).map((p) => p.amount_cents),
    );
    const capitalCorrect = sumCents(
      corrected.filter((p) => p.capital_project_id || model.capital_projects.some((c) => !c.amortized && c.statement_caption === p.category)).map((p) => p.amount_cents),
    );

    out[y.year] = {
      pool_billed: y.recon.pool_total_cents,
      pool_correct: poolCorrect,
      controllable_billed: y.recon.controllable_actual_cents,
      controllable_correct: controllableCorrect,
      cap_ceiling_correct: ceiling,
      cap_payable_correct: payable,
      cap_billed: y.recon.cap_billed_cents,
      cap_stated_by_landlord: y.recon.cap_allowed_cents,
      fee_billed: y.recon.fee_billed_cents,
      fee_correct: feeCorrect,
      tax_billed: taxBilled,
      tax_correct: taxCorrect,
      capital_billed: capitalBilled,
      capital_correct: capitalCorrect,
      tenant_billed: y.recon.tenant_total_cents,
      tenant_correct: tenantCorrect,
      tenant_excess: y.recon.tenant_total_cents - tenantCorrect,
      estimates_paid: y.recon.estimates_paid_cents,
      balance_due_billed: y.recon.balance_due_cents,
      balance_due_correct: tenantCorrect - y.recon.estimates_paid_cents,
    };
  }

  return out;
}

export function scenarioId(model: ScenarioModel): string {
  const schemes = model.config.schemes.length === 0 ? "clean" : String(model.config.schemes.length);
  return `${model.universe.site_code}-${model.config.start_year}-${schemes}`;
}

/**
 * What the Red-Flag Scanner will estimate for a finding, as a range with a few
 * percent either side.
 *
 * Deliberately computed here, from the finished package, rather than by each
 * scheme as it runs. Two reasons. Schemes are applied in sequence and a later
 * one moves figures an earlier one already reported — the migration scales the
 * controllable pool after the fee scheme has widened its base — so a range
 * fixed at plant time goes stale. And for the fee, the scanner's estimate is
 * knowably *smaller* than the true overcharge, because it computes the
 * permitted base its own way; a range taken from the answer key's own figures
 * would never contain the number the scanner actually produces.
 */
function fillExpectedRanges(model: ScenarioModel, findings: AnswerFinding[], ledger: Record<number, YearTruth>): void {
  const shareFrac = model.lease.share_pct / 100;
  const ladder = leaseLadder(model);
  const band = (cents: number): [number, number] => [Math.floor((cents * 0.96) / 100), Math.ceil((cents * 1.04) / 100) + 1];

  for (const f of findings) {
    if (typeof f.year !== "number") continue;
    const y = model.years.find((x) => x.year === f.year);
    const truth = ledger[f.year];
    if (!y || !truth) continue;

    if (f.check_id === "RF-06") {
      // The pool *as the statement presents it*, which is what RF-06 compares
      // against — not the corrected pool in the truth ledger. When a migration
      // has also moved a line out, those two are different populations and
      // mixing them produces a range the scanner's answer will never fall in.
      const rung = ladder?.get(f.year);
      const payableAsPresented = rung ? Math.min(truth.controllable_billed, rung.ceiling) : truth.cap_payable_correct;
      f.expected_impact_range = band(mulRate(Math.max(0, truth.cap_billed - payableAsPresented), shareFrac));
    } else if (f.check_id === "RF-07") {
      // The scanner's permitted base, not the lease's narrower one.
      const scannerBase = scannerFeeBaseCents(
        y.pools.map((p) => ({ label: p.category, section: p.section, amount_cents: p.amount_cents, is_fee: p.is_fee })),
      );
      const asScannerSeesIt = truth.fee_billed - mulRate(scannerBase, model.lease.fee.rate_pct / 100);
      // RF-07 stays quiet below a dollar of pool-level excess.
      f.scanner_visible = asScannerSeesIt > 100;
      f.expected_impact_range = band(mulRate(Math.max(0, asScannerSeesIt), shareFrac));
    } else if (f.check_id === "RF-09") {
      const line = y.pools.find((p) => p.category === f.category);
      if (line) {
        const firstInstalment = Math.round(line.amount_cents / model.lease.capital_life_years);
        f.expected_impact_range = band(mulRate(line.amount_cents - firstInstalment, shareFrac));
      }
    } else if (f.check_id === "RF-13") {
      // RF-13 nets the backup the same way the truth ledger does — the levy as
      // issued, less the credits the collector's account shows — so the
      // scanner's estimate and the answer key's are the same arithmetic on the
      // same figures, and the band is only there for the rounding.
      f.expected_impact_range = band(mulRate(truth.tax_billed - truth.tax_correct, shareFrac));
    }
  }

  // RF-04 spans two years and prices what the cap would have disallowed.
  for (const f of findings.filter((x) => x.check_id === "RF-04")) {
    const last = model.years[model.years.length - 1]!;
    const truth = ledger[last.year];
    if (!truth) continue;
    const escaping = Math.max(0, truth.controllable_correct - (truth.cap_ceiling_correct ?? truth.controllable_correct));
    f.expected_impact_range = band(mulRate(escaping, shareFrac));
  }
}

export function buildAnswerKey(model: ScenarioModel): AnswerKey {
  const ledger = correctFigures(model);
  const findings = model.planted.flatMap((p) => p.findings);
  fillExpectedRanges(model, findings, ledger);
  const total = sumCents(Object.values(ledger).map((t) => t.tenant_excess));

  return {
    scenario_id: scenarioId(model),
    seed: model.config.seed,
    config: model.config,
    property_name: model.universe.property_name,
    tenant_name: model.universe.tenant_name,
    site_code: model.universe.site_code,
    schemes: model.config.schemes,
    ledger,
    findings,
    total_planted_tenant_impact_cents: total,
    expected_scanner: {
      clean: model.planted.length === 0,
      high_min: findings.filter((f) => f.check_id !== null && f.scanner_visible !== false && f.severity === "high").length,
      document_only: findings.filter((f) => f.check_id === null).length,
    },
  };
}

/**
 * The projection the Red-Flag Scanner's fixture test reads: the shape of
 * `red-flag-scanner/src/data/manifests/mw-b.manifest.json`.
 *
 * Two things are dropped on the way out. Findings with no `check_id` — because
 * no check can raise them, and a manifest that expected one would fail forever.
 * And the `seam` and `evidence` prose, which is training material, not a test
 * assertion.
 */
export function toScannerManifest(key: AnswerKey): unknown {
  return {
    package_id: key.scenario_id,
    expected_high_min: key.expected_scanner.high_min,
    ...(key.expected_scanner.clean ? { expected_total_findings: 0, expected_high: 0 } : {}),
    ledger: Object.fromEntries(
      Object.entries(key.ledger).map(([year, t]) => [
        year,
        {
          pool_actual: d(t.controllable_billed),
          allowed_correct: t.cap_ceiling_correct === null ? null : d(t.cap_ceiling_correct),
          paid_correct: d(t.cap_payable_correct),
          billed: d(t.cap_billed),
          ll_allowed: t.cap_stated_by_landlord === null ? null : d(t.cap_stated_by_landlord),
          fee_billed: d(t.fee_billed),
          fee_correct: d(t.fee_correct),
          tax_billed: d(t.tax_billed),
          tax_correct: d(t.tax_correct),
          capital_billed: d(t.capital_billed),
          capital_correct: d(t.capital_correct),
          tenant_billed: d(t.tenant_billed),
          tenant_correct: d(t.tenant_correct),
          tenant_excess: d(t.tenant_excess),
        },
      ]),
    ),
    findings: key.findings
      .filter((f) => f.check_id !== null && f.scanner_visible !== false)
      .map((f) => ({
        check_id: f.check_id,
        year: f.year,
        category: f.category,
        severity: f.severity,
        ...(f.expected_impact_range ? { expected_impact_range: f.expected_impact_range } : {}),
        // The scanner drops a quantified finding to "info" when the tenant-level
        // impact falls under its materiality threshold. Where that is possible,
        // the severity above is the intent, not a promise.
        ...(f.expected_impact_range && f.expected_impact_range[0] < 250 ? { materiality_sensitive: true } : {}),
        ...(f.note ? { note: f.note } : {}),
      })),
    /**
     * Checks that fire *because* of a planted scheme without being the finding
     * it was planted for — a new line appearing, a category vanishing, a swing
     * the scheme caused. A scanner-side test needs these to tell an expected
     * consequence from an unplanned one; without the distinction, "no findings
     * beyond the manifest" would be false for every scheme that moves a line.
     */
    cofires: [...new Set(key.findings.flatMap((f) => f.cofires ?? []))].sort(),
    total_planted_tenant_impact: d(key.total_planted_tenant_impact_cents),
    document_only_findings: key.expected_scanner.document_only,
  };
}
