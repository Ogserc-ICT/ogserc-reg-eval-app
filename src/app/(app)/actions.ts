"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { runDailyReview } from "@/server/daily-review";

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
