# 0002 — The XLSX writer is hand-rolled, and stays small

**Status:** accepted · 2026-08-28

## Context

Recon Foundry has to produce workbooks — the reconciliation, the amortization
schedule, the tenant's account — because a training package made of HTML is not
the thing an auditor is sent. The obvious move is SheetJS, which the Red-Flag
Scanner already depends on for *reading* uploads.

## Decision

Write the `.xlsx` files here, in about three hundred lines across
`src/engine/zip/` and `src/engine/xlsx/`, supporting exactly: several sheets,
text and number cells, six cell formats, column widths, and a frozen header row.

## Why not SheetJS

**Determinism.** A workbook is a ZIP, and a ZIP written by a general-purpose
library carries the current time in every entry header and deflate streams whose
bytes depend on the library's version. Both make a byte-level golden test
impossible, and byte-level goldens are the whole point of ADR 0001: forge twice
from a seed, get the same file. Storing entries uncompressed with a fixed
timestamp, in sorted filename order, removes every source of drift there is.

**Direction of use.** The scanner *reads* arbitrary workbooks people upload, which
is a genuinely hard problem worth a library. Recon Foundry *writes* workbooks it
designed itself, which is not.

**The family's fourth non-negotiable.** Prefer twenty lines of code to a package.
Three hundred is more than twenty, but it is code we can read in an afternoon,
with no supply chain behind it, in an app whose entire claim is that nothing
leaves the browser.

## The scope guard

The feature list above is the decision, not a starting point. Merged cells,
charts, formulas, conditional formatting, images, defined names, data
validation — none of these are supported, and the day one is genuinely needed is
the day this ADR is revisited, not the day the writer quietly grows a branch.
`S` in `writer.ts` has six entries for the same reason.

Two omissions are worth calling out because they look like laziness:

**No shared-string table.** Strings are written inline. A shared-string table is
built in encounter order, so its contents depend on the order the renderer
happened to visit cells — reorder a column and every string index moves, and the
golden hash flaps for no reason. Inline strings cost a few kilobytes.

**Dates as text.** Excel stores a date as a day count from an epoch containing a
famous off-by-one, and converting to it correctly requires knowing the timezone
of the machine doing the conversion — which this engine is forbidden to know.
Dates are written as the strings a reader wants to see anyway, and the scanner's
parser reads amounts, never dates.

## Consequences

Verified, not assumed: SheetJS opens every workbook this writer produces without
a repair prompt, and the scanner's own `parse.ts` reads the ReconciliationSummary
tab correctly — header row detected, one amount column per year, the tenant
column ignored, every line's bucket right. Both were checked against the sibling
repo's installed copy during M3.

The cost is that a real Excel — as opposed to two independent readers of the
format — is still a manual check, recorded in the milestone rather than
automated. If Excel ever demands a part this writer omits, the fix is to add
that part minimally and record it here.
