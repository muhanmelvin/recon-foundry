# Domain glossary

The words this project uses, in the sense it uses them. These are user-facing
terms — they appear in the interface, in the code and here, and they should mean
the same thing in all three. Nothing about implementation belongs in this file.

Terms below are shared across every app in the family; add the app's own
vocabulary underneath as it settles, and add it the moment it settles rather
than in a batch at the end.

## Shared vocabulary

**Operating expenses** — what the landlord spends running the property and
seeks to recover from tenants: common-area maintenance, real estate taxes,
insurance, utilities, and the fees charged on top of them.

**Reconciliation** — the landlord's year-end statement setting actual operating
expenses against what the tenant paid in estimates, and billing or crediting the
difference.

**Statement** — one year of that reconciliation as the landlord presented it:
expense lines under their own captions, the fees, and what was charged to the
tenant.

**Line** — one caption on a statement with an amount for a year.

**Controllable / non-controllable** — the landlord's classification of an
expense according to whether they can influence what it costs. Caps usually
apply only to controllables, which is why the boundary is worth money.

**Cap** — a contractual ceiling on how much a category of expense may grow. Its
reading depends on the base, the rate, whether unused headroom carries forward,
and whether the ceiling compounds.

**Pro-rata share** — the fraction of a property's expenses this tenant bears,
and the arithmetic that produces it.

**Gross-up** — restating variable expenses to what they would have cost at a
stated occupancy, so a partly-empty building does not shift cost onto the tenants
who are actually there.

**Amortization** — spreading a capital cost over its useful life instead of
charging it in the year it was incurred.

**Finding** — one thing worth raising: what it is, which year, the arithmetic
behind it, and a sentence written to go into a finding letter.

**Synthetic lease / synthetic property** — invented material used for every
public example. Never a real client's lease, site, or numbers.

## This app's vocabulary

**Package** — everything a landlord sends a tenant to support one year of
reconciliation, and everything the tenant's auditor works from: the workbook,
the billing statement, the tax and insurance backup, the amortization schedule,
the tenant's ledger, and the lease. Recon Foundry forges a whole package, not a
spreadsheet.

**Scenario** — one invented property, tenant, lease and package, for a run of
years. A scenario is fully determined by its seed and its shape; the same
scenario forged twice is the same bytes twice.

**Seed** — the word or phrase a scenario is grown from. Change the seed and you
get a different property with the same anatomy. Keep the seed and you can hand
the identical package to twenty trainees.

**Tie** — a named agreement between two documents that must hold to the cent:
the general ledger against the reconciliation, the reconciliation against the
billing statement, the tax bills against the real-estate-tax line. Seven of them
define what "the package is consistent" means.

**Seam** — the tie a scheme deliberately breaks. Everything else about that
scheme still ties, which is what makes it worth finding.

**Scheme** — one thing the invented landlord did wrong, planted on purpose:
capital expensed in a lump, billing above the cap, a management fee charged on a
base the lease does not permit, a controllable expense relabelled as
non-controllable, a tax refund kept. A package with no schemes is **clean**.

**Answer key** — the ground truth for a forged package: what was billed, what
was correct, which scheme caused the difference, which tie it broke, and where
in the paper to look. It travels in its own folder so a trainer can delete it.

**Training mode** — the answer key hidden, so the package can be worked the way
a real one is.

**Clean** — a package with no scheme planted: every tie holds, and the
Red-Flag Scanner finds nothing at all in it. That last part is a promise the
tests keep, not a hope.

**State of Franklin** — the state every forged property stands in. There isn't
one. It is how a document that otherwise looks entirely real announces that it
is not.

**Step** — one of the three stations a visitor moves through: **Forge** (choose
what the package is), **Read** (look at the documents it produced), **Take it
away** (download it, scan it, see the answers). Steps are not gates; the package
exists at every one of them, and any step can be reached from any other.

**Rider** — the clauses a visitor adds to the lease beyond its seven numbered
articles. Numbered R1 onward, after Article VII, so that the articles a finding
cites never move. A lease nobody added anything to has no Rider.

**Clause** — one selectable provision of the Rider. A clause restates what the
package already does and never contradicts it; ticking one changes the lease
and nothing else — no figure, no tie, no finding.

**Provenance** — for one document, what it was built from and which ties it has
to hold. It is what the page shows instead of pretending the forge takes time.
