// Admin edits to the Schedule 3 fee table and the activity → category map (docs/DECISIONS.md: every
// edit needs a reason and is audited). Pure validation and change descriptions; the server applies them.
// Existing submissions keep their pricing snapshot, so an edit never changes what anyone already owes.

import { formatNaira } from "./money";
import type { Activity, FeeRow } from "./reference";
import type { Kobo } from "./types";

export type FieldErrors = Record<string, string[]>;

export interface FeeEdit {
  category: string;
  registrationFee: Kobo | null;
  lateInitial: Kobo | null;
  lateDaily: Kobo | null;
  lateDailyCap: Kobo | null;
  description: string;
}

export interface ActivityEdit {
  code: string;
  cat10MwPlus: string;
  cat1To10Mw: string;
  catBelow1Mw: string;
  capacityBased: boolean;
}

/** Category I is for own-use notifications only (para 3(4)); no activity maps to it. */
export const OWN_USE_CATEGORY = "I";

export const FEE_FIELDS = [
  ["registrationFee", "registration fee"],
  ["lateInitial", "late charge (initial)"],
  ["lateDaily", "late charge (per day)"],
  ["lateDailyCap", "late charge daily cap"],
] as const;

export const BANDS = [
  ["cat10MwPlus", "10 MW or more"],
  ["cat1To10Mw", "1 to below 10 MW"],
  ["catBelow1Mw", "below 1 MW"],
] as const;

/** Field errors keyed `{category}.{field}`; empty when the table can be saved. */
export function feeTableErrors(current: readonly FeeRow[], edits: readonly FeeEdit[]): FieldErrors {
  const errors: FieldErrors = {};
  const fail = (key: string, message: string) => (errors[key] ??= []).push(message);
  const known = new Set(current.map((f) => f.category));
  const seen = new Set<string>();
  for (const e of edits) {
    if (!known.has(e.category) || seen.has(e.category)) {
      fail(`${e.category}.category`, "Unknown or repeated category");
      continue;
    }
    seen.add(e.category);
    for (const [field, label] of FEE_FIELDS) {
      const v = e[field];
      if (v === null) fail(`${e.category}.${field}`, `Enter the ${label} in naira`);
    }
    if (e.registrationFee !== null && e.registrationFee <= 0)
      fail(`${e.category}.registrationFee`, "Must be more than ₦0");
    const d = e.description.trim();
    if (!d) fail(`${e.category}.description`, "Enter the description");
    else if (d.length > 500) fail(`${e.category}.description`, "At most 500 characters");
  }
  for (const c of known) if (!seen.has(c)) fail(`${c}.category`, "Missing from the form");
  return errors;
}

/** Field errors keyed `{code}.{band}`; empty when the map can be saved. */
export function activityMapErrors(
  current: readonly Activity[],
  categories: readonly string[],
  edits: readonly ActivityEdit[],
): FieldErrors {
  const errors: FieldErrors = {};
  const fail = (key: string, message: string) => (errors[key] ??= []).push(message);
  const known = new Set(current.map((a) => a.code));
  const valid = new Set(categories.filter((c) => c !== OWN_USE_CATEGORY));
  const seen = new Set<string>();
  for (const e of edits) {
    if (!known.has(e.code) || seen.has(e.code)) {
      fail(`${e.code}.code`, "Unknown or repeated activity");
      continue;
    }
    seen.add(e.code);
    for (const [band] of BANDS) {
      if (!valid.has(e[band]))
        fail(`${e.code}.${band}`, "Choose a Schedule 3 category (not I, which is own-use only)");
    }
    if (!e.capacityBased && !(e.cat10MwPlus === e.cat1To10Mw && e.cat1To10Mw === e.catBelow1Mw)) {
      fail(
        `${e.code}.capacityBased`,
        "Categories differ by capacity: tick “Depends on capacity” or use one category",
      );
    }
  }
  for (const c of known) if (!seen.has(c)) fail(`${c}.code`, "Missing from the form");
  return errors;
}

/** "registration fee ₦300,000 → ₦350,000; …" per changed row (for the audit log). */
export function feeTableChanges(current: readonly FeeRow[], edits: readonly FeeEdit[]) {
  return edits.flatMap((e) => {
    const before = current.find((f) => f.category === e.category);
    if (!before) return [];
    const parts: string[] = [];
    for (const [field, label] of FEE_FIELDS) {
      const after = e[field]!;
      if (after !== before[field])
        parts.push(`${label} ${formatNaira(before[field])} → ${formatNaira(after)}`);
    }
    if (e.description.trim() !== before.description) parts.push("description changed");
    return parts.length ? [{ category: e.category, detail: parts.join("; ") }] : [];
  });
}

export function activityMapChanges(current: readonly Activity[], edits: readonly ActivityEdit[]) {
  return edits.flatMap((e) => {
    const before = current.find((a) => a.code === e.code);
    if (!before) return [];
    const parts: string[] = [];
    for (const [band, label] of BANDS) {
      if (e[band] !== before[band]) parts.push(`${label} ${before[band]} → ${e[band]}`);
    }
    if (e.capacityBased !== before.capacityBased)
      parts.push(
        `depends on capacity ${before.capacityBased ? "yes" : "no"} → ${e.capacityBased ? "yes" : "no"}`,
      );
    return parts.length ? [{ code: e.code, detail: parts.join("; ") }] : [];
  });
}
