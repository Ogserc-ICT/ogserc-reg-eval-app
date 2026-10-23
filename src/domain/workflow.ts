import { daysBetween, formatDate } from "./dates";
import { determinationDue } from "./deadlines";
import { paymentRequiredForCompleteness } from "./documents";
import type { CheckCounts } from "./evaluation";
import { gateReason } from "./finance";
import type { DataFlag } from "./flags";
import { formatNaira } from "./money";
import { formatRegistrationNo } from "./numbers";
import type { Policy, Settings } from "./reference";
import type { Assessment } from "./submission";
import {
  FINAL_DECISION,
  STATUS,
  isClosed,
  type EvaluationInput,
  type IsoDate,
  type Kobo,
  type Status,
  type SubmissionInput,
} from "./types";

// Guards and state changes for the workflow actions (SPEC §4). Each guard returns every failing
// reason so the UI can list them all; an empty list means the action may proceed.

const SIGNATORY_PLACEHOLDER = "[Name]";

export interface Officers {
  evaluatingOfficerId: string | null;
  reviewingSupervisorId: string | null;
  approvingOfficerId: string | null;
  /** User who created the submission. */
  createdById: string | null;
}

export function officersOf(
  ev: Pick<EvaluationInput, "evaluatingOfficerId" | "reviewingSupervisorId" | "approvingOfficerId">,
  createdById: string | null,
): Officers {
  return {
    evaluatingOfficerId: ev.evaluatingOfficerId,
    reviewingSupervisorId: ev.reviewingSupervisorId,
    approvingOfficerId: ev.approvingOfficerId,
    createdById,
  };
}

/**
 * Who may record a decision (refuse; approve adds more checks): the assigned approving officer,
 * with separation of duties intact.
 */
export function deciderProblems(
  ev: Pick<EvaluationInput, "evaluatingOfficerId" | "reviewingSupervisorId" | "approvingOfficerId">,
  createdById: string | null,
  actorId: string,
): string[] {
  const reasons: string[] = [];
  if (!ev.approvingOfficerId) reasons.push("No approving officer assigned");
  else if (actorId !== ev.approvingOfficerId)
    reasons.push("Only the assigned approving officer can decide");
  reasons.push(...separationOfDutiesViolations(officersOf(ev, createdById)));
  return reasons;
}

/** §5 separation of duties for one submission. */
export function separationOfDutiesViolations(o: Officers): string[] {
  const reasons: string[] = [];
  const same = (a: string | null, b: string | null) => !!a && a === b;
  if (same(o.approvingOfficerId, o.evaluatingOfficerId)) {
    reasons.push("The approving officer cannot be the evaluating officer");
  }
  if (same(o.approvingOfficerId, o.reviewingSupervisorId)) {
    reasons.push("The approving officer cannot be the reviewing supervisor");
  }
  if (same(o.approvingOfficerId, o.createdById)) {
    reasons.push("The approving officer cannot be the user who created the submission");
  }
  if (same(o.reviewingSupervisorId, o.evaluatingOfficerId)) {
    reasons.push("The reviewing supervisor cannot be the evaluating officer");
  }
  return reasons;
}

export function signatoriesMissing(settings: Settings): boolean {
  const unset = (name: string) => !name.trim() || name.trim() === SIGNATORY_PLACEHOLDER;
  return unset(settings.chairmanName) || unset(settings.commissionerName);
}

/** §4.4 Mark submission complete. */
export type MarkCompleteResult =
  | { ok: true; dateSubmissionComplete: IsoDate; determinationDue: IsoDate; changed: boolean }
  | { ok: false; outstandingDocuments: string[]; shortfall: Kobo; message: string };

export function markComplete(
  sub: SubmissionInput,
  a: Assessment,
  today: IsoDate,
  settings: Settings,
): MarkCompleteResult {
  if (!a.submissionComplete) {
    const shortfall = Math.max(
      0,
      paymentRequiredForCompleteness(a.fees, settings.policy) - a.fees.amountPaid,
    );
    const parts: string[] = [];
    if (a.documents.outstandingList.length) {
      parts.push(`${a.documents.outstandingList.length} outstanding document(s)`);
    }
    if (shortfall > 0) parts.push(`${formatNaira(shortfall)} unpaid`);
    return {
      ok: false,
      outstandingDocuments: a.documents.outstandingList,
      shortfall,
      message: `Not complete: ${parts.join(", ")}. Consider issuing a deficiency notice.`,
    };
  }
  const date = sub.dateSubmissionComplete ?? today;
  return {
    ok: true,
    dateSubmissionComplete: date,
    determinationDue: determinationDue(date, settings)!,
    changed: !sub.dateSubmissionComplete,
  };
}

/** §4.5 Issue deficiency notice. */
export function deficiencyNoticeCheck(
  status: Status | null,
  counts: CheckCounts,
  submissionComplete: boolean,
): { blockers: string[]; needsConfirmation: string | null } {
  if (isClosed(status))
    return { blockers: [`Submission is closed (${status})`], needsConfirmation: null };
  if (status === STATUS.DEFICIENCY) {
    return {
      blockers: [
        "A deficiency notice is already outstanding: mark the submission complete or lapse it",
      ],
      needsConfirmation: null,
    };
  }
  const needsConfirmation =
    counts.failed === 0 && submissionComplete
      ? "No checks have failed and the submission is complete. Issue a deficiency notice anyway?"
      : null;
  return { blockers: [], needsConfirmation };
}

export interface ApprovalInput {
  sub: SubmissionInput;
  assessment: Assessment;
  evaluation: EvaluationInput;
  counts: CheckCounts;
  flags: readonly DataFlag[];
  createdById: string | null;
  /** Authenticated user attempting the approval. */
  actorId: string;
  settings: Settings;
}

/** §4.6 Approve and register: every reason approval is blocked. */
export function approvalBlockers(input: ApprovalInput): string[] {
  const { sub, assessment: a, evaluation: ev, counts, flags, settings } = input;
  const reasons: string[] = [];

  if (isClosed(sub.status)) reasons.push(`Submission is closed (${sub.status})`);
  if (!a.financeGate.cleared) reasons.push(gateReason(a.financeGate));
  if (!ev.evaluatingOfficerId) reasons.push("No evaluating officer assigned");
  if (!ev.reviewingSupervisorId) reasons.push("No reviewing supervisor assigned");
  if (!ev.approvingOfficerId) reasons.push("No approving officer assigned");
  if (ev.approvingOfficerId && input.actorId !== ev.approvingOfficerId) {
    reasons.push("Only the assigned approving officer can decide");
  }
  if (!a.submissionComplete)
    reasons.push("Submission is not complete (documents or fees outstanding)");
  if (counts.failed > 0) reasons.push(`${counts.failed} evaluation check(s) failed`);
  if (counts.pending > 0) reasons.push(`${counts.pending} evaluation check(s) pending`);
  if (!a.categoryApplied || !a.primaryCode) {
    reasons.push("Category or activity code cannot be determined");
  }

  if (flags.length > 0) {
    const list = flags.map((f) => f.message).join("; ");
    if (settings.policy.flagsBlockApproval) {
      reasons.push(`${flags.length} unresolved data flag(s): ${list}`);
    } else if (!ev.flagOverrideReason?.trim()) {
      reasons.push(
        `${flags.length} unresolved data flag(s) with no written override reason: ${list}`,
      );
    }
  }

  reasons.push(...separationOfDutiesViolations(officersOf(ev, input.createdById)));

  if (signatoriesMissing(settings)) {
    reasons.push("Certificate signatory names are not set in Settings");
  }
  return reasons;
}

export interface ApprovalChanges {
  submission: Pick<
    SubmissionInput,
    "dateSubmissionComplete" | "certificateIssueDate" | "status" | "registrationNo"
  >;
  evaluation: Pick<EvaluationInput, "finalDecision" | "reviewDate" | "approvalDate">;
  auditDetail: string;
}

/**
 * §4.6 state change on approval. Call only when `approvalBlockers` is empty, inside the transaction
 * that takes `serial` from the year's registration counter (see `nextRegistrationSerial`).
 */
export function approvalChanges(
  input: ApprovalInput,
  approverName: string,
  serial: number,
  today: IsoDate,
): ApprovalChanges {
  const { sub, assessment: a, evaluation: ev, settings } = input;
  if (!a.categoryApplied || !a.primaryCode)
    throw new Error("Cannot number a registration without a category");
  const registrationNo = formatRegistrationNo(
    settings.registrationPrefix,
    today,
    a.categoryApplied,
    a.primaryCode,
    serial,
  );
  return {
    submission: {
      dateSubmissionComplete: sub.dateSubmissionComplete ?? today,
      certificateIssueDate: today,
      status: STATUS.REGISTERED,
      registrationNo,
    },
    evaluation: {
      finalDecision: FINAL_DECISION.REGISTER,
      reviewDate: ev.reviewDate ?? today,
      approvalDate: today,
    },
    auditDetail: `${registrationNo} - approved by ${approverName}`,
  };
}

/** §4.7 Lapse (para 13(2)): only after the deficiency response period has ended. */
export function lapseBlockers(status: Status | null, a: Assessment, today: IsoDate): string[] {
  if (status !== STATUS.DEFICIENCY)
    return ["Only a submission with a deficiency notice issued can lapse"];
  if (!a.deficiencyResponseDue) return ["No deficiency notice date recorded"];
  if (!(today > a.deficiencyResponseDue)) {
    return [`The response period runs until ${formatDate(a.deficiencyResponseDue)}`];
  }
  return [];
}

/** Grounds for refusal allowed by the Order (paras 13(3), 20). The first is the default suggestion. */
export const REFUSAL_GROUNDS = [
  "False or misleading information",
  "Non-payment of fees or charges",
  "Activity outside the scope of the Order",
] as const;

/** §4.8 Refuse: show-cause served and its period ended; a permitted ground given. */
export function refusalBlockers(
  status: Status | null,
  showCauseDate: IsoDate | null,
  ground: string | null,
  today: IsoDate,
  settings: Settings,
): string[] {
  const reasons: string[] = [];
  if (isClosed(status)) reasons.push(`Submission is closed (${status})`);
  if (!showCauseDate) {
    reasons.push("No show-cause notice date recorded");
  } else if (daysBetween(showCauseDate, today) < settings.showCauseDays) {
    reasons.push(`The ${settings.showCauseDays}-day show-cause period has not ended`);
  }
  if (!ground?.trim()) {
    reasons.push("Grounds for refusal are required");
  } else if (!(REFUSAL_GROUNDS as readonly string[]).includes(ground)) {
    reasons.push("Grounds must be one allowed by the Order");
  }
  return reasons;
}

/** §4.9 Cancel (admin only; the role check happens in the server action). */
export function cancelBlockers(status: Status | null, reason: string | null): string[] {
  const reasons: string[] = [];
  if (status === STATUS.CANCELLED || status === STATUS.REFUSED || status === STATUS.LAPSED) {
    reasons.push(`Submission is already closed (${status})`);
  }
  if (!reason?.trim()) reasons.push("A reason is required");
  return reasons;
}

export interface ReviewItem {
  sub: SubmissionInput;
  assessment: Assessment;
}

export interface DailyReviewResult {
  /** Acknowledged submissions whose confirmed payments clear the Finance gate (§4.12). */
  toRelease: string[];
  /** Acknowledged, unpaid, at or past the reminder setting (none when the setting is blank). */
  reminderDue: string[];
  /** Submissions to move to Provisionally Registered (para 13(4)). */
  toProvisional: string[];
  /** Deficiency responses overdue; listed for a user to lapse, never auto-lapsed. */
  overdueDeficiency: string[];
  /** Registered with no locked number. */
  toLock: string[];
  red: number;
  amber: number;
  unpaidOrPartPaid: number;
  summary: string;
}

/** §4.10 daily review. Pure: the job applies the returned changes in a transaction. */
export function dailyReview(
  items: readonly ReviewItem[],
  today: IsoDate,
  policy?: Pick<Policy, "unpaidReminderDays">,
): DailyReviewResult {
  const toRelease: string[] = [];
  const reminderDue: string[] = [];
  const reminderDays = policy?.unpaidReminderDays ?? null;
  const toProvisional: string[] = [];
  const overdueDeficiency: string[] = [];
  const toLock: string[] = [];
  let red = 0;
  let amber = 0;
  let unpaidOrPartPaid = 0;

  for (const { sub, assessment: a } of items) {
    if (sub.status === STATUS.AWAITING) {
      if (a.financeGate.cleared) toRelease.push(sub.id);
      else if (
        reminderDays !== null &&
        sub.dateSubmitted &&
        daysBetween(sub.dateSubmitted, today) >= reminderDays
      ) {
        reminderDue.push(sub.id);
      }
    }
    if (sub.status === STATUS.RECEIVED && a.determinationDue && a.determinationDue < today) {
      toProvisional.push(sub.id);
    }
    if (
      sub.status === STATUS.DEFICIENCY &&
      a.deficiencyResponseDue &&
      a.deficiencyResponseDue < today
    ) {
      overdueDeficiency.push(sub.id);
    }
    if (sub.status === STATUS.REGISTERED && !sub.registrationNo) toLock.push(sub.id);
    if (a.sla === "Red") red++;
    if (a.sla === "Amber") amber++;
    const live = !isClosed(sub.status) || sub.status === STATUS.REGISTERED;
    if (live && (a.fees.paymentStatus === "Unpaid" || a.fees.paymentStatus === "Part-paid"))
      unpaidOrPartPaid++;
  }

  const summary =
    `Provisional today: ${toProvisional.length}; overdue deficiency responses: ${overdueDeficiency.length}; ` +
    `numbers locked: ${toLock.length}; red: ${red}; amber: ${amber}; unpaid/part-paid: ${unpaidOrPartPaid}; ` +
    `released for evaluation: ${toRelease.length}` +
    (reminderDays !== null
      ? `; unpaid acknowledgements ${reminderDays}+ days: ${reminderDue.length}`
      : "");
  return {
    toRelease,
    reminderDue,
    toProvisional,
    overdueDeficiency,
    toLock,
    red,
    amber,
    unpaidOrPartPaid,
    summary,
  };
}
