import type { FeeSummary } from "./fees";
import {
  PAYMENT_EVIDENCE_KEY,
  type Conditions,
  type FormDocumentDef,
  type RegistrationFormDef,
} from "./forms";
import type { Policy } from "./reference";
import type { CheckValue, Kobo } from "./types";

/**
 * How a checklist item gets its value:
 * - "manual": entered by registry staff
 * - "auto-na": its condition is N, so it does not apply (read-only)
 * - "auto": evidence of payment, ticked once Finance confirms the fee (read-only)
 */
export type DocumentMode = "manual" | "auto-na" | "auto";

export interface DocumentItem extends FormDocumentDef {
  value: CheckValue;
  mode: DocumentMode;
  /** Form whose list the item comes from (another activity's form when that policy is on). */
  form: string;
}

export interface DocumentSummary {
  items: DocumentItem[];
  outstanding: number;
  pending: number;
  documentsComplete: boolean;
  /** Items not Y and not N/A (deficiency notice, acknowledgement "Pending"). */
  outstandingList: string[];
  /** Items marked Y (acknowledgement letter). */
  receivedList: string[];
}

/**
 * The documents a submission must provide: its form's list, then (when the policy says so) the
 * items of the other activities' forms that its own form does not already have. Items are matched
 * by their shared key, so one received document satisfies every form that asks for it.
 */
export function documentList(
  form: RegistrationFormDef | null,
  otherForms: readonly RegistrationFormDef[],
  policy: Pick<Policy, "otherActivitiesRequireDocuments">,
): (FormDocumentDef & { form: string })[] {
  if (!form) return [];
  const list = form.documents.map((d) => ({ ...d, form: form.form }));
  if (!policy.otherActivitiesRequireDocuments) return list;
  const seen = new Set(list.map((d) => d.key));
  for (const other of otherForms) {
    if (other.form === form.form) continue;
    for (const d of other.documents) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      // Keep evidence of payment last: one fee is paid, for the highest category (para 17(1)).
      list.splice(list.length - (list.at(-1)?.key === PAYMENT_EVIDENCE_KEY ? 1 : 0), 0, {
        ...d,
        form: other.form,
      });
    }
  }
  return list;
}

/** Evidence of payment ticks itself: Y once confirmed payments cover fee − waiver, N/A when nothing is due. */
export function paymentEvidenceValue(fees: Pick<FeeSummary, "netFee" | "amountPaid">): CheckValue {
  if (fees.netFee === 0) return "N/A";
  return fees.amountPaid >= fees.netFee ? "Y" : null;
}

/** Merge stored values with the automatic rules. */
export function effectiveDocuments(
  list: readonly (FormDocumentDef & { form: string })[],
  stored: Readonly<Record<string, CheckValue>>,
  conditions: Conditions,
  paymentEvidence: CheckValue,
): DocumentItem[] {
  return list.map((d) => {
    if (d.key === PAYMENT_EVIDENCE_KEY) return { ...d, value: paymentEvidence, mode: "auto" };
    if (d.requiredWhen && conditions[d.requiredWhen] === "N")
      return { ...d, value: "N/A", mode: "auto-na" };
    return { ...d, value: stored[d.key] ?? null, mode: "manual" };
  });
}

/** §2.6 over the per-form list. */
export function summariseDocuments(items: readonly DocumentItem[]): DocumentSummary {
  const outstanding = items.filter((d) => d.value === "N").length;
  const pending = items.filter((d) => d.value === null).length;
  return {
    items: [...items],
    outstanding,
    pending,
    documentsComplete: items.length > 0 && outstanding === 0 && pending === 0,
    outstandingList: items.filter((d) => d.value !== "Y" && d.value !== "N/A").map((d) => d.text),
    receivedList: items.filter((d) => d.value === "Y").map((d) => d.text),
  };
}

/** Payment needed before a submission counts as complete (§2.7; §9.2 decides whether the late charge counts). */
export function paymentRequiredForCompleteness(fees: FeeSummary, policy: Policy): Kobo {
  return policy.lateChargeBlocksCompleteness ? fees.totalDue : fees.netFee;
}

/** §2.7, para 13(1). */
export function isSubmissionComplete(
  docs: DocumentSummary,
  fees: FeeSummary,
  policy: Policy,
): boolean {
  return docs.documentsComplete && fees.amountPaid >= paymentRequiredForCompleteness(fees, policy);
}
