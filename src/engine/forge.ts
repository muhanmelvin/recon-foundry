/**
 * `forge(config)` — the one entry point the rest of the app uses.
 *
 * Build the clean model, plant whatever schemes were asked for, then work out
 * what the lease actually required. The result is a package and the truth about
 * it, and both are pure functions of the configuration: the same seed forges the
 * same property, the same invoices and the same answer key, every time.
 */

import { rootRng } from "./rng.ts";
import { validateScenarioConfig } from "./model/bounds.ts";
import { buildCleanModel } from "./model/clean.ts";
import { applySchemes } from "./model/schemes/index.ts";
import { buildAnswerKey, type AnswerKey } from "./model/answer-key.ts";
import { checkTies, type TieBreak } from "./model/ties.ts";
import type { ScenarioConfig, ScenarioModel } from "./model/types.ts";

export interface Scenario {
  model: ScenarioModel;
  answerKey: AnswerKey;
  /**
   * The ties that do not hold. In a clean package this is empty; in a schemed
   * one it is exactly the seams the schemes declared, which is what the UI's
   * ties panel shows and what `tests/schemes.test.ts` pins.
   */
  breaks: TieBreak[];
}

export function forge(config: ScenarioConfig): Scenario {
  // The gate, not the markup. A panel's min/max colours a control; a pasted
  // draft or a hand-built config never sees it, and both reach this line.
  const errors = validateScenarioConfig(config);
  if (errors.length > 0) throw new Error("forge: " + errors.join(" "));

  const model = buildCleanModel(config);
  applySchemes(model, rootRng(config.seed));
  return { model, answerKey: buildAnswerKey(model), breaks: checkTies(model) };
}
