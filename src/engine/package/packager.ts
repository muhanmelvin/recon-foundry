/**
 * Assembling the package: every document, in folders, as one ZIP.
 *
 * The layout is the one a tenant's lease administrator would recognise — a
 * folder per reconciliation year, holding what belongs to that year, and the
 * papers that span the whole term at the root, because a lease belongs to no
 * single year.
 *
 * The answer key sits in its own folder, named so it sorts to the top and reads
 * as a warning. It is *included*, not withheld: a trainer needs it, and a
 * downloaded ZIP that quietly lacked half its contents would be worse than one
 * whose dangerous folder is obvious. The page says plainly that it is in there
 * and to delete it before handing the package out.
 */

import { writeZip, utf8, type ZipEntry } from "../zip/zip.ts";
import { renderReconWorkbook, renderAmortizationWorkbook, renderTenantLedger } from "../render/workbook.ts";
import { renderBillingStatement, renderInsuranceBackup, renderLease, renderProjectBackup, renderTaxBackup } from "../render/documents.ts";
import { renderReconPackageJson } from "../render/recon-package.ts";
import { renderAnswerSheet } from "../render/answer-sheet.ts";
import { toScannerManifest, type AnswerKey } from "../model/answer-key.ts";
import { forgeName, syntheticNotice, type Artifact } from "../render/artifact.ts";
import { ANSWER_KEY_FOLDER, packageFolder, termDocumentName } from "./filenames.ts";
import type { ScenarioModel } from "../model/types.ts";

export interface PackageContents {
  /** Everything, with the folder each document belongs in already on its path. */
  entries: Array<{ path: string; artifact: Artifact }>;
  /** The paths under the answer-key folder, so the UI can say what is in there. */
  answerKeyPaths: string[];
}

/** Every document a scenario produces, with its place in the package. */
export function packageContents(model: ScenarioModel, key: AnswerKey): PackageContents {
  const site = model.universe.site_code;
  const entries: Array<{ path: string; artifact: Artifact }> = [];

  for (const y of model.years) {
    const folder = packageFolder(site, y.year);
    const perYear: Array<Artifact | null> = [
      renderReconWorkbook(model, y.year),
      renderBillingStatement(model, y.year),
      renderTaxBackup(model, y.year),
      renderInsuranceBackup(model, y.year),
      renderAmortizationWorkbook(model, y.year),
      renderProjectBackup(model, y.year),
    ];
    for (const a of perYear) if (a) entries.push({ path: `${folder}/${a.filename}`, artifact: a });
  }

  for (const a of [renderLease(model), renderTenantLedger(model)]) {
    entries.push({ path: a.filename, artifact: a });
  }

  const lastYear = model.years[model.years.length - 1]!.year;
  const answer = renderAnswerSheet(model, key);
  const keyJson: Artifact = {
    filename: `${ANSWER_KEY_FOLDER}/${termDocumentName(site, "Answer Key", model.delivery[lastYear]!, "json")}`,
    kind: "json",
    title: "Answer key (JSON)",
    year: null,
    bytes: JSON.stringify(key, null, 2) + "\n",
  };
  const manifest: Artifact = {
    filename: `${ANSWER_KEY_FOLDER}/${termDocumentName(site, "Findings Manifest", model.delivery[lastYear]!, "json")}`,
    kind: "json",
    title: "Findings manifest (scanner format)",
    year: null,
    bytes: JSON.stringify(toScannerManifest(key), null, 2) + "\n",
  };
  const pkgJson = renderReconPackageJson(model);
  const pkgJsonInKey: Artifact = { ...pkgJson, filename: `${ANSWER_KEY_FOLDER}/${pkgJson.filename}` };

  for (const a of [answer, keyJson, manifest, pkgJsonInKey]) entries.push({ path: a.filename, artifact: a });

  return { entries, answerKeyPaths: entries.map((e) => e.path).filter((p) => p.startsWith(ANSWER_KEY_FOLDER + "/")) };
}

/** The note at the root of the ZIP, for whoever opens it without context. */
export function aboutText(model: ScenarioModel, key: AnswerKey): string {
  const u = model.universe;
  const lines = [
    "ABOUT THIS PACKAGE",
    "",
    syntheticNotice(model.config.branding),
    "",
    `Property:      ${u.property_name}, ${u.address.line1}, ${u.address.city}, ${u.address.state} ${u.address.zip}`,
    `Tenant:        ${u.tenant_name}, ${u.premises_suite}`,
    `Years:         ${model.years.map((y) => y.year).join(", ")}`,
    `Seed:          ${key.seed}`,
    `Scenario:      ${key.scenario_id}`,
    // Only when there is one. A package with no Rider says nothing about a
    // Rider, so its ZIP is the file it always was.
    ...((model.config.clauses?.length ?? 0) > 0 ? [`Rider:         ${model.config.clauses!.length} additional clause(s) in the lease`] : []),
    "",
    "There is no such place as the State of Franklin, and no such ZIP code as",
    `${u.address.zip}. Every party, vendor, parcel, policy and figure in these`,
    `documents was invented by ${forgeName(model.config.branding)}. Nothing here is a real lease, a`,
    "real property, or a real client's reconciliation.",
    "",
    "Forge this package again from the same seed and you will get the same bytes,",
    "so a class of twenty can be handed identical copies.",
    "",
    key.findings.length === 0
      ? "This package is clean: every figure ties, and there is nothing to find."
      : `${key.findings.length} finding(s) are planted in it, worth ${(key.total_planted_tenant_impact_cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} to the tenant.`,
    "",
    `The "${ANSWER_KEY_FOLDER}" folder contains the answer key, the findings manifest and`,
    "the machine-readable package. DELETE THAT FOLDER before handing this to anyone",
    "who is meant to work the exercise.",
    "",
  ];
  return lines.join("\r\n");
}

/** The whole package as one ZIP. */
export function buildPackageZip(model: ScenarioModel, key: AnswerKey): { filename: string; bytes: Uint8Array } {
  const { entries } = packageContents(model, key);
  const zipEntries: ZipEntry[] = entries.map((e) => ({
    path: e.path,
    bytes: typeof e.artifact.bytes === "string" ? utf8(e.artifact.bytes) : e.artifact.bytes,
  }));
  zipEntries.push({ path: "_ABOUT THIS PACKAGE.txt", bytes: utf8(aboutText(model, key)) });

  const years = model.years.map((y) => y.year);
  return {
    filename: `${model.universe.site_code}_${years[0]}-${years[years.length - 1]} OPEX RECON PACKAGE.zip`,
    bytes: writeZip(zipEntries),
  };
}
