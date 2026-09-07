# 0005 — Optional clauses ride after the articles, and change only the lease

**Status:** accepted · 2026-09-07

## Context

The lease Recon Foundry forges has seven articles and seventeen sections, and
every one of them is filled from the model: the premises, the share, the cap,
the fee base, the capital threshold, the gross-up. It is a real lease to read
against a real statement, and it is the same lease every time.

Visitors wanted to build one. Not to change what the package computes — to
choose what the lease *says*: repairs and who does them, utilities and who is
billed for them, what counts as a Tax, what the landlord's insurance may
recover, what the common areas are. Six or so topics, a couple of provisions
each, ticked on and off beside the document while it redraws.

Two facts constrain where those clauses can go.

**The numbering is a contract with another application.**
`src/engine/render/lease/sections.ts` is a verbatim copy of the Red-Flag
Scanner's clause map. An answer key forged here cites §6.04; a finding raised
there cites §6.04; a trainee holding both has to be reading the same clause.
Articles I–VII are never renumbered, no section is ever removed, and a section
the model is silent on still renders as a negative clause so that every citation
anchor stays alive in every package.

**The scanner never reads the prose lease.** The ReconPackage JSON carries the
lease *abstract* — share, cap, fee, capital threshold and life, gross-up — and
nothing else. No clause can create or hide a scanner finding.

## Decision

**Optional clauses are a Rider: prose only, opt-in, numbered R1 onward, printed
after Article VII.**

- Twelve clauses in six sections, catalogued in
  `src/engine/render/lease/rider.ts`. `ScenarioConfig.clauses` names the ones
  selected; the Rider prints in catalog order whatever order they were ticked in.
- **Absent is byte-identical to before; empty is document-identical.** No
  Rider, no mention of one in §7.02, no line in the package's about note.
  `tests/rider.test.ts` holds the three pinned regression ZIPs against the
  absent case, and the lease's bytes against the empty one (see Consequences).
- **A clause restates the model and never contradicts it.** It changes the lease
  document and nothing else: no pool, no tie, no scheme, no finding.
- **Nothing tenant-specific.** The wording keys on the kind of property — retail
  centre, office building, industrial flex — through a phrase table, and on
  nothing else. The same Rider has to read as a lease a big-box retailer, an
  e-commerce distributor or a manufacturer could all have signed.
- **The engine is the gate.** `validateScenarioConfig` refuses an unknown or a
  repeated clause id, because a pasted configuration never sees the checkboxes.

## Why

**Because a clause that contradicts the package plants a finding nobody
planted.** This is the whole risk of the feature and the reason it is worth an
ADR. The forge amortizes roof and paving replacements and recovers them under
§6.04; a repairs clause promising that capital replacement is "at Landlord's
sole cost" would make every clean package look wrong, and the answer key would
be wrong about its own package. Likewise the collector's account statement
credits a tax refund in the year the county granted it, so the tax clause says
that and not the tempting opposite. Restate, never contradict, is not a style
rule here — it is what keeps the answer key true.

**Because prose is the only safe surface.** Everything else in this app is
derived: a figure exists because the model computed it, and a document is a pure
function of the model. A clause that moved money would have to move the model,
and something that moves the model in a way the tenant pays for is a scheme —
which gets built as a scheme, with a seam, a broken tie and an answer-key entry.

## Alternatives considered

**Renumber the additions as Articles VIII and onward.** Rejected. It looks
tidier and it is the obvious thing to do, but it invites the next change to
renumber something inside I–VII, and the numbering is a cross-repo contract.
Riding after the articles makes the constraint visible in the artefact itself:
R1 is plainly not part of the numbering the findings cite.

**Let clauses toggle the Article VI sections instead.** Rejected. Article VI is
where the money is: §6.02 is the cap, §6.03 the fee, §6.04 the amortization.
Those sections are written from the model precisely so that the schemes have a
lease to be wrong against. A visitor switching §6.02 off would take the basis
away from a planted overcharge.

**Let a clause drive the model — an exclusion that actually excludes.**
Rejected, and this is the one that keeps coming back. It is a good feature and
it is a different feature: it is a scheme, or a new lease term, and either way
it belongs in the model with a tie and an answer-key entry, not in a checkbox
that quietly changes what the tenant owes.

## Consequences

`ScenarioConfig` gains a fourth optional field, `clauses`, under the same rule
as `premises_sf` and `opex_psf_target`: a config that omits it forges the bytes
it always forged. That rule now has a wrinkle worth knowing — the answer key
records the configuration verbatim, so `clauses: []` is nineteen bytes larger
than an absent key even though every *document* is identical. The rail deletes
the key rather than writing an empty list.

The lease gained a table of contents in the same body of work, and that did move
the three pinned ZIP hashes, deliberately and in its own commit. It is what makes
a Rider findable: the preview shows the real bytes in a sandboxed iframe that the
page cannot scroll, and an in-document fragment link is the only navigation left.

The scanner-side fixtures (`red-flag-scanner/tests/fixtures/foundry/`) are
untouched, because they carry the ReconPackage JSON and the JSON does not carry
the prose.
