/**
 * "Clean" here means something stricter than "the arithmetic works": it means
 * the Red-Flag Scanner, pointed at this package, finds *nothing at all*.
 *
 * That is a promise about twelve checks the scanner runs, and it is easy to
 * break by accident — a category renamed to something with "parking" in it, a
 * per-square-foot rate that lands a pool on a round $18,000, a growth range
 * widened past the scanner's 15% question. Each test below pins one of those
 * checks' trigger conditions against every shape the generator can forge, so
 * the break is caught here rather than in the scanner repo three milestones
 * later.
 *
 * This is a mirror, not the authority. The authority is the fixture test that
 * runs the real scanner over a forged package (milestone M5b); if the two ever
 * disagree, the scanner is right and `src/engine/scanner-rules.ts` is stale.
 */

import { describe, expect, it } from "vitest";
import { buildCleanModel } from "../src/engine/model/clean.ts";
import { allCategoryLabels } from "../src/engine/model/categories.ts";
import { isRoundPoolAmount, looksCapital, normalizeLabel } from "../src/engine/scanner-rules.ts";
import type { ScenarioModel } from "../src/engine/model/types.ts";
import { sweep } from "./helpers/sweep.ts";

const MODELS: Array<readonly [string, ScenarioModel]> = sweep().map((c) => [c.seed, buildCleanModel(c)] as const);

function mulRate(cents: number, rate: number): number {
  return Math.round(Math.abs(cents) * rate + 1e-9) * (cents < 0 ? -1 : 1);
}

describe("RF-05 — no pool amount looks like a budget figure", () => {
  it.each(MODELS)("%s bills no round amount", (_seed, model) => {
    const round = model.years.flatMap((y) =>
      y.pools.filter((p) => isRoundPoolAmount(p.amount_cents)).map((p) => `${y.year} ${p.category} ${p.amount_cents}`),
    );
    expect(round).toEqual([]);
  });
});

describe("RF-01 and RF-12 — lines move, but not far, and never stand still", () => {
  it.each(MODELS)("%s keeps every line inside 15% and off its own prior figure", (_seed, model) => {
    const problems: string[] = [];
    for (let k = 1; k < model.years.length; k++) {
      const prev = model.years[k - 1]!;
      const curr = model.years[k]!;
      for (const p of curr.pools) {
        const q = prev.pools.find((x) => normalizeLabel(x.category) === normalizeLabel(p.category));
        if (!q || q.amount_cents <= 0) continue;
        // Amortization is fixed by a schedule; the scanner exempts it from both checks.
        if (p.capital_project_id && q.capital_project_id) continue;
        const drift = (p.amount_cents - q.amount_cents) / q.amount_cents;
        if (Math.abs(drift) >= 0.15) problems.push(`${curr.year} ${p.category} ${(drift * 100).toFixed(1)}%`);
        if (p.amount_cents === q.amount_cents) problems.push(`${curr.year} ${p.category} identical to ${prev.year}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("RF-02, RF-03 and RF-04 — nothing appears, vanishes or changes pool", () => {
  it.each(MODELS)("%s presents the same categories in the same places every year", (_seed, model) => {
    const shape = (m: ScenarioModel, i: number) =>
      m.years[i]!.pools.map((p) => `${normalizeLabel(p.category)}|${p.section}|${p.bucket}`).sort();
    const first = shape(model, 0);
    for (let k = 1; k < model.years.length; k++) expect(shape(model, k)).toEqual(first);
  });
});

describe("RF-08 — the share reproduces from the square footage, and the denominator holds still", () => {
  it.each(MODELS)("%s bills a share the statement's own figures produce", (_seed, model) => {
    const denominators = new Set(model.years.map((y) => y.denominator_sf));
    expect(denominators.size).toBe(1);
    const recomputed = (model.lease.premises_sf / model.lease.denominator_sf) * 100;
    expect(Math.abs(recomputed - model.lease.share_pct)).toBeLessThan(0.05);
    for (const y of model.years) {
      const expected = mulRate(y.recon.billed_pool_cents, model.lease.share_pct / 100);
      expect(Math.abs(y.recon.tenant_total_cents - expected)).toBeLessThanOrEqual(100);
    }
  });
});

describe("RF-07 — one fee, on the base the lease permits", () => {
  it.each(MODELS)("%s bills a single management fee on CAM only", (_seed, model) => {
    expect(model.lease.fee.base).toBe("cam_only");
    for (const y of model.years) {
      const fees = y.pools.filter((p) => p.is_fee);
      expect(fees.length).toBe(1);
      const base = y.pools.filter((p) => !p.is_fee && p.section === "CAM").reduce((s, p) => s + p.amount_cents, 0);
      expect(fees[0]!.amount_cents).toBe(mulRate(base, model.lease.fee.rate_pct / 100));
      // No administrative fee and no on-site payroll line beside it: the scanner
      // reads those together as stacked charges for one service.
      const stacked = y.pools.filter((p) => /\badministrative\b|\bsupervisory\b|\boverhead\b|\bpayroll\b|\bproperty manager\b/.test(normalizeLabel(p.category)));
      expect(stacked).toEqual([]);
    }
  });
});

describe("RF-06 — the cap is a ceiling and the landlord respects it", () => {
  it.each(MODELS)("%s bills the lesser of actual and the ceiling", (_seed, model) => {
    const cap = model.lease.cap!;
    expect(cap.basis).toBe("amount_paid");
    let prevPaid = cap.base_year_amount_cents;
    for (const y of model.years) {
      const allowed = prevPaid + mulRate(prevPaid, cap.pct / 100);
      expect(y.recon.cap_allowed_cents).toBe(allowed);
      expect(y.recon.cap_billed_cents).toBe(Math.min(y.recon.controllable_actual_cents, allowed));
      // Billed at actual, never at the ceiling: a cap is not a floor.
      expect(y.recon.cap_billed_cents).toBe(y.recon.controllable_actual_cents);
      prevPaid = y.recon.cap_billed_cents;
    }
  });
});

describe("RF-09 — nothing capital is expensed in a lump", () => {
  it("no label in the whole catalog reads as capital work", () => {
    const offenders = allCategoryLabels().filter((l) => looksCapital(l));
    expect(offenders).toEqual([]);
  });

  it.each(MODELS)("%s amortizes its capital and states a threshold", (_seed, model) => {
    expect(model.lease.capital_threshold_cents).toBeGreaterThan(0);
    for (const y of model.years) {
      for (const p of y.pools) {
        if (p.capital_project_id) {
          expect(model.capital_projects.some((c) => c.id === p.capital_project_id)).toBe(true);
          continue;
        }
        if (looksCapital(p.category)) {
          expect(p.amount_cents, `${p.category} would read as an unamortized capital lump`).toBeLessThanOrEqual(model.lease.capital_threshold_cents);
        }
      }
    }
  });

  it.each(MODELS)("%s recovers each project's cost exactly over its life", (_seed, model) => {
    for (const c of model.capital_projects) {
      expect(c.monthly_cents * c.recovery_period_months).toBe(c.total_cost_cents);
      expect(c.recovery_period_months).toBe(model.lease.capital_life_years * 12);
    }
  });

  it.each(MODELS)("%s captions the amortization line without naming capital work", (_seed, model) => {
    // The workbook can be uploaded on its own, and the wide format carries no
    // amortization detail — so a line captioned "Roof section replacement" would
    // reach the scanner as a lump with nothing behind it. The asset's name lives
    // on the schedule, where the backup is.
    for (const c of model.capital_projects) expect(looksCapital(c.statement_caption)).toBe(false);
    for (const y of model.years) {
      for (const p of y.pools) {
        if (p.capital_project_id) expect(looksCapital(p.category), p.category).toBe(false);
      }
    }
  });

  it.each(MODELS)("%s charges a different installment each year, because interest declines", (_seed, model) => {
    // Straight-line principal alone repeats to the cent, which is what RF-12
    // asks about — and it would be asking about the one line in a clean package
    // that is honestly constant. Interest on the unamortized balance is both
    // what most leases allow and what makes the figure move.
    for (const c of model.capital_projects) expect(c.interest_rate_pct).toBeGreaterThan(0);
    for (let k = 1; k < model.years.length; k++) {
      const prev = model.years[k - 1]!.pools.filter((p) => p.capital_project_id);
      for (const p of model.years[k]!.pools.filter((x) => x.capital_project_id)) {
        const q = prev.find((x) => x.capital_project_id === p.capital_project_id);
        if (!q) continue;
        expect(p.amount_cents).not.toBe(q.amount_cents);
        expect(Math.abs((p.amount_cents - q.amount_cents) / q.amount_cents)).toBeLessThan(0.15);
      }
    }
  });
});

describe("RF-10 — no gross-up is applied, so there is none to get wrong", () => {
  it.each(MODELS)("%s grosses nothing up", (_seed, model) => {
    // The lease carries the provision, as most do; the statements never invoke
    // it. A forged gross-up belongs to a scheme, not to a clean package.
    expect(model.lease.gross_up.allowed).toBe(true);
    for (const y of model.years) expect(y.pools.every((p) => !("gross_up" in p))).toBe(true);
  });
});
