/**
 * A ZIP writer that stores rather than compresses.
 *
 * One module serves both jobs: an `.xlsx` file is a ZIP, and so is the package
 * a visitor downloads. Storing instead of deflating costs disk — a forged
 * package is a few hundred kilobytes either way — and buys the thing this app
 * is built on: **the same input produces the same bytes**. Every compressor
 * makes choices, and a compressor's choices are not part of anyone's contract;
 * a stored entry is the file itself, byte for byte, which is what lets a golden
 * test pin a SHA-256 and mean it.
 *
 * The other two sources of drift are dealt with the same way. Timestamps are
 * fixed at 2026-01-01 00:00:00 rather than taken from the clock, and entries are
 * written in sorted filename order rather than in whatever order the caller
 * happened to build them.
 *
 * No compression, no ZIP64, no encryption, no data descriptors. Archives stay
 * well under the 4 GB and 65,535-entry limits that would require any of them,
 * and `writeZip` throws rather than silently producing a broken file if that
 * ever stops being true.
 */

import { crc32 } from "./crc32.ts";

export interface ZipEntry {
  /** Forward slashes, no leading slash. A trailing slash makes it a directory. */
  path: string;
  bytes: Uint8Array;
}

/** 2026-01-01 00:00:00 in the MS-DOS packing ZIP has used since 1989. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

class ByteSink {
  private parts: Uint8Array[] = [];
  private length = 0;

  get offset(): number {
    return this.length;
  }

  push(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }

  u16(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }

  u32(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * `entries` in any order; the archive is written in sorted path order so the
 * bytes do not depend on how the caller assembled it.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const seen = new Set<string>();
  for (const e of sorted) {
    if (seen.has(e.path)) throw new Error(`writeZip: duplicate entry ${e.path}`);
    seen.add(e.path);
    if (e.path.startsWith("/")) throw new Error(`writeZip: absolute path ${e.path}`);
    if (e.bytes.length > MAX_SIZE) throw new Error(`writeZip: ${e.path} needs ZIP64, which this writer does not do`);
  }
  if (sorted.length > MAX_ENTRIES) throw new Error("writeZip: too many entries for a non-ZIP64 archive");

  const body = new ByteSink();
  const central: Array<{ name: Uint8Array; crc: number; size: number; offset: number; isDir: boolean }> = [];

  for (const e of sorted) {
    const name = utf8(e.path);
    const isDir = e.path.endsWith("/");
    const bytes = isDir ? new Uint8Array(0) : e.bytes;
    const crc = crc32(bytes);
    const offset = body.offset;

    body.u32(LOCAL_SIG);
    body.u16(20); // version needed
    body.u16(0x0800); // flags: names are UTF-8
    body.u16(0); // method: stored
    body.u16(DOS_TIME);
    body.u16(DOS_DATE);
    body.u32(crc);
    body.u32(bytes.length); // compressed size
    body.u32(bytes.length); // uncompressed size
    body.u16(name.length);
    body.u16(0); // no extra field
    body.push(name);
    body.push(bytes);

    central.push({ name, crc, size: bytes.length, offset, isDir });
  }

  const dir = new ByteSink();
  for (const c of central) {
    dir.u32(CENTRAL_SIG);
    dir.u16(20); // version made by
    dir.u16(20); // version needed
    dir.u16(0x0800);
    dir.u16(0);
    dir.u16(DOS_TIME);
    dir.u16(DOS_DATE);
    dir.u32(c.crc);
    dir.u32(c.size);
    dir.u32(c.size);
    dir.u16(c.name.length);
    dir.u16(0); // extra
    dir.u16(0); // comment
    dir.u16(0); // disk number
    dir.u16(0); // internal attributes
    dir.u32(c.isDir ? 0x10 : 0); // external attributes: the DOS directory bit
    dir.u32(c.offset);
    dir.push(c.name);
  }

  const out = new ByteSink();
  const bodyBytes = body.concat();
  const dirBytes = dir.concat();
  out.push(bodyBytes);
  out.push(dirBytes);
  out.u32(END_SIG);
  out.u16(0); // this disk
  out.u16(0); // disk with the central directory
  out.u16(central.length);
  out.u16(central.length);
  out.u32(dirBytes.length);
  out.u32(bodyBytes.length);
  out.u16(0); // no archive comment
  return out.concat();
}
