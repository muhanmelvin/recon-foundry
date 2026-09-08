/**
 * The names on the paper.
 *
 * A forged package says who forged it — at the foot of every page, in the
 * workbook's file properties, and in the note at the root of the ZIP. Those
 * sentences name this app, which is right for a package this app hands out and
 * wrong for one forged under a sibling's masthead. `ScenarioConfig.branding`
 * is how a caller replaces them.
 *
 * Two things have to be true, and they pull in opposite directions, which is
 * why they are tested together here:
 *
 *   **Set, the names are gone.** Not softened, not left in a corner of the
 *   XML — gone from every artifact in the package, the parts of the workbook a
 *   spreadsheet shows in File → Properties included. A leak there is the kind
 *   nobody finds by reading the page.
 *
 *   **Absent, nothing moved.** Every string is the string it always was. The
 *   pinned fixtures in `tests/describe-regression.test.ts` and the scanner's
 *   own `tests/foundry.test.ts` rest on that, so it is asserted here directly
 *   rather than left to be inferred from a hash somewhere else.
 *
 * A branded package is otherwise the same package: same figures, same ties,
 * same answer key. `toReconPackage` is the proof, since it is what the scanner
 * reads, and it must not notice.
 */

import { describe, expect, it } from "vitest";
import { forge } from "../src/engine/forge.ts";
import { buildPackageZip, packageContents } from "../src/engine/package/packager.ts";
import { toReconPackage } from "../src/engine/render/recon-package.ts";
import { renderReconWorkbook } from "../src/engine/render/workbook.ts";
import { renderAnswerSheet } from "../src/engine/render/answer-sheet.ts";
import { creatorName, forgeName, scannerName, syntheticNotice, FORGE_NAME, SCANNER_NAME, SYNTHETIC_NOTICE } from "../src/engine/render/artifact.ts";
import { validateScenarioConfig, BRAND_NAME_MAX_CHARS, BRAND_NOTICE_MAX_CHARS } from "../src/engine/model/bounds.ts";
import type { ScenarioConfig } from "../src/engine/model/types.ts";
import { readZip, readWorkbook } from "./helpers/read-xlsx.ts";

/** Every scheme, so the answer sheet has finding cards and the ZIP has every document. */
const BASE: ScenarioConfig = {
  seed: "branding-1",
  start_year: 2022,
  year_count: 3,
  property_kind: "office",
  size_band: "medium",
  schemes: ["above_cap_billing", "unamortized_capital", "kept_tax_refund"],
};

const BRANDED: ScenarioConfig = {
  ...BASE,
  branding: {
    forge: "The Statement Workshop",
    scanner: "scanner we run",
    notice: "Sample document. Every party, property and figure is fictional.",
  },
};

function textOfAll(config: ScenarioConfig): string[] {
  const { model, answerKey } = forge(config);
  const { entries } = packageContents(model, answerKey);
  const out: string[] = [];
  for (const e of entries) {
    const a = e.artifact;
    out.push(a.filename, a.title);
    if (typeof a.bytes === "string") {
      out.push(a.bytes);
    } else if (a.kind === "xlsx") {
      // The XML inside, not the bytes — a name in docProps is invisible to a
      // substring search over a deflated archive and perfectly visible in Excel.
      for (const part of readZip(a.bytes)) out.push(new TextDecoder().decode(part.bytes));
    }
  }
  const zip = buildPackageZip(model, answerKey);
  for (const part of readZip(zip.bytes)) {
    out.push(part.path);
    if (!part.path.endsWith(".xlsx")) out.push(new TextDecoder().decode(part.bytes));
  }
  return out;
}

describe("branding replaces the names on the paper", () => {
  const branded = textOfAll(BRANDED);

  it("leaves this app's name nowhere in the package", () => {
    const leaks = branded.filter((t) => t.includes(FORGE_NAME) || t.includes(SCANNER_NAME));
    expect(leaks).toEqual([]);
  });

  it("puts the caller's names there instead", () => {
    const joined = branded.join("\n");
    expect(joined).toContain("The Statement Workshop");
    expect(joined).toContain("scanner we run");
    expect(joined).toContain("Sample document. Every party, property and figure is fictional.");
  });

  it("reaches the workbook's own file properties, which no page shows", () => {
    const { model } = forge(BRANDED);
    const parts = readZip(renderReconWorkbook(model, model.years[0]!.year).bytes as Uint8Array);
    const props = parts
      .filter((p) => p.path === "docProps/core.xml" || p.path === "docProps/app.xml")
      .map((p) => new TextDecoder().decode(p.bytes));
    expect(props).toHaveLength(2);
    for (const xml of props) {
      expect(xml).not.toContain(FORGE_NAME);
      expect(xml).toContain("The Statement Workshop");
    }
  });

  it("supplies the name and not the article, so the sentence still reads", () => {
    // The answer sheet says "the <scanner>". A name that reads as a noun phrase
    // after "the" is what a caller has to pass — which is why the default is
    // "Red-Flag Scanner" and not "the Red-Flag Scanner".
    // Only a clean package's answer sheet says it, so this is the one assertion
    // here that cannot use the schemed config above.
    const clean = { ...BRANDED, schemes: [] };
    const { model, answerKey } = forge(clean);
    const sheet = renderAnswerSheet(model, answerKey).bytes as string;
    expect(sheet).toContain("and the scanner we run finds nothing");
    expect(renderAnswerSheet(forge({ ...BASE, schemes: [] }).model, forge({ ...BASE, schemes: [] }).answerKey).bytes as string).toContain(
      `and the ${SCANNER_NAME} finds nothing`,
    );
  });

  it("does not reach the package the scanner reads", () => {
    // The interchange carries figures, not letterheads. If branding could move
    // a single byte here it could move a finding.
    expect(toReconPackage(forge(BRANDED).model)).toEqual(toReconPackage(forge(BASE).model));
  });
});

describe("absent, nothing moved", () => {
  it("composes exactly the notice the constant always held", () => {
    expect(syntheticNotice()).toBe(SYNTHETIC_NOTICE);
    expect(syntheticNotice({})).toBe(SYNTHETIC_NOTICE);
    expect(forgeName()).toBe(FORGE_NAME);
    expect(scannerName()).toBe(SCANNER_NAME);
  });

  it("agrees with the writer's own creator string", () => {
    // `xlsx/writer.ts` holds the un-branded creator as its own constant rather
    // than importing it from the renderers, so this is what keeps the two from
    // drifting apart.
    const { model } = forge(BASE);
    const book = readWorkbook(renderReconWorkbook(model, model.years[0]!.year).bytes as Uint8Array);
    expect(book.core).toContain(`<dc:creator>${creatorName()}</dc:creator>`);
  });

  it("forges the same documents with an empty branding object as with none", () => {
    // The same rule the Rider and the Variants follow: an empty list forges the
    // documents an absent one forges, and the answer key records the config as
    // it was passed, so that one file differs by the few bytes of the key
    // itself. Everything a visitor is handed is identical.
    const documents = (config: ScenarioConfig): Array<[string, string]> => {
      const { model, answerKey } = forge(config);
      return packageContents(model, answerKey)
        .entries.filter((e) => !e.path.endsWith("Answer Key_08.18.25.json"))
        .map((e) => [e.path, typeof e.artifact.bytes === "string" ? e.artifact.bytes : Buffer.from(e.artifact.bytes).toString("base64")]);
    };
    const plain = documents(BASE);
    expect(plain.length).toBeGreaterThan(20);
    expect(documents({ ...BASE, branding: {} })).toEqual(plain);
  });
});

describe("what the forge will not be called", () => {
  function errors(branding: unknown): string[] {
    return validateScenarioConfig({ ...BASE, branding } as ScenarioConfig);
  }

  it("refuses a name another app in the family already answers to", () => {
    expect(errors({ forge: "Maplewood Commerce Center" }).join(" ")).toContain("belongs to another app");
    expect(errors({ notice: "A Cedar Ridge document." }).join(" ")).toContain("belongs to another app");
  });

  it("refuses a name longer than a name", () => {
    expect(errors({ forge: "x".repeat(BRAND_NAME_MAX_CHARS + 1) }).join(" ")).toContain("over the");
    expect(errors({ forge: "x".repeat(BRAND_NAME_MAX_CHARS) })).toEqual([]);
    expect(errors({ notice: "x".repeat(BRAND_NOTICE_MAX_CHARS + 1) }).join(" ")).toContain("over the");
  });

  it("refuses a blank name, which is not the same as no name", () => {
    expect(errors({ scanner: "   " }).join(" ")).toContain("leave it out altogether");
  });

  it("refuses branding that is not an object", () => {
    expect(errors("The Statement Workshop").join(" ")).toContain("are an object");
    expect(errors(["a"]).join(" ")).toContain("are an object");
  });

  it("accepts the branding a sibling app would actually pass", () => {
    expect(validateScenarioConfig(BRANDED)).toEqual([]);
    expect(validateScenarioConfig(BASE)).toEqual([]);
  });
});
