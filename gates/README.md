# Client-data gates

Everything in this repo is public. Everything it runs on is synthetic. Two
automated gates enforce that, and both read the same deny-list:

1. **Test gate** — `tests/no-client-identifiers.test.ts` scans `src/`, `schema/`,
   `tools/`, `scripts/`, `public/`, `index.html` and `README.md` for every
   deny-listed term and fails `npm test` on a hit.
2. **Build gate** — `scripts/build-gate.mjs` runs after `vite build`, re-scans
   the output directory, and on a hit **deletes the output and exits non-zero**,
   so nothing reaches a deploy step.

## Where the deny-list lives

- `gates/denylist.public.json` — committed; generic canaries only. Exists so the
  mechanism is testable in a clean clone.
- `gates/denylist.local.json` — **git-ignored**; the private list of real site
  codes, client names and source-folder names. Copy it from another app repo on
  your machine; never reconstruct it from memory into a committed file, and
  never paste its contents into a chat, an issue, or a commit message.
- `CLIENT_DENYLIST` — environment variable (JSON array), used by CI and by the
  hosting build. Set it as a GitHub Actions repository secret.

With `REQUIRE_PRIVATE_DENYLIST=1` (CI sets this), a missing private list fails
the gate instead of passing silently. **Do not remove that variable from the
workflow** — it is the line that turns a forgotten secret into a red build
instead of an unprotected deploy.

## When a gate fires

It is telling you a real thing. Do not add the term to an allow-list, do not
rename a variable to slip past the substring match, and do not disable the gate
to "unblock the build". Find the client identifier and remove it, then re-run.
