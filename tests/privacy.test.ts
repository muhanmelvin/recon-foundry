/**
 * "Your file never leaves your machine" is a claim on the page, so it is a
 * test, not a convention. These checks are textual on purpose: they fail on the
 * mere presence of a network call, before anyone has to reason about whether it
 * would have fired.
 *
 * They also pin the engine/UI direction of dependency, which is what keeps the
 * arithmetic testable in a node environment.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

const srcFiles = walk(join(root, "src"));
const engineFiles = walk(join(root, "src", "engine"));

describe("the page can only load itself", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const csp = /content="([^"]*default-src[^"]*)"/.exec(html)?.[1] ?? "";

  it("declares a Content-Security-Policy", () => {
    expect(csp).not.toBe("");
  });

  it("forbids outbound connections", () => {
    expect(csp).toContain("connect-src 'none'");
  });

  it("allows no script source but itself", () => {
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    // 'unsafe-inline' in script-src would defeat the point; the single-file
    // build adds per-script hashes instead. See scripts/finalize-single.mjs.
    expect(/script-src[^;]*unsafe-inline/.test(csp)).toBe(false);
  });

  it("submits no forms anywhere", () => {
    expect(csp).toContain("form-action 'none'");
  });

  it("loads no remote asset", () => {
    // Anchors in the site nav legitimately point at the sibling apps; what must
    // never appear is a *resource* loaded from another host.
    const loaders = /<(?:link|script|img|iframe|source|video|audio|embed|object)\b[^>]*\b(?:src|href|data)="https?:\/\/[^"]*"/gi;
    expect(html.match(loaders) ?? []).toEqual([]);
  });
});

const BANNED = ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "importScripts", "navigator.connection"];

/**
 * The single module under `src/` allowed to name another application's address.
 *
 * The Red-Flag Scanner handoff needs an `href`, and a file interchange nobody
 * can find is not an interchange. The exception is confined to one module and
 * pinned below: the host it may name, that it opens nothing itself, and that no
 * second file quietly grows the same privilege.
 */
const CROSS_APP_LINK = "src/ui/scanner-link.ts";
const posix = (f: string) => relative(root, f).split(/[\\/]/).join("/");
const stripNamespaces = (t: string) => t.replace(/https?:\/\/(?:schemas\.openxmlformats\.org|purl\.org\/dc)[^"'`\s]*/g, "");

describe("no source file reaches the network", () => {
  it("has source files to scan", () => {
    expect(srcFiles.length).toBeGreaterThan(0);
  });

  it.each(srcFiles.map((f) => [relative(root, f), f] as const))("%s makes no request", (_rel, file) => {
    const text = readFileSync(file, "utf8");
    const found = BANNED.filter((b) => text.includes(b));
    expect(found, `network API in ${_rel}: ${found.join(", ")}`).toEqual([]);
  });

  it.each(srcFiles.map((f) => [relative(root, f), f] as const))("%s references no remote host", (_rel, file) => {
    // Cross-app links live in index.html's site nav. Application source under
    // src/ has no business naming a host at all.
    //
    // Two exceptions, both XML namespace identifiers rather than addresses:
    // schemas.openxmlformats.org and purl.org/dc are the strings that make a
    // .xlsx a .xlsx, written *into* the file the writer produces. Nothing
    // resolves them, and an Office document without them is not readable. This
    // is a local widening of the family's check; the rest of it stands.
    //
    // A third exception, and the only one that is a real address: see
    // CROSS_APP_LINK above, and the tests that fence it in below.
    if (posix(file) === CROSS_APP_LINK) return;
    const text = readFileSync(file, "utf8");
    expect(/https?:\/\/(?!www\.w3\.org)/.test(stripNamespaces(text)), `remote host referenced in ${_rel}`).toBe(false);
  });
});

describe("the one cross-app link", () => {
  const text = readFileSync(join(root, CROSS_APP_LINK), "utf8");

  it("names only the scanner, live and local", () => {
    const hosts = [...text.matchAll(/https?:\/\/([^/"'`\s]+)/g)].map((m) => m[1]!);
    expect([...new Set(hosts)].sort()).toEqual(["localhost:5173", "scanner.petriumalpha.com"]);
  });

  it("opens no connection of its own — it only produces an href", () => {
    const found = BANNED.filter((b) => text.includes(b));
    expect(found, `network API in ${CROSS_APP_LINK}: ${found.join(", ")}`).toEqual([]);
    expect(/\blocation\s*\.\s*(?:href|assign|replace)\b/.test(text), "it navigates for you instead of offering a link").toBe(false);
  });

  it("is the only module under src/ that names a host", () => {
    const offenders = srcFiles
      .filter((f) => posix(f) !== CROSS_APP_LINK)
      .filter((f) => /https?:\/\/(?!www\.w3\.org)/.test(stripNamespaces(readFileSync(f, "utf8"))))
      .map((f) => posix(f));
    expect(offenders).toEqual([]);
  });
});

describe("the engine stays pure", () => {
  it("has engine files", () => {
    expect(engineFiles.length).toBeGreaterThan(0);
  });

  it.each(engineFiles.map((f) => [relative(root, f), f] as const))("%s imports nothing from the UI", (_rel, file) => {
    const text = readFileSync(file, "utf8");
    expect(/from\s+["'][^"']*\/ui\//.test(text), `${_rel} imports from src/ui/`).toBe(false);
  });

  it.each(engineFiles.map((f) => [relative(root, f), f] as const))("%s touches no document", (_rel, file) => {
    // Word-boundary matching rather than a bare substring, because this repo
    // writes Office XML: the content type that makes a workbook a workbook is
    // "…officedocument.spreadsheetml…", which contains "document." and is not a
    // DOM reference. `\bdocument\s*\.` does not match inside "officedocument",
    // and still catches every real use.
    const text = readFileSync(file, "utf8");
    const banned: Array<[string, RegExp]> = [
      ["document", /\bdocument\s*\./],
      ["window", /\bwindow\s*\./],
      ["localStorage", /\blocalStorage\b/],
      ["HTMLElement", /\bHTMLElement\b/],
    ];
    const found = banned.filter(([, re]) => re.test(text)).map(([name]) => name);
    expect(found, `DOM reference in ${_rel}: ${found.join(", ")}`).toEqual([]);
  });
});
