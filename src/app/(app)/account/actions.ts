"use server";

import { formText, runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { currentSessionToken } from "@/lib/session";
import { changeOwnPassword } from "@/server/users";

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    await changeOwnPassword(db, actor, await currentSessionToken(), {
      currentPassword: formText(fd, "currentPassword"),
      newPassword: formText(fd, "newPassword"),
      confirmPassword: formText(fd, "confirmPassword"),
    });
    return "Password changed. Your other sessions have been signed out.";
  });
}
