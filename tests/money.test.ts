/**
 * Money is integer cents everywhere in the engine. These tests pin the
 * boundary conversions and the rounding rule, because a half-cent drift shows
 * up as a wrong dollar figure in a finding letter.
 */

import { describe, expect, it } from "vitest";
import { deltaStr, mulRate, pct, pctStr, sumCents, toCents, toDollars, usd } from "../src/engine/money.ts";

describe("toCents", () => {
  it("converts dollars to integer cents", () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents(0)).toBe(0);
  });

  it("survives the float representations that bite naive conversions", () => {
    expect(toCents(0.07)).toBe(7);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(86_517.36)).toBe(8_651_736);
  });

  it("rounds half away from zero, symmetrically", () => {
    expect(toCents(-1234.56)).toBe(-123456);
    expect(toCents(-0.005)).toBe(-1);
  });

  it("refuses a non-finite input rather than producing NaN cents", () => {
    expect(() => toCents(Number.NaN)).toThrow();
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("toDollars", () => {
  it("round-trips", () => {
    for (const d of [0, 0.07, 1234.56, 86_517.36, -42.5]) {
      expect(toDollars(toCents(d))).toBe(d);
    }
  });
});

describe("mulRate and pct", () => {
  it("applies a rate in cents", () => {
    expect(mulRate(100_000, 0.03)).toBe(3000);
    expect(pct(100_000, 3)).toBe(3000);
  });

  it("keeps the sign", () => {
    expect(pct(-100_000, 5)).toBe(-5000);
  });

  it("rounds to the cent", () => {
    expect(pct(8_651_736, 5)).toBe(432_587);
  });
});

describe("usd", () => {
  it("formats with separators and two decimals", () => {
    expect(usd(123456)).toBe("$1,234.56");
    expect(usd(7)).toBe("$0.07");
    expect(usd(0)).toBe("$0.00");
  });

  it("puts the sign outside the symbol", () => {
    expect(usd(-123456)).toBe("-$1,234.56");
  });
});

describe("pctStr and deltaStr", () => {
  it("formats fractions as percentages", () => {
    expect(pctStr(0.0714285)).toBe("7.14%");
    expect(pctStr(0.05, 0)).toBe("5%");
  });

  it("signs a change", () => {
    expect(deltaStr(0.18)).toBe("+18.0%");
    expect(deltaStr(-0.045)).toBe("-4.5%");
  });
});

describe("sumCents", () => {
  it("sums exactly — the reason the engine holds cents at all", () => {
    const cents = [0.1, 0.2, 0.3, 0.4].map(toCents);
    expect(sumCents(cents)).toBe(100);
    expect(toDollars(sumCents(cents))).toBe(1);
  });

  it("is zero for nothing", () => {
    expect(sumCents([])).toBe(0);
  });
});
