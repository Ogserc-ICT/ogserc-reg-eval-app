// CSV for Excel: UTF-8 with a byte-order mark (so ₦ and accents open correctly), CRLF line ends.

export type Cell = string | number | null | undefined;

/**
 * Text that starts with = + - @ (or a tab/carriage return) would run as a formula when opened in a
 * spreadsheet. Prefix it with an apostrophe so it shows as text. Numbers are written as they are.
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
