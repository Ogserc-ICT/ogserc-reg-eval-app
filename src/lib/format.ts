import { formatDate } from "@/domain/dates";
import { formatNaira } from "@/domain/money";

/** Display helpers: "—" for missing values. */
export const dash = "—";
export const showDate = (d: string | null | undefined) => (d ? formatDate(d) : dash);
export const showMoney = (kobo: number | null | undefined) =>
  kobo === null || kobo === undefined ? dash : formatNaira(kobo);
export const showText = (s: string | number | null | undefined) =>
  s === null || s === undefined || s === "" ? dash : String(s);
/** Kobo → plain naira text for a form field, e.g. 25000000 → "250000". */
export const nairaInput = (kobo: number) =>
  kobo % 100 ? (kobo / 100).toFixed(2) : String(kobo / 100);
