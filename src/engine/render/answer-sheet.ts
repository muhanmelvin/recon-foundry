/**
 * The answer sheet — what was wrong, what it cost, and where on the paper it
 * shows.
 *
 * Written for a trainer to hand out after the exercise, so it is arranged the
 * way a debrief goes: the finding first, then the arithmetic, then the two or
 * three documents you would have had to put side by side to see it. Every
 * finding carries its evidence list for that reason; "the landlord overcharged
 * $2,400" teaches nothing without "and here is the pair of pages that proves it".
 *
 * The distinction the sheet makes most loudly is between findings the Red-Flag
 * Scanner would raise and findings only the documents reveal. A trainee who
 * learns that a scanner catches everything has learned something false.
 */

import type { AnswerKey, YearTruth } from "../model/answer-key.ts";
import type { ScenarioModel } from "../model/types.ts";
import { TIE_STATEMENTS, TIE_TITLES } from "../model/ties.ts";
import { esc, htmlDocument, pct, rows, usd } from "./html.ts";
import { ANSWER_KEY_FOLDER, termDocumentName } from "../package/filenames.ts";
import { SYNTHETIC_NOTICE, type Artifact } from "./artifact.ts";

function yearLabel(y: number | [number, number]): string {
  return Array.isArray(y) ? `${y[0]}–${y[1]}` : String(y);
}

function truthRows(t: YearTruth): Array<{ label: string; value: string }> {
  return [
    { label: "Property-level total, as billed", value: usd(t.pool_billed) },
    { label: "Property-level total, as the lease requires", value: usd(t.pool_correct) },
    { label: "Controllable pool, as presented", value: usd(t.controllable_billed) },
    { label: "Controllable pool, correctly classified", value: usd(t.controllable_correct) },
    { label: "Cap ceiling under the lease", value: t.cap_ceiling_correct === null ? "—" : usd(t.cap_ceiling_correct) },
    { label: "Ceiling the landlord stated", value: t.cap_stated_by_landlord === null ? "—" : usd(t.cap_stated_by_landlord) },
    { label: "Payable for the capped pool", value: usd(t.cap_payable_correct) },
    { label: "Billed for the capped pool", value: usd(t.cap_billed) },
    { label: "Management fee, as billed", value: usd(t.fee_billed) },
    { label: "Management fee the lease permits", value: usd(t.fee_correct) },
    { label: "Real estate taxes, as billed", value: usd(t.tax_billed) },
    { label: "Real estate taxes, net of credits", value: usd(t.tax_correct) },
    { label: "Capital recovered this year, as billed", value: usd(t.capital_billed) },
    { label: "Capital recoverable this year", value: usd(t.capital_correct) },
    { label: "Charged to the tenant", value: usd(t.tenant_billed) },
    { label: "Correctly chargeable to the tenant", value: usd(t.tenant_correct) },
    { label: "Overcharge", value: usd(t.tenant_excess) },
  ];
}

export function renderAnswerSheet(model: ScenarioModel, key: AnswerKey): Artifact {
  const u = model.universe;
  const clean = key.findings.length === 0;

  const findingCards = key.findings
    .map((f) => {
      const visible = f.check_id !== null && f.scanner_visible !== false;
      const chip = visible
        ? `<span class="stamp">The scanner catches this — ${esc(f.check_id!)}</span>`
        : `<span class="stamp">Only the paper catches this</span>`;
      return (
        `<div class="callout"><h3>${esc(f.category)} · ${yearLabel(f.year)} · ${esc(f.severity)}</h3>` +
        `<p>${chip}</p>` +
        `<p>${esc(f.seam)}</p>` +
        (f.note ? `<p class="small">${esc(f.note)}</p>` : "") +
        (f.expected_impact_range
          ? `<p class="small">At the tenant's share, roughly $${f.expected_impact_range[0].toLocaleString("en-US")}–$${f.expected_impact_range[1].toLocaleString("en-US")}.</p>`
          : "") +
        `<p class="small"><strong>Where to look</strong></p><ul class="small">` +
        f.evidence.map((e) => `<li>${esc(e)}</li>`).join("") +
        `</ul>` +
        (f.cofires?.length
          ? `<p class="small">Expect ${f.cofires.map((c) => esc(c)).join(", ")} to fire alongside it — consequences of the same act, not separate charges.</p>`
          : "") +
        `</div>`
      );
    })
    .join("");

  const page =
    `<div class="page">` +
    `<h1>Answer key — ${esc(u.property_name)}</h1>` +
    `<p class="small">${esc(u.tenant_name)} · ${esc(u.premises_suite)} · site ${esc(u.site_code)} · seed <strong>${esc(key.seed)}</strong></p>` +
    `<p><span class="stamp">Delete this folder before handing the package out</span></p>` +
    (clean
      ? `<h2>Nothing is wrong with this package</h2>` +
        `<p>Every one of the seven ties holds to the cent, and the Red-Flag Scanner finds nothing in it at all — no swing worth asking about, no round figure, no repeated amount, no fee on a base the lease does not permit. That is the exercise: a package can foot perfectly and still be the one you have to be able to sign off on.</p>`
      : `<h2>${key.findings.length} finding${key.findings.length === 1 ? "" : "s"}, worth ${usd(key.total_planted_tenant_impact_cents)} to the tenant</h2>` +
        findingCards) +
    `<h2>The seven ties</h2><p class="small">Where each pair of documents must agree, and which ones this package breaks.</p>` +
    `<table><thead><tr><th>Tie</th><th>What it says</th><th>Holds?</th></tr></thead><tbody>` +
    (Object.keys(TIE_TITLES) as Array<keyof typeof TIE_TITLES>)
      .map((tie) => {
        const broken = model.planted.some((p) => p.seams.includes(tie));
        return `<tr><td><strong>${esc(tie)}</strong> ${esc(TIE_TITLES[tie])}</td><td class="small">${esc(TIE_STATEMENTS[tie])}</td><td>${broken ? "<strong>broken</strong>" : "holds"}</td></tr>`;
      })
      .join("") +
    `</tbody></table>` +
    `<h2>Property</h2><dl class="facts">` +
    rows([
      { label: "Premises", value: `${model.lease.premises_sf.toLocaleString("en-US")} sf` },
      { label: "Gross leasable area", value: `${model.lease.denominator_sf.toLocaleString("en-US")} sf` },
      { label: "Proportionate share", value: pct(model.lease.share_pct) },
      { label: "Cap", value: model.lease.cap ? `${model.lease.cap.pct}% a year on controllables, measured against the amount payable` : "none" },
      { label: "Management fee", value: `${model.lease.fee.rate_pct}% of ${model.lease.fee.base.replace(/_/g, " ")}` },
      { label: "Capital threshold", value: usd(model.lease.capital_threshold_cents) },
      { label: "Capital life", value: `${model.lease.capital_life_years} years` },
    ]) +
    `</dl>` +
    model.years
      .map(
        (y) =>
          `<h2>${y.year} — billed against the lease</h2><dl class="facts">${rows(truthRows(key.ledger[y.year]!))}</dl>`,
      )
      .join("") +
    `<p class="notice">${esc(SYNTHETIC_NOTICE)}</p>` +
    `</div>`;

  const lastYear = model.years[model.years.length - 1]!.year;
  return {
    filename: `${ANSWER_KEY_FOLDER}/${termDocumentName(u.site_code, "Answer Key", model.delivery[lastYear]!, "html")}`,
    kind: "html",
    title: "Answer key",
    year: null,
    bytes: htmlDocument({ title: `Answer key — ${u.property_name}` }, page),
  };
}
