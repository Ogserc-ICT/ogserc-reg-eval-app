import type { FeeSummary } from "./fees";
import type { Policy } from "./reference";
import type { CheckValue, Kobo } from "./types";

export interface DocumentSummary {
  outstanding: number;
  pending: number;
  documentsComplete: boolean;
  /** Items not Y and not N/A (deficiency notice). */
  outstandingList: string[];
  /** Items marked Y (acknowledgement letter). */
  receivedList: string[];
}

/** §2.6. `values` and `names` are in Schedule 2 order. */
export function summariseDocuments(
  values: readonly CheckValue[],
  names: readonly string[],
): DocumentSummary {
  const at = (i: number): CheckValue => values[i] ?? null;
  const outstanding = names.filter((_, i) => at(i) === "N").length;
  const pending = names.filter((_, i) => at(i) === null).length;
  return {
    outstanding,
    pending,
    documentsComplete: outstanding === 0 && pending === 0,
    outstandingList: names.filter((_, i) => at(i) !== "Y" && at(i) !== "N/A"),
    receivedList: names.filter((_, i) => at(i) === "Y"),
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
