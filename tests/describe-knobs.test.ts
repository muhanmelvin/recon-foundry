/**
 * The two knobs a description can turn, held to the same standard as everything
 * else the engine forges: the seven ties hold, the package is byte-deterministic,
 * and the Red-Flag Scanner still finds nothing in a clean one.
 *
 * That last clause is the one worth being nervous about. `premises_sf` changes
 * the denominator the share is computed from, and `opex_psf_target` moves every
 * amount in the package — so between them they can reach RF-05's round-number
 * test, RF-08's share arithmetic, and the drift bands RF-01 and RF-12 watch.
 * A knob that quietly makes clean packages dirty would be worse than no knob.
 */

import { describe, expect, it } from "vitest";
import { forge } from "../src/engine/forge.ts";
import { buildCleanModel } from "../src/engine/model/clean.ts";
import { toReconPackage } from "../src/engine/render/recon-package.ts";
import { buildPackageZip } from "../src/engine/package/packager.ts";
import { isRoundPoolAmount, normalizeLabel } from "../src/engine/scanner-rules.ts";
import { MAX_ANNUAL_OPEX, OPEX_PSF_MAX, OPEX_PSF_MIN, PREMISES_SF_MAX, PREMISES_SF_MIN, validateScenarioConfig } from "../src/engine/model/bounds.ts";
import type { PropertyKind, ScenarioConfig, SizeBand } from "../src/engine/model/types.ts";

function config(over: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return { seed: "knobs-1", start_year: 2023, year_count: 3, property_kind: "retail_strip", size_band: "medium", schemes: [], ...over };
}

/** A corner-and-middle sweep rather than a dense one: the failures live at the edges. */
const KINDS: PropertyKind[] = ["retail_strip", "office", "industrial_flex"];
const BANDS: SizeBand[] = ["small", "medium", "large"];
const SFS = [PREMISES_SF_MIN, 12_500, 40_000, 250_000, PREMISES_SF_MAX];
const PSFS = [OPEX_PSF_MIN, 4.25, 9.5, 22, OPEX_PSF_MAX];

/**
 * Every kind against every band, every square footage and every rate, but not
 * the full cross product of the four — that is 225 scenarios, each of which
 * forges up to four times while the expense scale converges, and the extra
 * combinations buy coverage of nothing the four axes do not already cover
 * separately. Rotating the rate through the list gives every (kind, band, sf)
 * and every (kind, band, rate) pairing at a fifth of the cost.
 */
const SWEEP: ScenarioConfig[] = [];
let rotation = 0;
for (const property_kind of KINDS) {
  for (const size_band of BANDS) {
    for (const premises_sf of SFS) {
      const opex_psf_target = PSFS[rotation++ % PSFS.length]!;
      if (premises_sf * opex_psf_target > MAX_ANNUAL_OPEX) continue;
      SWEEP.push(config({ seed: `knobs-${property_kind}-${size_band}-${premises_sf}-${opex_psf_target}`, property_kind, size_band, premises_sf, opex_psf_target }));
    }
  }
}
// And the four corners explicitly, whatever the rotation happened to land on.
for (const premises_sf of [PREMISES_SF_MIN, PREMISES_SF_MAX]) {
  for (const opex_psf_target of [OPEX_PSF_MIN, OPEX_PSF_MAX]) {
    SWEEP.push(config({ seed: `knobs-corner-${premises_sf}-${opex_psf_target}`, premises_sf, opex_psf_target }));
  }
}

describe("the square footage is exactly the one that was asked for", () => {
  it.each(SWEEP.map((c) => [c.seed, c] as const))("%s", (_seed, c) => {
    const { model, breaks } = forge(c);
    expect(model.lease.premises_sf).toBe(c.premises_sf);
    // Tie T7 is the one that would notice a share that does not reproduce.
    expect(breaks).toEqual([]);
  });
});

describe("the property is bigger than the space inside it, and the share reproduces", () => {
  it.each(SWEEP.map((c) => [c.seed, c] as const))("%s", (_seed, c) => {
    const { model } = forge(c);
    const gla = model.lease.denominator_sf;
    expect(gla).toBeGreaterThan(model.lease.premises_sf);
    const recomputed = Math.round((model.lease.premises_sf / gla) * 100 * 10_000) / 10_000;
    expect(recomputed).toBe(model.lease.share_pct);
    for (const y of model.years) expect(y.denominator_sf).toBe(gla);
  });
});

describe("the pool lands where the target said it would", () => {
  it.each(SWEEP.map((c) => [c.seed, c] as const))("%s", (_seed, c) => {
    const { model } = forge(c);
    const first = model.years[0]!;
    const psf = first.recon.pool_total_cents / 100 / first.denominator_sf;
    // The response is not perfectly linear — a capital project has a floor under
    // its monthly principal, a tax bill rounds to a whole assessed value — so the
    // engine corrects and re-forges rather than solving in one step. One percent
    // is the room that iteration is allowed to leave.
    expect(Math.abs(psf - c.opex_psf_target!) / c.opex_psf_target!).toBeLessThan(0.01);
  });
});

describe("a package forged from the knobs is still a clean package", () => {
  it.each(SWEEP.map((c) => [c.seed, c] as const))("%s trips no round-number or drift check", (_seed, c) => {
    const model = buildCleanModel(c);

    const round = model.years.flatMap((y) => y.pools.filter((p) => isRoundPoolAmount(p.amount_cents)).map((p) => `${y.year} ${p.category}`));
    expect(round).toEqual([]);

    const drifted: string[] = [];
    for (let k = 1; k < model.years.length; k++) {
      const prev = model.years[k - 1]!;
      for (const p of model.years[k]!.pools) {
        const q = prev.pools.find((x) => normalizeLabel(x.category) === normalizeLabel(p.category));
        if (!q || q.amount_cents <= 0) continue;
        if (p.capital_project_id && q.capital_project_id) continue;
        if (Math.abs((p.amount_cents - q.amount_cents) / q.amount_cents) >= 0.15) drifted.push(`${p.category}`);
        if (p.amount_cents === q.amount_cents) drifted.push(`${p.category} identical`);
      }
    }
    expect(drifted).toEqual([]);
  });
});

describe("determinism survives the knobs", () => {
  it("forges the same bytes twice, iteration and all", () => {
    const c = config({ premises_sf: 38_400, opex_psf_target: 11.75, schemes: ["above_cap_billing"] });
    const a = forge(c);
    const b = forge(c);
    expect(JSON.stringify(toReconPackage(a.model))).toBe(JSON.stringify(toReconPackage(b.model)));
    expect(Array.from(buildPackageZip(a.model, a.answerKey).bytes)).toEqual(Array.from(buildPackageZip(b.model, b.answerKey).bytes));
  });

  it("does not depend on which object the config arrived in", () => {
    const one = forge(config({ premises_sf: 22_100, opex_psf_target: 7.4 }));
    const two = forge({ ...config(), premises_sf: 22_100, opex_psf_target: 7.4 });
    expect(JSON.stringify(toReconPackage(one.model))).toBe(JSON.stringify(toReconPackage(two.model)));
  });
});

describe("the knobs reach the package the scanner reads", () => {
  it("puts the visitor's square footage in meta and in the share", () => {
    const pkg = toReconPackage(forge(config({ premises_sf: 40_000, opex_psf_target: 9.5 })).model) as {
      meta: { premises_sf: number; story: string };
      lease_lite: { share: { numerator_sf: number } };
    };
    expect(pkg.meta.premises_sf).toBe(40_000);
    expect(pkg.lease_lite.share.numerator_sf).toBe(40_000);
  });

  it("carries a story the visitor wrote instead of the one the engine composes", () => {
    const written = "A distribution tenant at a flex park, arguing about a repaved truck court.";
    const withStory = toReconPackage(forge(config({ story: written })).model) as { meta: { story: string } };
    const without = toReconPackage(forge(config()).model) as { meta: { story: string } };
    expect(withStory.meta.story).toBe(written);
    expect(without.meta.story).not.toBe(written);
  });

  it("falls back to the composed story when the written one is blank", () => {
    const blank = toReconPackage(forge(config({ story: "   " })).model) as { meta: { story: string } };
    const none = toReconPackage(forge(config()).model) as { meta: { story: string } };
    expect(blank.meta.story).toBe(none.meta.story);
  });
});

describe("the engine is the gate, not the markup", () => {
  it.each([
    [{ premises_sf: PREMISES_SF_MIN - 1 }, "premises_sf"],
    [{ premises_sf: PREMISES_SF_MAX + 1 }, "premises_sf"],
    [{ premises_sf: 40_000.5 }, "premises_sf"],
    [{ opex_psf_target: OPEX_PSF_MIN - 0.01 }, "opex_psf_target"],
    [{ opex_psf_target: OPEX_PSF_MAX + 0.01 }, "opex_psf_target"],
    [{ opex_psf_target: 9.505 }, "opex_psf_target"],
    [{ premises_sf: 500_000, opex_psf_target: 60.01 }, "opex_psf_target"],
    [{ story: "A tenant at Maplewood Commerce Center." }, "Maplewood"],
    [{ story: "x".repeat(200) }, "story"],
    [{ start_year: 1999 }, "start_year"],
    [{ seed: "" }, "seed"],
  ] as Array<[Partial<ScenarioConfig>, string]>)("refuses %o", (over, needle) => {
    const c = config(over);
    expect(validateScenarioConfig(c).join(" ")).toContain(needle);
    expect(() => forge(c)).toThrow(/forge:/);
  });

  it("lets a legal config through untouched", () => {
    expect(validateScenarioConfig(config({ premises_sf: 40_000, opex_psf_target: 9.5, story: "A retail tenant." }))).toEqual([]);
  });

  it("treats a blank story as an absent one, the way the package renderer does", () => {
    expect(validateScenarioConfig(config({ story: "   " }))).toEqual([]);
  });

  it("allows the largest scenario the two knobs can describe between them", () => {
    // The ceiling sits exactly on the corner: 500,000 sf at $60.00 is $30M to
    // the dollar. Nothing in bounds today can breach it without breaching a
    // range first — the check is there for a later widening.
    expect(validateScenarioConfig(config({ premises_sf: PREMISES_SF_MAX, opex_psf_target: OPEX_PSF_MAX }))).toEqual([]);
    expect(PREMISES_SF_MAX * OPEX_PSF_MAX).toBe(MAX_ANNUAL_OPEX);
  });
});
