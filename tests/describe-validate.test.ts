/**
 * The validator is the gate between an AI's output and a generator that is
 * otherwise entirely deterministic. Most of what it does is ordinary shape
 * checking; one thing it does is not.
 *
 * **The quote check is the security property.** Every filled field has to cite
 * words that really appear in the description, because the panel displays those
 * quotes beside the controls they filled and a visitor reads them to decide
 * whether to override. A quote nobody wrote makes that display a lie — so a
 * fabricated one is an error, not a warning, and the tests below spend most of
 * their time on it.
 */

import { describe, expect, it } from "vitest";
import { validateForgeDraft } from "../src/engine/describe/validate.ts";
import { RESERVED_NAMES } from "../src/engine/names.ts";
import { MAX_ANNUAL_OPEX, STORY_MAX_CHARS } from "../src/engine/model/bounds.ts";

const DESCRIPTION =
  "We lease 40,000 square feet in a suburban retail centre. Operating expenses run about $9.50 a foot across three years. " +
  "Last year the landlord repaved the whole parking lot and charged the entire cost to that single year, and the management fee " +
  "appears to be taken on the taxes as well as the services.";

function draft(body: Record<string, unknown>): string {
  return JSON.stringify({ kind: "forge_config_draft", ...body });
}

function errorsOf(text: string, description = DESCRIPTION): string[] {
  const v = validateForgeDraft(text, description);
  return v.ok ? [] : v.errors;
}

describe("what is not a draft at all", () => {
  it("says so plainly when the paste is not JSON", () => {
    const v = validateForgeDraft("Sure! Here's the JSON:\n```json\n{}\n```", DESCRIPTION);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("malformed");
    expect(v.errors.join(" ")).toContain("no markdown fences");
  });

  it("refuses valid JSON that is not an object", () => {
    const v = validateForgeDraft("[1, 2, 3]", DESCRIPTION);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("wrong-shape");
  });

  it("refuses a draft with the wrong kind", () => {
    const errors = errorsOf(JSON.stringify({ kind: "cap_clause_draft", fields: {} }));
    expect(errors.join(" ")).toContain("forge_config_draft");
  });

  it("refuses to check anything against an empty description", () => {
    const errors = errorsOf(draft({ fields: {} }), "   ");
    expect(errors.join(" ")).toContain("no description");
  });
});

describe("a filled field has to cite the description", () => {
  it("accepts a quote that is really in it", () => {
    const v = validateForgeDraft(draft({ fields: { premises_sf: { value: 40_000, quote: "40,000 square feet" } } }), DESCRIPTION);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.draft.premises_sf).toEqual({ value: 40_000, quote: "40,000 square feet" });
  });

  it("rejects a quote nobody wrote, and names the field", () => {
    const errors = errorsOf(draft({ fields: { premises_sf: { value: 250_000, quote: "250,000 square feet" } } }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("fields.premises_sf");
    expect(errors[0]).toContain("does not appear in the description");
  });

  it("rejects a value with no quote at all", () => {
    const errors = errorsOf(draft({ fields: { premises_sf: { value: 40_000 } } }));
    expect(errors.join(" ")).toContain("must quote the words");
  });

  it("does not care about whitespace, case, or a model's tidied punctuation", () => {
    const v = validateForgeDraft(
      draft({ fields: { property_kind: { value: "retail_strip", quote: "a  SUBURBAN\n  retail centre" } } }),
      DESCRIPTION,
    );
    expect(v.ok).toBe(true);
  });

  it("does not care that a model straightened a curly apostrophe", () => {
    const description = "The landlord’s parking lot was repaved last year.";
    const v = validateForgeDraft(draft({ fields: { story: { value: "A repaving charged to one year.", quote: "The landlord's parking lot" } } }), description);
    expect(v.ok).toBe(true);
  });

  it("holds schemes to the same rule", () => {
    const good = validateForgeDraft(
      draft({ schemes: [{ scheme: "unamortized_capital", quote: "charged the entire cost to that single year" }] }),
      DESCRIPTION,
    );
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.draft.schemes.map((s) => s.value)).toEqual(["unamortized_capital"]);

    const bad = errorsOf(draft({ schemes: [{ scheme: "kept_tax_refund", quote: "they kept our tax refund" }] }));
    expect(bad.join(" ")).toContain("does not appear in the description");
  });
});

describe("bounds", () => {
  it("refuses a square footage outside the range", () => {
    const errors = errorsOf(draft({ fields: { premises_sf: { value: 900, quote: "40,000 square feet" } } }));
    expect(errors.join(" ")).toContain("premises_sf");
    expect(errors.join(" ")).toContain("500,000");
  });

  it("refuses a per-foot figure outside the range", () => {
    expect(errorsOf(draft({ fields: { opex_psf_target: { value: 900, quote: "$9.50 a foot" } } })).join(" ")).toContain("opex_psf_target");
    expect(errorsOf(draft({ fields: { opex_psf_target: { value: 0.5, quote: "$9.50 a foot" } } })).join(" ")).toContain("opex_psf_target");
  });

  it("refuses fractions of a cent", () => {
    expect(errorsOf(draft({ fields: { opex_psf_target: { value: 9.505, quote: "$9.50 a foot" } } })).join(" ")).toContain("two decimal places");
  });

  it("allows the largest scenario the two bounds can describe between them", () => {
    // The $30M ceiling sits exactly on the corner of the other two bounds:
    // 500,000 sf at $60.00 is $30,000,000 to the dollar. So today nothing can
    // breach the ceiling without breaching a bound first, and the corner itself
    // is legal. The check earns its place by catching a later widening of
    // either bound rather than by firing now — see the note on MAX_ANNUAL_OPEX.
    const description = "We lease 500,000 square feet and expenses run $60.00 a foot.";
    const errors = errorsOf(
      draft({
        fields: {
          premises_sf: { value: 500_000, quote: "500,000 square feet" },
          opex_psf_target: { value: 60, quote: "$60.00 a foot" },
        },
      }),
      description,
    );
    expect(errors).toEqual([]);
    expect(500_000 * 60).toBe(MAX_ANNUAL_OPEX);
  });

  it("refuses a year outside the range and a year_count that is not 2 or 3", () => {
    expect(errorsOf(draft({ fields: { start_year: { value: 1998, quote: "three years" } } })).join(" ")).toContain("start_year");
    expect(errorsOf(draft({ fields: { year_count: { value: 7, quote: "three years" } } })).join(" ")).toContain("year_count");
  });

  it("refuses an enum value that is not one of ours", () => {
    expect(errorsOf(draft({ fields: { property_kind: { value: "shopping_mall", quote: "retail centre" } } })).join(" ")).toContain("retail_strip");
    expect(errorsOf(draft({ fields: { size_band: { value: "enormous", quote: "retail centre" } } })).join(" ")).toContain("small | medium | large");
  });
});

describe("the story", () => {
  it("refuses one longer than a caption", () => {
    const long = "A ".repeat(STORY_MAX_CHARS) + "centre.";
    expect(errorsOf(draft({ fields: { story: { value: long, quote: "retail centre" } } })).join(" ")).toContain("over the");
  });

  it("refuses a name that belongs to another app in the family", () => {
    for (const name of RESERVED_NAMES) {
      const errors = errorsOf(draft({ fields: { story: { value: `A tenant at ${name} Plaza.`, quote: "retail centre" } } }));
      expect(errors.join(" "), name).toContain(name);
    }
  });
});

describe("what is tolerated rather than refused", () => {
  it("keeps an unknown field as a warning", () => {
    const v = validateForgeDraft(draft({ fields: {}, confidence: "high", notes: [] }), DESCRIPTION);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warnings.length).toBe(0); // top-level extras are simply not read
  });

  it("warns rather than fails on an unrecognized field inside fields", () => {
    const v = validateForgeDraft(draft({ fields: { landlord_name: { value: "x", quote: "retail centre" } } }), DESCRIPTION);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warnings.join(" ")).toContain("landlord_name");
  });

  it("ignores a seed the model tried to set, and says why", () => {
    const v = validateForgeDraft(draft({ fields: { seed: { value: "acme-1", quote: "retail centre" } } }), DESCRIPTION);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.warnings.join(" ")).toContain("seed stays yours");
      expect(v.draft).not.toHaveProperty("seed");
    }
  });

  it("takes a duplicated scheme once", () => {
    const v = validateForgeDraft(
      draft({
        schemes: [
          { scheme: "unamortized_capital", quote: "repaved the whole parking lot" },
          { scheme: "unamortized_capital", quote: "charged the entire cost to that single year" },
        ],
      }),
      DESCRIPTION,
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.draft.schemes).toHaveLength(1);
  });

  it("returns schemes in canonical order whatever order they arrived in", () => {
    const v = validateForgeDraft(
      draft({
        schemes: [
          { scheme: "fee_base_expansion", quote: "management fee" },
          { scheme: "unamortized_capital", quote: "repaved the whole parking lot" },
        ],
      }),
      DESCRIPTION,
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.draft.schemes.map((s) => s.value)).toEqual(["unamortized_capital", "fee_base_expansion"]);
  });

  it("accepts a draft that filled nothing — an honest answer to a vague description", () => {
    const v = validateForgeDraft(draft({ fields: {}, schemes: [] }), DESCRIPTION);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.draft.schemes).toEqual([]);
      expect(v.draft.premises_sf).toBeUndefined();
    }
  });
});
