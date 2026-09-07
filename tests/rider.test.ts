/**
 * The Rider — the clauses a visitor may add to the lease.
 *
 * Three things have to be true of it, and each is a different kind of promise.
 *
 * *A lease with no Rider is the lease that was always forged.* The clauses are
 * opt-in, and opt-in here is a claim about bytes: the three configs pinned in
 * `tests/fixtures/regression.json` must still produce those exact ZIPs, whether
 * they omit `clauses` or set it to an empty list.
 *
 * *A clause restates the package; it never contradicts it.* This is the trap
 * the whole feature is built around. A clause that promised something the forge
 * does not honour — a roof replacement at the landlord's sole cost, a refund
 * credited to a year the collector's account does not credit it to — would hand
 * a trainee a finding nobody planted, and the answer key would be wrong about
 * its own package. So the restatement checks below are not style tests.
 *
 * *It reads as a lease anyone could have signed.* The wording keys on the kind
 * of property and on nothing else. A guaranty, an exclusive use, a tenant's
 * code of conduct would all make it somebody's lease in particular.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { forge } from "../src/engine/forge.ts";
import { buildCleanModel } from "../src/engine/model/clean.ts";
import { validateScenarioConfig } from "../src/engine/model/bounds.ts";
import { buildPackageZip } from "../src/engine/package/packager.ts";
import { buildLeaseDoc, sectionsOf } from "../src/engine/render/lease/doc.ts";
import { buildRider, CLAUSE_IDS, RIDER_SECTIONS, type ClauseId } from "../src/engine/render/lease/rider.ts";
import { renderLease } from "../src/engine/render/documents.ts";
import { ARTICLES } from "../src/engine/render/lease/sections.ts";
import type { PropertyKind, ScenarioConfig, ScenarioModel } from "../src/engine/model/types.ts";

const KINDS: PropertyKind[] = ["retail_strip", "office", "industrial_flex"];

function modelWith(clauses: ClauseId[], kind: PropertyKind = "retail_strip"): ScenarioModel {
  return buildCleanModel({
    seed: "rider-1",
    start_year: 2023,
    year_count: 3,
    property_kind: kind,
    size_band: "medium",
    schemes: [],
    clauses,
  });
}

const ALL = [...CLAUSE_IDS];

// ---------------------------------------------------------------------------

describe("the catalog", () => {
  it("is six sections of two clauses, numbered R1.1 onward", () => {
    expect(RIDER_SECTIONS).toHaveLength(6);
    expect(RIDER_SECTIONS.map((s) => s.numeral)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
    for (const [si, section] of RIDER_SECTIONS.entries()) {
      expect(section.clauses).toHaveLength(2);
      expect(section.clauses.map((c) => c.ref)).toEqual([`R${si + 1}.1`, `R${si + 1}.2`]);
    }
  });

  it("names twelve distinct clauses, and CLAUSE_IDS is that list in catalog order", () => {
    expect(ALL).toHaveLength(12);
    expect(new Set(ALL).size).toBe(12);
    expect(ALL).toEqual(RIDER_SECTIONS.flatMap((s) => s.clauses.map((c) => c.id)));
  });
});

describe("a lease with no Rider is the lease that was always forged", () => {
  const captured: Array<{ name: string; config: ScenarioConfig; zip_sha256: string; zip_bytes: number }> = JSON.parse(
    readFileSync(join(resolve(__dirname, "fixtures"), "regression.json"), "utf8"),
  ).configs;
  const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

  it.each(captured.map((c) => [c.name, c] as const))("%s forges its pinned bytes when it says nothing about clauses", (_name, c) => {
    expect("clauses" in c.config, "the fixture would not be testing an absent key").toBe(false);
    const { model, answerKey } = forge(c.config);
    expect(buildLeaseDoc(model).rider).toEqual([]);
    const zip = buildPackageZip(model, answerKey);
    expect(zip.bytes.length).toEqual(c.zip_bytes);
    expect(sha256(zip.bytes)).toEqual(c.zip_sha256);
  });

  /**
   * An empty list is not quite the same object as an absent key, and the
   * difference is deliberate: the answer key records the configuration it was
   * forged from, verbatim, so `clauses: []` shows up there as an empty list and
   * the ZIP is nineteen bytes longer. Every *document* is identical — which is
   * the promise that matters — and the rail on the page deletes the key rather
   * than writing an empty list, the same discipline `premises_sf` follows.
   */
  it.each(captured.map((c) => [c.name, c] as const))("%s forges the same documents from an empty list", (_name, c) => {
    const absent = forge(c.config);
    const empty = forge({ ...c.config, clauses: [] as ClauseId[] });
    expect(buildLeaseDoc(empty.model).rider).toEqual([]);
    expect(renderLease(empty.model).bytes).toEqual(renderLease(absent.model).bytes);
  });

  it("says nothing about a Rider in §7.02, and everything once there is one", () => {
    const silent = sectionsOf(buildLeaseDoc(modelWith([]))).find((s) => s.ref === "7.02")!;
    expect(silent.paragraphs.join(" ")).not.toContain("Rider");
    const loud = sectionsOf(buildLeaseDoc(modelWith(["parking"]))).find((s) => s.ref === "7.02")!;
    expect(loud.paragraphs.join(" ")).toContain("Rider");
  });
});

describe("the Rider never moves a citation", () => {
  it("leaves Articles I–VII exactly where they were", () => {
    const doc = buildLeaseDoc(modelWith(ALL));
    expect(doc.articles.map((a) => a.numeral)).toEqual(ARTICLES.map((a) => a.numeral));
    expect(doc.articles.flatMap((a) => a.sections.map((s) => s.ref))).toEqual(ARTICLES.flatMap((a) => a.sections.map((s) => s.ref)));
  });

  it("appends its clauses after them, so §R3.1 is findable by ref", () => {
    const refs = sectionsOf(buildLeaseDoc(modelWith(["utilities_metered", "taxes_share"]))).map((s) => s.ref);
    expect(refs.slice(0, 17)).toEqual(ARTICLES.flatMap((a) => a.sections.map((s) => s.ref)));
    expect(refs.slice(17)).toEqual(["R3.1", "R4.1"]);
  });
});

describe("the Rider prints in catalog order, whatever order it was ticked in", () => {
  it("puts R1.1 before R6.2 however they arrived", () => {
    const forwards = buildRider(modelWith(["repairs_landlord", "parking", "taxes_excluded"]));
    const backwards = buildRider(modelWith(["taxes_excluded", "parking", "repairs_landlord"]));
    expect(backwards).toEqual(forwards);
    expect(forwards.flatMap((a) => a.sections.map((s) => s.ref))).toEqual(["R1.1", "R4.2", "R6.2"]);
  });

  it("forges the same bytes twice from the same clauses", () => {
    const a = renderLease(modelWith(ALL)).bytes as string;
    const b = renderLease(modelWith(ALL)).bytes as string;
    expect(b).toEqual(a);
  });
});

describe("every clause is written, for every kind of property", () => {
  it.each(KINDS)("%s writes all twelve", (kind) => {
    const rider = buildRider(modelWith(ALL, kind));
    const sections = rider.flatMap((a) => a.sections);
    expect(sections).toHaveLength(12);
    for (const s of sections) {
      expect(s.paragraphs.length, `${s.ref} is empty`).toBeGreaterThan(0);
      for (const p of s.paragraphs) expect(p.length, `${s.ref}: ${p}`).toBeGreaterThan(60);
    }
  });

  // Four clauses describe the physical property, and a truck court is not a
  // lobby. The other eight are the same words whatever the building is.
  const KEYED: ClauseId[] = ["repairs_landlord", "utilities_common", "common_areas", "parking"];

  it.each(KEYED)("%s says something different about each kind of property", (id) => {
    const written = KINDS.map((kind) => buildRider(modelWith([id], kind))[0]!.sections[0]!.paragraphs.join(" "));
    expect(new Set(written).size, `${id} reads the same for two different properties`).toBe(3);
  });

  it.each(KINDS)("%s names its own common areas and its own parking", (kind) => {
    const html = renderLease(modelWith(ALL, kind)).bytes as string;
    const expected: Record<PropertyKind, string[]> = {
      retail_strip: ["the parking field", "lot lighting", "the drive aisles serving it"],
      office: ["the lobbies", "house electricity", "the parking structure"],
      industrial_flex: ["the truck court", "yard lighting", "the trailer positions in the yard"],
    };
    for (const phrase of expected[kind]) expect(html, phrase).toContain(phrase);
  });
});

describe("a clause restates the package and never contradicts it", () => {
  const text = (id: ClauseId, kind: PropertyKind = "retail_strip") =>
    buildRider(modelWith([id], kind))[0]!.sections[0]!.paragraphs.join(" ");

  it("leaves a capital replacement recoverable under §6.04, where the forge amortizes one", () => {
    const t = text("repairs_landlord");
    expect(t).toContain("Section 6.04");
    expect(t).not.toContain("sole cost");
  });

  it("keeps the classes §6.01 fixed", () => {
    for (const id of ["utilities_common", "taxes_share", "insurance_landlord"] as ClauseId[]) {
      expect(text(id), id).toContain("Non-Controllable");
    }
  });

  it("credits a tax refund where the collector's account credits it", () => {
    const t = text("taxes_share");
    expect(t).toContain("refund");
    // The account statement nets a credit in the year the county granted it,
    // whatever year was appealed. A clause saying otherwise would make the tax
    // line look wrong in every clean package.
    expect(t).toContain("in which Landlord receives it");
  });

  it("keeps a directly metered utility out of the pool", () => {
    expect(text("utilities_metered")).toContain("excluded from Operating Expenses");
  });

  it("invents no figure the package cannot support", () => {
    for (const kind of KINDS) {
      for (const id of ALL) {
        expect(text(id, kind), `${id} (${kind})`).not.toContain("$");
        expect(text(id, kind), `${id} (${kind})`).not.toMatch(/\d+(?:,\d{3})*(?:\.\d\d)? (?:dollars|per square foot)/);
      }
    }
  });
});

describe("the Rider is nobody's lease in particular", () => {
  const FORBIDDEN = ["guarant", "locker", "generator", "code of conduct", "rooftop", "exclusive use"];

  it.each(KINDS)("%s says nothing that only one kind of tenant would sign", (kind) => {
    const all = buildRider(modelWith(ALL, kind))
      .flatMap((a) => a.sections.flatMap((s) => s.paragraphs))
      .join(" ")
      .toLowerCase();
    for (const word of FORBIDDEN) expect(all, word).not.toContain(word);
  });
});

describe("the engine is the gate", () => {
  const config = (clauses: unknown): ScenarioConfig =>
    ({ seed: "gate-1", start_year: 2023, year_count: 3, property_kind: "retail_strip", size_band: "medium", schemes: [], clauses }) as ScenarioConfig;

  it("accepts the twelve, in any order, and an empty list", () => {
    expect(validateScenarioConfig(config([]))).toEqual([]);
    expect(validateScenarioConfig(config([...ALL].reverse()))).toEqual([]);
  });

  it("refuses a clause that does not exist", () => {
    const errors = validateScenarioConfig(config(["not_a_clause"]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("not_a_clause");
    expect(errors[0], "the message says what would have been acceptable").toContain("repairs_landlord");
  });

  it("refuses the same clause twice", () => {
    const errors = validateScenarioConfig(config(["parking", "parking"]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("parking");
  });

  it("refuses something that is not a list at all", () => {
    expect(validateScenarioConfig(config("parking"))).toHaveLength(1);
  });
});

describe("the package says what it carries", () => {
  it("counts the Rider's clauses in the about note only when there are some", () => {
    const clean = forge({ ...modelWith([]).config });
    const withRider = forge({ ...modelWith(["parking", "alterations"]).config });
    const about = (m: ScenarioModel, k: Parameters<typeof buildPackageZip>[1]) =>
      new TextDecoder().decode(buildPackageZip(m, k).bytes).includes("2 additional clause(s)");
    expect(about(clean.model, clean.answerKey)).toBe(false);
    expect(about(withRider.model, withRider.answerKey)).toBe(true);
  });
});
