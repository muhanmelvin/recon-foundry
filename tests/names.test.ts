/**
 * Two rules about what a forged package may be called.
 *
 * The Maplewood trio belongs to the Red-Flag Scanner. Recon Foundry reproduces
 * it exactly, as fixed demo scenarios, so that the two apps visibly agree about
 * the same property — which only works if nothing *else* the foundry forges can
 * accidentally be called Maplewood too.
 *
 * And every forged address stands in the State of Franklin, at a ZIP the Postal
 * Service has never issued. A document that is otherwise indistinguishable from
 * a real one needs somewhere unmistakable to say that it is not, and geography
 * says it without ruining the exercise the way a watermark across the page
 * would.
 */

import { describe, expect, it } from "vitest";
import { allBankWords, FRANKLIN, RESERVED_NAMES } from "../src/engine/names.ts";
import { buildCleanModel } from "../src/engine/model/clean.ts";
import { sweep } from "./helpers/sweep.ts";

const MODELS = sweep().map((c) => [c.seed, buildCleanModel(c)] as const);

describe("names another app has already spoken for", () => {
  it("are absent from the bank", () => {
    const words = allBankWords().join(" ").toLowerCase();
    const found = RESERVED_NAMES.filter((n) => words.includes(n.toLowerCase()));
    expect(found).toEqual([]);
  });

  it.each(MODELS)("%s calls nothing by a reserved name", (_seed, model) => {
    const text = [
      model.universe.property_name,
      model.universe.landlord_entity,
      model.universe.management_agent,
      model.universe.tenant_name,
      model.universe.county,
      model.universe.address.line1,
      model.universe.address.city,
      model.universe.insurance_carrier,
      ...Object.values(model.universe.vendors),
    ]
      .join(" ")
      .toLowerCase();
    expect(RESERVED_NAMES.filter((n) => text.includes(n.toLowerCase()))).toEqual([]);
  });
});

describe("the geography cannot be real", () => {
  it.each(MODELS)("%s stands in the State of Franklin", (_seed, model) => {
    const a = model.universe.address;
    expect(a.state).toBe(FRANKLIN.name);
    expect(a.state_abbr).toBe(FRANKLIN.abbr);
    expect(a.zip).toMatch(/^000\d\d$/);
  });
});

describe("the codes look like the codes on a real package", () => {
  it.each(MODELS)("%s has a site code, a property code and a ledger account", (_seed, model) => {
    expect(model.universe.site_code).toMatch(/^[A-Z]{2,3}\d$/);
    expect(model.universe.property_code).toMatch(/^br\d{5}$/);
    expect(model.universe.tenant_ledger_account).toMatch(/^t00\d{5}$/);
  });

  it("gives different properties different site codes often enough to be useful", () => {
    const codes = new Set(MODELS.map(([, m]) => m.universe.site_code));
    expect(codes.size).toBeGreaterThan(MODELS.length / 2);
  });
});
