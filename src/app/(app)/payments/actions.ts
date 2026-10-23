"use server";

import { revalidatePath } from "next/cache";
import { formBool, formText, formValues, runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { safeInternalPath } from "@/lib/paths";
import {
  CONFIRM_DUPLICATE_RRR,
  recordPayment,
  reversePayment,
  verifyPayment,
} from "@/server/payments";

const PAYMENT_FIELDS = [
  "dateReceived",
  "reference",
  "purpose",
  "channel",
  "amount",
  "rrr",
] as const;

export async function recordPaymentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd, PAYMENT_FIELDS);
  return runAction(async (actor) => {
    await recordPayment(db, actor, values, {
      confirmDuplicateRrr: formBool(fd, CONFIRM_DUPLICATE_RRR),
    });
    revalidatePath("/payments");
    revalidatePath("/submissions");
    revalidatePath("/own-use");
    const back = safeInternalPath(formText(fd, "returnTo"), "/payments");
    return { redirectTo: `${back}${back.includes("?") ? "&" : "?"}notice=payment` };
  }, values);
}

export async function verifyPaymentAction(id: string): Promise<ActionState> {
  return runAction(async (actor) => {
    await verifyPayment(db, actor, id);
    revalidatePath("/", "layout");
    return "Marked as verified with the bank.";
  });
}

export async function reversePaymentAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["reason"]);
  return runAction(async (actor) => {
    await reversePayment(db, actor, id, values);
    revalidatePath("/", "layout");
    return "Payment reversed.";
  }, values);
}
