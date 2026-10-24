"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { runDailyReview } from "@/server/daily-review";

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
