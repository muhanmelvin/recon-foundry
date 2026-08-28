# 0003 — Money is integer cents here too

**Status:** accepted · 2026-08-28

## Context

The family rule is integer cents in the engine. One sibling repo has an
exemption: Cap Trap Explorer's ADR-0001 lets its cap engine work in floats,
because it reproduces published schedules whose sub-cent per-square-foot figures
were themselves computed in floats, and rounding is a per-lease modelling choice
there rather than a fact.

Recon Foundry is superficially similar — it also computes cap ladders — so it is
worth saying plainly why the exemption does not travel.

## Decision

Every amount in `src/engine/` is integer cents. No exemption.

## Why the sibling's reasoning does not apply

Cap Trap Explorer *reproduces* arithmetic somebody else performed and has to
match it. Recon Foundry *authors* the arithmetic. It controls every rounding
site, so there is no external figure to match and no reason to inherit anyone
else's floating-point residue.

And the output is consumed by a program, not only read by a person. A forged
package is scanned by the Red-Flag Scanner, whose tie-out check (RF-11) recomputes
the balance due and reports a discrepancy over a dollar as a finding. A package
that drifts a cent because it was assembled in floats would produce a *false*
finding in the scanner — the exact failure the clean fixtures exist to rule out.

## Consequences

The seven ties in `ties.ts` are exact: no tolerances, because there is no
measurement error to tolerate. A one-cent difference is a bug.

Rounding happens in named places and nowhere else: `mulRate` for a rate applied
to a base, and `allocate` for dividing a total across invoices, where the last
part absorbs the remainder — which is also how a real year works, the final
invoice being whatever the year actually cost.

Dollars appear only at the boundary: when a document is rendered, and when a
`ReconPackage` is exported in the scanner's schema, which states amounts in
dollars to two decimals.
