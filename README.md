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

## The five schemes

| Scheme | Breaks | The scanner sees it as |
|---|---|---|
| Capital expensed in a lump | T7 | RF-09 |
| The cap grown on the cap | T7 | RF-06 |
| A fee on a base the lease forbids | T7 | RF-07 |
| A cost moved out of the capped pool | T7 | RF-04, with RF-02 and RF-03 |
| **A tax refund kept** | **T4** | **RF-13 — but only from the JSON** |

Four of the five are visible only by reading the lease: the arithmetic is right
and the entitlement is wrong. The fifth is the opposite, and it is the one worth
pointing at.

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
put a tax backup. It is still the best of the five to teach with, for exactly
that reason: only the paper catches it.

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
npm run dev      # http://localhost:5173
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
