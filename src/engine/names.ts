/**
 * The name bank. Everything a forged package is called comes from here, drawn
 * by seed, so the same seed always produces the same property with the same
 * vendors and the same tax collector.
 *
 * Two rules govern what may go in these arrays.
 *
 * **Nothing real.** Not a property, not a tenant, not a vendor, not a county.
 * These are invented words assembled into plausible-sounding names, and the
 * deny-list gate is the backstop, not the mechanism.
 *
 * **Nothing already spoken for.** The Maplewood trio belongs to the Red-Flag
 * Scanner and is reproduced here as fixed demo scenarios, not grown from a
 * seed; every name it uses is excluded below, and `tests/names.test.ts` fails
 * if one creeps back in. Two apps in the family showing two different
 * "Maplewood Commerce Center" would quietly destroy the thing that makes them
 * worth showing together.
 *
 * Geography is fictional on purpose: see `FRANKLIN` and §9.4 of the build plan.
 */

import type { Rng } from "./rng.ts";

/** Names that belong to another app in the family and must never be drawn here. */
export const RESERVED_NAMES: readonly string[] = Object.freeze([
  "Maplewood",
  "Cedar Ridge",
  "Northgate",
  "Tessaro",
  "Halverson",
  "Copperline",
]);

/** The state every forged property stands in. There isn't one. */
export const FRANKLIN = Object.freeze({
  name: "Franklin",
  abbr: "FK",
  /** The Postal Service has never issued a 000xx ZIP. */
  zipPrefix: "000",
});

const PLACE_WORDS: readonly string[] = Object.freeze([
  "Ashford", "Bellamy", "Briarcliff", "Calderwood", "Chandler", "Dunmore",
  "Eastgate", "Fairlane", "Glenmoor", "Harrowfield", "Ironwood", "Kingsbury",
  "Larkspur", "Merrivale", "Norwood", "Oakhaven", "Pemberton", "Quarrytown",
  "Ravenswood", "Silverbrook", "Thornbury", "Underhill", "Warwick", "Westbrook",
  "Yardley", "Amberton", "Blackstone", "Coldwater", "Drummond", "Elmsford",
]);

const CENTER_WORDS: readonly string[] = Object.freeze([
  "Commerce Center", "Trade Center", "Business Park", "Crossing", "Plaza",
  "Marketplace", "Commons", "Exchange", "Station", "Landing",
]);

const OFFICE_WORDS: readonly string[] = Object.freeze([
  "Tower", "Center", "Place", "Financial Center", "Corporate Center", "Offices",
]);

const FLEX_WORDS: readonly string[] = Object.freeze([
  "Industrial Park", "Logistics Center", "Distribution Center", "Flex Center",
  "Commerce Park", "Business Center",
]);

const TENANT_FIRST: readonly string[] = Object.freeze([
  "Alder", "Brightline", "Carrow", "Delmarch", "Everly", "Fennimore", "Granville",
  "Havilland", "Ingleside", "Jessup", "Kettleman", "Lindquist", "Marchetti",
  "Nordstrand", "Ottoway", "Pallisade", "Quenton", "Rothwell", "Stroudmoor",
  "Tavistock", "Ulmer", "Vandermeer", "Whitlock", "Yarborough", "Zelnick",
]);

const TENANT_TRADE: readonly string[] = Object.freeze([
  "Home Goods", "Outfitters", "Supply Co.", "Furnishings", "Sporting Goods",
  "Market", "Pharmacy", "Trading Co.", "Apparel", "Hardware", "Bookshop",
  "Kitchenware", "Footwear", "Garden Center",
]);

const OFFICE_TENANT_TRADE: readonly string[] = Object.freeze([
  "Associates", "Partners", "Group", "Advisory", "Consulting", "Analytics",
  "Actuarial", "Engineering", "Diagnostics", "Underwriters",
]);

const OWNER_SUFFIX: readonly string[] = Object.freeze([
  "OWNER, LLC", "OWNER, L.L.C.", "PROPERTY OWNER, LLC", "REALTY HOLDINGS, LLC",
  "INVESTORS, LP", "PROPERTIES, LLC",
]);

const AGENT_SUFFIX: readonly string[] = Object.freeze([
  "Property Management", "Realty Services", "Commercial Management",
  "Asset Services", "Property Group",
]);

const COUNTY_WORDS: readonly string[] = Object.freeze([
  "Adair", "Bellrock", "Carrington", "Denbigh", "Ellsworth", "Fairmount",
  "Grayson", "Hollis", "Innsbrook", "Jarrell", "Kesterton", "Loudon",
]);

const STREET_WORDS: readonly string[] = Object.freeze([
  "Commerce", "Industrial", "Meridian", "Sycamore", "Foundry", "Millrace",
  "Wexford", "Sandhill", "Kestrel", "Barrowdale", "Copper Beech", "Tanner",
]);

const STREET_TYPE: readonly string[] = Object.freeze([
  "Boulevard", "Parkway", "Road", "Avenue", "Drive", "Way", "Lane",
]);

const CARRIERS: readonly string[] = Object.freeze([
  "Continental Mutual Casualty", "Granite Harbor Insurance Company",
  "Meridian Indemnity Group", "Ashland Fire & Marine", "Palisade Underwriters",
  "Sable Creek Mutual",
]);

/** One invented vendor per trade. The trade key matches the expense category. */
const VENDORS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  landscaping: ["Verdant Grounds Care", "Highfield Landscape Services", "Green Marrow Grounds"],
  sweeping: ["Broadside Lot Services", "Clearpath Sweeping", "Meridian Lot Care"],
  trash: ["Halcyon Waste Services", "Barrow Sanitation", "Cinder Ridge Disposal"],
  security: ["Sentinel Watch Services", "Keystone Patrol Group", "Northwind Security"],
  janitorial: ["Bright Hollow Building Services", "Clearline Janitorial", "Winnow Facility Care"],
  repairs: ["Tarrant Building Services", "Ridgeline Facility Repair", "Colefax Maintenance"],
  pest: ["Hollowbrook Pest Control", "Ambrose Pest Services", "Fenmark Exterminating"],
  fire_safety: ["Marchmont Fire Systems", "Kestrel Life Safety", "Ironvale Fire Protection"],
  electricity: ["Franklin Valley Electric Cooperative", "Cordell Power & Light", "Statewide Electric Authority"],
  water: ["Franklin Regional Water Authority", "Bellrock Water District", "Harrowfield Water & Sewer"],
  snow: ["Northline Snow Services", "Winterbourne Snow & Ice", "Glacier Ridge Plowing"],
  elevator: ["Aldergate Elevator Service", "Pinnacle Vertical Systems", "Cross Keys Elevator"],
  hvac_service: ["Thermalline Mechanical", "Ridgeway Climate Services", "Corbin Mechanical Group"],
  contractor: ["Halloway Construction Group", "Stonebridge Contracting", "Ferrisburg Builders"],
  management: ["—"], // filled from the management agent's own name
});

/** Trades that must have a vendor in every scenario. */
export const VENDOR_TRADES: readonly string[] = Object.freeze(Object.keys(VENDORS).filter((t) => t !== "management"));

export interface DrawnNames {
  property_name: string;
  landlord_entity: string;
  management_agent: string;
  tenant_name: string;
  county: string;
  tax_collector: string;
  street: string;
  city: string;
  insurance_carrier: string;
  vendors: Record<string, string>;
}

function titleToInitials(s: string): string {
  return s
    .replace(/[^A-Za-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * A site code in the tenant's own vocabulary: initials of the property plus a
 * digit, the way a national tenant labels a location it leases in a hundred
 * places. Deliberately short and opaque — it is what ends up on the filenames.
 */
export function siteCodeFor(propertyName: string, rng: Rng): string {
  const initials = titleToInitials(propertyName).slice(0, 3);
  return (initials.length >= 2 ? initials : initials + "X") + String(rng.int(1, 9));
}

export function drawNames(rng: Rng, kind: "retail_strip" | "office" | "industrial_flex"): DrawnNames {
  const place = rng.child("place").pick(PLACE_WORDS);
  const suffixes = kind === "office" ? OFFICE_WORDS : kind === "industrial_flex" ? FLEX_WORDS : CENTER_WORDS;
  const property_name = `${place} ${rng.child("suffix").pick(suffixes)}`;

  const ownerStem = place.toUpperCase();
  const landlord_entity = `${ownerStem} ${rng.child("owner").pick(OWNER_SUFFIX)}`;

  const agentPlace = rng.child("agent-place").pick(PLACE_WORDS.filter((p) => p !== place));
  const management_agent = `${agentPlace} ${rng.child("agent").pick(AGENT_SUFFIX)}`;

  const trades = kind === "office" ? OFFICE_TENANT_TRADE : TENANT_TRADE;
  const tenant_name = `${rng.child("tenant-first").pick(TENANT_FIRST)} ${rng.child("tenant-trade").pick(trades)}`;

  const county = `${rng.child("county").pick(COUNTY_WORDS)} County`;
  const tax_collector = `${county} Treasurer & Tax Collector`;
  const street = `${rng.child("street").pick(STREET_WORDS)} ${rng.child("street-type").pick(STREET_TYPE)}`;
  const city = rng.child("city").pick(PLACE_WORDS.filter((p) => p !== place && p !== agentPlace));

  const insurance_carrier = rng.child("carrier").pick(CARRIERS);

  const vendors: Record<string, string> = {};
  for (const trade of VENDOR_TRADES) {
    vendors[trade] = rng.child("vendor").child(trade).pick(VENDORS[trade]!);
  }
  vendors["management"] = management_agent;

  return {
    property_name,
    landlord_entity,
    management_agent,
    tenant_name,
    county,
    tax_collector,
    street,
    city,
    insurance_carrier,
    vendors,
  };
}

/** Every string the bank can produce, for the reserved-name test. */
export function allBankWords(): string[] {
  return [
    ...PLACE_WORDS, ...CENTER_WORDS, ...OFFICE_WORDS, ...FLEX_WORDS,
    ...TENANT_FIRST, ...TENANT_TRADE, ...OFFICE_TENANT_TRADE,
    ...OWNER_SUFFIX, ...AGENT_SUFFIX, ...COUNTY_WORDS, ...STREET_WORDS,
    ...STREET_TYPE, ...CARRIERS,
    ...Object.values(VENDORS).flatMap((v) => [...v]),
  ];
}
