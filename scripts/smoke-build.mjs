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
const css = read(/\.(css|html)$/);

const checks = [
  ["the page is titled", () => html.includes("<title>Recon Foundry</title>")],
  ["the CSP forbids outbound connections", () => html.includes("connect-src 'none'")],
  ["nothing is loaded from another host", () =>
    !/<(?:link|script|img|iframe|source)\b[^>]*\b(?:src|href)="https?:\/\//i.test(html)],
  ["the page says the data is synthetic", () => html.includes("State of Franklin")],

  // The engine actually shipped. A tree-shaken generator builds clean, passes
  // the gate and produces a blank page — the one failure no test run in node
  // can see.
  ["the generator reached the bundle", () => js.includes("9e3779b97f4a7c15")],
  ["the expense catalog reached the bundle", () =>
    ["Landscaping & grounds", "Snow removal", "Management fee"].every((s) => js.includes(s))],
  ["all five schemes reached the bundle", () =>
    ["unamortized_capital", "above_cap_billing", "fee_base_expansion", "bucket_migration", "kept_tax_refund"].every((s) =>
      js.includes(s),
    )],
  ["the seven ties reached the bundle", () =>
    js.includes("General ledger") && js.includes("Amortization schedule") && js.includes("Tax bills")],
  ["the workbook writer reached the bundle", () =>
    js.includes("spreadsheetml") && js.includes("[Content_Types].xml")],
  ["the lease's article numbering reached the bundle", () =>
    js.includes("Cap on Increases") && js.includes("Capital Items and Amortization")],
  ["the synthetic notice travels with every document", () =>
    js.includes("Every party, property and figure is fictional")],
  ["the answer key is hidden by default", () => js.includes("Training mode")],
  ["the package warns about its own answer key", () => js.includes("DELETE THAT FOLDER")],
  ["severity is carried by text, not only by colour", () => js.includes("Only the paper catches this")],

  // The theme
  ["dark mode survived the build", () => css.includes("prefers-color-scheme")],
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
