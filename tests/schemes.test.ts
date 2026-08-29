/**
 * The scheme contract: a planted overcharge breaks exactly the tie it says it
 * breaks, and nothing else.
 *
 * That is the specification of the whole app, not a detail. If a scheme leaves
 * collateral damage — a subtotal that no longer adds, a ledger that no longer
 * balances — then a trainee finds the loose thread instead of the overcharge,
 * and the exercise teaches them to look for sloppiness rather than for the thing
 * the job is actually about. A real landlord's package is internally consistent.
 * So is a forged one.
 */

import { describe, expect, it } from "vitest";
import { forge } from "../src/engine/forge.ts";
import { checkTies } from "../src/engine/model/ties.ts";
import { toScannerManifest } from "../src/engine/model/answer-key.ts";
import { SCHEME_ORDER, type ScenarioConfig, type SchemeId, type TieId } from "../src/engine/model/types.ts";
import { sweep } from "./helpers/sweep.ts";

const BASES = sweep().slice(0, 9);

function withSchemes(base: ScenarioConfig, schemes: SchemeId[]): ScenarioConfig {
  return { ...base, schemes };
}

const SETS: Array<[string, SchemeId[]]> = [
  ...SCHEME_ORDER.map((s) => [s, [s]] as [string, SchemeId[]]),
  ["all five", [...SCHEME_ORDER]],
  ["cap and migration", ["above_cap_billing", "bucket_migration"]],
  ["capital and fee", ["unamortized_capital", "fee_base_expansion"]],
];

describe("a scheme breaks exactly the ties it declares", () => {
  const cases = BASES.flatMap((base) => SETS.map(([name, schemes]) => [`${base.seed} · ${name}`, base, schemes] as const));

  it.each(cases)("%s", (_label, base, schemes) => {
    const { model, breaks } = forge(withSchemes(base, schemes));
    const declared = [...new Set(model.planted.flatMap((p) => p.seams))].sort();
    const actual = [...new Set(breaks.map((b) => b.tie))].sort();
    const detail = breaks
      .slice(0, 5)
      .map((b) => `${b.tie} ${b.year} ${b.category ?? "—"} Δ${b.delta_cents}: ${b.detail}`)
      .join("\n");
    expect(actual, `declared ${declared.join(",")} but broke ${actual.join(",")}\n${detail}`).toEqual(declared);
  });

  it("plants one record per scheme asked for, in canonical order", () => {
    const { model } = forge(withSchemes(BASES[0]!, ["kept_tax_refund", "above_cap_billing", "unamortized_capital"]));
    expect(model.planted.map((p) => p.id)).toEqual(["unamortized_capital", "above_cap_billing", "kept_tax_refund"]);
  });

  it("leaves a clean package with nothing planted and nothing broken", () => {
    for (const base of BASES) {
      const { model, breaks, answerKey } = forge(withSchemes(base, []));
      expect(model.planted).toEqual([]);
      expect(breaks).toEqual([]);
      expect(answerKey.findings).toEqual([]);
      expect(answerKey.expected_scanner.clean).toBe(true);
    }
  });
});

describe("each scheme breaks the tie its lesson is about", () => {
  const expected: Record<SchemeId, TieId[]> = {
    // Four of the five are only visible by reading the lease. That is the point:
    // the arithmetic is right and the entitlement is wrong.
    unamortized_capital: ["T7"],
    above_cap_billing: ["T7"],
    fee_base_expansion: ["T7"],
    bucket_migration: ["T7"],
    // The fifth is the opposite case: the lease arithmetic is untouched, and the
    // only thing that gives it away is the tax backup not netting to the tax line.
    kept_tax_refund: ["T4"],
  };

  it.each(SCHEME_ORDER.map((s) => [s, s] as const))("%s", (_n, scheme) => {
    const { model } = forge(withSchemes(BASES[0]!, [scheme]));
    expect(model.planted[0]!.seams).toEqual(expected[scheme]);
  });
});

describe("the answer key is derived from the finished package", () => {
  it.each(BASES.map((b) => [b.seed, b] as const))("%s prices every year against the lease", (_seed, base) => {
    const { model, answerKey } = forge(withSchemes(base, [...SCHEME_ORDER]));
    const summed = Object.values(answerKey.ledger).reduce((s, t) => s + t.tenant_excess, 0);
    expect(answerKey.total_planted_tenant_impact_cents).toBe(summed);
    expect(summed).toBeGreaterThan(0);
    for (const y of model.years) {
      const t = answerKey.ledger[y.year]!;
      expect(t.tenant_billed).toBe(y.recon.tenant_total_cents);
      expect(t.balance_due_billed).toBe(y.recon.balance_due_cents);
      expect(t.tenant_excess).toBe(t.tenant_billed - t.tenant_correct);
    }
  });

  it("gives every finding a seam sentence and somewhere to look", () => {
    const { answerKey } = forge(withSchemes(BASES[0]!, [...SCHEME_ORDER]));
    expect(answerKey.findings.length).toBeGreaterThan(3);
    for (const f of answerKey.findings) {
      expect(f.seam.length, JSON.stringify(f)).toBeGreaterThan(40);
      expect(f.evidence.length).toBeGreaterThan(1);
    }
  });

  it("records the kept refund as RF-13, the check the tax backup made possible", () => {
    // It was `check_id: null` until schema 1.1 gave the package somewhere to
    // carry the collector's account. Nothing about the scheme changed — the
    // scanner learned to read the document that always betrayed it.
    const { answerKey } = forge(withSchemes(BASES[0]!, ["kept_tax_refund"]));
    expect(answerKey.findings).toHaveLength(1);
    expect(answerKey.findings[0]!.check_id).toBe("RF-13");
    expect(answerKey.findings[0]!.expected_impact_range![0]).toBeGreaterThan(0);
    expect(answerKey.expected_scanner.document_only).toBe(0);
    expect(answerKey.total_planted_tenant_impact_cents).toBeGreaterThan(0);
  });
});

describe("the manifest is what the scanner can actually be held to", () => {
  it("carries every finding a check can raise, the kept refund included", () => {
    const { answerKey } = forge(withSchemes(BASES[0]!, [...SCHEME_ORDER]));
    const manifest = toScannerManifest(answerKey) as { findings: Array<{ check_id: string }>; document_only_findings: number; cofires: string[] };
    expect(manifest.findings.every((f) => f.check_id !== null)).toBe(true);
    expect(manifest.findings.map((f) => f.check_id)).toContain("RF-13");
    // Zero since RF-13 landed. The count stays in the format: it is how the
    // *next* scheme no check can see gets declared instead of hidden.
    expect(manifest.document_only_findings).toBe(0);
  });

  it("names the checks that fire as a consequence, so a test can tell them from surprises", () => {
    const { answerKey } = forge(withSchemes(BASES[0]!, ["bucket_migration"]));
    const manifest = toScannerManifest(answerKey) as { cofires: string[] };
    expect(manifest.cofires).toEqual(["RF-02", "RF-03"]);
  });

  it("declares a clean package as expecting nothing at all", () => {
    const { answerKey } = forge(withSchemes(BASES[0]!, []));
    const manifest = toScannerManifest(answerKey) as { expected_total_findings: number; expected_high: number; findings: unknown[] };
    expect(manifest.expected_total_findings).toBe(0);
    expect(manifest.expected_high).toBe(0);
    expect(manifest.findings).toEqual([]);
  });
});

describe("forging is still deterministic once schemes are planted", () => {
  it.each(SETS.map(([n, s]) => [n, s] as const))("%s reproduces exactly", (_n, schemes) => {
    const config = withSchemes(BASES[0]!, schemes);
    expect(forge(config).model).toEqual(forge(config).model);
    expect(forge(config).answerKey).toEqual(forge(config).answerKey);
  });

  it("re-checking the ties gives the same answer as forging did", () => {
    const { model, breaks } = forge(withSchemes(BASES[2]!, [...SCHEME_ORDER]));
    expect(checkTies(model)).toEqual(breaks);
  });
});
