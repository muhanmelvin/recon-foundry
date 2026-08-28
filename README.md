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
the amortization schedule was never written at all. A trainee who can't cross-tie
documents never learns the one skill the job is made of.

Recon Foundry forges the whole package for an invented property — the workbook,
the general ledger, the billing statement, the tax and insurance backup, the
amortization schedule, the tenant ledger, and the lease itself — and every figure
in it agrees with every other figure, to the cent. Then it plants the
overcharges you asked for, and only those, and tells you afterwards where they
were.

## Status

Under construction. See `docs/adr/` for the decisions already made, and the
build plan in the planning folder for what is still ahead.

## Running it

```
npm install
npm run dev      # http://localhost:5173
npm test
npm run ci       # typecheck → test → build → client-data gate → build smoke
```

## Architecture

- `src/engine/` — pure, DOM-free, integer cents. Tested in a node environment.
- `src/ui/` — thin render layer. Imports the engine; the engine never imports it.
- `gates/` — the client-data deny-list and the two gates that enforce it.
- `tests/` — the specification. Golden fixtures pin real outputs.

## Everything here is fictional

Every property, party, vendor, parcel and figure this tool produces is invented.
Every address is in the State of Franklin, which is not a state, at a ZIP code
the Postal Service has never issued. No client lease, site or number is in this
repository, and the deny-list gates fail the build if one ever appears.

## Licence

MIT — see [LICENSE](LICENSE).
