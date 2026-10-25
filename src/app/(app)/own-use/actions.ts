"use server";

import { revalidatePath } from "next/cache";
import { formBool, formValues, runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import {
  CONFIRM_BELOW_THRESHOLD,
  CONFIRM_SAME_SITE,
  createOwnUse,
  recalculateOwnUsePricing,
  registerOwnUse,
  updateOwnUse,
  updateOwnUseDocuments,
} from "@/server/own-use";
import { OWN_USE_FIELDS } from "./fields";

const confirmations = (fd: FormData) => ({
  confirmBelowThreshold: formBool(fd, CONFIRM_BELOW_THRESHOLD),
  confirmSameSite: formBool(fd, CONFIRM_SAME_SITE),
});

export async function createOwnUseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd, OWN_USE_FIELDS);
  return runAction(async (actor) => {
    const row = await createOwnUse(db, actor, values, confirmations(fd));
    revalidatePath("/own-use");
    return { redirectTo: `/own-use/${row.id}?notice=created` };
  }, values);
}

export async function updateOwnUseAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, OWN_USE_FIELDS);
  return runAction(async (actor) => {
    await updateOwnUse(db, actor, id, values, confirmations(fd));
    revalidatePath("/own-use");
    return { redirectTo: `/own-use/${id}?notice=updated` };
  }, values);
}

export async function updateOwnUseDocumentsAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = Object.fromEntries(
    [...fd.entries()]
      .filter(([k]) => /^doc-[a-z_]+$/.test(k))
      .map(([k, val]) => [k.slice(4), String(val)]),
  );
  return runAction(async (actor) => {
    const changed = await updateOwnUseDocuments(db, actor, id, values);
    revalidatePath(`/own-use/${id}`);
    return changed
      ? `Checklist saved (${changed} change${changed === 1 ? "" : "s"}).`
      : "No changes.";
  });
}

export async function registerOwnUseAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["flagOverrideReason"]);
  return runAction(async (actor) => {
    const { registrationNo } = await registerOwnUse(db, actor, id, values);
    revalidatePath(`/own-use/${id}`);
    revalidatePath("/own-use");
    return `Registered as ${registrationNo}. The certificate is under Issued documents.`;
  }, values);
}

export async function recalculateOwnUseAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["reason"]);
  return runAction(async (actor) => {
    const r = await recalculateOwnUsePricing(db, actor, id, values);
    revalidatePath(`/own-use/${id}`);
    return r.changed
      ? `Pricing recalculated: ${r.changes.join("; ")}.`
      : "Pricing was already current.";
  }, values);
}
