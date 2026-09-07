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
import {
  OPEX_PSF_MAX,
  OPEX_PSF_MIN,
  PREMISES_SF_MAX,
  PREMISES_SF_MIN,
  STORY_MAX_CHARS,
  validateScenarioConfig,
} from "../engine/model/bounds.ts";
import { buildDescribePrompt, countWords, MAX_DESCRIPTION_CHARS, MAX_DESCRIPTION_WORDS } from "../engine/describe/prompt.ts";
import { DRAFT_FIELD_NAMES, FIELD_LABELS, validateForgeDraft, type DraftValidation, type ForgeDraft } from "../engine/describe/validate.ts";
import { renderAmortizationWorkbook, renderReconWorkbook, renderTenantLedger } from "../engine/render/workbook.ts";
import { renderBillingStatement, renderInsuranceBackup, renderLease, renderProjectBackup, renderTaxBackup } from "../engine/render/documents.ts";
import { renderAnswerSheet } from "../engine/render/answer-sheet.ts";
import { renderReconPackageJson } from "../engine/render/recon-package.ts";
import { CLAUSE_IDS, RIDER_SECTIONS, type ClauseId } from "../engine/render/lease/rider.ts";
import { litLease } from "../engine/render/lease/highlight.ts";
import { VARIANT_IDS, variantsFor, type VariantId } from "../engine/model/variants.ts";
import { buildPackageZip, packageContents } from "../engine/package/packager.ts";
import { toScannerManifest } from "../engine/model/answer-key.ts";
import type { Artifact } from "../engine/render/artifact.ts";
import { $, clear, h } from "./dom.ts";
import { scannerUrl } from "./scanner-link.ts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface DescribeState {
  /** What the visitor wrote. Never leaves the page, never reaches the engine. */
  description: string;
  /** What their AI handed back. */
  paste: string;
  /** The last verdict on that paste, or null before they have asked for one. */
  result: DraftValidation | null;
  /** The draft currently reflected in the controls, kept for its quotes. */
  applied: ForgeDraft | null;
}

/**
 * The three stations a visitor moves through. Not gates: the package exists at
 * every one of them, and every one is reachable from the step bar at any time.
 * "Step" and not "tab" because `tab` already means the document being previewed.
 */
type Step = "forge" | "read" | "take";

const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: "forge", label: "1 · Forge" },
  { id: "read", label: "2 · Read" },
  { id: "take", label: "3 · Take it away" },
];

interface State {
  config: ScenarioConfig;
  scenario: Scenario;
  step: Step;
  tab: string;
  sheet: string;
  year: number;
  /** The one tie whose detail is open, if any. */
  openTie: TieId | null;
  trainingMode: boolean;
  /**
   * The clause added last, marked in the lease preview so a visitor can see
   * where it landed. UI state and not configuration: it changes what the page
   * draws over the document, never what the forge produced.
   */
  latestClause: ClauseId | null;
  describe: DescribeState;
  /**
   * Why the last edit did not forge. The bounds live in the engine, so a value
   * the panel's own min/max would have allowed can still be refused — and when
   * it is, the controls keep showing what the visitor typed rather than
   * silently snapping back to the config that is still in force.
   */
  configError: string | null;
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
    blurb: "The right percentage, on everything — taxes and insurance included. The quietest of them all.",
  },
  bucket_migration: {
    title: "A cost moved out of the capped pool",
    blurb: "Security vanishes; life safety appears next to the taxes, costing about the same.",
  },
  kept_tax_refund: {
    title: "A tax refund kept",
    blurb: "Only the collector's account statement shows it. RF-13 reads that backup; a workbook cannot carry one.",
  },
  budget_tax_billing: {
    title: "Taxes billed at budget",
    blurb: "The estimate never becomes an actual. Twelve accruals, no true-up, and the county's bill says less.",
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
    step: "forge",
    tab: "lease",
    sheet: "ReconciliationSummary",
    year: scenario.model.years[scenario.model.years.length - 1]!.year,
    openTie: null,
    trainingMode: true,
    latestClause: null,
    describe: { description: "", paste: "", result: null, applied: null },
    configError: null,
  };
})();

function reforge(): void {
  // `forge` refuses a configuration outside its bounds, and refusing is the
  // correct behaviour — but a thrown error in a click handler would leave the
  // page showing a package that no longer matches its own controls. Catch it,
  // say what is wrong, and keep the last good scenario on screen.
  const errors = validateScenarioConfig(state.config);
  if (errors.length > 0) {
    state.configError = errors.join(" ");
    renderAll();
    return;
  }
  state.configError = null;
  state.scenario = forge(state.config);
  const years = state.scenario.model.years.map((y) => y.year);
  if (!years.includes(state.year)) state.year = years[years.length - 1]!;
  renderAll();
}

/** Clipboard, with the button itself as the only feedback surface. */
function copyText(text: string, button: HTMLButtonElement): void {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const old = button.textContent;
      button.textContent = "Copied.";
      setTimeout(() => {
        button.textContent = old;
      }, 1200);
    })
    .catch(() => {
      button.textContent = "Select the box and copy manually";
    });
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

/**
 * A number the visitor may leave blank, because blank is a real answer here: it
 * means "you choose", and the generator draws it the way it always did. So the
 * handler deletes the key rather than writing a zero — an optional field that
 * has been set to nothing is not the same as an optional field that is absent,
 * and only the second one forges the package it used to.
 */
function optionalNumber(
  value: number | undefined,
  attrs: Record<string, string | number>,
  onSet: (v: number | undefined) => void,
): HTMLInputElement {
  const el = h("input", {
    type: "number",
    value: value === undefined ? "" : String(value),
    ...attrs,
    onchange: (e: Event) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      onSet(raw === "" ? undefined : Number(raw));
    },
  }) as HTMLInputElement;
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
      field(
        "Your square footage",
        optionalNumber(state.config.premises_sf, { min: PREMISES_SF_MIN, max: PREMISES_SF_MAX, step: 100, placeholder: "drawn from the size" }, (v) => {
          if (v === undefined) delete state.config.premises_sf;
          else state.config.premises_sf = Math.round(v);
          reforge();
        }),
        `Leave it blank and the size band draws one. ${PREMISES_SF_MIN.toLocaleString("en-US")}–${PREMISES_SF_MAX.toLocaleString("en-US")} sf; the property grows around it so the billed share still reproduces.`,
      ),
      field(
        "Operating expenses / sf",
        optionalNumber(state.config.opex_psf_target, { min: OPEX_PSF_MIN, max: OPEX_PSF_MAX, step: "0.01", placeholder: "whatever it costs" }, (v) => {
          if (v === undefined) delete state.config.opex_psf_target;
          else state.config.opex_psf_target = Math.round(v * 100) / 100;
          reforge();
        }),
        `A year of expenses per square foot, $${OPEX_PSF_MIN.toFixed(2)}–$${OPEX_PSF_MAX.toFixed(2)}. The invoices are still drawn one by one; this only says how big they should come to.`,
      ),
    ),
    field(
      "Story",
      h("input", {
        type: "text",
        value: state.config.story ?? "",
        maxlength: STORY_MAX_CHARS,
        placeholder: "the engine writes one from the schemes",
        "aria-label": "Story",
        onchange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          if (v === "") delete state.config.story;
          else state.config.story = v;
          reforge();
        },
      }),
      `One line, at most ${STORY_MAX_CHARS} characters. It rides along in the package the scanner reads.`,
    ),
    state.configError ? h("p", { class: "error-box" }, state.configError) : null,
    h("h3", {}, "What the landlord did wrong"),
    h("p", { class: "field-hint" }, "Leave them all unchecked for a clean package: every figure ties, and there is nothing to find."),
    ...schemeBoxes,
    h(
      "div",
      { class: "row" },
      h("button", { type: "button", class: "ghost", onclick: () => { state.config.schemes = []; reforge(); } }, "Clean package"),
      h("button", { type: "button", class: "ghost", onclick: () => { state.config.schemes = [...SCHEME_ORDER]; reforge(); } }, "All of them"),
    ),
    h(
      "p",
      { class: "field-hint" },
      `Forged: ${u.property_name}, ${u.address.city}, ${u.address.state} — ${u.tenant_name}, ${years[0]}–${years[years.length - 1]}.` +
        (riderCount() > 0 ? ` Rider: ${riderCount()} clause${riderCount() === 1 ? "" : "s"}.` : ""),
    ),
  );
}

function riderCount(): number {
  return state.config.clauses?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Describe it instead
// ---------------------------------------------------------------------------

/**
 * The AI step, shaped the way the family's CSP requires: prompt out, JSON back.
 * This page calls nothing. The visitor copies a prompt into the AI they already
 * use, brings the answer back, and a hand-rolled validator decides whether it
 * may touch the controls.
 *
 * The thing worth noticing about this panel is how little the AI is trusted
 * with. It cannot write an amount, name a property or author a document; it
 * fills in at most seven knobs and suggests some schemes, and every one of them
 * arrives with the words it was read from, displayed beside the control it
 * filled. Nothing is applied silently and nothing is forged until the visitor
 * presses the same button they would have pressed anyway.
 *
 * The description itself goes nowhere. It is not stored, not exported, not part
 * of the package. See docs/adr/0004.
 */
function describePanel(): HTMLElement {
  const d = state.describe;

  const counter = h("span", { class: "field-hint" }) as HTMLSpanElement;
  const copyBtn = h("button", { type: "button", class: "ghost" }, "Copy the prompt") as HTMLButtonElement;
  // The prompt is output, so it is not a form control. It was a readonly
  // textarea, and a textarea that takes a caret and refuses the keystroke reads
  // as a broken input however it is styled.
  const promptBox = h("pre", { class: "prompt-box mono", "aria-label": "The configuration prompt" }) as HTMLPreElement;

  function refresh(): void {
    const words = countWords(d.description);
    const over = words > MAX_DESCRIPTION_WORDS;
    counter.textContent = `${words} / ${MAX_DESCRIPTION_WORDS} words${over ? " — too long to build a prompt from" : ""}`;
    counter.className = "field-hint" + (over ? " over" : "");
    copyBtn.disabled = words === 0 || over;
    promptBox.textContent = words === 0 ? "" : buildDescribePrompt(d.description);
    // Nothing below the description is any use until something is written, and
    // an empty prompt sitting under an empty box is what made the panel read as
    // a form that did not work.
    rest.hidden = words === 0;
  }

  const descBox = h("textarea", {
    class: "describe-box",
    rows: "6",
    maxlength: MAX_DESCRIPTION_CHARS,
    placeholder:
      "We lease 40,000 square feet in a suburban retail centre. Operating expenses run about $9.50 a foot. Last year the landlord charged us for repaving the whole parking lot in one go, and the management fee looks like it is being taken on the taxes as well.",
    "aria-label": "Describe your business",
    oninput: (e: Event) => {
      // Deliberately not a re-render: redrawing the page under a textarea takes
      // the cursor with it. The things that depend on this value are updated in
      // place instead.
      d.description = (e.target as HTMLTextAreaElement).value;
      refresh();
    },
  }) as HTMLTextAreaElement;
  descBox.value = d.description;

  copyBtn.addEventListener("click", () => copyText(promptBox.textContent ?? "", copyBtn));

  const pasteBox = h("textarea", {
    class: "describe-box mono",
    rows: "5",
    placeholder: '{ "kind": "forge_config_draft", … }',
    "aria-label": "Paste the JSON your AI returned",
    oninput: (e: Event) => {
      d.paste = (e.target as HTMLTextAreaElement).value;
    },
  }) as HTMLTextAreaElement;
  pasteBox.value = d.paste;

  const applyBtn = h(
    "button",
    {
      type: "button",
      onclick: () => {
        const v = validateForgeDraft(d.paste, d.description);
        d.result = v;
        if (v.ok) {
          d.applied = v.draft;
          applyDraft(v.draft);
          return; // applyDraft reforges, which redraws
        }
        renderAll();
      },
    },
    "Fill in the controls",
  );

  const rest = h(
    "div",
    { class: "describe-rest" },
    counter,
    h("div", { class: "row" }, copyBtn),
    promptBox,
    field("Paste what your AI returned", pasteBox),
    h("div", { class: "row" }, applyBtn),
    draftVerdict(),
  ) as HTMLDivElement;
  refresh();

  return h(
    "div",
    { class: "panel describe" },
    h("h3", {}, "Describe it instead"),
    h(
      "p",
      { class: "field-hint" },
      "Write what your business leases in plain words. This page never calls an AI: copy the prompt it builds into the one you already use, bring back the JSON, and it fills in the controls below — which you can then override. ",
      h("strong", {}, "What you write here is sent nowhere by this page and stored nowhere; if you paste it into an AI service, that is you sending it to that service."),
      " Nothing you write reaches the forged package: every name in it comes from this app's own invented bank.",
    ),
    field("Describe your business", descBox),
    rest,
  );
}

/** The two registers: what was refused, and what was accepted with a caveat. */
function draftVerdict(): HTMLElement | null {
  const { result, applied } = state.describe;
  if (result === null) return null;

  if (!result.ok) {
    return h(
      "div",
      { class: "error-box" },
      h("strong", {}, result.kind === "malformed" ? "That is not JSON yet." : "That JSON is not a forge draft."),
      h("ul", {}, ...result.errors.map((e) => h("li", {}, e))),
    );
  }

  const filled = DRAFT_FIELD_NAMES.filter((n) => applied?.[n] !== undefined);
  const missing = DRAFT_FIELD_NAMES.filter((n) => applied?.[n] === undefined);

  return h(
    "div",
    { class: "ok-box" },
    h("strong", {}, `Applied — ${filled.length} control${filled.length === 1 ? "" : "s"} filled, ${applied?.schemes.length ?? 0} scheme${(applied?.schemes.length ?? 0) === 1 ? "" : "s"} suggested.`),
    // Every filled control next to the words it was read from. This is the
    // whole reviewability story: an override is only meaningful if you can see
    // what the model thought it was doing.
    ...filled.map((n) => {
      const cited = applied![n]!;
      return h("div", { class: "cited" }, h("span", { class: "cited-field" }, FIELD_LABELS[n]), " ← ", h("q", {}, cited.quote));
    }),
    ...(applied?.schemes ?? []).map((s) =>
      h("div", { class: "cited" }, h("span", { class: "cited-field" }, SCHEME_COPY[s.value].title), " ← ", h("q", {}, s.quote)),
    ),
    missing.length > 0
      ? h("p", { class: "field-hint" }, `Not stated, so left as they were: ${missing.map((n) => FIELD_LABELS[n]).join(", ")}.`)
      : null,
    ...result.warnings.map((w) => h("p", { class: "field-hint" }, w)),
  );
}

/**
 * Write a validated draft into the controls. Fields the draft omitted are left
 * exactly as they are — an omission is the model declining to guess, and
 * honouring it means not quietly resetting something the visitor chose.
 *
 * The seed is never touched. It is what makes a package shareable, and it is
 * the one control that is unambiguously the visitor's.
 */
function applyDraft(draft: ForgeDraft): void {
  if (draft.property_kind) state.config.property_kind = draft.property_kind.value;
  if (draft.size_band) state.config.size_band = draft.size_band.value;
  if (draft.start_year) state.config.start_year = draft.start_year.value;
  if (draft.year_count) state.config.year_count = draft.year_count.value;
  if (draft.premises_sf) state.config.premises_sf = draft.premises_sf.value;
  if (draft.opex_psf_target) state.config.opex_psf_target = draft.opex_psf_target.value;
  if (draft.story) state.config.story = draft.story.value;
  if (draft.schemes.length > 0) state.config.schemes = draft.schemes.map((s) => s.value);
  reforge();
}

// ---------------------------------------------------------------------------
// The ties
// ---------------------------------------------------------------------------

const TIE_IDS = Object.keys(TIE_TITLES) as TieId[];

function brokenTies(): Set<TieId> {
  return new Set(state.scenario.breaks.map((b) => b.tie));
}

/**
 * Seven marks across the top of the Read step, one to a tie, each opening on to
 * what it means and — outside training mode — where it went wrong.
 *
 * This is what "watch it being built" comes to in an app where forging is
 * instant. There is no build to animate; what a visitor actually needs to see is
 * which pairs of documents have to agree, and that six of the seven still do.
 */
function tiesStrip(): HTMLElement {
  const broken = brokenTies();
  const open = state.openTie;
  const detail = open === null ? [] : state.scenario.breaks.filter((b) => b.tie === open);

  return h(
    "div",
    { class: "panel ties" },
    h("h3", {}, "Does it tie?"),
    h(
      "div",
      { class: "ties-strip", role: "group", "aria-label": "The seven ties" },
      ...TIE_IDS.map((tie) => {
        const isBroken = broken.has(tie);
        return h(
          "button",
          {
            type: "button",
            class: "tiemark" + (isBroken ? " tie-broken" : "") + (tie === open ? " on" : ""),
            "aria-expanded": tie === open ? "true" : "false",
            "aria-label": `${tie} — ${TIE_TITLES[tie]} — ${isBroken ? "broken" : "holds"}`,
            onclick: () => {
              state.openTie = tie === open ? null : tie;
              renderAll();
            },
          },
          h("span", { class: "tie-mark", "aria-hidden": "true" }, isBroken ? "✕" : "✓"),
          tie,
        );
      }),
    ),
    open === null
      ? h(
          "p",
          { class: "field-hint" },
          "Seven places where two documents have to agree. In a clean package all seven hold to the cent; a planted overcharge breaks exactly one, and everything else still adds — which is why the arithmetic never gives it away. Pick one to read it.",
        )
      : h(
          "div",
          { class: "tie" + (broken.has(open) ? " tie-broken" : "") },
          h(
            "div",
            {},
            h("div", { class: "tie-name" }, `${open} · ${TIE_TITLES[open]}`, h("span", { class: "tie-state" }, broken.has(open) ? " — broken" : " — holds")),
            h("div", { class: "field-hint" }, TIE_STATEMENTS[open]),
            !broken.has(open)
              ? null
              : state.trainingMode
                ? h("div", { class: "field-hint" }, "Turn training mode off to see where.")
                : h("ul", { class: "tie-detail" }, ...detail.slice(0, 4).map((b) => h("li", {}, `${b.year}${b.category ? " · " + b.category : ""} — ${b.detail}`))),
          ),
        ),
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
  /** What this document was built from, in one line. */
  provenance: string;
  /** The ties it has to hold. Read off TIE_STATEMENTS, not guessed. */
  ties: TieId[];
  build: () => HTMLElement | null;
  artifact: () => Artifact | null;
}

/**
 * The documents, in the order the package assembles them: the lease first,
 * because every other figure is argued from it, then the workbook the landlord
 * computed, then the statement it produced, then the backup behind each line.
 */
function tabDefs(): TabDef[] {
  const { model, answerKey } = state.scenario;
  const y = state.year;
  const frame = (a: Artifact | null) => (a ? docFrame(a.bytes as string, a.title) : null);

  const list: TabDef[] = [
    {
      id: "lease",
      label: "Lease",
      perYear: false,
      provenance: "Built from the lease terms: the premises, the share, the cap, the fee base, the capital threshold and its life.",
      ties: ["T7"],
      // The mark goes on the way to the frame, never into the artifact: the
      // file this tab downloads and the copy in the ZIP are the lease as
      // forged. The two calls were already independent.
      build: () => {
        const lease = renderLease(model);
        return docFrame(litLease(lease.bytes as string, latestClauseRef()), lease.title);
      },
      artifact: () => renderLease(model),
    },
    {
      id: "workbook",
      label: "Workbook",
      perYear: true,
      provenance: "Built from the year's expense categories and the invoices booked against each of them.",
      ties: ["T1", "T3", "T7"],
      build: workbookPreview,
      artifact: () => renderReconWorkbook(model, y),
    },
    {
      id: "statement",
      label: "Statement",
      perYear: true,
      provenance: "Built from the reconciliation on the workbook, at the tenant's proportionate share.",
      ties: ["T2"],
      build: () => frame(renderBillingStatement(model, y)),
      artifact: () => renderBillingStatement(model, y),
    },
    {
      id: "tax",
      label: "Tax backup",
      perYear: true,
      provenance: "Built from each parcel's assessment and rate, the instalments the county billed, and any credit it granted.",
      ties: ["T4"],
      build: () => frame(renderTaxBackup(model, y)),
      artifact: () => renderTaxBackup(model, y),
    },
    {
      id: "insurance",
      label: "Insurance",
      perYear: true,
      provenance: "Built from the carrier's policy year: the premium, the policy fees and the coverages declared.",
      ties: ["T5"],
      build: () => frame(renderInsuranceBackup(model, y)),
      artifact: () => renderInsuranceBackup(model, y),
    },
    {
      id: "project",
      label: "Project backup",
      perYear: true,
      provenance: "Built from the contractor's contract sum and the date the work was placed in service.",
      ties: ["T6"],
      build: () => frame(renderProjectBackup(model, y)),
      artifact: () => renderProjectBackup(model, y),
    },
    {
      id: "amort",
      label: "Amortization",
      perYear: true,
      provenance: "Built from the project's cost over its recovery period, with interest on the unamortized balance.",
      ties: ["T6"],
      build: () => null,
      artifact: () => renderAmortizationWorkbook(model, y),
    },
    {
      id: "ledger",
      label: "Tenant ledger",
      perYear: false,
      provenance: "Built from the estimates charged month by month, the payments posted against them and the true-up on delivery.",
      ties: ["T3"],
      build: () => null,
      artifact: () => renderTenantLedger(model),
    },
  ];
  if (!state.trainingMode) {
    list.push({
      id: "answer",
      label: "Answer key",
      perYear: false,
      provenance: "Built from the schemes you planted — the only document here that knows they exist.",
      ties: [],
      build: () => frame(renderAnswerSheet(model, answerKey)),
      artifact: () => renderAnswerSheet(model, answerKey),
    });
  }
  return list;
}

function previewPanel(): HTMLElement {
  const defs = tabDefs();
  if (!defs.some((d) => d.id === state.tab)) state.tab = defs[0]!.id;
  const active = defs.find((d) => d.id === state.tab)!;
  const years = state.scenario.model.years.map((y) => y.year);
  const artifact = active.artifact();
  const body = active.build();
  const broken = brokenTies();

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
    // What this document was made from, and which ties it is answerable for.
    // The point of a forged package is that the documents reproduce from each
    // other; saying so beside each one is the whole lesson.
    h(
      "p",
      { class: "docmeta" },
      active.provenance,
      active.ties.length > 0
        ? h(
            "span",
            {},
            " · must hold ",
            ...active.ties.map((tie, i) =>
              h("span", { class: "docmeta-tie" + (broken.has(tie) ? " tie-broken" : "") }, `${i > 0 ? ", " : ""}${tie} ${broken.has(tie) ? "✕" : "✓"}`),
            ),
          )
        : null,
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
// The lease rail
// ---------------------------------------------------------------------------

/**
 * Write the selection back to the config and forge again.
 *
 * The key is deleted rather than set to an empty list, the same discipline
 * `premises_sf` follows: an optional field set to nothing is not the same object
 * as an optional field that was never mentioned, and only the second one leaves
 * the package exactly as it was.
 */
function setClauses(ids: ClauseId[], latest: ClauseId | null): void {
  if (ids.length === 0) delete state.config.clauses;
  else state.config.clauses = CLAUSE_IDS.filter((id) => ids.includes(id));
  // One rule covers unticking the marked clause, "None", and "All twelve":
  // a mark survives only while the clause it points at is in the lease, and
  // twelve added at once leaves no single one of them latest.
  state.latestClause = latest !== null && ids.includes(latest) ? latest : null;
  reforge();
}

/** The Rider reference of the clause added last, for the preview's mark. */
function latestClauseRef(): string | null {
  const id = state.latestClause;
  if (id === null) return null;
  return RIDER_SECTIONS.flatMap((s) => s.clauses).find((c) => c.id === id)?.ref ?? null;
}

/**
 * The forms the county's bills take, beside the bills.
 *
 * Same shape as the clause rail below it and the same discipline: the key is
 * deleted rather than emptied, so a package nobody asked a variant of is the
 * package that was always forged. What it promises is stronger than the Rider's,
 * though — a clause changes the lease and leaves the money alone, and a variant
 * leaves the money alone while changing the document the money is proved by.
 */
type VariantTab = "tax" | "insurance";

const RAIL_COPY: Record<VariantTab, { heading: string; legend: string; hint: string }> = {
  tax: {
    heading: "How the tax bills arrive",
    legend: "The county's practice",
    hint: "No two counties bill alike, and an auditor who has only seen one shape reads the second as an error. Tick these and the paper changes — the bills, the ledger memos, the collector's account. The figure does not: the property bears the same tax in the same year with every box ticked as with none.",
  },
  insurance: {
    heading: "How the insurance is billed",
    legend: "The carrier's practice",
    hint: "A package policy paid at inception is one shape; a programme priced coverage by coverage and financed over the year is another. Tick these and the invoice changes, and the ledger with it. The premium and the fees do not.",
  },
};

/**
 * A variant is set on the tab whose document it changes, and the key is deleted
 * rather than emptied — so a package nobody asked a variant of is the package
 * that was always forged. Both tabs write the same list, in catalog order.
 */
function setVariants(tab: VariantTab, ids: VariantId[]): void {
  const others = (state.config.variants ?? []).filter((id) => !variantsFor(tab).some((v) => v.id === id));
  const wanted = new Set([...others, ...ids]);
  const inOrder = VARIANT_IDS.filter((id) => wanted.has(id));
  if (inOrder.length === 0) delete state.config.variants;
  else state.config.variants = inOrder;
  reforge();
}

function variantRail(tab: VariantTab): HTMLElement {
  const selected = state.config.variants ?? [];
  const specs = variantsFor(tab);
  const copy = RAIL_COPY[tab];

  return h(
    "div",
    { class: "panel rail" },
    h("h3", {}, copy.heading),
    h("p", { class: "field-hint" }, copy.hint),
    h(
      "fieldset",
      {},
      h("legend", {}, copy.legend),
      ...specs.map((spec) => {
        const on = selected.includes(spec.id);
        const box = h("input", {
          type: "checkbox",
          onchange: (e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;
            const mine = specs.map((v) => v.id).filter((id) => selected.includes(id));
            setVariants(tab, checked ? [...mine, spec.id] : mine.filter((id) => id !== spec.id));
          },
        }) as HTMLInputElement;
        box.checked = on;
        return h("label", { class: "scheme" }, box, h("span", {}, h("strong", {}, spec.title), h("span", { class: "field-hint" }, spec.hint)));
      }),
    ),
    h(
      "div",
      { class: "row pad" },
      h("button", { type: "button", class: "ghost", onclick: () => setVariants(tab, specs.map((v) => v.id)) }, "All three"),
      h("button", { type: "button", class: "ghost", onclick: () => setVariants(tab, []) }, "None"),
    ),
  );
}

/**
 * The clause tree beside the lease. Ticking one adds it to the Rider, the forge
 * runs again, and the document to the right redraws with the clause in it — the
 * nearest thing in an app this fast to watching a lease be written.
 */
function leaseRail(): HTMLElement {
  const selected = state.config.clauses ?? [];

  return h(
    "div",
    { class: "panel rail" },
    h("h3", {}, "Build the Rider"),
    h(
      "p",
      { class: "field-hint" },
      "Clauses ride after Article VII, so nothing a finding cites ever moves. The Rider changes the lease and nothing else: every figure in the package is exactly what it was. The clause you added last is marked in the document, and on its line in the contents at the top.",
    ),
    ...RIDER_SECTIONS.map((section) =>
      h(
        "fieldset",
        {},
        h("legend", {}, section.title),
        ...section.clauses.map((clause) => {
          const on = selected.includes(clause.id);
          const box = h("input", {
            type: "checkbox",
            onchange: (e: Event) => {
              const checked = (e.target as HTMLInputElement).checked;
              setClauses(checked ? [...selected, clause.id] : selected.filter((id) => id !== clause.id), checked ? clause.id : state.latestClause);
            },
          }) as HTMLInputElement;
          box.checked = on;
          return h(
            "label",
            { class: "scheme" },
            box,
            h(
              "span",
              {},
              h("strong", {}, clause.title),
              on ? h("span", { class: "field-hint" }, `§${clause.ref} in the lease${clause.id === state.latestClause ? ", marked in it" : ""}`) : null,
            ),
          );
        }),
      ),
    ),
    h(
      "div",
      { class: "row pad" },
      h("button", { type: "button", class: "ghost", onclick: () => setClauses([...CLAUSE_IDS], null) }, "All twelve"),
      h("button", { type: "button", class: "ghost", onclick: () => setClauses([], null) }, "None"),
    ),
  );
}

// ---------------------------------------------------------------------------
// Downloads and the answer key
// ---------------------------------------------------------------------------

function downloadsPanel(): HTMLElement {
  const { model, answerKey } = state.scenario;
  const findings = answerKey.findings;

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
    h("p", { class: "field-hint" }, "Training mode is the switch at the end of the step bar. On, the answers stay hidden and a broken tie says only that it is broken."),
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

// ---------------------------------------------------------------------------
// The three steps
// ---------------------------------------------------------------------------

function stepBar(): HTMLElement {
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
    { class: "stepbar" },
    h(
      "div",
      { class: "steps", role: "tablist", "aria-label": "Where you are" },
      ...STEPS.map((s) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: "step" + (s.id === state.step ? " on" : ""),
            "aria-selected": s.id === state.step ? "true" : "false",
            onclick: () => goTo(s.id),
          },
          s.label,
        ),
      ),
    ),
    // Training mode belongs here rather than on one step: it decides what two
    // of the three show, so it has to be reachable from all of them.
    h("label", { class: "trainer" }, toggle, h("span", {}, "Training mode")),
  );
}

function goTo(step: Step): void {
  state.step = step;
  renderAll();
}

function stepNav(): HTMLElement | null {
  const i = STEPS.findIndex((s) => s.id === state.step);
  const back = STEPS[i - 1];
  const next = STEPS[i + 1];
  if (!back && !next) return null;
  return h(
    "div",
    { class: "stepnav" },
    back ? h("button", { type: "button", class: "ghost", onclick: () => goTo(back.id) }, `← ${back.label.replace(/^\d+ · /, "")}`) : h("span", {}),
    next ? h("button", { type: "button", class: "ghost", onclick: () => goTo(next.id) }, `${next.label.replace(/^\d+ · /, "")} →`) : null,
  );
}

/** Only the active step is built. `artifact()` zips a workbook; do it once. */
function stepPanel(): HTMLElement {
  if (state.step === "forge") {
    return h(
      "div",
      { class: "step-body" },
      describePanel(),
      forgePanel(),
      h("div", { class: "panel" }, h("button", { type: "button", class: "primary", onclick: () => goTo("read") }, "Forge it and read it →")),
    );
  }
  if (state.step === "take") {
    return h("div", { class: "step-body" }, downloadsPanel());
  }
  // A rail belongs to its own document: the clauses beside the lease, the
  // county's practice beside the tax backup, the carrier's beside the insurance.
  // Every other document takes the full width it was starved of before.
  const rail =
    state.tab === "lease" ? leaseRail() : state.tab === "tax" || state.tab === "insurance" ? variantRail(state.tab) : null;
  return h(
    "div",
    { class: "step-body" },
    tiesStrip(),
    rail === null ? previewPanel() : h("div", { class: "read-layout" }, rail, previewPanel()),
  );
}

function renderAll(): void {
  const root = $("app");
  clear(root);
  root.appendChild(h("div", { class: "layout" }, stepBar(), stepPanel(), stepNav()));
}

// The ties panel has to be checking, not decorating: recomputing from the model
// must agree with what forging reported.
if (checkTies(state.scenario.model).length !== state.scenario.breaks.length) {
  throw new Error("the ties panel and the forge disagree");
}

renderAll();
