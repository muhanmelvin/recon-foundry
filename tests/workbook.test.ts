/**
 * Two questions about the workbooks, answered separately.
 *
 * *Are the figures in them the model's figures?* — answered by reading the file
 * back through an independent parser (`tests/helpers/read-xlsx.ts`) and looking
 * for the model's own numbers in the grid. A golden hash cannot answer this: it
 * proves the bytes have not changed, not that they were ever right.
 *
 * *Will the Red-Flag Scanner's uploader be able to read the summary tab?* —
 * answered by pinning the three layout facts its parser depends on. The real
 * answer comes at milestone M5b, when a forged workbook is put through the
 * scanner's own `parse.ts`; these are the tripwires that catch a layout change
 * before it gets that far.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildCleanModel } from "../src/engine/model/clean.ts";
import { renderAmortizationWorkbook, renderReconWorkbook, renderTenantLedger } from "../src/engine/render/workbook.ts";
import { amortizationForYear } from "../src/engine/scanner-rules.ts";
import { SYNTHETIC_NOTICE } from "../src/engine/render/artifact.ts";
import { centsOf, readWorkbook } from "./helpers/read-xlsx.ts";
import { GOLDEN_CONFIGS } from "./helpers/sweep.ts";

const MODEL = buildCleanModel(GOLDEN_CONFIGS[0]!);
const YEAR = MODEL.years[MODEL.years.length - 1]!;
const RECON = renderReconWorkbook(MODEL, YEAR.year);
const BOOK = readWorkbook(RECON.bytes as Uint8Array);

function findRow(grid: string[][], label: string): string[] | undefined {
  return grid.find((r) => r[0] === label);
}

describe("the workbook is a workbook", () => {
  it("carries the parts a reader needs and nothing else", () => {
    expect(BOOK.parts).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/app.xml",
      "docProps/core.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
      "xl/worksheets/sheet4.xml",
    ]);
  });

  it("has the four tabs an analyst builds", () => {
    expect(BOOK.sheetNames).toEqual(["ReconciliationSummary", "GL Detail", "CAP Calc", "Payment History"]);
  });

  it("says in its own properties that it is synthetic", () => {
    expect(BOOK.core).toContain("Recon Foundry");
    expect(BOOK.core).toContain(SYNTHETIC_NOTICE);
    // Fixed timestamps, not the clock: two forges of the same seed are the same file.
    expect(BOOK.core).toContain("2026-01-01T00:00:00Z");
  });
});

describe("the figures in the file are the figures in the model", () => {
  const summary = BOOK.sheets["ReconciliationSummary"]!;

  it("bills every pool line at the model's amount", () => {
    const amountCol = 3 + MODEL.years.length - 1; // label, section, classification, then one column per year
    for (const p of YEAR.pools) {
      const row = findRow(summary, p.category);
      expect(row, `${p.category} is missing from the summary`).toBeDefined();
      expect(centsOf(row![amountCol]), p.category).toBe(p.amount_cents);
    }
  });

  it("shows the balance due the model computed", () => {
    const label = YEAR.recon.balance_due_cents >= 0 ? "Tenant balance due" : "Tenant credit due";
    expect(centsOf(findRow(summary, label)![3])).toBe(YEAR.recon.balance_due_cents);
    expect(centsOf(findRow(summary, "Tenant estimates paid during the year")![3])).toBe(YEAR.recon.estimates_paid_cents);
    expect(centsOf(findRow(summary, "Tenant's share of the reconciled pool")![3])).toBe(YEAR.recon.tenant_total_cents);
  });

  it("carries every general-ledger entry, and they add to the pools", () => {
    const gl = BOOK.sheets["GL Detail"]!;
    const booked = new Map<string, number>();
    for (const row of gl) {
      const cents = centsOf(row[6]);
      if (cents === null || !row[3] || row[3].startsWith("Total")) continue;
      booked.set(row[3], (booked.get(row[3]) ?? 0) + cents);
    }
    for (const p of YEAR.pools) expect(booked.get(p.category), p.category).toBe(p.amount_cents);
  });

  it("shows the cap ladder the lease produces", () => {
    const cap = BOOK.sheets["CAP Calc"]!;
    const row = cap.find((r) => r[0] === String(YEAR.year))!;
    expect(centsOf(row[1])).toBe(YEAR.recon.controllable_actual_cents);
    expect(centsOf(row[3])).toBe(YEAR.recon.cap_allowed_cents);
    expect(centsOf(row[5])).toBe(YEAR.recon.cap_billed_cents);
  });

  it("ends with the notice that the document is invented", () => {
    for (const name of BOOK.sheetNames) {
      const grid = BOOK.sheets[name]!;
      expect(grid.at(-1)?.[0], name).toBe(SYNTHETIC_NOTICE);
    }
  });
});

describe("the summary tab stays inside what the scanner's uploader can read", () => {
  const summary = BOOK.sheets["ReconciliationSummary"]!;
  const headerRow = summary.findIndex((r) => r[0] === "Line item");

  it("puts the header row inside the first ten, where the parser looks for it", () => {
    expect(headerRow).toBeGreaterThanOrEqual(0);
    expect(headerRow).toBeLessThan(10);
  });

  it("heads one column per year and gives no other column a year in its header", () => {
    const head = summary[headerRow]!;
    const yearHeaders = head.filter((h) => /\b(19[89]\d|20\d\d)\b/.test(h));
    expect(yearHeaders).toEqual(MODEL.years.map((y) => String(y.year)));
  });

  it("words every summary row so the parser skips it rather than reading it as an expense", () => {
    // The parser drops a row whose label starts with "total" or "tenant"; every
    // row below the expense lines that carries an amount must therefore do so.
    const lineLabels = new Set(YEAR.pools.map((p) => p.category));
    for (let r = headerRow + 1; r < summary.length; r++) {
      const label = summary[r]![0] ?? "";
      const hasAmount = summary[r]!.slice(3).some((c) => centsOf(c) !== null || /^\d+$/.test(c));
      if (!label || !hasAmount || lineLabels.has(label)) continue;
      expect(label.toLowerCase(), `row ${r + 1} would be read as an expense line`).toMatch(/^(total|tenant)/);
    }
  });
});

describe("the amortization schedule and the tenant ledger", () => {
  it("shows principal and interest, and totals them to the line the statement bills", () => {
    const amort = renderAmortizationWorkbook(MODEL, YEAR.year);
    const grid = readWorkbook(amort.bytes as Uint8Array).sheets["Amortization"]!;
    for (const p of MODEL.capital_projects) {
      const row = grid.find((r) => r[1] === p.asset_name)!;
      const s = amortizationForYear(p.total_cost_cents, p.recovery_period_months, p.amort_start, YEAR.year, p.interest_rate_pct);
      expect(centsOf(row[7])).toBe(p.total_cost_cents);
      expect(centsOf(row[8])).toBe(p.monthly_cents);
      expect(Number(row[10])).toBe(s.months);
      expect(centsOf(row[11])).toBe(s.principal);
      expect(centsOf(row[12])).toBe(s.interest);
      expect(centsOf(row[13])).toBe(s.total);
      // The schedule's own asset name never reaches the statement; the caption does.
      const line = YEAR.pools.find((x) => x.capital_project_id === p.id)!;
      expect(line.amount_cents).toBe(s.total);
      expect(line.category).not.toContain(p.asset_name);
    }
  });

  it("carries the whole term's account, and the balance adds down the page", () => {
    const ledger = renderTenantLedger(MODEL);
    const grid = readWorkbook(ledger.bytes as Uint8Array).sheets["Tenant Ledger"]!;
    const rows = grid.filter((r) => /^\d+\/\d+\/\d{4}$/.test(r[0] ?? ""));
    expect(rows.length).toBe(MODEL.ledger.length);
    let balance = 0;
    for (const r of rows) {
      balance += (centsOf(r[4]) ?? 0) - (centsOf(r[5]) ?? 0);
      expect(centsOf(r[6])).toBe(balance);
    }
    expect(balance).toBe(0);
  });
});

describe("the same seed renders the same bytes", () => {
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);

  it("renders identical bytes on a second run", () => {
    const again = renderReconWorkbook(buildCleanModel(GOLDEN_CONFIGS[0]!), YEAR.year);
    expect(sha(again.bytes as Uint8Array)).toBe(sha(RECON.bytes as Uint8Array));
  });

  /**
   * Pinned artifact hashes. A move here means a renderer changed — which is
   * often intended. Update these in the same commit as the change, with the
   * reason in the message; never in passing.
   */
  const GOLDEN: Record<string, string> = {
    "recon workbook": "a6872d460478ae84",
    "amortization schedule": "bae860dfa184eeff",
    "tenant ledger": "47eacd50d4fdd41a",
  };

  it("matches the pinned workbook bytes", () => {
    expect(sha(RECON.bytes as Uint8Array)).toBe(GOLDEN["recon workbook"]);
    expect(sha(renderAmortizationWorkbook(MODEL, YEAR.year).bytes as Uint8Array)).toBe(GOLDEN["amortization schedule"]);
    expect(sha(renderTenantLedger(MODEL).bytes as Uint8Array)).toBe(GOLDEN["tenant ledger"]);
  });

  it("names the file the way the landlord's file server does", () => {
    expect(RECON.filename).toMatch(/^[A-Z]{2,3}\d_\d{4} OPEX RECON_Recon Workbook_\d\d\.\d\d\.\d\d\.xlsx$/);
  });
});
