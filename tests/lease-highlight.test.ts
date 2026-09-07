/**
 * The mark on the clause just added.
 *
 * One promise carries this feature: the mark is a preview and never a package.
 * A visitor who ticks a clause, downloads the lease and opens it must get the
 * lease as forged — no wash, no injected rule — because the bytes on screen are
 * meant to be the bytes in the ZIP, and a highlight in a forged document would
 * be a figure the model never produced.
 */

import { describe, expect, it } from "vitest";

import { buildCleanModel } from "../src/engine/model/clean.ts";
import { renderLease } from "../src/engine/render/documents.ts";
import { litLease } from "../src/engine/render/lease/highlight.ts";
import { RIDER_SECTIONS, type ClauseId } from "../src/engine/render/lease/rider.ts";
import type { ScenarioConfig } from "../src/engine/model/types.ts";

function leaseHtml(clauses: ClauseId[]): string {
  const config: ScenarioConfig = {
    seed: "highlight-1",
    start_year: 2023,
    year_count: 3,
    property_kind: "retail_strip",
    size_band: "medium",
    schemes: [],
    ...(clauses.length > 0 ? { clauses } : {}),
  };
  return renderLease(buildCleanModel(config)).bytes as string;
}

const refOf = (id: ClauseId): string => RIDER_SECTIONS.flatMap((s) => s.clauses).find((c) => c.id === id)!.ref;

describe("the clause just added is lit in the preview", () => {
  const html = leaseHtml(["parking", "repairs_landlord"]);

  it("asks for nothing when no clause is the latest", () => {
    expect(litLease(html, null)).toBe(html);
  });

  it("marks the clause and its line in the contents", () => {
    const ref = refOf("parking");
    const lit = litLease(html, ref);
    const id = `sec-${ref.replace(/\./g, "-")}`;
    expect(lit).toContain(`<style>#${id}{`);
    expect(lit).toContain(`.toc a[href="#${id}"]`);
    // Before the stylesheet closes, or the rule is not in the file's head.
    expect(lit.indexOf("<style>#")).toBeLessThan(lit.indexOf("</head>"));
  });

  it("changes nothing else about the lease", () => {
    const lit = litLease(html, refOf("parking"));
    expect(lit.replace(/<style>#sec[^<]*<\/style>\n/, "")).toBe(html);
  });

  it("leaves the lease alone when the clause is not in it", () => {
    // The state between unticking the lit clause and the rail clearing it.
    expect(litLease(html, refOf("tenant_repairs"))).toBe(html);
    const noRider = leaseHtml([]);
    expect(litLease(noRider, refOf("parking"))).toBe(noRider);
  });
});

describe("the forged lease never carries the mark", () => {
  it.each(RIDER_SECTIONS.flatMap((s) => s.clauses).map((c) => [c.id, c.ref] as const))(
    "%s is rendered without a highlight",
    (id, ref) => {
      const html = leaseHtml([id]);
      expect(html).toContain(`id="sec-${ref.replace(/\./g, "-")}"`);
      expect(html).not.toContain("<style>#sec-");
      expect(html).not.toContain("#fdf1c4");
    },
  );
});
