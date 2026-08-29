/**
 * The page: choose a shape, forge a package, look at it, take it away.
 *
 * The engine does all the work; this reads the controls, calls `forge`, and
 * renders. Two decisions in here are worth explaining.
 *
 * **The preview shows the real documents.** The paper documents appear in a
 * sandboxed iframe holding exactly the bytes that download, rather than a second
 * rendering of the model in the app's own styles. A preview that is a different
 * rendering is a preview that can look right while the file is wrong. The
 * workbook is the exception — a spreadsheet has no HTML form — so its sheets are
 * drawn as tables from the same model the writer reads.
 *
 * **Training mode is on by default.** The answers stay hidden until someone asks
 * for them, because the natural mistake is to read them first and conclude the
 * exercise was easy. The ZIP still contains the key, in its own folder, and the
 * page says so where it cannot be missed: a download that quietly omitted half
 * its contents would be worse than one whose dangerous folder is obvious.
 *
 * Pattern, from the family: one module-level `state`, a `renderAll()` that
 * redraws wholesale, handlers that mutate state and call it. No framework.
 */

import "../shared/tokens.css";
import "../shared/app.css";
import "./styles.css";

import { forge, type Scenario } from "../engine/forge.ts";
import { checkTies, TIE_STATEMENTS, TIE_TITLES } from "../engine/model/ties.ts";
import { SCHEME_ORDER, type PropertyKind, type ScenarioConfig, type SchemeId, type SizeBand, type TieId } from "../engine/model/types.ts";
import { renderAmortizationWorkbook, renderReconWorkbook, renderTenantLedger } from "../engine/render/workbook.ts";
import { renderBillingStatement, renderInsuranceBackup, renderLease, renderProjectBackup, renderTaxBackup } from "../engine/render/documents.ts";
import { renderAnswerSheet } from "../engine/render/answer-sheet.ts";
import { renderReconPackageJson } from "../engine/render/recon-package.ts";
import { buildPackageZip, packageContents } from "../engine/package/packager.ts";
import { toScannerManifest } from "../engine/model/answer-key.ts";
import type { Artifact } from "../engine/render/artifact.ts";
import { $, clear, h } from "./dom.ts";
import { scannerUrl } from "./scanner-link.ts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface State {
  config: ScenarioConfig;
  scenario: Scenario;
  tab: string;
  sheet: string;
  year: number;
  trainingMode: boolean;
}

const SCHEME_COPY: Record<SchemeId, { title: string; blurb: string }> = {
  unamortized_capital: {
    title: "Capital expensed in a lump",
    blurb: "A six-figure job charged to the year it was done instead of over its life. Every invoice is there.",
  },
  above_cap_billing: {
    title: "The cap grown on the cap",
    blurb: "Next year's ceiling grown on what was billed, not on what was payable. A ceiling becomes a floor.",
  },
  fee_base_expansion: {
    title: "A fee on a base the lease forbids",
    blurb: "The right percentage, on everything — taxes and insurance included. The quietest of the five.",
  },
  bucket_migration: {
    title: "A cost moved out of the capped pool",
    blurb: "Security vanishes; life safety appears next to the taxes, costing about the same.",
  },
  kept_tax_refund: {
    title: "A tax refund kept",
    blurb: "Only the collector's account statement shows it. RF-13 reads that backup; a workbook cannot carry one.",
  },
};

const KIND_LABEL: Record<PropertyKind, string> = {
  retail_strip: "Retail centre",
  office: "Office building",
  industrial_flex: "Industrial / flex",
};

const BAND_LABEL: Record<SizeBand, string> = { small: "Small", medium: "Medium", large: "Large" };

function defaultConfig(): ScenarioConfig {
  return {
    seed: "ashford-1",
    start_year: 2023,
    year_count: 3,
    property_kind: "retail_strip",
    size_band: "medium",
    schemes: ["above_cap_billing", "fee_base_expansion"],
  };
}

const state: State = (() => {
  const config = defaultConfig();
  const scenario = forge(config);
  return {
    config,
    scenario,
    tab: "workbook",
    sheet: "ReconciliationSummary",
    year: scenario.model.years[scenario.model.years.length - 1]!.year,
    trainingMode: true,
  };
})();

function reforge(): void {
  state.scenario = forge(state.config);
  const years = state.scenario.model.years.map((y) => y.year);
  if (!years.includes(state.year)) state.year = years[years.length - 1]!;
  renderAll();
}

// ---------------------------------------------------------------------------
// Formatting and downloads
// ---------------------------------------------------------------------------

function usd(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return (neg ? "-$" : "$") + Math.floor(abs / 100).toLocaleString("en-US") + "." + String(abs % 100).padStart(2, "0");
}

function mimeOf(kind: Artifact["kind"] | "zip"): string {
  if (kind === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (kind === "html") return "text/html;charset=utf-8";
  if (kind === "json") return "application/json";
  if (kind === "zip") return "application/zip";
  return "text/plain;charset=utf-8";
}

/** A file, straight from memory. No network is involved and none is permitted. */
function download(filename: string, kind: Artifact["kind"] | "zip", data: Uint8Array | string): void {
  const blob = new Blob([data as BlobPart], { type: mimeOf(kind) });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: filename.split("/").pop()! });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---------------------------------------------------------------------------
// The forge panel
// ---------------------------------------------------------------------------

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h(
    "label",
    { class: "field" },
    h("span", { class: "field-label" }, label),
    control,
    hint ? h("span", { class: "field-hint" }, hint) : null,
  );
}

function select<T extends string>(value: T, options: Array<[T, string]>, onChange: (v: T) => void): HTMLSelectElement {
  const el = h("select", { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as T) }) as HTMLSelectElement;
  for (const [v, label] of options) {
    const opt = h("option", { value: v }, label) as HTMLOptionElement;
    if (v === value) opt.selected = true;
    el.appendChild(opt);
  }
  return el;
}

function forgePanel(): HTMLElement {
  const seedInput = h("input", {
    type: "text",
    value: state.config.seed,
    "aria-label": "Seed",
    oninput: (e: Event) => {
      state.config.seed = (e.target as HTMLInputElement).value || "seed";
    },
    onchange: () => reforge(),
  }) as HTMLInputElement;

  const reroll = h(
    "button",
    {
      type: "button",
      class: "ghost",
      onclick: () => {
        // A fresh word, then forge from it. The seed lands back in the box, so
        // anything a visitor stumbles onto can be handed to someone else and
        // forged again identically.
        const n = new Uint32Array(2);
        crypto.getRandomValues(n);
        state.config.seed = `${n[0]!.toString(36)}-${n[1]!.toString(36)}`;
        seedInput.value = state.config.seed;
        reforge();
      },
    },
    "Reroll",
  );

  const schemeBoxes = SCHEME_ORDER.map((id) => {
    const on = state.config.schemes.includes(id);
    const box = h("input", {
      type: "checkbox",
      onchange: (e: Event) => {
        const checked = (e.target as HTMLInputElement).checked;
        state.config.schemes = checked ? [...state.config.schemes, id] : state.config.schemes.filter((s) => s !== id);
        reforge();
      },
    }) as HTMLInputElement;
    box.checked = on;
    return h(
      "label",
      { class: "scheme" },
      box,
      h("span", {}, h("strong", {}, SCHEME_COPY[id].title), h("span", { class: "field-hint" }, SCHEME_COPY[id].blurb)),
    );
  });

  const years = state.scenario.model.years.map((y) => y.year);
  const u = state.scenario.model.universe;

  return h(
    "div",
    { class: "panel forge" },
    h("h3", {}, "Forge a package"),
    field("Seed", h("div", { class: "row" }, seedInput, reroll), "The same seed forges the same package, down to the bytes — hand a class of twenty the seed and they all work the same one."),
    h(
      "div",
      { class: "grid-2" },
      field("Property", select(state.config.property_kind, Object.entries(KIND_LABEL) as Array<[PropertyKind, string]>, (v) => { state.config.property_kind = v; reforge(); })),
      field("Size", select(state.config.size_band, Object.entries(BAND_LABEL) as Array<[SizeBand, string]>, (v) => { state.config.size_band = v; reforge(); })),
      field("First year", select(String(state.config.start_year), (["2021", "2022", "2023", "2024"] as const).map((y) => [y, y] as [string, string]), (v) => { state.config.start_year = Number(v); reforge(); })),
      field("Years", select(String(state.config.year_count), [["2", "Two"], ["3", "Three"]] as Array<[string, string]>, (v) => { state.config.year_count = Number(v) as 2 | 3; reforge(); })),
    ),
    h("h3", {}, "What the landlord did wrong"),
    h("p", { class: "field-hint" }, "Leave them all unchecked for a clean package: every figure ties, and there is nothing to find."),
    ...schemeBoxes,
    h(
      "div",
      { class: "row" },
      h("button", { type: "button", class: "ghost", onclick: () => { state.config.schemes = []; reforge(); } }, "Clean package"),
      h("button", { type: "button", class: "ghost", onclick: () => { state.config.schemes = [...SCHEME_ORDER]; reforge(); } }, "All five"),
    ),
    h(
      "p",
      { class: "field-hint" },
      `Forged: ${u.property_name}, ${u.address.city}, ${u.address.state} — ${u.tenant_name}, ${years[0]}–${years[years.length - 1]}.`,
    ),
  );
}

// ---------------------------------------------------------------------------
// The ties panel
// ---------------------------------------------------------------------------

function tiesPanel(): HTMLElement {
  const breaks = state.scenario.breaks;
  const broken = new Set(breaks.map((b) => b.tie));
  const ties = Object.keys(TIE_TITLES) as TieId[];

  return h(
    "div",
    { class: "panel ties" },
    h("h3", {}, "Does it tie?"),
    h(
      "p",
      { class: "field-hint" },
      "Seven places where two documents have to agree. In a clean package all seven hold to the cent; a planted overcharge breaks exactly one, and everything else still adds — which is why the arithmetic never gives it away.",
    ),
    ...ties.map((tie) => {
      const isBroken = broken.has(tie);
      const detail = breaks.filter((b) => b.tie === tie);
      return h(
        "div",
        { class: "tie" + (isBroken ? " tie-broken" : "") },
        h("span", { class: "tie-mark", "aria-hidden": "true" }, isBroken ? "✕" : "✓"),
        h(
          "div",
          {},
          h("div", { class: "tie-name" }, `${tie} · ${TIE_TITLES[tie]}`, h("span", { class: "tie-state" }, isBroken ? " — broken" : " — holds")),
          h("div", { class: "field-hint" }, TIE_STATEMENTS[tie]),
          isBroken && !state.trainingMode
            ? h("ul", { class: "tie-detail" }, ...detail.slice(0, 4).map((b) => h("li", {}, `${b.year}${b.category ? " · " + b.category : ""} — ${b.detail}`)))
            : isBroken
              ? h("div", { class: "field-hint" }, "Turn training mode off to see where.")
              : null,
        ),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

function docFrame(html: string, title: string): HTMLElement {
  const frame = h("iframe", { class: "doc-frame", title, sandbox: "", loading: "lazy" }) as HTMLIFrameElement;
  // srcdoc rather than a blob URL: what is on screen is byte-for-byte what
  // downloads, and the empty sandbox means nothing in it could run even if the
  // page's own policy allowed it.
  frame.setAttribute("srcdoc", html);
  return frame;
}

interface SheetCell {
  text: string;
  numeric: boolean;
  strong: boolean;
}

function sheetTable(rows: SheetCell[][]): HTMLElement {
  return h(
    "div",
    { class: "table-scroll" },
    h(
      "table",
      { class: "sheet" },
      h(
        "tbody",
        {},
        ...rows.map((row) => h("tr", {}, ...row.map((c) => h("td", { class: (c.numeric ? "num" : "") + (c.strong ? " strong" : "") }, c.text)))),
      ),
    ),
  );
}

/** The workbook's sheets, drawn from the model — a spreadsheet has no HTML form. */
function workbookPreview(): HTMLElement {
  const { model } = state.scenario;
  const year = model.years.find((y) => y.year === state.year)!;
  const shareFrac = model.lease.share_pct / 100;
  const share = (c: number) => Math.round(Math.abs(c) * shareFrac + 1e-9) * (c < 0 ? -1 : 1);
  const t = (text: string, strong = false): SheetCell => ({ text, numeric: false, strong });
  const n = (cents: number, strong = false): SheetCell => ({ text: usd(cents), numeric: true, strong });

  const sheets: Record<string, SheetCell[][]> = {
    ReconciliationSummary: [
      [t("Line item", true), t("Section", true), t("Class", true), t(String(year.year), true), t("Tenant's share", true)],
      ...year.pools.map((p) => [
        t(p.category),
        t(p.section),
        t(p.bucket === "controllable" ? "Controllable" : "Non-controllable"),
        n(p.amount_cents),
        n(share(p.amount_cents)),
      ]),
      [t("Total operating expenses", true), t(""), t(""), n(year.recon.pool_total_cents, true), n(share(year.recon.pool_total_cents), true)],
      [t("Tenant's share of the reconciled pool", true), t(""), t(""), t(""), n(year.recon.tenant_total_cents, true)],
      [t("Tenant estimates paid", true), t(""), t(""), t(""), n(year.recon.estimates_paid_cents)],
      [t(year.recon.balance_due_cents >= 0 ? "Tenant balance due" : "Tenant credit due", true), t(""), t(""), t(""), n(year.recon.balance_due_cents, true)],
    ],
    "GL Detail": [
      [t("Date", true), t("Account", true), t("Account name", true), t("Vendor", true), t("Memo", true), t("Amount", true)],
      ...year.gl.map((g) => [t(g.date), t(g.account), t(g.category), t(g.vendor), t(g.memo), n(g.amount_cents)]),
    ],
    "CAP Calc": model.lease.cap
      ? [
          [t("Year", true), t("Controllable actual", true), t("Ceiling stated", true), t("Billed", true)],
          ...model.years
            .filter((y) => y.year <= state.year)
            .map((y) => [
              t(String(y.year)),
              n(y.recon.controllable_actual_cents),
              y.recon.cap_allowed_cents === null ? t("—") : n(y.recon.cap_allowed_cents),
              n(y.recon.cap_billed_cents, true),
            ]),
        ]
      : [[t("This lease caps nothing.")]],
    "Payment History": [
      [t("Date", true), t("Description", true), t("Charge", true), t("Payment", true), t("Balance", true)],
      ...model.ledger
        .filter((e) => e.period.startsWith(String(state.year)))
        .map((e) => [
          t(e.date),
          t(e.description),
          e.charge_cents ? n(e.charge_cents) : t(""),
          e.payment_cents ? n(e.payment_cents) : t(""),
          n(e.balance_cents),
        ]),
    ],
  };

  const names = Object.keys(sheets);
  if (!names.includes(state.sheet)) state.sheet = names[0]!;

  return h(
    "div",
    {},
    h(
      "div",
      { class: "subtabs", role: "tablist" },
      ...names.map((name) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: "subtab" + (name === state.sheet ? " on" : ""),
            "aria-selected": name === state.sheet ? "true" : "false",
            onclick: () => {
              state.sheet = name;
              renderAll();
            },
          },
          name,
        ),
      ),
    ),
    sheetTable(sheets[state.sheet]!),
  );
}

interface TabDef {
  id: string;
  label: string;
  perYear: boolean;
  build: () => HTMLElement | null;
  artifact: () => Artifact | null;
}

function tabDefs(): TabDef[] {
  const { model, answerKey } = state.scenario;
  const y = state.year;
  const frame = (a: Artifact | null) => (a ? docFrame(a.bytes as string, a.title) : null);

  const list: TabDef[] = [
    { id: "workbook", label: "Workbook", perYear: true, build: workbookPreview, artifact: () => renderReconWorkbook(model, y) },
    { id: "statement", label: "Statement", perYear: true, build: () => frame(renderBillingStatement(model, y)), artifact: () => renderBillingStatement(model, y) },
    { id: "tax", label: "Tax backup", perYear: true, build: () => frame(renderTaxBackup(model, y)), artifact: () => renderTaxBackup(model, y) },
    { id: "insurance", label: "Insurance", perYear: true, build: () => frame(renderInsuranceBackup(model, y)), artifact: () => renderInsuranceBackup(model, y) },
    { id: "project", label: "Project backup", perYear: true, build: () => frame(renderProjectBackup(model, y)), artifact: () => renderProjectBackup(model, y) },
    { id: "amort", label: "Amortization", perYear: true, build: () => null, artifact: () => renderAmortizationWorkbook(model, y) },
    { id: "ledger", label: "Tenant ledger", perYear: false, build: () => null, artifact: () => renderTenantLedger(model) },
    { id: "lease", label: "Lease", perYear: false, build: () => frame(renderLease(model)), artifact: () => renderLease(model) },
  ];
  if (!state.trainingMode) {
    list.push({
      id: "answer",
      label: "Answer key",
      perYear: false,
      build: () => frame(renderAnswerSheet(model, answerKey)),
      artifact: () => renderAnswerSheet(model, answerKey),
    });
  }
  return list;
}

function previewPanel(): HTMLElement {
  const defs = tabDefs();
  if (!defs.some((d) => d.id === state.tab)) state.tab = "workbook";
  const active = defs.find((d) => d.id === state.tab)!;
  const years = state.scenario.model.years.map((y) => y.year);
  const artifact = active.artifact();
  const body = active.build();

  return h(
    "div",
    { class: "panel preview" },
    h(
      "div",
      { class: "tabs", role: "tablist" },
      ...defs.map((d) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: "tab" + (d.id === state.tab ? " on" : ""),
            "aria-selected": d.id === state.tab ? "true" : "false",
            onclick: () => {
              state.tab = d.id;
              renderAll();
            },
          },
          d.label,
        ),
      ),
    ),
    active.perYear
      ? h(
          "div",
          { class: "yearpicker", role: "group", "aria-label": "Reconciliation year" },
          ...years.map((yr) =>
            h(
              "button",
              {
                type: "button",
                class: "subtab" + (yr === state.year ? " on" : ""),
                "aria-pressed": yr === state.year ? "true" : "false",
                onclick: () => {
                  state.year = yr;
                  renderAll();
                },
              },
              String(yr),
            ),
          ),
        )
      : null,
    body ?? h("p", { class: "field-hint pad" }, `${active.label} is a spreadsheet, so there is nothing to show on a page. Download it and open it.`),
    artifact
      ? h("div", { class: "row pad" }, h("button", { type: "button", onclick: () => download(artifact.filename, artifact.kind, artifact.bytes) }, `Download ${artifact.filename.split("/").pop()}`))
      : null,
  );
}

// ---------------------------------------------------------------------------
// Downloads and the answer key
// ---------------------------------------------------------------------------

function downloadsPanel(): HTMLElement {
  const { model, answerKey } = state.scenario;
  const findings = answerKey.findings;

  const toggle = h("input", {
    type: "checkbox",
    onchange: (e: Event) => {
      state.trainingMode = (e.target as HTMLInputElement).checked;
      renderAll();
    },
  }) as HTMLInputElement;
  toggle.checked = state.trainingMode;

  return h(
    "div",
    { class: "panel downloads" },
    h("h3", {}, "Take it away"),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          type: "button",
          class: "primary",
          onclick: () => {
            const zip = buildPackageZip(model, answerKey);
            download(zip.filename, "zip", zip.bytes);
          },
        },
        "Download the whole package (.zip)",
      ),
    ),
    h("p", { class: "field-hint" }, `${packageContents(model, answerKey).entries.length} documents. The ZIP contains the answer key in a folder of its own — delete that folder before handing the package to anyone who is meant to work it.`),
    h("h3", {}, "Scan this package"),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          type: "button",
          class: "ghost",
          onclick: () => {
            const a = renderReconPackageJson(model);
            download(a.filename, a.kind, a.bytes);
          },
        },
        "Download for the Scanner (.json)",
      ),
      // A link, not a button: it navigates, and the visitor should be able to
      // middle-click it. The URL is resolved by src/ui/scanner-link.ts, the one
      // module in this repo that names a sibling app.
      h("a", { class: "button-link", href: scannerUrl(), target: "_blank", rel: "noopener noreferrer" }, "Open the Red-Flag Scanner ↗"),
    ),
    h(
      "p",
      { class: "field-hint" },
      "Drop that file on the scanner's ",
      h("em", {}, "Upload your own"),
      " card. There is no column-mapping step — the file is already in the shape the scanner reads — and it carries the things a spreadsheet cannot: the landlord's cap ladder, the capital blocks and the statement's own subtotals.",
    ),
    model.config.schemes.includes("kept_tax_refund")
      ? h(
          "p",
          { class: "field-hint" },
          "One scheme planted here — the kept tax refund — is only findable through the tax backup this JSON carries: the collector's account, with the levy as issued and the credit against it. The scanner's RF-13 reads exactly that. Upload the workbook instead and the same scheme is invisible, because a reconciliation statement does not contain the fact that a refund exists.",
        )
      : null,
    // The package is the input and the manifest is the answers, so training mode
    // separates them: the JSON above always downloads, the manifest waits until
    // the answers are asked for. Nothing is silently withheld — the ZIP still
    // carries the key in its own folder, and the line below says where it is.
    state.trainingMode
      ? h(
          "p",
          { class: "field-hint" },
          "The findings manifest — what should be found in this package, in the scanner's own arithmetic — is part of the answers. Turn training mode off to download it here; it is in the ZIP either way.",
        )
      : h(
          "div",
          {},
          h(
            "div",
            { class: "row" },
            h(
              "button",
              {
                type: "button",
                class: "ghost",
                onclick: () => download(`${model.universe.site_code}_findings-manifest.json`, "json", JSON.stringify(toScannerManifest(answerKey), null, 2) + "\n"),
              },
              "Findings manifest (.json)",
            ),
          ),
          h("p", { class: "field-hint" }, "What should be found in the package, in the scanner's own arithmetic. The two files together are a regression fixture: the package, and the truth about it."),
        ),

    h("h3", {}, "Answer key"),
    h(
      "label",
      { class: "scheme" },
      toggle,
      h("span", {}, h("strong", {}, "Training mode"), h("span", { class: "field-hint" }, "On: the answers stay hidden, and the ties panel says only that something is broken.")),
    ),
    state.trainingMode
      ? h("p", { class: "field-hint" }, findings.length === 0 ? "Nothing is planted in this package." : `${findings.length} finding${findings.length === 1 ? "" : "s"} planted. Turn training mode off to see them.`)
      : findings.length === 0
        ? h("p", { class: "field-hint" }, "Nothing is planted. Every tie holds, and the Red-Flag Scanner finds nothing in this package at all — no swing worth asking about, no round figure, no repeated amount.")
        : h(
            "div",
            {},
            h("p", { class: "field-hint" }, `Worth ${usd(answerKey.total_planted_tenant_impact_cents)} to the tenant in total.`),
            ...findings.map((f) => {
              const visible = f.check_id !== null && f.scanner_visible !== false;
              return h(
                "div",
                { class: "finding finding-" + f.severity },
                h(
                  "div",
                  { class: "finding-head" },
                  h("span", { class: "chip chip-" + f.severity }, f.severity),
                  h("span", { class: "chip" }, visible ? `The scanner catches this — ${f.check_id}` : "Only the paper catches this"),
                ),
                h("div", { class: "finding-title" }, `${f.category} · ${Array.isArray(f.year) ? f.year.join("–") : f.year}`),
                h("p", {}, f.seam),
                f.expected_impact_range
                  ? h("p", { class: "field-hint" }, `About $${f.expected_impact_range[0].toLocaleString("en-US")}–$${f.expected_impact_range[1].toLocaleString("en-US")} at the tenant's share.`)
                  : null,
                h("p", { class: "field-hint" }, "Where to look"),
                h("ul", { class: "evidence" }, ...f.evidence.map((e) => h("li", {}, e))),
              );
            }),
          ),
  );
}

// ---------------------------------------------------------------------------

function renderAll(): void {
  const root = $("app");
  clear(root);
  root.appendChild(
    h(
      "div",
      { class: "layout" },
      h("div", { class: "col-left" }, forgePanel(), tiesPanel()),
      h("div", { class: "col-main" }, previewPanel()),
      h("div", { class: "col-right" }, downloadsPanel()),
    ),
  );
}

// The ties panel has to be checking, not decorating: recomputing from the model
// must agree with what forging reported.
if (checkTies(state.scenario.model).length !== state.scenario.breaks.length) {
  throw new Error("the ties panel and the forge disagree");
}

renderAll();
