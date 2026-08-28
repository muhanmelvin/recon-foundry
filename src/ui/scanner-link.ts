/**
 * The one place in this repo that names a sibling application's address.
 *
 * The interchange between Recon Foundry and the Red-Flag Scanner is a *file* —
 * downloaded here, uploaded there. Nothing in here opens a connection; this
 * module produces an `href` for an anchor the visitor clicks, and that is the
 * whole of the coupling between the two apps.
 *
 * It is a hostname switch rather than a build-time constant so that `npm run
 * dev` on this machine sends you to the scanner's dev server rather than to the
 * live site: the two are the same application, but only one of them has your
 * unreleased changes in it.
 *
 * `tests/privacy.test.ts` names this file explicitly as the only module under
 * `src/` allowed to contain a remote host, and pins the host it may contain.
 * If you add a second cross-app link, put it here too.
 */

/** The scanner's dev server. The family pins one port per app; the scanner's is 5173. */
const SCANNER_DEV = "http://localhost:5173/";
const SCANNER_LIVE = "https://scanner.petriumalpha.com/";

export function scannerUrl(): string {
  const host = typeof location === "undefined" ? "" : location.hostname;
  return host === "localhost" || host === "127.0.0.1" ? SCANNER_DEV : SCANNER_LIVE;
}
