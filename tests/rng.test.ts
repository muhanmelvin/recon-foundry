/**
 * The generator's contract, which everything else in the app rests on.
 *
 * The property that matters most is the third one: streams split by *name*, so
 * a stream's numbers depend on the path that names it and on nothing else. That
 * is what lets a later milestone add a whole new document type, or insert a
 * category into the middle of the catalog, without silently rewriting every
 * golden fixture in the repo.
 */

import { describe, expect, it } from "vitest";
import { avoidRoundAmount, hashSeed, rootRng } from "../src/engine/rng.ts";
import { isRoundPoolAmount } from "../src/engine/scanner-rules.ts";

describe("the same seed is the same numbers", () => {
  it("reproduces a sequence exactly", () => {
    const a = rootRng("ashford").child("gl").child("2024");
    const b = rootRng("ashford").child("gl").child("2024");
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("gives different seeds different sequences", () => {
    const a = Array.from({ length: 8 }, () => rootRng("ashford").child("x").next());
    const b = Array.from({ length: 8 }, () => rootRng("bellamy").child("x").next());
    expect(a).not.toEqual(b);
  });

  it("hashes an empty seed to something usable rather than to zero", () => {
    expect(hashSeed("")).not.toBe(0n);
  });
});

describe("streams split by name, not by order", () => {
  it("does not disturb a sibling when another is drawn from first", () => {
    const parent = rootRng("seed");
    const first = parent.child("insurance").next();
    // Draw a great deal from an unrelated sibling, then ask again.
    const other = parent.child("landscaping");
    for (let i = 0; i < 500; i++) other.next();
    expect(parent.child("insurance").next()).toBe(first);
  });

  it("gives a differently-named child a different stream", () => {
    const parent = rootRng("seed");
    expect(parent.child("a").next()).not.toBe(parent.child("b").next());
  });

  it("makes the path, not the nesting, the identity", () => {
    const viaTwo = rootRng("s").child("gl").child("2024").next();
    const viaOne = rootRng("s").child("gl/2024").next();
    expect(viaOne).toBe(viaTwo);
  });
});

describe("draws stay inside their bounds", () => {
  const rng = rootRng("bounds");

  it("keeps next() in [0, 1)", () => {
    for (let i = 0; i < 2000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("includes both ends of an integer range", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(rootRng("i" + i).int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("refuses an empty range rather than returning nonsense", () => {
    expect(() => rng.int(5, 4)).toThrow();
    expect(() => rng.pick([])).toThrow();
  });
});

describe("invoices do not look manufactured", () => {
  it("never bills a whole dollar", () => {
    for (let i = 0; i < 3000; i++) {
      const v = rootRng("inv" + i).invoiceCents(200, 9000);
      expect(v % 100).not.toBe(0);
    }
  });

  it("stays inside the dollar range asked for", () => {
    for (let i = 0; i < 500; i++) {
      const v = rootRng("r" + i).invoiceCents(1200, 1400);
      expect(v).toBeGreaterThanOrEqual(1200_00);
      expect(v).toBeLessThan(1401_00);
    }
  });
});

describe("the scanner's round-number rule, as this app must obey it", () => {
  it("calls a $1,000 multiple round from $5,000 up", () => {
    expect(isRoundPoolAmount(500_000)).toBe(true);
    expect(isRoundPoolAmount(1_800_000)).toBe(true);
    expect(isRoundPoolAmount(400_000)).toBe(false); // below the minimum tested
  });

  it("calls a $500 multiple round only above $20,000", () => {
    expect(isRoundPoolAmount(2_050_000)).toBe(true);
    expect(isRoundPoolAmount(1_050_000)).toBe(false);
  });

  it("leaves an ordinary figure alone", () => {
    expect(isRoundPoolAmount(1_836_741)).toBe(false);
  });

  it("nudges a round figure off it, and leaves the rest untouched", () => {
    const rng = rootRng("nudge");
    expect(isRoundPoolAmount(avoidRoundAmount(1_800_000, rng))).toBe(false);
    expect(avoidRoundAmount(1_836_741, rng)).toBe(1_836_741);
  });
});
