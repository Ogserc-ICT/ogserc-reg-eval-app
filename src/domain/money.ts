import type { Kobo } from "./types";

export function nairaToKobo(naira: number): Kobo {
  return Math.round(naira * 100);
}

/** "₦2,800,000" or "₦1,234.50" when there are kobo. */
export function formatNaira(kobo: Kobo): string {
  const sign = kobo < 0 ? "-" : "";
  const abs = Math.abs(kobo);
  const naira = Math.floor(abs / 100);
  const rest = abs % 100;
  const whole = naira.toLocaleString("en-NG");
  return `${sign}₦${whole}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * Parse a naira amount typed by a user ("250,000", "₦1,234.50", "100000") into kobo.
 * Returns null if it is not a valid amount with at most two decimal places.
 */
export function parseNairaToKobo(input: string): Kobo | null {
  const cleaned = input.replace(/[₦,\s]/g, "");
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
