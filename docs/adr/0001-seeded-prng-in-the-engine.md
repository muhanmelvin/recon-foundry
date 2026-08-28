# 0001 — A seeded generator lives in the engine

**Status:** accepted · 2026-08-28

## Context

Every app in this family follows one rule about `src/engine/`: pure functions,
no DOM, no I/O, no clock, **no randomness**. The rule exists because the engine
computes money that ends up in a finding letter, and a figure you cannot
reproduce is a figure you cannot defend.

Recon Foundry's whole purpose is to invent things. It needs a different property
name, a different set of vendors, and a different set of invoices every time
someone presses Forge. Read literally, the family rule forbids the app.

## Decision

The engine carries a seeded pseudo-random generator (`src/engine/rng.ts`), and
the seed is part of the input.

`buildCleanModel(config)` is a pure function: the seed is a field of
`ScenarioConfig`, so the same configuration produces the same model, deep-equal,
every time. Nothing about *same input, same output* is given up — what changes
is that the input now contains a word that determines a hundred thousand
downstream choices.

Three things stay banned, and are enforced textually by
`tests/determinism-guards.test.ts`:

- **`Math.random` anywhere under `src/`.** It has no seed, so it breaks the
  property this ADR exists to preserve. There is no legitimate use of it here.
- **Reading the clock in `src/engine/`** — `Date.now()`, `new Date()` with no
  arguments, `performance.now()`. Dates the engine *computes* are fine;
  `new Date(2024, 0, 1)` is a pure function of its arguments. What is forbidden
  is asking the machine what today is, which would make the delivery date on a
  billing statement depend on when it was forged.
- **Drawing a stream positionally.** `rng.child(label)` derives an independent
  stream by hashing the path that names it, rather than by drawing from its
  parent. Every call site keys its stream by a stable identity — a year, a
  category name — never by a loop index. Without this, inserting a category in
  the middle of the catalog silently rewrites every figure after it and every
  golden fixture in the repo, with no error anywhere.

## Consequences

Golden tests can pin bytes, not just shapes: a scenario's model hash and, from
milestone M3, the SHA-256 of the workbook it renders. A moved hash is a real
finding about a change, not a test to update in passing.

A trainer can hand twenty people the identical package by handing them a seed.

The cost is that the generator is now load-bearing infrastructure. SplitMix64
over `BigInt` is about twenty lines and has no dependency, which is the trade
this family prefers; its statistical quality is far beyond what invented
invoices require, and the properties that actually matter here — reproducibility
and name-keyed splitting — are pinned by `tests/rng.test.ts`.
