/**
 * The only source of variation in this app, and it is not random.
 *
 * A scenario is a pure function of its configuration, and the seed is part of
 * that configuration: forge twice from the same seed and you get the same
 * property, the same invoices, the same bytes. That is what lets a trainer hand
 * twenty people the identical package, and what lets a golden test pin one.
 *
 * Two properties matter more than statistical quality, and both are deliberate:
 *
 * 1. **Streams split by name, not by order.** `child("gl")` derives a fresh
 *    independent stream by hashing the path that leads to it — it does not draw
 *    from its parent. So adding a new document type, or a new expense category,
 *    or reordering a loop, cannot reshuffle numbers that were already settled
 *    somewhere else. Always key a stream by a stable identity
 *    (`child("gl").child("2024").child("Landscaping & grounds")`), never by a
 *    loop index.
 *
 * 2. **Amounts avoid looking manufactured.** `invoiceCents` never returns a
 *    whole-dollar figure, because a page of invoices ending in .00 is the first
 *    thing that gives synthetic data away — and, less obviously, a round total
 *    is exactly what the Red-Flag Scanner's round-number test fires on. See
 *    `isRoundPoolAmount`.
 *
 * See docs/adr/0001-seeded-prng-in-the-engine.md for why randomness lives in an
 * engine that is otherwise forbidden to have any.
 */

import { isRoundPoolAmount } from "./scanner-rules.ts";

const MASK64 = (1n << 64n) - 1n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const GOLDEN = 0x9e3779b97f4a7c15n;

/** FNV-1a over the UTF-16 code units of `s`, two bytes at a time. */
export function hashSeed(s: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = ((h ^ BigInt(c & 0xff)) * FNV_PRIME) & MASK64;
    h = ((h ^ BigInt((c >> 8) & 0xff)) * FNV_PRIME) & MASK64;
  }
  // A zero state would make SplitMix64 start from its own fixed point.
  return h === 0n ? GOLDEN : h;
}

function splitmix64(state: bigint): { value: bigint; state: bigint } {
  const next = (state + GOLDEN) & MASK64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  z = z ^ (z >> 31n);
  return { value: z, state: next };
}

export interface Rng {
  /** The path that identifies this stream, for debugging and for error messages. */
  readonly path: string;
  /** An independent stream named under this one. Same name, same numbers, always. */
  child(label: string): Rng;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Uniform in [min, max). */
  float(min: number, max: number): number;
  /** One of `xs`. Throws on an empty array rather than returning undefined. */
  pick<T>(xs: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** A plausible vendor invoice, in cents. Never a whole dollar. */
  invoiceCents(minDollars: number, maxDollars: number): number;
}

class Stream implements Rng {
  private state: bigint;

  constructor(readonly path: string) {
    this.state = hashSeed(path);
  }

  child(label: string): Rng {
    return new Stream(this.path + "/" + label);
  }

  private draw(): bigint {
    const { value, state } = splitmix64(this.state);
    this.state = state;
    return value;
  }

  next(): number {
    // Top 53 bits — the most significant ones, which SplitMix64 mixes best.
    return Number(this.draw() >> 11n) / 9007199254740992; // 2^53
  }

  int(min: number, max: number): number {
    if (max < min) throw new Error(`rng.int: empty range [${min}, ${max}] at ${this.path}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error(`rng.pick: empty array at ${this.path}`);
    return xs[this.int(0, xs.length - 1)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  invoiceCents(minDollars: number, maxDollars: number): number {
    const dollars = this.int(Math.ceil(minDollars), Math.floor(maxDollars));
    return dollars * 100 + this.int(1, 99);
  }
}

/** The root stream for a seed. Everything else hangs off `child()`. */
export function rootRng(seed: string): Rng {
  return new Stream("seed:" + seed);
}

/**
 * Nudge a target amount off a round figure. Used wherever the model computes an
 * amount rather than summing invoices — a growth target, an allocation — so
 * that arithmetic never lands the model somewhere its own invoices could not.
 */
export function avoidRoundAmount(cents: number, rng: Rng): number {
  if (!isRoundPoolAmount(cents)) return cents;
  return cents + rng.int(-97, -3);
}
