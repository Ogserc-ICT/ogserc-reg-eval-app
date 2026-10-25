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

/** A checklist item's state in words; for automatic items, why it is set. */
export function documentStatusText(d: {
  mode: "manual" | "auto-na" | "auto";
  value: "Y" | "N" | "N/A" | null;
}): string {
  if (d.mode === "auto-na") return "N/A – its condition is answered No";
  if (d.mode === "auto") {
    if (d.value === "Y") return "Received – Finance confirmed the fee";
    if (d.value === "N/A") return "N/A – nothing to pay";
    return "Pending – ticks itself once Finance confirms the fee";
  }
  if (d.value === "Y") return "Received";
  if (d.value === "N") return "Outstanding";
  if (d.value === "N/A") return "N/A";
  return "Pending";
}
