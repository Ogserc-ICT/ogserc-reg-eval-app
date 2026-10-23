import {
  buildDashboard,
  dashboardYears,
  workQueues,
  type QueueSubmission,
} from "@/domain/dashboard";
import type { Actor, Db } from "./types";
import { loadContext } from "./context";
import { loadEvaluationStates } from "./evaluation-state";
import { listOwnUse } from "./own-use";
import { paymentFromRow } from "./submissions";

/** SPEC §10: everything the dashboard shows, and the user's work queues. */
export async function getDashboard(
  db: Db,
  actor: Actor,
  opts: { today?: string; monthYear?: number | null } = {},
) {
  const ctx = await loadContext(db, opts.today);
  // Only years from the Effective Date to now are offered; anything else shows the default window.
  const monthYear =
    opts.monthYear && dashboardYears(ctx.settings.effectiveDate, ctx.today).includes(opts.monthYear)
      ? opts.monthYear
      : null;
  const [states, ownUse, payments, lgas] = await Promise.all([
    loadEvaluationStates(db, ctx),
    listOwnUse(db, ctx.today),
    db.payment.findMany(),
    db.lga.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } }),
  ]);

  const rows: QueueSubmission[] = states.map((s) => ({
    sub: s.sub,
    assessment: s.assessment,
    flags: s.flags,
    evaluationStatus: s.status,
    officers: {
      evaluatingOfficerId: s.evaluation.evaluatingOfficerId,
      reviewingSupervisorId: s.evaluation.reviewingSupervisorId,
      approvingOfficerId: s.evaluation.approvingOfficerId,
    },
    finalDecision: s.evaluation.finalDecision,
  }));

  return {
    today: ctx.today,
    dashboard: buildDashboard({
      today: ctx.today,
      settings: ctx.settings,
      ref: ctx.ref,
      lgas: lgas.map((l) => l.name),
      submissions: rows,
      ownUse: ownUse.map((o) => ({ input: o.input, assessment: o.assessment })),
      payments: payments.map(paymentFromRow),
      monthYear,
    }),
    queues: workQueues(rows, actor.id, ctx.today),
  };
}
