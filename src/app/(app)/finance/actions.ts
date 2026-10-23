"use server";

import { revalidatePath } from "next/cache";
import { formBool, formValues, runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { confirmPayment, rejectPayment } from "@/server/finance";

export async function confirmPaymentAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["remarks"]);
  return runAction(async (actor) => {
    const { released } = await confirmPayment(db, actor, id, {
      verified: formBool(fd, "verified"),
      remarks: values.remarks,
    });
    revalidatePath("/", "layout");
    // The payment leaves the pending list, so the message is shown by the page, not the row.
    return { redirectTo: `/finance?notice=${released ? "released" : "confirmed"}` };
  }, values);
}

export async function rejectPaymentAction(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = formValues(fd, ["reason"]);
  return runAction(async (actor) => {
    await rejectPayment(db, actor, id, values);
    revalidatePath("/", "layout");
    return { redirectTo: "/finance?notice=rejected" };
  }, values);
}
