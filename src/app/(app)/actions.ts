"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { runDailyReview } from "@/server/daily-review";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/notifications";

// --- Notifications (the bell). Only ever the signed-in user's own. ---

export async function loadNotificationsAction() {
  return listNotifications(db, await requireUser());
}

export async function markNotificationReadAction(id: string): Promise<void> {
  const actor = await requireUser();
  // Action arguments come from the browser: check the type, not just the signature.
  if (typeof id !== "string") return;
  await markNotificationRead(db, actor, id);
}

export async function markAllNotificationsReadAction(): Promise<void> {
  await markAllNotificationsRead(db, await requireUser());
}

/** Called by the inactivity timer (src/components/idle-sign-out.tsx). */
export async function idleSignOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login?reason=idle" });
}

export async function runDailyReviewAction(): Promise<ActionState> {
  return runAction(async (actor) => {
    const run = await runDailyReview(db, actor);
    revalidatePath("/");
    const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
    return (
      `Daily review done: ${n(run.provisional.length, "submission")} provisionally registered, ` +
      `${n(run.overdueDeficiency.length, "overdue deficiency response")}, ` +
      `${n(run.locked.length, "number")} locked.`
    );
  });
}
