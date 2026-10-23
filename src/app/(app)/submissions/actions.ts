"use server";

import { revalidatePath } from "next/cache";
import { formAll, formBool, formText, formValues, runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import {
  CONFIRM_DUPLICATE_CAC,
  createSubmission,
  setWaiver,
  updateDocuments,
  updateSubmission,
} from "@/server/intake";
import {
  generateAcknowledgement,
  generateEvaluationForm,
  reissueCertificate,
} from "@/server/documents";
import { recalculatePricing, recalculatePricingBulk } from "@/server/pricing";
import { SUBMISSION_FIELDS } from "./fields";

// Thin wrappers: the services check permissions, validate, run the transaction and write the audit log.

export async function createSubmissionAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, [...SUBMISSION_FIELDS, "evaluatingOfficerId"]);
  return runAction(async (actor) => {
    const sub = await createSubmission(db, actor, values, {
      confirmDuplicateCac: formBool(fd, CONFIRM_DUPLICATE_CAC),
    });
    revalidatePath("/submissions");
    // Offer the acknowledgement letter straight away (SPEC §4.1). The submission is saved either way;
    // if the letter fails, it can be generated from the submission page.
    try {
      await generateAcknowledgement(db, actor, sub.id);
    } catch (e) {
      console.error("Acknowledgement letter not generated", e);
    }
    return { redirectTo: `/submissions/${sub.id}?notice=created` };
  }, values);
}

export async function updateSubmissionAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, [...SUBMISSION_FIELDS, "changeReason"]);
  return runAction(async (actor) => {
    await updateSubmission(db, actor, id, values, {
      confirmDuplicateCac: formBool(fd, CONFIRM_DUPLICATE_CAC),
      changeReason: values.changeReason,
    });
    revalidatePath("/submissions");
    return { redirectTo: `/submissions/${id}?notice=updated` };
  }, values);
}

export async function updateDocumentsAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = Object.fromEntries(
    [...fd.entries()]
      .filter(([k]) => /^doc-\d+$/.test(k))
      .map(([k, val]) => [k.slice(4), String(val)]),
  );
  return runAction(async (actor) => {
    const changed = await updateDocuments(db, actor, id, values, {
      changeReason: formText(fd, "changeReason"),
    });
    revalidatePath(`/submissions/${id}`);
    return changed
      ? `Checklist saved (${changed} change${changed === 1 ? "" : "s"}).`
      : "No changes.";
  });
}

export async function setWaiverAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["amount", "reason"]);
  return runAction(async (actor) => {
    await setWaiver(db, actor, id, values);
    revalidatePath(`/submissions/${id}`);
    return "Waiver saved.";
  }, values);
}

export async function recalculateAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["reason"]);
  return runAction(async (actor) => {
    const result = await recalculatePricing(db, actor, id, values);
    revalidatePath(`/submissions/${id}`);
    return result.changed
      ? `Pricing recalculated: ${result.changes.join("; ")}.`
      : "Pricing was already current.";
  }, values);
}

export async function bulkRecalculateAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["reason"]);
  return runAction(async (actor) => {
    const r = await recalculatePricingBulk(db, actor, formAll(fd, "ids"), {
      reason: formText(fd, "reason"),
    });
    revalidatePath("/submissions");
    const parts = [`${r.changed.length} recalculated`, `${r.unchanged.length} already current`];
    if (r.skipped.length) {
      parts.push(
        `${r.skipped.length} skipped as registered (${r.skipped.map((s) => s.ackNo).join(", ")})`,
      );
    }
    return `${parts.join("; ")}.`;
  }, values);
}

export async function generateAcknowledgementAction(id: string): Promise<ActionState> {
  return runAction(async (actor) => {
    const doc = await generateAcknowledgement(db, actor, id);
    revalidatePath(`/submissions/${id}`);
    return `Acknowledgement letter v${doc.version} generated.`;
  });
}

export async function generateEvaluationFormAction(id: string): Promise<ActionState> {
  return runAction(async (actor) => {
    const doc = await generateEvaluationForm(db, actor, id);
    revalidatePath(`/submissions/${id}`);
    return `Evaluation form v${doc.version} generated.`;
  });
}

export async function reissueCertificateAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["reason"]);
  return runAction(async (actor) => {
    const doc = await reissueCertificate(db, actor, id, values);
    revalidatePath(`/submissions/${id}`);
    return `Certificate v${doc.version} issued.`;
  }, values);
}
