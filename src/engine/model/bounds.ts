/**
 * The limits on what a visitor may ask the forge for.
 *
 * Until now nothing in this repo — or in any app in the family — had a numeric
 * ceiling, because nothing took a number from anyone. `premises_sf` and
 * `opex_psf_target` do, so this file is where the convention gets set.
 *
 * Two reasons the bounds are here rather than in the markup. First, an HTML
 * `min`/`max` is advisory: it colours a control, and a paste or a script sails
 * straight past it. The engine is the gate, and the panel's attributes are a
 * courtesy that happens to agree with it. Second, three callers need the same
 * numbers — the forge boundary, the pinned prompt that tells an AI what it may
 * fill in, and the validator that checks what came back — and three copies of a
 * bound is two chances for them to drift apart.
 *
 * The product ceiling is the one bound that is not about plausibility. Either
 * knob alone stays inside what a real property looks like; multiplied, they
 * describe a portfolio rather than a building, and the arithmetic is only ever
 * pointed at one lease. Refusing is honest: the generator has no model for it.
 */

import { RESERVED_NAMES } from "../names.ts";
import type { ScenarioConfig } from "./types.ts";

/** Square feet of premises. Below this is a kiosk; above it is a campus. */
export const PREMISES_SF_MIN = 2_000;
export const PREMISES_SF_MAX = 500_000;

/** Dollars of annual operating expense per square foot. */
export const OPEX_PSF_MIN = 2;
export const OPEX_PSF_MAX = 60;

/**
 * Dollars. `premises_sf × opex_psf_target` may not exceed this.
 *
 * Note that it sits exactly on the corner of the other two bounds — 500,000 sf
 * at $60.00 is $30,000,000 to the dollar — so as the numbers stand today no
 * configuration can violate this without violating one of them first. That is
 * deliberate rather than accidental: the ceiling is the statement of intent,
 * and it is what would catch a later widening of either bound before the
 * widening produced a scenario the generator has no model for.
 */
export const MAX_ANNUAL_OPEX = 30_000_000;

export const START_YEAR_MIN = 2015;
export const START_YEAR_MAX = 2030;

/** A story is a caption, not a paragraph. */
export const STORY_MAX_CHARS = 160;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Everything wrong with a config, in the order a reader would meet it. An empty
 * array is the only way through `forge`.
 *
 * Each message names the field, what arrived, and what would have been
 * acceptable — the family's rule for validator output, because an error a user
 * cannot act on is a stack trace with better manners.
 */
export function validateScenarioConfig(config: ScenarioConfig): string[] {
  const errors: string[] = [];

  if (typeof config.seed !== "string" || config.seed.length === 0) {
    errors.push("seed: a seed is required — any word will do, and the same word always forges the same package.");
  }

  if (!Number.isInteger(config.start_year) || config.start_year < START_YEAR_MIN || config.start_year > START_YEAR_MAX) {
    errors.push(`start_year: ${String(config.start_year)} is outside ${START_YEAR_MIN}–${START_YEAR_MAX}.`);
  }

  if (config.year_count !== 2 && config.year_count !== 3) {
    errors.push(`year_count: ${String(config.year_count)} is not 2 or 3 — the scanner's cross-year checks need at least two.`);
  }

  const sf = config.premises_sf;
  if (sf !== undefined) {
    if (!Number.isInteger(sf) || sf < PREMISES_SF_MIN || sf > PREMISES_SF_MAX) {
      errors.push(`premises_sf: ${fmt(Number(sf))} is outside ${fmt(PREMISES_SF_MIN)}–${fmt(PREMISES_SF_MAX)} square feet (whole square feet only).`);
    }
  }

  const psf = config.opex_psf_target;
  if (psf !== undefined) {
    if (!Number.isFinite(psf) || psf < OPEX_PSF_MIN || psf > OPEX_PSF_MAX) {
      errors.push(`opex_psf_target: $${String(psf)} is outside $${OPEX_PSF_MIN.toFixed(2)}–$${OPEX_PSF_MAX.toFixed(2)} per square foot.`);
    } else if (Math.round(psf * 100) !== psf * 100) {
      errors.push(`opex_psf_target: $${String(psf)} has more than two decimal places.`);
    }
  }

  // A blank story is not an error, it is an absence: `storyOf` in
  // recon-package.ts falls back to the composed one, and the panel's own input
  // clears the key when it is emptied. Refusing it here would make the two
  // disagree about the same value.
  if (config.story !== undefined && config.story.trim() !== "") {
    if (typeof config.story !== "string") {
      errors.push("story: a story is a line of text.");
    } else if (config.story.length > STORY_MAX_CHARS) {
      errors.push(`story: ${config.story.length} characters, over the ${STORY_MAX_CHARS}-character limit.`);
    } else {
      // The last gate on the one string in a package a human wrote. The name
      // bank could not draw these; a typed or pasted story could.
      const hit = RESERVED_NAMES.find((n) => config.story!.toLowerCase().includes(n.toLowerCase()));
      if (hit !== undefined) errors.push(`story: "${hit}" belongs to another app in the family and cannot appear in a forged package.`);
    }
  }

  // Only worth asking once both are in range; a product check on a nonsense
  // number just repeats the complaint above in a more confusing form.
  if (sf !== undefined && psf !== undefined && errors.length === 0) {
    const product = sf * psf;
    if (product > MAX_ANNUAL_OPEX) {
      errors.push(
        `premises_sf × opex_psf_target: ${fmt(sf)} sf at $${psf.toFixed(2)} is $${fmt(Math.round(product))} of operating expense a year, over the $${fmt(MAX_ANNUAL_OPEX)} ceiling. Lower one of the two.`,
      );
    }
  }

  return errors;
}
