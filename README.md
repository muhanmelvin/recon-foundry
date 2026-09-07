# Recon Foundry

[![CI](https://github.com/muhanmelvin/recon-foundry/actions/workflows/ci.yml/badge.svg)](https://github.com/muhanmelvin/recon-foundry/actions/workflows/ci.yml)

**Forges complete synthetic lease-audit packages that tie to the cent — except
exactly where you told them to cheat.**

**Live:** https://foundry.petriumalpha.com/ · **Offline:** download
[`index.html`](https://foundry.petriumalpha.com/) and open it — the whole tool is one file.

## The problem

Every dataset you could train a lease auditor on is one of two things. Real, and
therefore unshareable — a client's reconciliation is a client's reconciliation.
Or invented, and therefore useless, because invented numbers don't *tie*: the
ledger doesn't foot to the statement, the tax bills don't add to the tax line,
and the amortization schedule was never written at all. A trainee who cannot
cross-tie documents never learns the one skill the job is made of.

Recon Foundry forges the whole package for an invented property — the workbook,
the general ledger, the billing statement, the tax and insurance backup, the
amortization schedule, the tenant's account, and the lease itself — and every
figure in it agrees with every other figure, to the cent. Then it plants the
overcharges you asked for, and only those, and tells you afterwards where they
were and which pair of pages proves it.

## How a package is made

```
ScenarioConfig  ──buildCleanModel──▶  a whole property, where nothing is wrong
                ──applySchemes─────▶  the same property, with one thing wrong  ──▶  answer key
                ──renderers────────▶  workbook · statement · backup · lease
                ──packager─────────▶  one ZIP, a folder per year
```

The renderers never know a scheme exists. A scheme does not write a wrong number
onto a statement; it changes the model — an expense classified differently, a fee
charged on a wider base, a refund never passed through — and every document is
then regenerated faithfully from the changed model. That is what makes a planted
overcharge worth finding: afterwards the workbook, the statement, the ledger and
the balance due all agree with each other, exactly as a real landlord's package
does, and only the lease disagrees.

## The seven ties

A reconciliation package is not one document. It is eight that have to agree, and
auditors find overcharges by putting two of them side by side.

| | Between | Which says |
|---|---|---|
| **T1** | General ledger → reconciliation | Every category's invoices add up to the amount billed for it |
| **T2** | Reconciliation → billing statement | The statement's totals, share and balance due are the reconciliation's, figure for figure |
| **T3** | Tenant ledger → payment history | The estimates charged are the estimates credited, and the running balance adds |
| **T4** | Tax bills → real estate tax line | The parcels' instalments, net of any credit the backup shows, are the tax line |
| **T5** | Insurance invoice → insurance line | The premium and the fees on the declaration page are the insurance line |
| **T6** | Amortization schedule → capital line | The schedule's total for the year is the capital line, and its own arithmetic works |
| **T7** | Lease → the arithmetic | Recomputing from the lease reproduces what was billed |

All seven are exact to the cent. There are no tolerances, because there is no
measurement error: the model controls every rounding site, so a one-cent
difference is a bug. A clean package holds all seven. A planted scheme breaks
exactly one, and `tests/schemes.test.ts` holds it to that — a scheme that broke a
tie it did not declare would leave a loose thread a trainee pulls on instead of
finding the real thing.

## The schemes

| Scheme | Breaks | The scanner sees it as |
|---|---|---|
| Capital expensed in a lump | T7 | RF-09 |
| The cap grown on the cap | T7 | RF-06 |
| A fee on a base the lease forbids | T7 | RF-07 |
| A cost moved out of the capped pool | T7 | RF-04, with RF-02 and RF-03 |
| A second fee for the same service | T7 | RF-07's duplication test — an exposure, not a priced overcharge |
| **A tax refund kept** | **T4** | **RF-13 — but only from the JSON** |
| Taxes billed at budget, never trued up | T4 | RF-13, from the other direction |
| **Another property's invoice** | **T1** | **nothing at all — see below** |

Most of them are visible only by reading the lease: the arithmetic is right and
the entitlement is wrong. The two tax schemes are the opposite, and they are the
ones worth pointing at.

**RF-13 exists because of the kept tax refund.** For most of this repo's life no
scanner check could catch it: none of the twelve read a refund or a credit, and
the ReconPackage schema had no field that could carry one — because a
reconciliation statement, on its own, simply does not contain the fact that a
refund exists. Only the county's account statement does. So the answer key
recorded that finding with `check_id: null` and the manifest left it out, as a
gap declared rather than hidden, and the README named the check that would close
it. Schema **1.1** did: every exported package now carries the collector's
account as a per-year `tax_backup` — the levy as issued, and the credits granted
against it — and the scanner's **RF-13** nets the two.

What has not changed is which document betrays it. Upload the workbook instead of
the JSON and the scheme is invisible again, because a spreadsheet has nowhere to
put a tax backup. It is still one of the best to teach with, for exactly that
reason: only the paper catches it.

**And the gap is open again, on purpose.** *Another property's invoice* is a
cost incurred somewhere else, allocated into this property's ledger and
recovered from a tenant who has never seen the place. There is no arithmetic to
catch it: the line is the right size, it takes the same share every year, the
vendor really does work here, and the ledger adds to the statement to the cent.
The only thing wrong with it is five words in a memo — and the ReconPackage
carries lines and amounts, not memos, so no check has anything to read. It is
recorded with `check_id: null` and counted in `document_only_findings`, the same
way the kept refund was, and it names the check that would close it: allocated
costs substantiated to the property they were incurred at.

## Variants — the same figure, evidenced differently

Counties do not bill alike, and neither do carriers. A tax year that runs July
to June serves every calendar year with two bills; a quarterly collection
estimates the first two instalments off last year's levy; a reassessment arrives
as a supplemental beside the original. A premium can be priced coverage by
coverage, financed over a down payment and instalments, or its fees collected a
quarter at a time.

Six checkboxes, three beside the tax backup and three beside the insurance, and
**none of them moves a cent**. The property bears the same tax in the same year
with every box ticked as with none; the Insurance line, the tenant's total and
all seven ties are exactly what they were. What changes is the paper, the ledger
memos behind it, and the arithmetic a reader has to follow to tie it out — which
is the point, because an auditor who has only ever seen one shape of bill reads
the second one as an error.

[ADR 0006](docs/adr/0006-variants-change-the-evidence-never-the-figure.md) carries
why the proration lives in the instalments rather than in the renderer, and why a
supplemental is carved out of the assessment it corrected rather than added to
it. A checkbox that moved money would be a scheme.

## Same seed, same bytes

A scenario is a pure function of its configuration, and the seed is part of that
configuration. Forge twice from `ashford-1` and you get the same property, the
same invoices and the same file — so a trainer can hand a class of twenty the
identical package by handing them a word, and a golden test can pin a SHA-256 and
mean it.

Three decisions carry the weight of that:

- [ADR 0001 — a seeded generator lives in the engine](docs/adr/0001-seeded-prng-in-the-engine.md):
  why an engine forbidden to have randomness has one, and the three things that
  stay banned so the promise holds.
- [ADR 0002 — the XLSX writer is hand-rolled, and stays small](docs/adr/0002-hand-rolled-xlsx.md):
  why a library that stamps the current time into every ZIP entry cannot be used
  by an app whose whole claim is byte-level reproducibility.
- [ADR 0003 — money is integer cents here too](docs/adr/0003-integer-cents-affirmed.md):
  why this app does not take the float exemption its cap-engine sibling took.
- [ADR 0004 — a description sets parameters, never the package](docs/adr/0004-describe-maps-to-parameters-only.md):
  where the prose in "Describe it instead" stops, and why it stops there.

## Describe it instead

The controls are honest, but nobody recognises their own business in "retail
strip, medium". So you can write a paragraph instead:

> We lease 40,000 square feet in a suburban retail centre. Operating expenses run
> about $9.50 a foot. Last year the landlord repaved the whole parking lot and
> charged it all to that year.

Copy the prompt the page builds, run it in whatever AI you already use, paste the
JSON back. The controls fill in — property kind, size, years, your square
footage, your dollars per foot, a caption, and the schemes your grievance
describes — and each one is shown **beside the words it was read from**, so an
override is a decision rather than a guess.

The page never calls an AI. It cannot: `connect-src 'none'`.

What the AI is trusted with is deliberately small. It fills seven knobs and
suggests schemes; it never writes an amount, and it never names anything. Every
dollar is still computed by the engine, bottom-up from invoices it drew itself,
so the seven ties still hold. Every name still comes from the seeded synthetic
bank. **Your description reaches none of it** — it is not stored in the package,
in an export, or anywhere else, which is what keeps the zero-client-data promise
true even for a package you configured yourself. A quote that does not appear in
your description is rejected, and a caption naming a property another app in the
family owns is rejected too.

Two knobs are new, and usable without any of the above:

| Knob | Range | Blank means |
|---|---|---|
| `premises_sf` | 2,000 – 500,000 sf | the size band draws one |
| `opex_psf_target` | $2.00 – $60.00 / sf | whatever the property naturally costs |

Naming a square footage sizes the property *around* it, rather than overriding
it, because T7 requires the billed share to reproduce from the two figures.
Naming a rate scales the inputs the generator draws amounts from — never a
finished total — and converges by re-forging. `src/engine/model/bounds.ts` holds
both ranges, and the engine is the gate: the input attributes agree with it as a
courtesy, and a pasted draft never sees them at all.

## How the Red-Flag Scanner consumes this

Every scenario exports two files in the scanner's own formats: a **ReconPackage**
JSON (validated here against a copy of the scanner's schema) and a **findings
manifest** saying what should be found in it. Both are in the `_ANSWER KEY`
folder of the ZIP, and downloadable on their own.

Those files are the interchange, and they travel as files. There is no runtime
call between the two apps: the family is built on the promise that a page can
only load itself, and a cross-origin fetch would spend that promise to save a
click. Copy, never import.

A clean package is the most valuable fixture of the set, because the promise it
carries is the strongest: the scanner finds **nothing at all** in it — no swing
over 15%, no round pool figure, no amount repeated to the cent, no
capital-sounding lump, no fee on a base the lease does not permit. It is the
fixture that catches a future check which starts crying wolf. The generator is
built inside those tolerances on purpose; `tests/scanner-tolerances.test.ts`
holds it there, against the copies of the scanner's own rules in
`src/engine/scanner-rules.ts`.

## Running it

```
npm install
npm run dev      # http://localhost:5174
npm test         # 1,000+ tests
npm run ci       # typecheck → test → build → client-data gate → build smoke
```

## Architecture

- `src/engine/` — pure, DOM-free, integer cents, tested in a node environment.
  - `model/` — the scenario: the clean generator, the schemes, the ties, the answer key.
  - `render/` — one pure function per document. None of them knows a scheme exists.
  - `xlsx/`, `zip/` — the workbook writer and the store-only ZIP underneath it.
- `src/ui/` — a thin render layer. Imports the engine; the engine never imports it.
- `gates/` — the client-data deny-list and the two gates that enforce it.
- `tests/` — the specification. Golden fixtures are contracts, not test data.

## Everything here is fictional

Every property, party, vendor, parcel and figure this tool produces is invented.
Every address is in the **State of Franklin**, which is not a state, at a ZIP code
the Postal Service has never issued. Every page carries a line saying so, every
workbook says it in its file properties, and every ZIP contains a note explaining
what it is.

That convention is deliberate in both directions. A watermark across every page
would destroy the realism the exercise depends on; a geography that cannot exist
is unmissable to anyone inspecting a document and invisible to anyone working it.

No client lease, site, code or number is in this repository, and the deny-list
gates fail the build if one ever appears.

## Licence

MIT — see [LICENSE](LICENSE).
