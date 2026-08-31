/**
 * The two knobs the "describe your business" panel fills — `premises_sf` and
 * `opex_psf_target` — are optional on `ScenarioConfig`, and optional here is a
 * promise about bytes: a config that omits them must forge what it forged
 * before the knobs existed. Not "the same arithmetic"; the same file.
 *
 * That promise has a consumer outside this repo. The Red-Flag Scanner commits
 * three packages forged here (`tests/fixtures/foundry`, via
 * tools/export-fixtures.mjs) and runs its real engine over them. If a default
 * forge moved, those fixtures would be stale in the other repo, on a commit made
 * in this one — which is exactly the silent drift the fixture pair exists to
 * catch, arriving from the wrong direction.
 *
 * The hashes below were captured by `node tools/capture-regression.mjs` before
 * any of the describe work landed. A red test here is a question: did forged
 * output change on purpose? Recapturing to get green answers nothing.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { forge } from "../src/engine/forge.ts";
import { toReconPackage } from "../src/engine/render/recon-package.ts";
import { buildPackageZip } from "../src/engine/package/packager.ts";
import type { ScenarioConfig } from "../src/engine/model/types.ts";

const fixtures = resolve(__dirname, "fixtures");

interface Captured {
  name: string;
  config: ScenarioConfig;
  package_sha256: string;
  zip_filename: string;
  zip_sha256: string;
  zip_bytes: number;
}

const captured: Captured[] = JSON.parse(readFileSync(join(fixtures, "regression.json"), "utf8")).configs;

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

describe("a config without the new knobs forges the bytes it always did", () => {
  it("has fixtures to check against", () => {
    expect(captured.length).toBeGreaterThan(0);
  });

  it.each(captured.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    // The knobs must be genuinely absent, not present-and-undefined: the point
    // is the path a config takes when nobody has described anything.
    expect("premises_sf" in c.config).toBe(false);
    expect("opex_psf_target" in c.config).toBe(false);

    const { model, answerKey } = forge(c.config);

    const pkg = JSON.stringify(toReconPackage(model), null, 2) + "\n";
    expect(pkg).toEqual(readFileSync(join(fixtures, `${c.name}.package.json`), "utf8"));
    expect(sha256(pkg)).toEqual(c.package_sha256);

    // The ZIP covers what the JSON cannot: the workbooks, the prose lease, the
    // answer key. A change that moved only those would slip past the JSON check.
    const zip = buildPackageZip(model, answerKey);
    expect(zip.filename).toEqual(c.zip_filename);
    expect(zip.bytes.length).toEqual(c.zip_bytes);
    expect(sha256(zip.bytes)).toEqual(c.zip_sha256);
  });
});
