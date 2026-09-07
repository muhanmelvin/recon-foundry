/**
 * The clause a visitor just added, lit where they can see it land.
 *
 * The rail beside the lease adds a clause and the whole package is forged
 * again, which redraws a seventeen-section lease with one new paragraph
 * somewhere inside it. Watching that happen is the point of the rail, and until
 * now there was nothing to watch: the new clause arrived below the fold of a
 * frame the page is not allowed to scroll.
 *
 * So the preview says where. Two marks, both from one injected rule: a wash
 * behind the clause itself, and the same wash on its line in the contents at
 * the top of the lease — which is where the frame opens, and the only
 * navigation a sandboxed frame still honours.
 *
 * **This is a preview, not a package.** The mark is injected into a copy of the
 * bytes on their way to the frame; `renderLease` never sees it, so the file the
 * visitor downloads and the copy inside the ZIP are the lease as forged, and no
 * pinned fixture can move. That separation is only free because the page builds
 * the preview and the artifact by two independent calls to the same pure
 * renderer — see `previewPanel` in `src/ui/main.ts`.
 */

import { anchorFor } from "./sections.ts";

/**
 * Paper colours. Every forged page declares `color-scheme: light` and prints on
 * white whatever the reader's system is set to, so the wash is a fixed pair
 * rather than something that follows the app's theme around.
 */
function highlightCss(id: string): string {
  return (
    `#${id}{background:#fdf1c4;box-shadow:0 0 0 7px #fdf1c4;border-radius:2px}` +
    `.toc a[href="#${id}"]{background:#fdf1c4;font-weight:700}`
  );
}

/**
 * `html` with the clause at `ref` lit, or `html` unchanged.
 *
 * Unchanged is the answer whenever the mark could not be honest: no clause
 * asked for, or a clause that is not in this lease — which is what a visitor
 * sees for the moment between unticking the highlighted clause and the rail
 * clearing it.
 */
export function litLease(html: string, ref: string | null): string {
  if (ref === null) return html;
  const id = anchorFor(ref);
  if (!html.includes(`id="${id}"`)) return html;
  const head = html.indexOf("</head>");
  if (head < 0) return html;
  return html.slice(0, head) + `<style>${highlightCss(id)}</style>\n` + html.slice(head);
}
