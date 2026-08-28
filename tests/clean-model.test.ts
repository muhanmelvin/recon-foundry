/**
 * The clean generator's two promises: everything ties, and the same seed builds
 * the same package.
 *
 * The tie sweep is the specification of what "a consistent package" means, run
 * over every property shape the app can forge. The golden hashes are the
 * specification of determinism: if one moves, some draw has become
 * order-dependent, and the fix is to find the stream that lost its name — not
 * to paste in the new hash. See CLAUDE.md on golden fixtures.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildCleanModel } from "../src/engine/model/clean.ts";
import { checkTies, TIE_TITLES } from "../src/engine/model/ties.ts";
import { GOLDEN_CONFIGS, sweep } from "./helpers/sweep.ts";

const CONFIGS = sweep();

function hashOf(o: unknown): string {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
}

describe("a clean package ties, in every shape the app can forge", () => {
  it.each(CONFIGS.map((c) => [c.seed, c] as const))("%s", (_seed, config) => {
    const model = buildCleanModel(config);
    const breaks = checkTies(model);
    const detail = breaks
      .slice(0, 5)
      .map((b) => `${b.tie} ${TIE_TITLES[b.tie]} · ${b.year} · ${b.category ?? "—"} · ${b.detail}`)
      .join("\n");
    expect(breaks, `${breaks.length} tie break(s):\n${detail}`).toEqual([]);
  });

  it("carries no planted scheme", () => {
    for (const config of CONFIGS) expect(buildCleanModel(config).planted).toEqual([]);
  });

  it("forges the number of years it was asked for, in ascending order", () => {
    for (const config of CONFIGS) {
      const years = buildCleanModel(config).years.map((y) => y.year);
      expect(years).toEqual(Array.from({ length: config.year_count }, (_, i) => config.start_year + i));
    }
  });
});

describe("the same seed builds the same package", () => {
  it.each(GOLDEN_CONFIGS.map((c) => [c.seed, c] as const))("%s is deep-equal on a second build", (_seed, config) => {
    expect(buildCleanModel(config)).toEqual(buildCleanModel(config));
  });

  it("changes when the seed changes and nothing else does", () => {
    const a = buildCleanModel({ ...GOLDEN_CONFIGS[0]!, seed: "one" });
    const b = buildCleanModel({ ...GOLDEN_CONFIGS[0]!, seed: "two" });
    expect(hashOf(a)).not.toBe(hashOf(b));
  });

  /**
   * Pinned model hashes. A change here means the numbers moved: either
   * deliberately, in which case update these in their own commit with the
   * reason, or accidentally, in which case a stream has stopped being keyed by
   * a stable name and the fix is upstream.
   */
  const GOLDEN_HASHES: Record<string, string> = {
    "foundry-golden-1": "d21c1245d818e5ad",
    "foundry-golden-2": "9930c5a3d5cd682e",
    "foundry-golden-3": "4a84fb67e5530020",
  };

  it.each(GOLDEN_CONFIGS.map((c) => [c.seed, c] as const))("%s matches its pinned hash", (seed, config) => {
    expect(hashOf(buildCleanModel(config))).toBe(GOLDEN_HASHES[seed]);
  });
});
