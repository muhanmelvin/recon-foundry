# 0004 — A description sets parameters; it never becomes the package

**Status:** accepted · 2026-08-31

## Context

Recon Foundry could already forge a package from a handful of controls: a seed,
a property kind, a size band, some years, five schemes. The controls are honest
but they are not *yours* — nobody recognises their own business in "retail
strip, medium".

So the page now takes a paragraph of prose. You describe what you lease, run a
prompt in whatever AI you already use, paste the JSON back, and the controls
fill in. This is the family's prompt-out/JSON-back shape, the same one
lease-interpreter uses, because the CSP forbids the page calling an AI itself
and we would not want it to anyway.

The question this ADR settles is where the description stops.

## Decision

**The description parametrises the generator. It never becomes any part of the
output.**

Concretely:

- The AI may fill at most seven knobs — `property_kind`, `size_band`,
  `start_year`, `year_count`, `premises_sf`, `opex_psf_target`, `story` — and
  suggest schemes. That is the entire interface.
- **It never writes an amount.** Every dollar in the package is computed by the
  engine from those knobs, bottom-up from invoices it drew itself.
- **It never names anything.** Property, landlord, tenant, vendors, county, tax
  collector, carrier: all still drawn from the seeded bank in `names.ts`, in the
  fictional state of Franklin. The one exception is `story`, a caption, which is
  length-capped and refused if it contains a name another app in the family owns.
- **The prose is not stored.** Not in the package, not in an export, not in
  local storage, not in a URL. It exists in a textarea and in whatever the
  visitor pasted it into.
- Every filled knob carries a quote from the description, and the validator
  checks that quote really appears in it. The panel shows each quote beside the
  control it filled.

## Why

**Because the ties are the product.** Seven relationships hold to the cent
across a workbook, a statement, three kinds of backup, a ledger and a lease,
and exactly one of them breaks where a scheme was planted. That property comes
from generating every figure from one model. An AI that wrote amounts — even
good ones — would break ties nobody planted, and a package whose arithmetic is
wrong in unplanned places is not a training exercise, it is noise.

**Because of the zero-client-data rule.** The rest of the family enforces it
with a deny-list gate over the repo and the build. That gate cannot see what a
visitor types into a browser at runtime. Structural isolation can: if user prose
has no path into the engine, then a package forged by a visitor who pasted a
real client name into the description still cannot contain it. The quote check
and the reserved-name check on `story` are the belt over those braces.

**Because the visible AI step should be a legible one.** The interesting claim
this feature makes is not "AI generated a package". It is "AI read your
paragraph, set seven controls, and showed you the words it read each one from —
now override whatever it got wrong." A model that authored the whole artefact
would be less useful and much harder to check.

## Alternatives considered

**Let the AI author the package.** Rejected: it breaks the ties, which is the
one thing this app has that a spreadsheet template does not.

**Store the description as `meta.story`.** Rejected: that is precisely the path
that would carry a real business's words into an exported file. The AI writes a
fresh synthetic caption instead, and the visitor can edit it.

**Call an AI from the page.** Rejected: forbidden by the family CSP, requires a
key or a backend, and would make a page that currently works offline depend on a
network.

**Let the draft set the seed.** Rejected: the seed is what makes a package
shareable and re-forgeable. It stays the visitor's; a draft that sets one is
ignored with a warning.

## Consequences

`ScenarioConfig` gains three optional fields — `premises_sf`,
`opex_psf_target`, `story` — and the rule that a config omitting them forges
byte-for-byte what it forged before, pinned by `tests/describe-regression.test.ts`.
That matters beyond this repo: the Red-Flag Scanner commits three packages
forged here, and a moved default would strand them.

`premises_sf` inverts a derivation rather than overriding one. The property is
sized around the premises, because tie T7 requires the billed share to be
premises ÷ denominator exactly.

`opex_psf_target` scales the *inputs* the generator draws amounts from, not the
finished totals, and it converges by re-forging: build, measure, correct, build
again, up to four passes. Scaling a completed pool would defeat the round-number
avoidance the clean packages depend on, and every pass re-derives from the same
seed, so determinism is untouched.

This repo is the first in the family to put a numeric bound on anything a user
supplies. `src/engine/model/bounds.ts` is the single place those bounds live —
read by the forge boundary, by the prompt, and by the validator — and the engine
is the gate. The panel's `min`/`max` attributes are a courtesy that happens to
agree with it.
