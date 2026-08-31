/**
 * Hand-rolled validator for the draft an AI hands back. No AJV in the bundle —
 * family precedent, and the same two failure registers lease-interpreter uses:
 * text that is not JSON, and JSON that is not a forge draft.
 *
 * One rule here has real teeth, and it is not a shape check. **A filled field
 * must quote the description, and the quote must actually be in it.** The panel
 * shows those quotes beside the controls they filled, which is what makes the
 * mapping reviewable; a quote nobody can find in the description makes that
 * display a lie, so it is an error rather than a warning. It costs nothing
 * against an honest model and everything against a hand-edited draft trying to
 * push a number through with a plausible-sounding justification stapled to it.
 *
 * Bounds are not re-litigated here. They live in `../model/bounds.ts`, which the
 * prompt and the forge boundary read too — one set of numbers, three readers.
 *
 * What this deliberately does NOT accept is a seed. The seed is the visitor's:
 * it is what makes a package shareable and re-forgeable, and letting a pasted
 * draft set it would take the one control that is unambiguously theirs.
 */

import { RESERVED_NAMES } from "../names.ts";
import { SCHEME_ORDER, type PropertyKind, type SchemeId, type SizeBand } from "../model/types.ts";
import {
  MAX_ANNUAL_OPEX,
  OPEX_PSF_MAX,
  OPEX_PSF_MIN,
  PREMISES_SF_MAX,
  PREMISES_SF_MIN,
  START_YEAR_MAX,
  START_YEAR_MIN,
  STORY_MAX_CHARS,
} from "../model/bounds.ts";

/** One value the AI filled in, and the words it read it out of. */
export interface Cited<T> {
  value: T;
  quote: string;
}

export interface ForgeDraft {
  property_kind?: Cited<PropertyKind>;
  size_band?: Cited<SizeBand>;
  start_year?: Cited<number>;
  year_count?: Cited<2 | 3>;
  premises_sf?: Cited<number>;
  opex_psf_target?: Cited<number>;
  story?: Cited<string>;
  schemes: Array<Cited<SchemeId>>;
}

export type DraftValidation =
  | { ok: true; draft: ForgeDraft; warnings: string[] }
  | { ok: false; kind: "malformed" | "wrong-shape"; errors: string[] };

const PROPERTY_KINDS: readonly string[] = ["retail_strip", "office", "industrial_flex"];
const SIZE_BANDS: readonly string[] = ["small", "medium", "large"];

/** Every field name the draft may carry, in the order the panel fills them. */
const FIELD_NAMES = ["property_kind", "size_band", "start_year", "year_count", "premises_sf", "opex_psf_target", "story"] as const;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Whitespace collapsed, case folded, curly quotes and dashes straightened.
 *
 * A model retyping a phrase out of a paragraph will not reproduce the line
 * breaks, and many will silently upgrade an apostrophe or a hyphen on the way.
 * None of that is evidence of fabrication, and treating it as such would fail
 * honest drafts constantly. What the check is actually for is a quote whose
 * *words* are not in the description.
 */
function normalizeForQuote(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface Ctx {
  haystack: string;
  errors: string[];
  warnings: string[];
}

/**
 * Pull `{ value, quote }` apart, check the quote, hand back the raw value for
 * the caller to check. Returns undefined when the field is unusable.
 */
function cite(name: string, raw: unknown, ctx: Ctx): { value: unknown; quote: string } | undefined {
  if (!isRecord(raw)) {
    ctx.errors.push(`fields.${name} must be an object { value, quote } — the draft has ${JSON.stringify(raw)}`);
    return undefined;
  }
  const quote = raw.quote;
  if (typeof quote !== "string" || quote.trim() === "") {
    ctx.errors.push(`fields.${name} has a value but no supporting quote — a filled field must quote the words it was read from`);
    return undefined;
  }
  if (!ctx.haystack.includes(normalizeForQuote(quote))) {
    ctx.errors.push(
      `fields.${name}: the quote ${JSON.stringify(quote)} does not appear in the description. Every filled field has to cite words that were actually written.`,
    );
    return undefined;
  }
  return { value: raw.value, quote };
}

function checkStory(value: unknown, ctx: Ctx): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    ctx.errors.push(`fields.story.value must be a non-empty sentence — the draft said ${JSON.stringify(value)}`);
    return undefined;
  }
  const story = value.trim();
  if (story.length > STORY_MAX_CHARS) {
    ctx.errors.push(`fields.story.value is ${story.length} characters, over the ${STORY_MAX_CHARS}-character limit.`);
    return undefined;
  }
  // The name bank owes the rest of the family these words. A story is the one
  // string in the package a human wrote, so it is the one place they could
  // arrive by a route the seeded draw cannot see.
  const hit = RESERVED_NAMES.find((n) => story.toLowerCase().includes(n.toLowerCase()));
  if (hit !== undefined) {
    ctx.errors.push(`fields.story.value uses "${hit}", which belongs to another app in the family. Every name in a forged package comes from this one's own bank.`);
    return undefined;
  }
  return story;
}

export function validateForgeDraft(text: string, description: string): DraftValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      kind: "malformed",
      errors: [
        `This isn't JSON yet: ${e instanceof Error ? e.message : String(e)}`,
        "Paste the model's JSON output only — no surrounding prose, no markdown fences.",
      ],
    };
  }

  if (!isRecord(parsed)) {
    return { ok: false, kind: "wrong-shape", errors: ["The draft must be a JSON object — this is valid JSON, but not a forge draft."] };
  }

  const ctx: Ctx = { haystack: normalizeForQuote(description), errors: [], warnings: [] };
  const draft: ForgeDraft = { schemes: [] };

  if (parsed.kind !== "forge_config_draft") {
    ctx.errors.push(`kind must be "forge_config_draft" — the prompt states the exact output shape; this draft says ${JSON.stringify(parsed.kind)}`);
  }

  if (description.trim() === "") {
    ctx.errors.push("There is no description to check the draft against — write one first, then run the prompt.");
  }

  const fields = parsed.fields;
  if (fields !== undefined && !isRecord(fields)) {
    ctx.errors.push("fields must be an object (an empty one is fine — it means nothing in the description settled anything)");
  } else if (isRecord(fields)) {
    for (const [name, raw] of Object.entries(fields)) {
      if (!(FIELD_NAMES as readonly string[]).includes(name)) {
        if (name === "seed") {
          ctx.warnings.push("fields.seed was ignored — the seed stays yours, so a package you like can be handed to someone else and forged again.");
        } else {
          ctx.warnings.push(`fields.${name} is not part of the draft shape — kept in the file, ignored by the panel`);
        }
        continue;
      }
      const cited = cite(name, raw, ctx);
      if (cited === undefined) continue;
      const { value, quote } = cited;

      switch (name) {
        case "property_kind":
          if (typeof value !== "string" || !PROPERTY_KINDS.includes(value)) {
            ctx.errors.push(`fields.property_kind.value must be one of ${PROPERTY_KINDS.join(" | ")} — the draft said ${JSON.stringify(value)}`);
          } else {
            draft.property_kind = { value: value as PropertyKind, quote };
          }
          break;

        case "size_band":
          if (typeof value !== "string" || !SIZE_BANDS.includes(value)) {
            ctx.errors.push(`fields.size_band.value must be one of ${SIZE_BANDS.join(" | ")} — the draft said ${JSON.stringify(value)}`);
          } else {
            draft.size_band = { value: value as SizeBand, quote };
          }
          break;

        case "start_year":
          if (!Number.isInteger(value) || (value as number) < START_YEAR_MIN || (value as number) > START_YEAR_MAX) {
            ctx.errors.push(`fields.start_year.value must be a whole year from ${START_YEAR_MIN} to ${START_YEAR_MAX} — the draft said ${JSON.stringify(value)}`);
          } else {
            draft.start_year = { value: value as number, quote };
          }
          break;

        case "year_count":
          if (value !== 2 && value !== 3) {
            ctx.errors.push(`fields.year_count.value must be 2 or 3 — the draft said ${JSON.stringify(value)}`);
          } else {
            draft.year_count = { value, quote };
          }
          break;

        case "premises_sf":
          if (!Number.isInteger(value) || (value as number) < PREMISES_SF_MIN || (value as number) > PREMISES_SF_MAX) {
            ctx.errors.push(
              `fields.premises_sf.value must be a whole number of square feet from ${PREMISES_SF_MIN.toLocaleString("en-US")} to ${PREMISES_SF_MAX.toLocaleString("en-US")} — the draft said ${JSON.stringify(value)}`,
            );
          } else {
            draft.premises_sf = { value: value as number, quote };
          }
          break;

        case "opex_psf_target":
          if (typeof value !== "number" || !Number.isFinite(value) || value < OPEX_PSF_MIN || value > OPEX_PSF_MAX) {
            ctx.errors.push(
              `fields.opex_psf_target.value must be a dollar figure from $${OPEX_PSF_MIN.toFixed(2)} to $${OPEX_PSF_MAX.toFixed(2)} per square foot — the draft said ${JSON.stringify(value)}`,
            );
          } else if (Math.round(value * 100) !== value * 100) {
            ctx.errors.push(`fields.opex_psf_target.value has more than two decimal places — the draft said ${JSON.stringify(value)}`);
          } else {
            draft.opex_psf_target = { value, quote };
          }
          break;

        case "story": {
          const story = checkStory(value, ctx);
          if (story !== undefined) draft.story = { value: story, quote };
          break;
        }
      }
    }
  }

  const schemes = parsed.schemes;
  if (schemes !== undefined && !Array.isArray(schemes)) {
    ctx.errors.push("schemes must be an array (an empty one is fine — it means the description narrated no grievance)");
  } else if (Array.isArray(schemes)) {
    const seen = new Set<string>();
    schemes.forEach((raw, i) => {
      if (!isRecord(raw)) {
        ctx.errors.push(`schemes[${i}] must be an object { scheme, quote } — the draft has ${JSON.stringify(raw)}`);
        return;
      }
      const cited = cite(`schemes[${i}]`, { value: raw.scheme, quote: raw.quote }, ctx);
      if (cited === undefined) return;
      const id = cited.value;
      if (typeof id !== "string" || !(SCHEME_ORDER as readonly string[]).includes(id)) {
        ctx.errors.push(`schemes[${i}].scheme must be one of ${SCHEME_ORDER.join(", ")} — the draft said ${JSON.stringify(id)}`);
        return;
      }
      if (seen.has(id)) {
        ctx.warnings.push(`schemes lists ${id} more than once — the panel checks it once`);
        return;
      }
      seen.add(id);
      draft.schemes.push({ value: id as SchemeId, quote: cited.quote });
    });
    // Canonical order, so the checkboxes fill the same way whatever order the
    // model listed them in.
    draft.schemes.sort((a, b) => SCHEME_ORDER.indexOf(a.value) - SCHEME_ORDER.indexOf(b.value));
  }

  // The product ceiling is only meaningful once both knobs survived their own
  // bounds; asking earlier just restates a complaint already on the list.
  if (draft.premises_sf && draft.opex_psf_target) {
    const product = draft.premises_sf.value * draft.opex_psf_target.value;
    if (product > MAX_ANNUAL_OPEX) {
      ctx.errors.push(
        `premises_sf × opex_psf_target: ${draft.premises_sf.value.toLocaleString("en-US")} sf at $${draft.opex_psf_target.value.toFixed(2)} is $${Math.round(product).toLocaleString("en-US")} of operating expense a year, over the $${MAX_ANNUAL_OPEX.toLocaleString("en-US")} ceiling.`,
      );
    }
  }

  if (ctx.errors.length > 0) return { ok: false, kind: "wrong-shape", errors: ctx.errors };
  return { ok: true, draft, warnings: ctx.warnings };
}

/** The knobs the draft left alone, named the way the panel says them. */
export const FIELD_LABELS: Record<(typeof FIELD_NAMES)[number], string> = {
  property_kind: "Property",
  size_band: "Size",
  start_year: "First year",
  year_count: "Years",
  premises_sf: "Your square footage",
  opex_psf_target: "Operating expenses per sf",
  story: "Story",
};

export const DRAFT_FIELD_NAMES = FIELD_NAMES;
