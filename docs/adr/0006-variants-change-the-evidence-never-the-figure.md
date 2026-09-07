# 0006 — Variants change the evidence, never the figure

**Status:** accepted · 2026-09-07

## Context

Recon Foundry has issued one shape of tax backup since it was written: a bill
per parcel for the calendar year, two instalments, April and October, and a
collector's account statement behind them. It is a good bill. It is also the
only one a trainee ever sees, and it is not what most of the paper in front of a
working auditor looks like.

Counties do not bill alike. One runs a July-to-June tax year, so every calendar
year is served by the tail of one bill and the head of the next and somebody has
to decide what the year bears. One collects in quarters and estimates the first
two off last year's levy, because the assessment for this year is not settled
when they fall due; the actual bill arrives later with a true-up line. One
reopens the roll after improvements are finished and issues a supplemental,
which arrives beside the original and is easy to double-count. An auditor who
has only met the first shape reads the second as an error, and reads the third
as a landlord charging twice.

The same is true of insurance: a broker's invoice with a down payment and
instalments, coverages itemised line by line, a loss deductible charged through
as its own row.

So the forge should be able to issue the paper in more than one shape. The
question is what a checkbox that does that is allowed to touch.

## Decision

**A Variant is a selectable form a backup document takes. It changes how a
figure is evidenced, and never the figure.**

- `ScenarioConfig.variants` names the forms asked for, under the same rule as
  `clauses`: **absent forges the bytes it always forged**, and an empty list
  forges the same documents while the answer key records the configuration as
  passed. The rail deletes the key rather than writing an empty list.
- **The property bears the same tax in the same calendar year with every box
  ticked as with none** — the same Taxes line, the same pool, the same tenant
  total, the same answer key. `tests/variants.test.ts` pins every combination
  against the package forged without variants, and a sweep of 450 scenarios
  holds all seven ties under all of them.
- **A carve-out, never an addition.** A supplemental bill's assessed increase is
  taken out of the base assessment it corrected, so the parcel's tax for the
  year is unchanged. A supplemental that *added* tax would be an overcharge, and
  an overcharge is a scheme.
- **The model carries the bills; the renderers stay pure functions of it.** A
  parcel's `years` are its bills, and a bill is not a year — under a fiscal year
  one bill's instalments fall in two calendar years. `src/engine/model/tax.ts` is
  the one place the question "what did the property bear in this calendar year"
  is answered, and the pool, the general ledger, tie T4, the collector's account
  and the ReconPackage JSON all ask it there.
- **The engine is the gate.** `validateScenarioConfig` refuses an unknown or
  repeated variant id, because a pasted configuration never sees the rail.
- Variants stay out of the Describe prompt and its draft validator. A visitor
  chooses a form of paper on the tab where that paper is; ADR 0004 keeps the
  prompt to the parameters it already names.

## Why

**Because the alternative is a knob that quietly changes what the tenant owes.**
This is the whole risk and the reason it is worth an ADR. Proration is the
obvious way to serve a calendar year out of fiscal bills — six twelfths of one
plus six twelfths of the next — and it is also the way to move money by a few
cents on every parcel in every year. Those cents would land in the Taxes line,
which lands in the tenant's total, which the answer key prices. A trainee would
find a difference the answer key does not explain, and the app would have taught
them to distrust the one thing it exists to prove.

So the instalments are the proration: what the property bore in a calendar year
is what came due in it, which is what the collector's account has always said
and what the general ledger has always booked. The chain that sizes the bills is
solved so those instalments add to the figure exactly, and each bill still
reproduces from its own assessed value at the county's own rate — both ties, to
the cent, in every combination.

**Because a form of paper is not a fact about the property.** The rail sits on
the document's own tab rather than in the forge panel for the same reason the
clause rail sits beside the lease: what is being chosen is how to read, not what
is true.

## Alternatives considered

**Prorate in the renderer and leave the model alone.** Rejected. The paper would
show six twelfths of a bill while the general ledger booked instalments and the
ReconPackage JSON carried a third figure. Three documents disagreeing is exactly
the thing this app is built to make impossible.

**Let the figure follow the evidence — a fiscal year legitimately bills a
different calendar total.** Rejected, and it is the tempting one, because it is
what would really happen. But then a Variant is a scenario knob with a scheme's
reach: every scheme's arithmetic, every expected impact range and every pinned
answer key would move when a checkbox changed the paper, and there would be no
way to say what a variant is *for*.

**Make the regimes mutually exclusive, as a county's practice really is.**
Rejected as a UI, kept as arithmetic: the fiscal year and the quarterly
collection compose, because a fiscal year that collects in quarters is a real
county too, and the chain that holds the figure still is the same chain either
way. Three checkboxes read as three facts about the county, which is what they
are.

## Consequences

`ScenarioConfig` gains a fifth optional field. `TaxParcelYear` is now a bill
rather than a year and says so in its own comment; `period`, `prior_levy_cents`
and `supplemental` are all absent in a package that asked for no variant, which
is what keeps the pinned bytes pinned.

Tie T4 tests every bill that put an instalment into the year, so a bill that
straddles two calendar years is checked in both — the same arithmetic twice,
which is cheap and honest.

The scanner-side fixtures (`red-flag-scanner/tests/fixtures/foundry/`) are
untouched. The ReconPackage still carries one entry per parcel per year, with
what the county charged it and what it credited back; a fiscal year or a
supplemental changes the paper behind those two figures and not the figures, so
RF-13 reads exactly what it always read.
