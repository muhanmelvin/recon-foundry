/**
 * The paper that arrives with the workbook: the billing statement, the tax
 * bills and the collector's account, the insurance invoice and declaration
 * page, the contractor's invoice, and the lease.
 *
 * These are the documents an audit is actually done from. The workbook says the
 * real-estate-tax line is $254,022.22; only the collector's account says whether
 * that is what the county actually charged, and whether any of it came back. A
 * package that is only a spreadsheet cannot teach the one skill the job is made
 * of, which is putting two documents side by side.
 *
 * Every renderer is a pure function of the model. None of them knows a scheme
 * exists — which is exactly what makes a planted overcharge hold together: the
 * landlord's own paperwork agrees with itself everywhere except the seam.
 */

import type { ScenarioModel, TaxParcel } from "../model/types.ts";
import { longDate, monthName, shortDate } from "../dates.ts";
import { amortizationForYear } from "../scanner-rules.ts";
import { buildLeaseDoc, sectionsOf, type LeaseArticle, type LeaseDoc } from "./lease/doc.ts";
import { anchorFor } from "./lease/sections.ts";
import { esc, htmlDocument, pct, rows, usd } from "./html.ts";
import { documentName, termDocumentName } from "../package/filenames.ts";
import { SYNTHETIC_NOTICE, type Artifact } from "./artifact.ts";

function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

function mulRate(cents: number, rate: number): number {
  return Math.round(Math.abs(cents) * rate + 1e-9) * (cents < 0 ? -1 : 1);
}

function notice(): string {
  return `<p class="notice">${esc(SYNTHETIC_NOTICE)}</p>`;
}

function letterhead(who: string, sub: string, meta: string[]): string {
  return (
    `<div class="letterhead"><div><div class="who">${esc(who)}</div><div class="sub">${esc(sub)}</div></div>` +
    `<div class="meta">${meta.map((m) => esc(m)).join("<br>")}</div></div>`
  );
}

// ---------------------------------------------------------------------------
// The billing statement
// ---------------------------------------------------------------------------

export function renderBillingStatement(model: ScenarioModel, year: number): Artifact {
  const y = model.years.find((x) => x.year === year);
  if (!y) throw new Error(`no reconciliation year ${year}`);
  const u = model.universe;
  const shareFrac = model.lease.share_pct / 100;
  const delivered = model.delivery[year]!;
  const owes = y.recon.balance_due_cents >= 0;

  const sections = ["CAM", "Taxes", "Insurance", "Fees"] as const;
  let body = "";
  for (const section of sections) {
    const lines = y.pools.filter((p) => p.section === section);
    if (lines.length === 0) continue;
    const total = sum(lines.map((p) => p.amount_cents));
    body +=
      lines
        .map(
          (p) =>
            `<tr><td>${esc(p.category)}</td><td class="small">${p.bucket === "controllable" ? "Controllable" : "Non-controllable"}</td>` +
            `<td class="num">${usd(p.amount_cents)}</td><td class="num">${usd(mulRate(p.amount_cents, shareFrac))}</td></tr>`,
        )
        .join("") +
      `<tr class="sub"><td colspan="2">Total ${esc(section)}</td><td class="num">${usd(total)}</td><td class="num">${usd(mulRate(total, shareFrac))}</td></tr>`;
  }

  const capNote = model.lease.cap
    ? `<p class="small">Controllable Operating Expenses are subject to the ${pct(model.lease.cap.pct, 2)} annual cap in Section 6.02 of the Lease. ` +
      `Actual controllable costs for ${year} were ${usd(y.recon.controllable_actual_cents)}; the ceiling was ${usd(y.recon.cap_allowed_cents ?? 0)}; ` +
      `the amount billed to all tenants was ${usd(y.recon.cap_billed_cents)}. The computation is on the CAP Calc tab of the enclosed workbook.</p>`
    : "";

  const page =
    `<div class="page">` +
    letterhead(u.landlord_entity, `Managed by ${u.management_agent}`, [
      `${u.address.line1}`,
      `${u.address.city}, ${u.address.state_abbr} ${u.address.zip}`,
      `Property ${u.property_code}`,
      longDate(delivered),
    ]) +
    `<h1>Operating expense reconciliation — ${year}</h1>` +
    `<div class="addr"><div class="name">${esc(u.tenant_name)}</div>` +
    `<div>${esc(u.premises_suite)}, ${esc(u.property_name)}</div>` +
    `<div>${esc(u.address.line1)}, ${esc(u.address.city)}, ${esc(u.address.state_abbr)} ${esc(u.address.zip)}</div>` +
    `<div class="small">Account ${esc(u.tenant_ledger_account)} · Site ${esc(u.site_code)}</div></div>` +
    `<p>In accordance with Section 6.06 of the Lease, this statement reconciles Operating Expenses for the Lease Year ended December 31, ${year} against the estimates billed to Tenant during that year.</p>` +
    `<table><thead><tr><th>Operating expense</th><th>Class</th><th class="num">Property total</th><th class="num">Tenant's share</th></tr></thead>` +
    `<tbody>${body}` +
    `<tr class="total"><td colspan="2">Total operating expenses</td><td class="num">${usd(y.recon.billed_pool_cents)}</td><td class="num">${usd(y.recon.tenant_total_cents)}</td></tr>` +
    `</tbody></table>` +
    capNote +
    `<div class="cols"><div><h2>Tenant's share</h2><dl class="facts">` +
    rows([
      { label: "Premises", value: `${model.lease.premises_sf.toLocaleString("en-US")} sf` },
      { label: "Gross leasable area", value: `${y.denominator_sf.toLocaleString("en-US")} sf` },
      { label: "Proportionate share", value: pct(model.lease.share_pct) },
      { label: "Average occupancy", value: pct(y.occupancy_pct, 1) },
    ]) +
    `</dl></div><div><h2>Settlement</h2><dl class="facts">` +
    rows([
      { label: `Tenant's share of ${year} expenses`, value: usd(y.recon.tenant_total_cents) },
      { label: "Estimates billed and paid", value: usd(y.recon.estimates_paid_cents) },
      { label: `Monthly estimate for ${year}`, value: usd(y.estimate_monthly_cents) },
    ]) +
    `</dl></div></div>` +
    `<div class="callout"><div>${owes ? "Balance due" : "Credit due Tenant"}</div>` +
    `<div class="big">${usd(Math.abs(y.recon.balance_due_cents))}</div>` +
    `<div class="small">${
      owes
        ? `Payable within thirty (30) days of this statement. Remit to ${esc(u.landlord_entity)}, c/o ${esc(u.management_agent)}, referencing account ${esc(u.tenant_ledger_account)}.`
        : `Applied to Tenant's account within thirty (30) days of this statement.`
    }</div></div>` +
    `<p class="small">Enclosed: reconciliation workbook with general ledger detail; real estate tax bills and the collector's account; the insurance invoice and declaration page; the capital amortization schedule.</p>` +
    notice() +
    `</div>`;

  return {
    filename: documentName(u.site_code, year, "Billing Statement", delivered, "html"),
    kind: "html",
    title: `${year} billing statement`,
    year,
    bytes: htmlDocument({ title: `${u.property_name} — ${year} operating expense statement` }, page),
  };
}

// ---------------------------------------------------------------------------
// The tax backup: a bill per parcel, then the collector's account
// ---------------------------------------------------------------------------

function taxBillPage(model: ScenarioModel, parcel: TaxParcel, year: number): string {
  const u = model.universe;
  const py = parcel.years.find((x) => x.year === year);
  if (!py) return "";
  const total = sum(py.installments.map((i) => i.amount_cents));

  return (
    `<div class="page">` +
    letterhead(u.tax_collector, `${u.county}, State of ${u.address.state}`, [`Tax year ${year}`, `Parcel ${parcel.parcel_id}`, `Bill issued ${longDate(`${year}-02-14`)}`]) +
    `<h1>Real property tax bill — ${year}</h1>` +
    `<div class="addr"><div class="name">${esc(u.landlord_entity)}</div>` +
    `<div>${esc(u.property_name)} — ${esc(parcel.description)}</div>` +
    `<div>${esc(u.address.line1)}, ${esc(u.address.city)}, ${esc(u.address.state_abbr)} ${esc(u.address.zip)}</div></div>` +
    `<h2>Assessment</h2><dl class="facts">` +
    rows([
      { label: "Parcel number", value: parcel.parcel_id },
      { label: "Assessed value", value: usd(py.assessed_value_cents) },
      { label: "Tax rate per $100 of assessed value", value: `$${py.rate_per_100.toFixed(4)}` },
      { label: "Tax levied", value: usd(total) },
    ]) +
    `</dl>` +
    `<h2>Instalments</h2><table><thead><tr><th>Instalment</th><th>Due</th><th class="num">Amount</th></tr></thead><tbody>` +
    py.installments
      .map((i, n) => `<tr><td>${n + 1} of ${py.installments.length}</td><td>${esc(longDate(i.due))}</td><td class="num">${usd(i.amount_cents)}</td></tr>`)
      .join("") +
    `<tr class="total"><td colspan="2">Total ${year} tax</td><td class="num">${usd(total)}</td></tr>` +
    `</tbody></table>` +
    `<p class="small">Assessed value × rate ÷ 100 = tax levied. Payment after the due date accrues interest at one percent (1%) per month. An appeal of the assessment does not stay the obligation to pay; a refund, if granted, is credited to the account shown on the collector's account statement.</p>` +
    notice() +
    `</div>`
  );
}

export function renderTaxBackup(model: ScenarioModel, year: number): Artifact {
  const u = model.universe;
  const bills = model.tax_parcels.map((p) => taxBillPage(model, p, year)).join("");

  // The collector's account: every movement on the parcels in the year,
  // including a refund the county granted on an earlier assessment. It is the
  // only document that shows one, which is the whole point of it being here.
  const movements: Array<{ date: string; parcel: string; description: string; charge: number; credit: number }> = [];
  for (const parcel of model.tax_parcels) {
    const py = parcel.years.find((x) => x.year === year);
    if (!py) continue;
    py.installments.forEach((i, n) => {
      movements.push({ date: i.due, parcel: parcel.parcel_id, description: `${year} tax, instalment ${n + 1} of ${py.installments.length} — paid`, charge: i.amount_cents, credit: 0 });
    });
    if (py.credit) {
      movements.push({
        date: py.credit.granted,
        parcel: parcel.parcel_id,
        description: `Refund on appeal of ${py.credit.appeal_year} assessment — docket ${py.credit.docket}`,
        charge: 0,
        credit: py.credit.amount_cents,
      });
    }
  }
  movements.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const charged = sum(movements.map((m) => m.charge));
  const credited = sum(movements.map((m) => m.credit));

  const account =
    `<div class="page">` +
    letterhead(u.tax_collector, `${u.county} — taxpayer account statement`, [`Account of ${u.landlord_entity}`, `Activity for ${year}`, `Printed ${longDate(`${year + 1}-01-09`)}`]) +
    `<h1>Taxpayer account — ${year} activity</h1>` +
    `<p class="small">All movements on the parcels below during the calendar year, in the order they were posted. Refunds and abatements are shown as credits in the year they were granted, whatever year the assessment they relate to.</p>` +
    `<table><thead><tr><th>Date</th><th>Parcel</th><th>Description</th><th class="num">Charged</th><th class="num">Credited</th></tr></thead><tbody>` +
    movements
      .map(
        (m) =>
          `<tr><td>${esc(shortDate(m.date))}</td><td>${esc(m.parcel)}</td><td>${esc(m.description)}</td>` +
          `<td class="num">${m.charge ? usd(m.charge) : ""}</td><td class="num">${m.credit ? usd(m.credit) : ""}</td></tr>`,
      )
      .join("") +
    `<tr class="total"><td colspan="3">Totals for ${year}</td><td class="num">${usd(charged)}</td><td class="num">${usd(credited)}</td></tr>` +
    `<tr class="total"><td colspan="3">Net tax borne by the property in ${year}</td><td class="num">${usd(charged - credited)}</td><td class="num"></td></tr>` +
    `</tbody></table>` +
    notice() +
    `</div>`;

  return {
    filename: documentName(u.site_code, year, "RE Tax Backup", model.delivery[year]!, "html"),
    kind: "html",
    title: `${year} real estate tax backup`,
    year,
    bytes: htmlDocument({ title: `${u.property_name} — ${year} real estate tax backup` }, bills + account),
  };
}

// ---------------------------------------------------------------------------
// The insurance backup: an invoice and a declaration page
// ---------------------------------------------------------------------------

export function renderInsuranceBackup(model: ScenarioModel, year: number): Artifact {
  const u = model.universe;
  const p = model.insurance;
  const py = p.years.find((x) => x.year === year);
  if (!py) throw new Error(`no insurance year ${year}`);
  const start = `${year}-${String(p.period_start_month).padStart(2, "0")}-01`;

  const invoice =
    `<div class="page">` +
    letterhead(p.carrier, "Premium invoice", [`Policy ${p.policy_number}`, `Invoice ${py.invoice_number}`, longDate(start)]) +
    `<h1>Premium invoice — policy year ${year}</h1>` +
    `<div class="addr"><div class="name">${esc(u.landlord_entity)}</div><div>${esc(u.property_name)}</div>` +
    `<div>${esc(u.address.line1)}, ${esc(u.address.city)}, ${esc(u.address.state_abbr)} ${esc(u.address.zip)}</div></div>` +
    `<table><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>` +
    `<tr><td>Annual premium — commercial property and general liability, ${monthName(p.period_start_month)} ${year} to ${monthName(p.period_start_month)} ${year + 1}</td><td class="num">${usd(py.premium_cents)}</td></tr>` +
    `<tr><td>Policy fee and surplus lines tax</td><td class="num">${usd(py.fees_cents)}</td></tr>` +
    `<tr class="total"><td>Total due</td><td class="num">${usd(py.premium_cents + py.fees_cents)}</td></tr>` +
    `</tbody></table>` +
    `<p class="small">Premium is fully earned at inception. The declaration page overleaf states the coverages, limits and deductibles this premium buys.</p>` +
    notice() +
    `</div>`;

  const dec =
    `<div class="page">` +
    letterhead(p.carrier, "Declaration page", [`Policy ${p.policy_number}`, `${monthName(p.period_start_month)} ${year} — ${monthName(p.period_start_month)} ${year + 1}`]) +
    `<h1>Declarations — policy ${esc(p.policy_number)}</h1>` +
    `<div class="cols"><div><h2>Named insured</h2><p>${esc(u.landlord_entity)}<br>c/o ${esc(u.management_agent)}</p></div>` +
    `<div><h2>Location</h2><p>${esc(u.property_name)}<br>${esc(u.address.line1)}<br>${esc(u.address.city)}, ${esc(u.address.state_abbr)} ${esc(u.address.zip)}</p></div></div>` +
    `<h2>Coverages</h2><table><thead><tr><th>Coverage</th><th class="num">Limit</th><th class="num">Deductible</th></tr></thead><tbody>` +
    p.coverages
      .map((c) => `<tr><td>${esc(c.coverage)}</td><td class="num">${usd(c.limit_cents)}</td><td class="num">${c.deductible_cents ? usd(c.deductible_cents) : "—"}</td></tr>`)
      .join("") +
    `</tbody></table>` +
    `<h2>Premium</h2><dl class="facts">` +
    rows([
      { label: "Annual premium", value: usd(py.premium_cents) },
      { label: "Policy fee and surplus lines tax", value: usd(py.fees_cents) },
      { label: "Total", value: usd(py.premium_cents + py.fees_cents) },
    ]) +
    `</dl>` +
    notice() +
    `</div>`;

  return {
    filename: documentName(u.site_code, year, "Insurance Backup", model.delivery[year]!, "html"),
    kind: "html",
    title: `${year} insurance backup`,
    year,
    bytes: htmlDocument({ title: `${u.property_name} — ${year} insurance backup` }, invoice + dec),
  };
}

// ---------------------------------------------------------------------------
// The contractor's invoice behind the capital project
// ---------------------------------------------------------------------------

export function renderProjectBackup(model: ScenarioModel, year: number): Artifact | null {
  const project = model.capital_projects[0];
  if (!project) return null;
  const u = model.universe;
  const s = amortizationForYear(project.total_cost_cents, project.recovery_period_months, project.amort_start, year, project.interest_rate_pct);
  const inService = project.amort_start;

  const page =
    `<div class="page">` +
    letterhead(project.contractor, "General contractor", [`Invoice ${esc(project.job_number)}`, `Job ${esc(project.job_number)}`, longDate(inService)]) +
    `<h1>Final invoice — ${esc(project.asset_name)}</h1>` +
    `<div class="addr"><div class="name">${esc(u.landlord_entity)}</div><div>c/o ${esc(u.management_agent)}</div>` +
    `<div>${esc(u.property_name)}, ${esc(u.address.line1)}, ${esc(u.address.city)}, ${esc(u.address.state_abbr)} ${esc(u.address.zip)}</div></div>` +
    `<h2>The work</h2><dl class="facts">` +
    rows([
      { label: "Asset", value: project.asset_name },
      { label: "Asset type", value: project.asset_type },
      { label: "Job number", value: project.job_number },
      { label: "Substantially complete / placed in service", value: longDate(inService) },
      { label: "Total contract sum", value: usd(project.total_cost_cents) },
    ]) +
    `</dl>` +
    (project.amortized
      ? `<h2>Recovery under the Lease</h2><dl class="facts">` +
        rows([
          { label: "Recovery period", value: `${project.recovery_period_months} months (${project.recovery_period_months / 12} years)` },
          { label: "Interest on the unamortized balance", value: pct(project.interest_rate_pct, 2) },
          { label: "Monthly principal", value: usd(project.monthly_cents) },
          { label: `${year} — months in service`, value: String(s.months) },
          { label: `${year} — principal`, value: usd(s.principal) },
          { label: `${year} — interest`, value: usd(s.interest) },
          { label: `${year} — included in Operating Expenses`, value: usd(s.total) },
        ]) +
        `</dl><p class="small">Recovered in accordance with Section 6.04 of the Lease. The full schedule accompanies this invoice.</p>`
      : `<p class="small">Charged to the property's repairs and maintenance account in the year of the work.</p>`) +
    notice() +
    `</div>`;

  return {
    filename: documentName(u.site_code, year, "Project Backup", model.delivery[year]!, "html"),
    kind: "html",
    title: `${year} capital project backup`,
    year,
    bytes: htmlDocument({ title: `${project.asset_name} — contractor's invoice` }, page),
  };
}

// ---------------------------------------------------------------------------
// The lease
// ---------------------------------------------------------------------------

const RIDER_HEADING = "Rider — Additional Provisions";

/**
 * The contents page — every article and section, each a link to the clause.
 *
 * A lease this long is unusable without one, and here it does a second job: the
 * preview on the page shows these bytes inside a sandboxed iframe that nothing
 * outside can scroll or highlight. An in-document fragment link is the only
 * thing that still works in there, so the contents list is how a reader gets
 * from "the lease has a clause about that" to the clause itself.
 */
function tableOfContents(doc: LeaseDoc): string {
  const entry = (s: { ref: string; title: string }) =>
    `<li><a href="#${anchorFor(s.ref)}"><span class="ref">§${esc(s.ref)}</span><span>${esc(s.title)}</span></a></li>`;
  const group = (label: string, sections: LeaseArticle["sections"]) =>
    `<li class="art">${esc(label)}<ul>${sections.map(entry).join("")}</ul></li>`;

  const articles = doc.articles.map((a) => group(`Article ${a.numeral} — ${a.title}`, a.sections)).join("");
  const rider =
    doc.rider.length > 0
      ? `<li class="art">${esc(RIDER_HEADING)}</li>` + doc.rider.map((a) => group(`${a.numeral} — ${a.title}`, a.sections)).join("")
      : "";

  return `<nav class="toc" aria-label="Contents"><h2>Contents</h2><ul>${articles}${rider}</ul></nav>`;
}

export function renderLease(model: ScenarioModel): Artifact {
  const doc = buildLeaseDoc(model);
  const u = model.universe;

  const cover =
    `<div class="page"><div class="cover"><h1>${esc(doc.title)}</h1>` +
    `<p>between</p><p><strong>${esc(model.lease.landlord)}</strong><br>Landlord</p>` +
    `<p>and</p><p><strong>${esc(model.lease.tenant)}</strong><br>Tenant</p>` +
    `<p class="small">${esc(u.premises_suite)}, ${esc(u.property_name)}<br>${esc(u.address.line1)}, ${esc(u.address.city)}, ${esc(u.address.state)} ${esc(u.address.zip)}</p>` +
    `<p style="margin-top:36px"><span class="stamp">Synthetic — training only</span></p></div>` +
    tableOfContents(doc) +
    notice() +
    `</div>`;

  const clauses = (a: LeaseArticle) =>
    a.sections
      .map(
        (s) =>
          `<div class="sec${s.present ? "" : " silent"}" id="${anchorFor(s.ref)}">` +
          `<p><span class="ref">§${esc(s.ref)} ${esc(s.title)}.</span> ` +
          s.paragraphs.map((p) => esc(p)).join('</p><p style="margin-left:1.5em">') +
          `</p></div>`,
      )
      .join("");

  const body = doc.articles.map((a) => `<h2>Article ${esc(a.numeral)} — ${esc(a.title)}</h2>` + clauses(a)).join("");

  // The Rider rides after Article VII, never inside it: Articles I–VII are the
  // numbering the scanner's findings cite, and nothing optional may push a
  // citation along.
  const rider =
    doc.rider.length > 0
      ? `<h2>${esc(RIDER_HEADING)}</h2>` +
        doc.rider.map((a) => `<h2>${esc(a.numeral)} — ${esc(a.title)}</h2>` + clauses(a)).join("")
      : "";

  const pages = cover + `<div class="page">` + body + rider + notice() + `</div>`;
  const lastYear = model.years[model.years.length - 1]!.year;

  return {
    filename: termDocumentName(u.site_code, "Lease", model.delivery[lastYear]!, "html"),
    kind: "html",
    title: "Lease",
    year: null,
    bytes: htmlDocument({ title: doc.title, bodyClass: "lease" }, pages),
  };
}

/** Section text, for tests and for the answer key's citations. */
export function leaseSectionText(model: ScenarioModel, ref: string): string {
  const s = sectionsOf(buildLeaseDoc(model)).find((x) => x.ref === ref);
  return s ? s.paragraphs.join("\n\n") : "";
}
