import { formatDate, yearOf } from "@/domain/dates";
import { formatRegistrationNo } from "@/domain/numbers";
import { can } from "@/domain/roles";
import type { IsoDate } from "@/domain/types";
import { dailyReview } from "@/domain/workflow";
import { writeAudit } from "./audit";
import { appToday } from "./clock";
import { loadContext } from "./context";
import { COUNTER, nextCounter } from "./counters";
import { ForbiddenError } from "./errors";
import { loadEvaluationStates } from "./evaluation-state";
import { releaseIfCleared } from "./finance";
import type { Actor, Db } from "./types";

export const DAILY_REVIEW_ACTION = "Daily review";

/**
 * §4.10 daily review: run by the 06:00 cron (`actor` null, the system) or by "Run now". Moves
 * submissions whose determination period has passed to Provisionally Registered (para 13(4)), locks
 * any Registered record without a number, lists overdue deficiency responses (never auto-lapsed) and
 * writes a summary audit entry. One transaction; a second run the same day changes nothing new.
 */
export async function runDailyReview(db: Db, actor: Actor | null, opts: { today?: IsoDate } = {}) {
  if (actor && !can(actor.roles, "dailyReview.run")) throw new ForbiddenError();
  const today = opts.today ?? appToday();

  return db.$transaction(
    async (tx) => {
      // One review at a time (cron and "Run now" together), and let it change workflow fields.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ogserc.daily-review'))`;
      await tx.$queryRaw`SELECT set_config('ogserc.workflow', 'on', true)`;
      const ctx = await loadContext(tx, today);
      const states = await loadEvaluationStates(tx, ctx);
      const result = dailyReview(states, today, ctx.settings.policy);
      const byId = new Map(states.map((s) => [s.sub.id, s]));
      const userId = actor?.id ?? null;

      // §4.12: acknowledged submissions whose confirmed payments clear the gate but were not released
      // (e.g. after a settings change or a missed confirmation step).
      for (const id of result.toRelease) {
        await releaseIfCleared(tx, userId, id, today, "daily review");
      }

      for (const id of result.toProvisional) {
        const s = byId.get(id)!;
        await tx.submission.update({ where: { id }, data: { status: "PROVISIONAL" } });
        await writeAudit(tx, {
          userId,
          action: "Provisional registration",
          reference: s.sub.ackNo,
          detail: `Determination due ${formatDate(s.assessment.determinationDue!)} passed with no decision (para 13(4)); registration no. in use ${s.sub.ackNo}`,
        });
      }

      const locked: string[] = [];
      for (const id of result.toLock) {
        const s = byId.get(id)!;
        const issued = s.sub.certificateIssueDate;
        const { categoryApplied: category, primaryCode: code } = s.assessment;
        if (!issued || !category || !code) continue; // cannot be numbered; the record shows a flag
        const serial = await nextCounter(tx, COUNTER.registration(yearOf(issued)));
        const registrationNo = formatRegistrationNo(
          ctx.settings.registrationPrefix,
          issued,
          category,
          code,
          serial,
        );
        await tx.submission.update({ where: { id }, data: { registrationNo } });
        await writeAudit(tx, {
          userId,
          action: "Registration number locked",
          reference: s.sub.ackNo,
          detail: registrationNo,
        });
        locked.push(id);
      }

      const summary = result.summary.replace(
        `numbers locked: ${result.toLock.length}`,
        `numbers locked: ${locked.length}`,
      );
      await writeAudit(tx, {
        userId,
        action: DAILY_REVIEW_ACTION,
        detail: `${actor ? `Run now by ${actor.name}` : "Scheduled"} for ${formatDate(today)}. ${summary}`,
      });

      const name = (id: string) => {
        const s = byId.get(id)!;
        return { id, ackNo: s.sub.ackNo!, name: s.sub.registeredName ?? "" };
      };
      return {
        today,
        released: result.toRelease.map(name),
        reminderDue: result.reminderDue.map(name),
        provisional: result.toProvisional.map(name),
        overdueDeficiency: result.overdueDeficiency.map(name),
        locked: locked.map(name),
        red: result.red,
        amber: result.amber,
        unpaidOrPartPaid: result.unpaidOrPartPaid,
        summary,
      };
    },
    { timeout: 120_000 },
  );
}

export type DailyReviewRun = Awaited<ReturnType<typeof runDailyReview>>;

/** The most recent review's summary entry, for the dashboard. */
export function lastDailyReview(db: Db) {
  return db.auditLog.findFirst({
    where: { action: DAILY_REVIEW_ACTION },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true, detail: true, user: { select: { name: true } } },
  });
}
