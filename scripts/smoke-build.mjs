/**
 * Build smoke check. Runs after `vite build`, alongside the client-data gate.
 *
 * The unit suite proves the figures are right; this proves they were actually
 * shipped. A build can be green, gate-clean and still useless — a tree-shaken
 * engine, a renderer whose output never reached the bundle, a stylesheet that
 * lost its dark-mode block. Those are the failures a test run in node cannot
 * see, and the ones that only show up on the deployed page.
 *
 *   node scripts/smoke-build.mjs            # checks dist/
 *   node scripts/smoke-build.mjs dist-single
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(
  root,
  process.argv[2] ?? (process.env.SINGLE_FILE === "1" ? "dist-single" : "dist"),
);

if (!existsSync(target)) {
  console.error(`smoke: ${relative(root, target)} does not exist — run the build first.`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(target);
const read = (re) =>
  files.filter((f) => re.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");

const html = read(/\.html$/);
const js = read(/\.(js|html)$/); // single-file builds inline the script

const checks = [
  ["the page is titled", () => html.includes("<title>Recon Foundry</title>")],
  ["the CSP forbids outbound connections", () => html.includes("connect-src 'none'")],
  ["nothing is loaded from another host", () =>
    !/<(?:link|script|img|iframe|source)\b[^>]*\b(?:src|href)="https?:\/\//i.test(html)],
  ["the page says the data is synthetic", () => html.includes("State of Franklin")],
  ["the bundle is not empty", () => js.length > 500],
];

let failed = 0;
for (const [label, fn] of checks) {
  let ok = false;
  try {
    ok = Boolean(fn());
  } catch {
    ok = false;
  }
  if (!ok) {
    console.error(`smoke: FAILED — ${label}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(
    `\nsmoke: ${failed} of ${checks.length} checks failed against ${relative(root, target)}.`,
  );
  process.exit(1);
}

console.log(
  `smoke: ${checks.length} checks passed — ${files.length} file(s) in ${relative(root, target)}.`,
);
