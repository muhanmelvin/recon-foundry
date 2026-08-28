/** The configuration sweep the model tests run over: every shape, several seeds. */

import type { PropertyKind, ScenarioConfig, SizeBand } from "../../src/engine/model/types.ts";

const KINDS: PropertyKind[] = ["retail_strip", "office", "industrial_flex"];
const BANDS: SizeBand[] = ["small", "medium", "large"];

/** 27 configurations: every kind × band × year count, with a distinct seed each. */
export function sweep(): ScenarioConfig[] {
  const out: ScenarioConfig[] = [];
  let i = 0;
  for (const property_kind of KINDS) {
    for (const size_band of BANDS) {
      for (const year_count of [2, 3] as const) {
        out.push({
          seed: `sweep-${property_kind}-${size_band}-${year_count}`,
          start_year: 2021 + (i % 4),
          year_count,
          property_kind,
          size_band,
          schemes: [],
        });
        i++;
      }
    }
  }
  // A few extra seeds on the commonest shape, to widen the draw.
  for (let k = 0; k < 9; k++) {
    out.push({
      seed: `retail-${k}`,
      start_year: 2022 + (k % 3),
      year_count: k % 2 === 0 ? 3 : 2,
      property_kind: "retail_strip",
      size_band: BANDS[k % 3]!,
      schemes: [],
    });
  }
  return out;
}

/** The three scenarios whose bytes are pinned as goldens. */
export const GOLDEN_CONFIGS: ScenarioConfig[] = [
  { seed: "foundry-golden-1", start_year: 2023, year_count: 3, property_kind: "retail_strip", size_band: "medium", schemes: [] },
  { seed: "foundry-golden-2", start_year: 2022, year_count: 2, property_kind: "office", size_band: "large", schemes: [] },
  { seed: "foundry-golden-3", start_year: 2024, year_count: 3, property_kind: "industrial_flex", size_band: "small", schemes: [] },
];
