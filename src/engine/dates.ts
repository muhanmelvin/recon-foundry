/**
 * Calendar arithmetic, done from arguments and never from the clock.
 *
 * The engine may compute any date it likes; what it may not do is ask the
 * machine what today is. A package forged on Tuesday and a package forged on
 * Thursday from the same seed must be the same package, down to the delivery
 * date printed on the billing statement — so delivery dates are derived from
 * the reconciliation year and the seed, never from the system clock.
 * `tests/determinism-guards.test.ts` enforces that.
 */

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in month `m` (1–12) of `year`. */
export function daysInMonth(year: number, m: number): number {
  if (m === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[m - 1]!;
}

/** ISO date from parts. Clamps the day to the end of the month. */
export function iso(year: number, month: number, day: number): string {
  const d = Math.min(Math.max(1, day), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "2024-03" — the period a ledger row belongs to. */
export function period(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function parseIso(s: string): DateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`not an ISO date: ${s}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Absolute month index, so month arithmetic never wraps a year by accident. */
export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function fromMonthIndex(idx: number): { year: number; month: number } {
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function addMonths(s: string, n: number): string {
  const { year, month, day } = parseIso(s);
  const t = fromMonthIndex(monthIndex(year, month) + n);
  return iso(t.year, t.month, day);
}

export function addDays(s: string, n: number): string {
  let { year, month, day } = parseIso(s);
  day += n;
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  while (day < 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    day += daysInMonth(year, month);
  }
  return iso(year, month, day);
}

/** Sort key for ISO dates — they sort lexicographically, but say so out loud. */
export function byIsoDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function monthName(m: number): string {
  return MONTH_NAMES[m - 1]!;
}

/** "April 17, 2025" — how a letter dates itself. */
export function longDate(s: string): string {
  const { year, month, day } = parseIso(s);
  return `${monthName(month)} ${day}, ${year}`;
}

/** "04.17.25" — how the landlord's file server dates a filename. */
export function fileDate(s: string): string {
  const { year, month, day } = parseIso(s);
  return `${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}.${String(year % 100).padStart(2, "0")}`;
}

/** "4/17/2025" — how a spreadsheet cell shows it. */
export function shortDate(s: string): string {
  const { year, month, day } = parseIso(s);
  return `${month}/${day}/${year}`;
}
