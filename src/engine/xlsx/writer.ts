/**
 * A minimal XLSX writer — enough spreadsheet to look like the workbook a
 * landlord's analyst actually sends, and not one feature more.
 *
 * What it does: several sheets, text and number cells, six cell formats, column
 * widths, a frozen header row. What it deliberately does not do: formulas,
 * merged cells, charts, conditional formatting, shared strings, or dates as
 * serial numbers. See docs/adr/0002-hand-rolled-xlsx.md — the scope is the
 * decision, and widening it silently is the failure mode the ADR exists to
 * prevent.
 *
 * Two choices are worth explaining because they look like shortcuts and are not.
 *
 * **Inline strings, not a shared-string table.** A shared-string table has to be
 * built in encounter order, which makes the bytes depend on the order the
 * renderer happened to visit cells in. Inline strings cost a few kilobytes and
 * remove a whole class of golden-test flapping.
 *
 * **Dates as text.** Excel stores a date as a day count from an epoch that is
 * itself a famous bug, and converting to it correctly means caring about the
 * timezone of the machine doing the converting — which this engine is not
 * allowed to know. Every date here is written as the string a reader wants to
 * see anyway, and the scanner's parser reads amounts, never dates.
 */

import { writeZip, utf8, type ZipEntry } from "../zip/zip.ts";

/** The six formats. Anything needing a seventh needs the ADR revisited first. */
export const S = {
  /** Body text. */
  text: 0,
  /** Column headers and section captions. */
  header: 1,
  /** An amount: #,##0.00 */
  money: 2,
  /** A total: the same, in bold, with a rule above it. */
  moneyTotal: 3,
  /** A share or a rate: 0.0000% */
  percent: 4,
  /** The small print that says the document is synthetic. */
  muted: 5,
} as const;

export type StyleId = (typeof S)[keyof typeof S];

export type Cell =
  | { kind: "blank"; style: StyleId }
  | { kind: "text"; value: string; style: StyleId }
  /** `value` is a decimal string so no float ever formats itself into the file. */
  | { kind: "number"; value: string; style: StyleId };

export const blank = (style: StyleId = S.text): Cell => ({ kind: "blank", style });
export const text = (value: string, style: StyleId = S.text): Cell => ({ kind: "text", value, style });
export const header = (value: string): Cell => ({ kind: "text", value, style: S.header });
export const muted = (value: string): Cell => ({ kind: "text", value, style: S.muted });

/** Integer cents → a money cell holding an exact decimal string. */
export function money(cents: number, style: StyleId = S.money): Cell {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const value = (neg ? "-" : "") + Math.floor(abs / 100) + "." + String(abs % 100).padStart(2, "0");
  return { kind: "number", value, style };
}

/** A percentage given as 12.6027 (meaning 12.6027%) → a percent-formatted cell. */
export function percent(pct: number): Cell {
  return { kind: "number", value: (pct / 100).toFixed(8), style: S.percent };
}

/** A plain count — square feet, months, a year. */
export function count(n: number): Cell {
  return { kind: "number", value: String(Math.round(n)), style: S.text };
}

export interface SheetSpec {
  /** Excel's own limits: at most 31 characters, and none of []:*?/\ */
  name: string;
  rows: Cell[][];
  /** Column widths in Excel's character units. */
  widths?: number[];
  /** Rows to freeze at the top, so the header survives scrolling. */
  freezeRows?: number;
}

export interface WorkbookMeta {
  title: string;
  /** Shown in the file's properties. Says the data is synthetic even when the sheet is not open. */
  description: string;
}

const CREATOR = "Recon Foundry — synthetic training data";
/** Fixed, not taken from the clock: see the module comment and ADR 0001. */
const FIXED_TIMESTAMP = "2026-01-01T00:00:00Z";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnRef(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function sheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim();
  if (cleaned.length === 0) throw new Error("sheet name is empty once Excel's forbidden characters are removed");
  return cleaned.slice(0, 31);
}

function sheetXml(sheet: SheetSpec): string {
  const rows = sheet.rows;
  const widest = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const dimension = `A1:${columnRef(widest - 1)}${Math.max(1, rows.length)}`;

  const pane =
    sheet.freezeRows && sheet.freezeRows > 0
      ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
      : "";

  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(2)}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  const body = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const ref = `${columnRef(c)}${r + 1}`;
          if (cell.kind === "blank") return cell.style === S.text ? "" : `<c r="${ref}" s="${cell.style}"/>`;
          if (cell.kind === "number") return `<c r="${ref}" s="${cell.style}"><v>${cell.value}</v></c>`;
          return `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    cols +
    `<sheetData>${body}</sheetData>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000%"/></numFmts>` +
  `<fonts count="3">` +
  `<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><sz val="9"/><color rgb="FF7A7A7A"/><name val="Calibri"/><family val="2"/></font>` +
  `</fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="2">` +
  `<border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top style="thin"><color rgb="FF999999"/></top><bottom/><diagonal/></border>` +
  `</borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="6">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // 0 text
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 1 header
  `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // 2 money
  `<xf numFmtId="4" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` + // 3 total
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // 4 percent
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 5 muted
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

export function writeWorkbook(sheets: readonly SheetSpec[], meta: WorkbookMeta): Uint8Array {
  if (sheets.length === 0) throw new Error("a workbook needs at least one sheet");
  const names = sheets.map((s) => sheetName(s.name));
  if (new Set(names).size !== names.length) throw new Error(`two sheets share a name: ${names.join(", ")}`);

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets
      .map(
        (_s, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const core =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(meta.title)}</dc:title>` +
    `<dc:subject>${esc(meta.description)}</dc:subject>` +
    `<dc:creator>${esc(CREATOR)}</dc:creator>` +
    `<cp:lastModifiedBy>${esc(CREATOR)}</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${FIXED_TIMESTAMP}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${FIXED_TIMESTAMP}</dcterms:modified>` +
    `</cp:coreProperties>`;

  const app =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>${esc(CREATOR)}</Application><Company></Company>` +
    `</Properties>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", bytes: utf8(contentTypes) },
    { path: "_rels/.rels", bytes: utf8(rootRels) },
    { path: "docProps/app.xml", bytes: utf8(app) },
    { path: "docProps/core.xml", bytes: utf8(core) },
    { path: "xl/workbook.xml", bytes: utf8(workbookXml) },
    { path: "xl/_rels/workbook.xml.rels", bytes: utf8(workbookRels) },
    { path: "xl/styles.xml", bytes: utf8(STYLES_XML) },
    ...sheets.map((s, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, bytes: utf8(sheetXml(s)) })),
  ];

  return writeZip(entries);
}
