"use server";

import { revalidatePath } from "next/cache";
import { formBool, formValues, runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import {
  CONFIRM_BELOW_THRESHOLD,
  createOwnUse,
  recalculateOwnUsePricing,
  updateOwnUse,
} from "@/server/own-use";
import { OWN_USE_FIELDS } from "./fields";

export async function createOwnUseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd, OWN_USE_FIELDS);
  return runAction(async (actor) => {
    const row = await createOwnUse(db, actor, values, {
      confirmBelowThreshold: formBool(fd, CONFIRM_BELOW_THRESHOLD),
    });
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
    await updateOwnUse(db, actor, id, values, {
      confirmBelowThreshold: formBool(fd, CONFIRM_BELOW_THRESHOLD),
    });
    revalidatePath("/own-use");
    return { redirectTo: `/own-use/${id}?notice=updated` };
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
