import { formatDate } from "./dates";
import { formatNaira } from "./money";
import type { Assessment } from "./submission";
import { STATUS, type IsoDate, type SubmissionInput } from "./types";

/** §2.11: the next action shown on the submission page. */
export function nextAction(sub: SubmissionInput, a: Assessment, today: IsoDate): string {
  switch (sub.status) {
    case STATUS.REGISTERED:
      return sub.registrationNo ? "Complete" : "Lock the registration number";
    case STATUS.CANCELLED:
    case STATUS.REFUSED:
      return `Closed – ${sub.status}`;
    case STATUS.LAPSED:
      return `Closed – ${sub.status}; fresh application needed`;
    case STATUS.DEFICIENCY:
      if (a.deficiencyResponseDue && today > a.deficiencyResponseDue) {
        return "Response overdue – lapse the submission (para 13(2))";
      }
      return a.deficiencyResponseDue
        ? `Await response by ${formatDate(a.deficiencyResponseDue)}`
        : "Await response";
    case STATUS.PROVISIONAL:
      return "Determine and issue the certificate";
  }

  if (!a.submissionComplete) {
    const parts: string[] = [];
    const docs = a.documents.outstandingList.length;
    if (docs > 0) parts.push(`obtain ${docs} outstanding document(s)`);
    if (a.fees.balance > 0) parts.push(`collect ${formatNaira(a.fees.balance)}`);
    const text = parts.join(" and ");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} – or issue a deficiency notice`;
  }
  if (!sub.dateSubmissionComplete || !a.determinationDue)
    return "Enter the Date Submission Complete";
  if (today > a.determinationDue) return "Overdue – provisional registration applies (para 13(4))";
  return `Determine by ${formatDate(a.determinationDue)}`;
}
