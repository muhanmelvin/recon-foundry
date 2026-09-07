# Working conventions

Read this before changing anything in a repo built from `app-starter`.

## The shape of the code

- `src/engine/` — pure functions. No DOM, no globals, no I/O, no clock, no
  randomness. Same input, same output, always. Money is integer cents. Tests run
  in a node environment, and `tests/privacy.test.ts` fails if an engine file so
  much as mentions `document`.
- `src/ui/` — rendering only. May import the engine; the engine must never
  import from here. Build elements with `h()` from `src/ui/dom.ts`, never
  `innerHTML` and never an inline event handler — both are blocked by the CSP
  and break the single-file build.
- `src/shared/` — tokens and chrome copied across every app in the family. If
  you change something here, it is a cross-repo change; say so in the commit.
- `gates/`, `scripts/` — the client-data gates. See `gates/README.md`.
- `tests/` — the specification. New behaviour means new tests in a new file.

## Limits on what a visitor may supply

This repo is the first in the family to take a number from a user, so it sets the
convention. `src/engine/model/bounds.ts` is the single home for every bound —
read by the `forge()` boundary, by the pinned prompt in `src/engine/describe/`,
and by the draft validator beside it. **The engine is the gate.** An input's
`min`/`max` is a courtesy that happens to agree with it, and a pasted draft never
sees the markup at all. Don't add a second copy of a bound; add it there.

The prose a visitor types is never an engine input, never stored, and never part
of a forged package — see `docs/adr/0004-describe-maps-to-parameters-only.md`.

## Non-negotiables

1. **Nothing leaves the browser.** No network calls, no analytics inside an app,
   no external fonts or images, no CDN. `connect-src 'none'` is not a
   suggestion; if a feature needs it lifted, the feature is wrong for this repo.
2. **Synthetic material only.** Invented properties, invented leases, invented
   numbers. Never a real site code, client name, address, or figure — in code,
   prose, comments, tests, commit messages, or fixtures. When a gate fires, fix
   the content; never widen the gate.
3. **Determinism where money is calculated.** AI may help read a lease; it never
   computes a number that appears in a finding. Say so on the page.
4. **No new dependencies** without a reason worth defending. Prefer twenty lines
   of code to a package.
5. **Golden fixtures are contracts.** If a change moves a golden output, that is
   a finding about the change, not a test to update in passing. Update it
   deliberately, in its own commit, with the reason in the message.

## Method

- Plan before code: stages, "done when" criteria, explicit non-goals.
- One stage at a time; `npm run ci` green before the next begins.
- One commit per stage. Subject line in the imperative, describing the change in
  the domain's language, not the file's: *"Statement view: the landlord's
  reconciliation behind the findings"*, not *"add recon-table.ts"*.
- Smoke `npm run build:single` per stage.
- **Open it in a browser.** Vitest runs in node; nothing here renders the DOM.
  A green suite is not evidence that the page works.
- Commit and push only when asked.

## Prose

The interface talks to a working auditor. Prefer the domain's word to the
programmer's one, name what the landlord did rather than what the code checked,
and give every number its arithmetic. Terms used in the UI belong in
`CONTEXT.md`, and must mean the same thing there, in the code, and on screen.

## From the Lease Audit Projects folder map

Moved here from `Lease Audit Projects\CLAUDE.md` on 2026-09-07; the one-line index entry there points to this section.

the Recon Foundry repo, third app on the petriumalpha showcase: a browser-only generator of complete synthetic lease-audit packages (recon workbook with GL detail, billing statement, tax and insurance backup, amortization schedule, tenant ledger, prose lease) where **seven named ties hold to the cent except at the one seam a planted scheme breaks**. Five schemes; `kept_tax_refund` is deliberately invisible to the Red-Flag Scanner and is the argument for a future RF-13. **v1.0 code-complete locally through milestone M6, NOT pushed — no GitHub repo, no DNS, no Pages.** `recon-foundry\melvin_sandbox\RESUME.md` is the authority on where it stands and what the operator still has to do. Scaffolded from `app-starter\`; same deny-list gate family as red-flag-scanner. **Determinism is the product**: seeded PRNG in the engine (ADR 0001, which the family's no-randomness rule would otherwise forbid), hand-rolled store-only ZIP and XLSX writers so bytes are reproducible (ADR 0002), integer cents affirmed rather than exempted (ADR 0003). `src/engine/scanner-rules.ts` holds **copies** of the scanner's own round-number, capital-keyword, label-normalizer and amortization rules — copy, never import, with the drift caught by the scanner-side fixture test `red-flag-scanner/tests/foundry.test.ts` (M5b, **written 2026-08-28**; regenerate its fixtures with `npm run fixtures` here). **The two apps now link to each other in the UI, and the scanner's half is committed but held unpushed until Foundry is live** — see both RESUME.md files. Will live at https://foundry.petriumalpha.com.
