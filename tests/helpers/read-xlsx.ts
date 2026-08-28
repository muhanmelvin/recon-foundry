/**
 * A reader for the writer's own output. Test-only — it never ships.
 *
 * Its whole purpose is to be a *different* piece of code from the writer. A
 * golden hash proves the bytes have not changed; it does not prove they were
 * ever right. Reading the file back through an independent parser and finding
 * the model's own figures in the grid is what proves that.
 *
 * It understands exactly the subset the writer emits: stored (uncompressed) zip
 * entries, inline strings, numbers. It would choke on a real-world workbook, and
 * that is fine.
 */

import { inflateSync } from "node:zlib";

export type SheetGrid = string[][];

interface RawEntry {
  path: string;
  bytes: Uint8Array;
}

function u16(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8);
}

function u32(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

/** Walks the central directory rather than scanning for local headers. */
export function readZip(zip: Uint8Array): RawEntry[] {
  let end = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (u32(zip, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip: no end-of-central-directory record");

  const count = u16(zip, end + 10);
  let at = u32(zip, end + 16);
  const out: RawEntry[] = [];
  const dec = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (u32(zip, at) !== 0x02014b50) throw new Error(`central directory entry ${n} has the wrong signature`);
    const method = u16(zip, at + 10);
    const size = u32(zip, at + 24);
    const nameLen = u16(zip, at + 28);
    const extraLen = u16(zip, at + 30);
    const commentLen = u16(zip, at + 32);
    const localAt = u32(zip, at + 42);
    const path = dec.decode(zip.subarray(at + 46, at + 46 + nameLen));

    if (u32(zip, localAt) !== 0x04034b50) throw new Error(`${path}: local header has the wrong signature`);
    const localNameLen = u16(zip, localAt + 26);
    const localExtraLen = u16(zip, localAt + 28);
    const dataAt = localAt + 30 + localNameLen + localExtraLen;
    const raw = zip.subarray(dataAt, dataAt + u32(zip, localAt + 18));
    const bytes = method === 0 ? raw : new Uint8Array(inflateSync(Buffer.from(raw), { windowBits: -15 }));
    if (method === 0 && bytes.length !== size) throw new Error(`${path}: stored entry is the wrong length`);

    out.push({ path, bytes });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function textOf(entries: RawEntry[], path: string): string {
  const e = entries.find((x) => x.path === path);
  if (!e) throw new Error(`missing part: ${path} (have ${entries.map((x) => x.path).join(", ")})`);
  return new TextDecoder().decode(e.bytes);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Column reference letters → a zero-based index. */
export function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface Workbook {
  sheetNames: string[];
  sheets: Record<string, SheetGrid>;
  /** Every part in the archive, for structural assertions. */
  parts: string[];
  core: string;
}

export function readWorkbook(zip: Uint8Array): Workbook {
  const entries = readZip(zip);
  const workbook = textOf(entries, "xl/workbook.xml");
  const sheetNames = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((m) => unescapeXml(m[1]!));

  const sheets: Record<string, SheetGrid> = {};
  sheetNames.forEach((name, i) => {
    const xml = textOf(entries, `xl/worksheets/sheet${i + 1}.xml`);
    const grid: SheetGrid = [];
    for (const rowMatch of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const r = Number(rowMatch[1]) - 1;
      const row: string[] = [];
      for (const cell of rowMatch[2]!.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const c = columnIndex(cell[1]!);
        const inner = cell[2] ?? "";
        const inline = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(inner);
        const num = /<v>([^<]*)<\/v>/.exec(inner);
        while (row.length <= c) row.push("");
        row[c] = inline ? unescapeXml(inline[1]!) : num ? num[1]! : "";
      }
      while (grid.length <= r) grid.push([]);
      grid[r] = row;
    }
    sheets[name] = grid;
  });

  return { sheetNames, sheets, parts: entries.map((e) => e.path).sort(), core: textOf(entries, "docProps/core.xml") };
}

/** Integer cents from a money cell's decimal string. */
export function centsOf(cell: string | undefined): number | null {
  if (!cell) return null;
  const m = /^(-?)(\d+)\.(\d\d)$/.exec(cell);
  if (!m) return null;
  const v = Number(m[2]) * 100 + Number(m[3]);
  return m[1] === "-" ? -v : v;
}
