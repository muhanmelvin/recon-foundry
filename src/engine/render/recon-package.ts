/**
 * The forged package, in the Red-Flag Scanner's own shape.
 *
 * This is the interchange between two apps in the family, and it travels as a
 * file — downloaded here, uploaded there, or committed as a fixture. There is no
 * runtime call between them, because the whole family is built on the promise
 * that a page can only load itself, and a cross-origin fetch would spend that
 * promise to save a click.
 *
 * Two conventions in here are not obvious and both come from reading the
 * scanner's own committed data (`src/data/mw-*.json`).
 *
 * **Per-line tenant amounts are omitted when a cap computation is shown.** With
 * a cap, what the tenant is charged for the capped pool is the pool figure on
 * the cap computation, not the sum of the lines — so a per-line tenant column
 * would not add to the tenant total, and the scanner's arithmetic check would
 * report a discrepancy that is really just a presentation choice. Real
 * statements do the same thing: they show the allocation in total.
 *
 * **An amortization line carries its capital block; an expensed one does not.**
 * That is the entire difference between a landlord recovering capital properly
 * and a landlord charging it in the year it was spent, and it is what lets the
 * scanner tell them apart.
 *
 * **The tax backup is the levy as issued, gross of any credit** (schema 1.1).
 * Netting a refund into `billed` here would destroy the only signal RF-13 has;
 * the credit travels as its own entry, exactly as the collector's account shows
 * it. Every package carries the block, clean ones included — a clean package
 * has to be invisible to RF-13 *running*, which is a stronger statement than
 * being invisible to RF-13 skipped.
 *
 * Amounts are dollars here, not cents: the schema says so, and this is the
 * boundary where the engine's integer cents turn back into money.
 */

import { creditsIn, parcelBilledIn } from "../model/tax.ts";
import type { ScenarioModel } from "../model/types.ts";
import { scenarioId } from "../model/answer-key.ts";
import { cappedPoolLabel } from "../model/categories.ts";
import { amortizationForYear } from "../scanner-rules.ts";
import { termDocumentName } from "../package/filenames.ts";
import { type Artifact } from "./artifact.ts";

function d(cents: number): number {
  return Math.round(cents) / 100;
}

export function toReconPackage(model: ScenarioModel): unknown {
  const u = model.universe;
  const lease = model.lease;
  const withCap = lease.cap !== undefined;

  return {
    meta: {
      package_id: scenarioId(model),
      property_name: u.property_name,
      tenant_name: u.tenant_name,
      premises_sf: lease.premises_sf,
      currency: "USD",
      schema_version: "1.1",
      story: storyOf(model),
    },
    lease_lite: {
      share: { numerator_sf: lease.premises_sf, denominator_basis: "GLA" },
      ...(lease.cap
        ? {
            cap: {
              applies_to: lease.cap.applies_to,
              pct: lease.cap.pct,
              method: lease.cap.method,
              basis: lease.cap.basis,
              base_year: lease.cap.base_year,
              base_year_amount: d(lease.cap.base_year_amount_cents),
              fee_treatment: lease.cap.fee_treatment,
            },
          }
        : {}),
      fees: [{ kind: lease.fee.kind, rate_pct: lease.fee.rate_pct, base: lease.fee.base }],
      capital_threshold: d(lease.capital_threshold_cents),
      capital_life_years: lease.capital_life_years,
      gross_up: { allowed: lease.gross_up.allowed, to_pct: lease.gross_up.to_pct },
    },
    years: model.years.map((y) => ({
      year: y.year,
      occupancy_pct: y.occupancy_pct,
      denominator_sf: y.denominator_sf,
      lines: y.pools.map((p) => {
        const project = p.capital_project_id ? model.capital_projects.find((c) => c.id === p.capital_project_id) : undefined;
        return {
          label: p.category,
          section: p.section,
          bucket: p.bucket,
          amount: d(p.amount_cents),
          ...(p.is_fee ? { is_fee: true } : {}),
          ...(project
            ? {
                capital: {
                  total_cost: d(project.total_cost_cents),
                  useful_life_months: project.recovery_period_months,
                  ...(project.interest_rate_pct ? { interest_rate_pct: project.interest_rate_pct } : {}),
                  in_service: project.amort_start,
                },
              }
            : {}),
          ...(withCap ? {} : { tenant_amount: d(Math.round((p.amount_cents * lease.share_pct) / 100)) }),
        };
      }),
      ...(lease.cap && y.recon.cap_allowed_cents !== null
        ? {
            cap_summary: {
              pool_label: cappedPoolLabel(lease.cap.pct),
              pool_actual: d(y.recon.controllable_actual_cents),
              pool_allowed: d(y.recon.cap_allowed_cents),
              pool_billed: d(y.recon.cap_billed_cents),
            },
          }
        : {}),
      tenant_summary: {
        pro_rata_share_pct: lease.share_pct,
        tenant_total: d(y.recon.tenant_total_cents),
        estimates_paid: d(y.recon.estimates_paid_cents),
        balance_due: d(y.recon.balance_due_cents),
      },
      ...taxBackupFor(model, y.year),
    })),
  };
}

/** The collector's account for one year, in the scanner's schema-1.1 shape. */
function taxBackupFor(model: ScenarioModel, year: number): { tax_backup?: unknown } {
  // One entry per parcel, whatever shape its bills arrived in: what the
  // county charged it this calendar year, and what it credited back. A fiscal
  // year or a supplemental changes the paper behind these two figures and not
  // the figures, which is why the scanner's own fixtures never move.
  const parcels = model.tax_parcels.flatMap((parcel) => {
    const billed = parcelBilledIn(parcel, year);
    if (billed === 0) return [];
    const credits = creditsIn(parcel, year);
    return [
      {
        parcel_id: parcel.parcel_id,
        billed: d(billed),
        ...(credits.length > 0
          ? {
              credits: credits.map((c) => ({
                amount: d(c.amount_cents),
                appeal_year: c.appeal_year,
                granted: c.granted,
                reference: c.docket,
              })),
            }
          : {}),
      },
    ];
  });
  return parcels.length > 0 ? { tax_backup: { parcels } } : {};
}

function storyOf(model: ScenarioModel): string {
  // A story the visitor wrote wins over the one the engine would compose. It is
  // the only human sentence anywhere in a forged package, and `bounds.ts` has
  // already held it to a caption's length and refused a name another app owns.
  const written = model.config.story;
  if (written !== undefined && written.trim() !== "") return written.trim();
  if (model.config.schemes.length === 0) {
    return `A clean package. Every document ties to the cent and there is nothing to find — which is what makes it worth scanning.`;
  }
  const named: Record<string, string> = {
    unamortized_capital: "capital expensed in a lump",
    above_cap_billing: "the cap grown on the cap",
    fee_base_expansion: "a fee on a base the lease does not permit",
    bucket_migration: "a controllable cost moved out of the capped pool",
    kept_tax_refund: "a tax refund kept",
    budget_tax_billing: "taxes billed at budget and never trued up",
    admin_fee_stacking: "a second fee for the service the first fee is for",
  };
  const list = model.config.schemes.map((s) => named[s] ?? s);
  const last = list.pop()!;
  return `Forged with ${list.length ? list.join(", ") + " and " : ""}${last}. Every other figure in the package ties.`;
}

export function renderReconPackageJson(model: ScenarioModel): Artifact {
  const lastYear = model.years[model.years.length - 1]!.year;
  return {
    filename: termDocumentName(model.universe.site_code, "Recon Package", model.delivery[lastYear]!, "json"),
    kind: "json",
    title: "ReconPackage (scanner format)",
    year: null,
    bytes: JSON.stringify(toReconPackage(model), null, 2) + "\n",
  };
}
