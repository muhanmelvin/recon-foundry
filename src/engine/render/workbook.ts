/**
 * The reconciliation workbook — the document the whole audit starts from.
 *
 * Four tabs, in the order a landlord's analyst builds them: the summary that
 * gets sent, the general-ledger detail that backs it, the cap computation that
 * bridges actual cost to billed cost, and the tenant's payment history for the
 * year.
 *
 * The ReconciliationSummary tab has a second job. It has to be readable by the
 * Red-Flag Scanner's uploader, which is not a general spreadsheet reader: it
 * looks in the first ten rows for the row carrying the most year-like cells,
 * takes that as the header, and reads a label column plus one amount column per
 * year. Three consequences shape the layout below and none of them are obvious:
 *
 * - The letterhead block is five rows, not ten. Push the header row down and the
 *   scanner finds nothing.
 * - No column outside the amount columns may have a four-digit year in its
 *   header, or the parser sees two columns claiming the same year and refuses
 *   the file. That is why the tenant column is headed "Tenant share of expense".
 * - The parser skips a row whose label begins with *total* or *tenant*, and
 *   treats a label with no amounts as a section heading. Every summary row below
 *   the expense lines is therefore worded to begin with one of those two words —
 *   which is how a real statement words them anyway, and means the cap ladder
 *   and the balance-due block are never mistaken for expenses.
 */

import type { ModelYear, ScenarioModel } from "../model/types.ts";
import { amortizationForYear } from "../scanner-rules.ts";
import { longDate, shortDate } from "../dates.ts";
import {
  blank,
  count,
  header,
  money,
  muted,
  percent,
  S,
  text,
  writeWorkbook,
  type Cell,
  type SheetSpec,
} from "../xlsx/writer.ts";
import { documentName, termDocumentName } from "../package/filenames.ts";
import { SYNTHETIC_NOTICE, type Artifact } from "./artifact.ts";

const SECTION_ORDER = ["CAM", "Taxes", "Insurance", "Fees"] as const;

function bucketLabel(b: "controllable" | "non_controllable"): string {
  return b === "controllable" ? "Controllable" : "Non-controllable";
}

function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

function mulRate(cents: number, rate: number): number {
  return Math.round(Math.abs(cents) * rate + 1e-9) * (cents < 0 ? -1 : 1);
}

// ---------------------------------------------------------------------------
// Tab 1 — ReconciliationSummary
// ---------------------------------------------------------------------------

function summarySheet(model: ScenarioModel, reconYear: number): SheetSpec {
  const u = model.universe;
  const shown = model.years.filter((y) => y.year <= reconYear);
  const current = shown[shown.length - 1]!;
  const shareFrac = model.lease.share_pct / 100;
  const delivered = model.delivery[reconYear]!;

  const rows: Cell[][] = [
    [text(u.property_name, S.header), blank(), blank(), blank(), text(`Property ${u.property_code}`)],
    [text(`Operating expense reconciliation for the year ended December 31`, S.header)],
    [text(`${u.tenant_name} · ${u.premises_suite} · account ${u.tenant_ledger_account} · site ${u.site_code}`)],
    [text(`Prepared by ${u.management_agent} · delivered ${longDate(delivered)}`)],
    [blank()],
    [
      header("Line item"),
      header("Section"),
      header("Classification"),
      ...shown.map((y) => ({ kind: "number" as const, value: String(y.year), style: S.header })),
      header("Tenant share of expense"),
    ],
  ];

  /**
   * The prior-year figure for a line. An amortization line is looked up by its
   * project rather than by its caption, because the caption carries the year of
   * the schedule it is on — "yr 5 of 10" — and would otherwise find nothing in
   * the earlier columns. A row that appears only in the last column reads to any
   * reader, and to the scanner, as a charge that arrived this year.
   */
  const amountsFor = (line: { category: string; capital_project_id?: string }, y: ModelYear): number | null => {
    const p = line.capital_project_id
      ? y.pools.find((x) => x.capital_project_id === line.capital_project_id)
      : y.pools.find((x) => x.category === line.category);
    return p ? p.amount_cents : null;
  };

  for (const section of SECTION_ORDER) {
    const lines = current.pools.filter((p) => p.section === section);
    if (lines.length === 0) continue;
    for (const p of lines) {
      rows.push([
        text(p.category),
        text(p.section),
        text(bucketLabel(p.bucket)),
        ...shown.map((y) => {
          const v = amountsFor(p, y);
          return v === null ? blank(S.money) : money(v);
        }),
        money(mulRate(p.amount_cents, shareFrac)),
      ]);
    }
    const sectionTotals = shown.map((y) => sum(y.pools.filter((p) => p.section === section).map((p) => p.amount_cents)));
    rows.push([
      text(`Total ${section}`, S.header),
      blank(),
      blank(),
      ...sectionTotals.map((v) => money(v, S.moneyTotal)),
      money(mulRate(sectionTotals[sectionTotals.length - 1]!, shareFrac), S.moneyTotal),
    ]);
  }

  rows.push([
    text("Total operating expenses — property", S.header),
    blank(),
    blank(),
    ...shown.map((y) => money(y.recon.pool_total_cents, S.moneyTotal)),
    money(mulRate(current.recon.pool_total_cents, shareFrac), S.moneyTotal),
  ]);

  rows.push([blank()]);
  if (model.lease.cap) {
    rows.push([text("Controllable costs are subject to the lease cap; the computation is on the CAP Calc tab.")]);
    rows.push([
      text("Total controllable costs as billed after the cap", S.header),
      blank(),
      blank(),
      ...shown.map((y) => money(y.recon.cap_billed_cents, S.moneyTotal)),
      money(mulRate(current.recon.cap_billed_cents, shareFrac), S.moneyTotal),
    ]);
    rows.push([
      text("Total billed to all tenants after the cap", S.header),
      blank(),
      blank(),
      ...shown.map((y) => money(y.recon.billed_pool_cents, S.moneyTotal)),
      blank(S.money),
    ]);
  }

  rows.push([blank()]);
  rows.push([text("Tenant's premises", S.header), blank(), blank(), count(model.lease.premises_sf)]);
  rows.push([text("Tenant's denominator — gross leasable area", S.header), blank(), blank(), count(current.denominator_sf)]);
  rows.push([text("Tenant's proportionate share", S.header), blank(), blank(), percent(model.lease.share_pct)]);
  rows.push([
    text("Tenant's share of the reconciled pool", S.header),
    blank(),
    blank(),
    money(current.recon.tenant_total_cents, S.moneyTotal),
  ]);
  rows.push([text("Tenant estimates paid during the year", S.header), blank(), blank(), money(current.recon.estimates_paid_cents)]);
  rows.push([
    text(current.recon.balance_due_cents >= 0 ? "Tenant balance due" : "Tenant credit due", S.header),
    blank(),
    blank(),
    money(current.recon.balance_due_cents, S.moneyTotal),
  ]);

  rows.push([blank()]);
  rows.push([muted(SYNTHETIC_NOTICE)]);

  return {
    name: "ReconciliationSummary",
    rows,
    widths: [42, 12, 16, ...shown.map(() => 15), 20],
    freezeRows: 6,
  };
}

// ---------------------------------------------------------------------------
// Tab 2 — GL Detail
// ---------------------------------------------------------------------------

function glSheet(model: ScenarioModel, year: ModelYear): SheetSpec {
  const rows: Cell[][] = [
    [text(`${model.universe.property_name} — general ledger detail, ${year.year}`, S.header)],
    [text(`Property ${model.universe.property_code} · operating expense accounts only`)],
    [blank()],
    [header("Period"), header("Date"), header("Account"), header("Account name"), header("Vendor"), header("Memo"), header("Amount")],
  ];

  const categories = year.pools.map((p) => p.category);
  for (const category of categories) {
    const entries = year.gl.filter((g) => g.category === category);
    if (entries.length === 0) continue;
    for (const g of entries) {
      rows.push([
        text(g.date.slice(0, 7)),
        text(shortDate(g.date)),
        text(g.account),
        text(g.category),
        text(g.vendor),
        text(g.memo),
        money(g.amount_cents),
      ]);
    }
    rows.push([
      blank(),
      blank(),
      blank(),
      text(`Total ${category}`, S.header),
      blank(),
      blank(),
      money(sum(entries.map((e) => e.amount_cents)), S.moneyTotal),
    ]);
  }

  rows.push([
    blank(),
    blank(),
    blank(),
    text("Total operating expenses", S.header),
    blank(),
    blank(),
    money(sum(year.gl.map((g) => g.amount_cents)), S.moneyTotal),
  ]);
  rows.push([blank()]);
  rows.push([muted(SYNTHETIC_NOTICE)]);

  return { name: "GL Detail", rows, widths: [10, 12, 10, 34, 32, 46, 15], freezeRows: 4 };
}

// ---------------------------------------------------------------------------
// Tab 3 — CAP Calc
// ---------------------------------------------------------------------------

function capSheet(model: ScenarioModel, reconYear: number): SheetSpec | null {
  const cap = model.lease.cap;
  if (!cap) return null;
  const shown = model.years.filter((y) => y.year <= reconYear);

  const rows: Cell[][] = [
    [text(`${model.universe.property_name} — controllable cost cap`, S.header)],
    [text(`Lease: ${cap.pct}% per year, measured against the amount payable the prior year. The fee is outside the capped pool.`)],
    [text(`Base year ${cap.base_year}`), blank(), money(cap.base_year_amount_cents)],
    [blank()],
    [
      header("Year"),
      header("Controllable actual"),
      header("Prior year payable"),
      header("Ceiling"),
      header("Lesser of actual and ceiling"),
      header("Billed"),
      header("Difference"),
    ],
  ];

  let prior = cap.base_year_amount_cents;
  for (const y of shown) {
    const ceiling = y.recon.cap_allowed_cents;
    const payable = ceiling === null ? y.recon.controllable_actual_cents : Math.min(y.recon.controllable_actual_cents, ceiling);
    rows.push([
      count(y.year),
      money(y.recon.controllable_actual_cents),
      money(prior),
      ceiling === null ? text("— base year") : money(ceiling),
      money(payable),
      money(y.recon.cap_billed_cents),
      money(y.recon.cap_billed_cents - payable),
    ]);
    prior = y.recon.cap_billed_cents;
  }

  rows.push([blank()]);
  rows.push([muted(SYNTHETIC_NOTICE)]);

  return { name: "CAP Calc", rows, widths: [10, 20, 20, 18, 26, 18, 15], freezeRows: 5 };
}

// ---------------------------------------------------------------------------
// Tab 4 — Payment History
// ---------------------------------------------------------------------------

function paymentSheet(model: ScenarioModel, year: ModelYear): SheetSpec {
  const rows: Cell[][] = [
    [text(`${model.universe.tenant_name} — payment history, ${year.year}`, S.header)],
    [text(`Account ${model.universe.tenant_ledger_account}`)],
    [blank()],
    [header("Date"), header("Description"), header("Charge"), header("Payment"), header("Balance")],
  ];

  const inYear = model.ledger.filter((e) => e.period.startsWith(String(year.year)));
  for (const e of inYear) {
    rows.push([
      text(shortDate(e.date)),
      text(e.description),
      e.charge_cents === 0 ? blank(S.money) : money(e.charge_cents),
      e.payment_cents === 0 ? blank(S.money) : money(e.payment_cents),
      money(e.balance_cents),
    ]);
  }

  const estimates = sum(inYear.filter((e) => e.code === "EST").map((e) => e.charge_cents));
  rows.push([blank(), text(`Total operating expense estimates charged in ${year.year}`, S.header), money(estimates, S.moneyTotal), blank(), blank()]);
  rows.push([blank()]);
  rows.push([muted(SYNTHETIC_NOTICE)]);

  return { name: "Payment History", rows, widths: [12, 52, 15, 15, 15], freezeRows: 4 };
}

// ---------------------------------------------------------------------------

export function renderReconWorkbook(model: ScenarioModel, reconYear: number): Artifact {
  const year = model.years.find((y) => y.year === reconYear);
  if (!year) throw new Error(`no reconciliation year ${reconYear} in this scenario`);

  const sheets: SheetSpec[] = [summarySheet(model, reconYear), glSheet(model, year)];
  const cap = capSheet(model, reconYear);
  if (cap) sheets.push(cap);
  sheets.push(paymentSheet(model, year));

  return {
    filename: documentName(model.universe.site_code, reconYear, "Recon Workbook", model.delivery[reconYear]!, "xlsx"),
    kind: "xlsx",
    title: `${reconYear} reconciliation workbook`,
    year: reconYear,
    bytes: writeWorkbook(sheets, {
      title: `${model.universe.property_name} — ${reconYear} operating expense reconciliation`,
      description: SYNTHETIC_NOTICE,
    }),
  };
}

/** The amortization schedule, as its own workbook — which is how it arrives. */
export function renderAmortizationWorkbook(model: ScenarioModel, reconYear: number): Artifact {
  const rows: Cell[][] = [
    [text(`${model.universe.property_name} — capital amortization schedule`, S.header)],
    [text(`Property ${model.universe.property_code} · as at December 31, ${reconYear}`)],
    [blank()],
    [
      header("Property"),
      header("Asset name"),
      header("Asset type"),
      header("Job #"),
      header("Recovery period (months)"),
      header("Amortization start"),
      header("Amortization end"),
      header("Total project cost"),
      header("Monthly principal"),
      header("Interest rate"),
      header(`${reconYear} months`),
      header(`${reconYear} principal`),
      header(`${reconYear} interest`),
      header(`${reconYear} year total`),
    ],
  ];

  for (const p of model.capital_projects) {
    if (!p.amortized) continue;
    const s = amortizationForYear(p.total_cost_cents, p.recovery_period_months, p.amort_start, reconYear, p.interest_rate_pct);
    rows.push([
      text(model.universe.property_name),
      text(p.asset_name),
      text(p.asset_type),
      text(p.job_number),
      count(p.recovery_period_months),
      text(shortDate(p.amort_start)),
      text(shortDate(p.amort_end)),
      money(p.total_cost_cents),
      money(p.monthly_cents),
      percent(p.interest_rate_pct),
      count(s.months),
      money(s.principal),
      money(s.interest),
      money(s.total, S.moneyTotal),
    ]);
  }

  const amortized = model.capital_projects.filter((p) => p.amortized);
  if (amortized.length === 0) {
    rows.push([text("No capital project is amortizing in this year.")]);
  }

  rows.push([blank()]);
  rows.push([muted(SYNTHETIC_NOTICE)]);

  return {
    filename: documentName(model.universe.site_code, reconYear, "Amortization Schedule", model.delivery[reconYear]!, "xlsx"),
    kind: "xlsx",
    title: `${reconYear} amortization schedule`,
    year: reconYear,
    bytes: writeWorkbook([{ name: "Amortization", rows, widths: [30, 38, 16, 14, 24, 20, 20, 20, 20, 14, 14, 18, 18, 20], freezeRows: 4 }], {
      title: `${model.universe.property_name} — capital amortization schedule`,
      description: SYNTHETIC_NOTICE,
    }),
  };
}

/** The tenant's account for the whole term, which is a separate document again. */
export function renderTenantLedger(model: ScenarioModel): Artifact {
  const u = model.universe;
  const rows: Cell[][] = [
    [text(`${u.tenant_name} — tenant account detail`, S.header)],
    [text(`${u.property_name} · account ${u.tenant_ledger_account} · ${u.premises_suite}`)],
    [blank()],
    [header("Date"), header("Period"), header("Code"), header("Description"), header("Charges"), header("Payments"), header("Balance")],
  ];

  for (const e of model.ledger) {
    rows.push([
      text(shortDate(e.date)),
      text(e.period),
      text(e.code),
      text(e.description),
      e.charge_cents === 0 ? blank(S.money) : money(e.charge_cents),
      e.payment_cents === 0 ? blank(S.money) : money(e.payment_cents),
      money(e.balance_cents),
    ]);
  }

  rows.push([blank()]);
  rows.push([muted(SYNTHETIC_NOTICE)]);

  const lastYear = model.years[model.years.length - 1]!.year;
  return {
    filename: termDocumentName(u.site_code, "Tenant Ledger", model.delivery[lastYear]!, "xlsx"),
    kind: "xlsx",
    title: "Tenant account detail",
    year: null,
    bytes: writeWorkbook([{ name: "Tenant Ledger", rows, widths: [12, 12, 8, 52, 15, 15, 15], freezeRows: 4 }], {
      title: `${u.tenant_name} — tenant account detail`,
      description: SYNTHETIC_NOTICE,
    }),
  };
}
