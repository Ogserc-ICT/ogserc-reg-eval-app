// The uniform 13-item Schedule 2 checklist used before the category-specific forms (seed
// `schedule2_documents_legacy`; also the workbook's Document Checklist columns). Existing values carry over
// to the per-form keys where an old item and a new one are the same document; the rest stay pending.

import { PAYMENT_EVIDENCE_KEY, type RegistrationFormDef } from "./forms";
import type { CheckValue } from "./types";

/**
 * New key(s) for each old item, by item number. Where several keys are listed, each form has at
 * most one of them. `null`: no single new item matches, so the value is not carried over.
 */
export const LEGACY_DOCUMENT_KEYS: Readonly<Record<number, readonly string[] | null>> = {
  1: ["incorporation"],
  2: ["constitution"],
  3: ["licences"],
  4: ["single_line_diagram"],
  5: ["asset_register"],
  6: ["financials"],
  // "PPAs, gas, bulk supply & franchise agreements" is now split into several separate items.
  7: null,
  8: ["tariff_order"],
  9: ["customer_enumeration"],
  10: ["env_safety_permits", "env_permits_eia", "env_permits"],
  11: ["board_resolution"],
  // Evidence of payment now ticks itself from Finance-confirmed payments; nothing to carry over.
  12: [PAYMENT_EVIDENCE_KEY],
  // "Ogun asset/customer register & boundary points" is only part of the new multi-State item
  // (which adds the ring-fencing plan).
  13: null,
};

export interface LegacyMapping {
  /** Values to store under the new keys. */
  mapped: Record<string, Exclude<CheckValue, null>>;
  /** Old items with a value that is not carried over, and why. */
  dropped: { item: number; value: Exclude<CheckValue, null>; why: string }[];
}

/** Map one submission's old checklist values (item number → value) onto its form's keys. */
export function mapLegacyDocuments(
  values: Readonly<Record<number, CheckValue>>,
  form: RegistrationFormDef | null,
): LegacyMapping {
  const keys = new Set(form?.documents.map((d) => d.key) ?? []);
  const out: LegacyMapping = { mapped: {}, dropped: [] };
  for (const [n, value] of Object.entries(values)) {
    const item = Number(n);
    if (value === null) continue;
    const targets = LEGACY_DOCUMENT_KEYS[item];
    if (!targets) {
      out.dropped.push({ item, value, why: "no matching item on the new forms" });
      continue;
    }
    if (targets.includes(PAYMENT_EVIDENCE_KEY)) {
      out.dropped.push({ item, value, why: "now ticked automatically from confirmed payments" });
      continue;
    }
    const key = targets.find((k) => keys.has(k));
    if (!key) {
      out.dropped.push({ item, value, why: `not on ${form?.form ?? "the form"}` });
      continue;
    }
    out.mapped[key] = value;
  }
  return out;
}
