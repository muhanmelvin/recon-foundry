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
