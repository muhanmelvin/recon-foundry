/**
 * The look of a document that arrives as paper.
 *
 * The billing statement, the tax bill, the declaration page and the lease are
 * PDFs in real life. This app has no PDF library and is not going to acquire
 * one, so they are printable HTML: letter-sized pages in a serif face, with the
 * stylesheet inlined into every file so that a page downloaded out of the ZIP
 * still looks right when it is opened on its own, offline, with nothing else
 * around it.
 *
 * There is no script in any of these files. Partly because the page's own
 * Content-Security-Policy would refuse it, and partly because a training
 * document that runs code is a strange object to hand somebody.
 */

const PAGE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { background: #f2f1ee; }
body {
  margin: 0;
  padding: 24px 12px;
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
  font-size: 11.5pt;
  line-height: 1.45;
  color: #14171a;
}
.page {
  width: 8.5in;
  min-height: 11in;
  max-width: 100%;
  margin: 0 auto 20px;
  padding: 0.85in 0.8in 0.7in;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.18);
}
.letterhead { border-bottom: 2px solid #14171a; padding-bottom: 10px; margin-bottom: 22px; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
.letterhead .who { font-size: 15pt; font-weight: 700; letter-spacing: .01em; }
.letterhead .sub { font-size: 9.5pt; color: #4a4f55; margin-top: 3px; }
.letterhead .meta { text-align: right; font-size: 9.5pt; color: #4a4f55; white-space: nowrap; }
h1 { font-size: 13pt; margin: 0 0 4px; letter-spacing: .02em; text-transform: uppercase; }
h2 { font-size: 11pt; margin: 22px 0 8px; letter-spacing: .04em; text-transform: uppercase; color: #33383e; }
h3 { font-size: 10.5pt; margin: 16px 0 6px; }
p { margin: 0 0 9px; }
.addr { margin: 0 0 18px; font-size: 10.5pt; }
.addr .name { font-weight: 700; }
.cols { display: flex; gap: 32px; flex-wrap: wrap; margin-bottom: 16px; }
.cols > div { flex: 1 1 220px; }
dl.facts { margin: 0; font-size: 10pt; }
dl.facts div { display: flex; gap: 8px; padding: 2px 0; border-bottom: 1px dotted #ccc7bd; }
dl.facts dt { color: #4a4f55; flex: 1 1 auto; }
dl.facts dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 8px 0 14px; }
th { text-align: left; font-size: 8.75pt; letter-spacing: .06em; text-transform: uppercase; color: #4a4f55; border-bottom: 1px solid #14171a; padding: 5px 6px; }
td { padding: 4px 6px; border-bottom: 1px solid #e5e1da; vertical-align: top; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr.total td { font-weight: 700; border-top: 1px solid #14171a; border-bottom: 2px solid #14171a; }
tr.sub td { font-weight: 700; background: #f6f4f0; }
.callout { border: 1px solid #14171a; padding: 10px 12px; margin: 14px 0; font-size: 10pt; }
.callout .big { font-size: 13pt; font-weight: 700; font-variant-numeric: tabular-nums; }
.small { font-size: 9pt; color: #4a4f55; }
.notice { margin-top: 28px; padding-top: 8px; border-top: 1px solid #ccc7bd; font-size: 8pt; color: #6d7278; }
.stamp { display: inline-block; border: 1.5px solid #8a2b2b; color: #8a2b2b; padding: 3px 9px; font-size: 9pt; letter-spacing: .09em; text-transform: uppercase; transform: rotate(-1.5deg); }
.lease h2 { text-align: center; text-transform: none; letter-spacing: 0; font-size: 11.5pt; margin-top: 26px; }
.lease .sec { margin: 0 0 12px; }
.lease .sec .ref { font-weight: 700; }
.lease .silent { color: #4a4f55; font-style: italic; }
.lease .cover { text-align: center; margin: 1.6in 0 0; }
.lease .cover h1 { font-size: 16pt; margin-bottom: 20px; }
@media print {
  html { background: #fff; }
  body { padding: 0; font-size: 10.5pt; }
  .page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  .page + .page { page-break-before: always; }
}
@page { size: letter; margin: 0.75in; }
`;

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Integer cents as $1,234.56 — the only money formatter these pages use. */
export function usd(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return (neg ? "-$" : "$") + Math.floor(abs / 100).toLocaleString("en-US") + "." + String(abs % 100).padStart(2, "0");
}

export function pct(n: number, decimals = 4): string {
  return `${Number(n.toFixed(decimals))}%`;
}

export interface PageOptions {
  title: string;
  /** Extra class on <body>, e.g. "lease". */
  bodyClass?: string;
}

/** Wraps finished page markup in a standalone file. */
export function htmlDocument(opts: PageOptions, body: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${esc(opts.title)}</title>\n<style>${PAGE_CSS}</style>\n</head>\n` +
    `<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>\n${body}\n</body>\n</html>\n`
  );
}

export function rows(cells: Array<{ label: string; value: string }>): string {
  return cells.map((c) => `<div><dt>${esc(c.label)}</dt><dd>${esc(c.value)}</dd></div>`).join("");
}
