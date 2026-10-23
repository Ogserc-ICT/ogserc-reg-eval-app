import type { IsoDate } from "./types";

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function toUtcMs(d: IsoDate): number {
  const m = ISO_RE.exec(d);
  if (!m) throw new Error(`Invalid date: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  return new Date(toUtcMs(s)).toISOString().slice(0, 10) === s;
}

export function addDays(d: IsoDate, days: number): IsoDate {
  return new Date(toUtcMs(d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function yearOf(d: IsoDate): number {
  return Number(d.slice(0, 4));
}

/** Today's calendar date in Africa/Lagos. The only impure helper; domain rules take `today` as a parameter. */
export function todayInLagos(now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "22 October 2026" */
export function formatDate(d: IsoDate): string {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** Certificate date parts: { day: "22nd", month: "October", year: "2026" } (SPEC §7). */
export function certificateDateParts(d: IsoDate): { day: string; month: string; year: string } {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return { day: ordinal(day), month: MONTHS[m - 1]!, year: String(y) };
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
