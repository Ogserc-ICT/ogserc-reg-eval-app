"use server";

import { revalidatePath } from "next/cache";
import { formBool, formText, formValues, runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import {
  CONFIRM_DEFICIENCY,
  approveAndRegister,
  assignOfficers,
  cancelSubmission,
  confirmCategory,
  issueDeficiency,
  lapseSubmission,
  markSubmissionComplete,
  recordReview,
  recordShowCause,
  refuseSubmission,
  reopenDecision,
  saveChecks,
} from "@/server/workflow";

// Thin wrappers over src/server/workflow.ts, which checks permissions, separation of duties and every
// §4 blocker, then changes state and writes the audit entry in one transaction.

const refresh = (id: string) => {
  revalidatePath(`/submissions/${id}`, "layout");
  revalidatePath("/submissions");
  revalidatePath("/evaluations");
};

export async function assignOfficersAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, [
    "evaluatingOfficerId",
    "reviewingSupervisorId",
    "approvingOfficerId",
  ]);
  return runAction(async (actor) => {
    const changed = await assignOfficers(db, actor, id, values);
    refresh(id);
    return changed ? "Officers saved." : "No changes.";
  }, values);
}

export async function saveChecksAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = Object.fromEntries(
    [...fd.entries()]
      .filter(([k]) => k.startsWith("check-"))
      .map(([k, v]) => [k.slice("check-".length), String(v)]),
  );
  return runAction(async (actor) => {
    const changed = await saveChecks(db, actor, id, { values, remarks: formText(fd, "remarks") });
    refresh(id);
    return changed ? `Saved (${changed} change${changed === 1 ? "" : "s"}).` : "No changes.";
  });
}

export async function recordReviewAction(id: string): Promise<ActionState> {
  return runAction(async (actor) => {
    await recordReview(db, actor, id);
    refresh(id);
    return "Review recorded.";
  });
}

export async function markCompleteAction(id: string): Promise<ActionState> {
  return runAction(async (actor) => {
    const r = await markSubmissionComplete(db, actor, id);
    refresh(id);
    return r.changed
      ? "Marked complete. The determination clock has started."
      : "Already complete.";
  });
}

export async function issueDeficiencyAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  return runAction(async (actor) => {
    await issueDeficiency(db, actor, id, { confirm: formBool(fd, CONFIRM_DEFICIENCY) });
    refresh(id);
    return "Deficiency notice issued.";
  });
}

export async function approveAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["flagOverrideReason"]);
  return runAction(async (actor) => {
    const { registrationNo, applied } = await approveAndRegister(db, actor, id, values);
    refresh(id);
    if (applied) {
      revalidatePath("/submissions", "layout");
      return `Approved. ${applied.length} change(s) applied to ${registrationNo}.`;
    }
    return `Registered as ${registrationNo}.`;
  }, values);
}

export async function confirmCategoryAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["category", "reason"]);
  return runAction(async (actor) => {
    const r = await confirmCategory(db, actor, id, values);
    refresh(id);
    return r.differs
      ? `Category ${r.category} confirmed, with the reason it differs from the form filed.`
      : `Category ${r.category} confirmed.`;
  }, values);
}

export async function lapseAction(id: string): Promise<ActionState> {
  return runAction(async (actor) => {
    await lapseSubmission(db, actor, id);
    refresh(id);
    return "Submission lapsed.";
  });
}

export async function showCauseAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["showCauseDate"]);
  return runAction(async (actor) => {
    await recordShowCause(db, actor, id, values);
    refresh(id);
    return "Show-cause notice recorded.";
  }, values);
}

export async function refuseAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["ground", "details"]);
  return runAction(async (actor) => {
    await refuseSubmission(db, actor, id, values);
    refresh(id);
    return "Submission refused.";
  }, values);
}

export async function cancelAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["reason"]);
  return runAction(async (actor) => {
    await cancelSubmission(db, actor, id, values);
    refresh(id);
    return "Submission cancelled.";
  }, values);
}

export async function reopenAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["reason"]);
  return runAction(async (actor) => {
    const r = await reopenDecision(db, actor, id, values);
    refresh(id);
    return `Decision reopened. The submission is now ${r.status}.`;
  }, values);
}
