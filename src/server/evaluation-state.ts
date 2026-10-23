import type { Evaluation, FinalDecision as DbFinalDecision, Prisma } from "@prisma/client";
import {
  countDecisionChecks,
  effectiveChecks,
  evaluationStatus,
  recommendedOutcome,
} from "@/domain/evaluation";
import {
  dataFlags,
  duplicateIndex,
  type DuplicateIndex,
  type OtherSubmission,
} from "@/domain/flags";
import { assessSubmission, type DomainContext } from "@/domain/submission";
import {
  FINAL_DECISION,
  type CheckValue,
  type EvaluationInput,
  type FinalDecision,
  type PaymentInput,
} from "@/domain/types";
import { toIsoDate } from "./reference-data";
import {
  CHECK_FROM_DB,
  paymentFromRow,
  submissionFromRow,
  submissionInclude,
  type SubmissionRowLike,
} from "./submissions";
import type { Db, Tx } from "./types";

export const DECISION_FROM_DB: Record<DbFinalDecision, FinalDecision> = {
  REGISTER: FINAL_DECISION.REGISTER,
  DEFICIENCY: FINAL_DECISION.DEFICIENCY,
  REFUSE: FINAL_DECISION.REFUSE,
  LAPSE: FINAL_DECISION.LAPSE,
  PROVISIONAL: FINAL_DECISION.PROVISIONAL,
  REDIRECT: FINAL_DECISION.REDIRECT,
};

/** The CheckValue enum is stored under its labels (@map): "N/A" is the Prisma value NA. */
const CHECK_VALUE_FROM_LABEL: Record<string, "Y" | "N" | "NA"> = { Y: "Y", N: "N", "N/A": "NA" };

type Name = { name: string } | null;

/** An evaluation with its manual answers and officer names, however it was loaded. */
export type EvaluationRow = Evaluation & {
  checks: { checkId: string; value: "Y" | "N" | "NA" }[];
  evaluatingOfficer: Name;
  reviewingSupervisor: Name;
  approvingOfficer: Name;
};

const stateInclude = {
  ...submissionInclude,
  createdBy: { select: { name: true } },
  evaluation: {
    include: {
      checks: true,
      evaluatingOfficer: { select: { name: true } },
      reviewingSupervisor: { select: { name: true } },
      approvingOfficer: { select: { name: true } },
    },
  },
  payments: {
    orderBy: { paymentSeq: "asc" },
    include: {
      recordedBy: { select: { name: true } },
      verifiedBy: { select: { name: true } },
      financeDecidedBy: { select: { name: true } },
      reversedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.SubmissionInclude;

/**
 * Pure: the evaluation state of one submission from its row (passed through for pages that show more
 * of it), payments and evaluation, given the other submissions (for duplicate checks).
 */
function buildState<R extends SubmissionRowLike>(
  row: R,
  payments: readonly PaymentInput[],
  ev: EvaluationRow,
  others: readonly OtherSubmission[] | DuplicateIndex,
  ctx: DomainContext,
) {
  const sub = submissionFromRow(row, ctx.ref.schedule2Documents.length);
  const assessment = assessSubmission(sub, payments, ctx);
  const flags = dataFlags(sub, assessment, others, ctx);

  const evaluation: EvaluationInput = {
    evaluatingOfficerId: ev.evaluatingOfficerId,
    reviewingSupervisorId: ev.reviewingSupervisorId,
    approvingOfficerId: ev.approvingOfficerId,
    dateEvaluationStarted: toIsoDate(ev.dateEvaluationStarted),
    checks: Object.fromEntries(
      ev.checks.map((c) => [c.checkId, CHECK_FROM_DB[c.value] as CheckValue]),
    ),
    evaluationRemarks: ev.evaluationRemarks,
    finalDecision: ev.finalDecision ? DECISION_FROM_DB[ev.finalDecision] : null,
    reasons: ev.reasons,
    reviewDate: toIsoDate(ev.reviewDate),
    approvalDate: toIsoDate(ev.approvalDate),
    flagOverrideReason: ev.flagOverrideReason,
  };

  /** Checks and counts, optionally as if an override reason were recorded (approval with override). */
  const checksFor = (flagOverrideReason: string | null) => {
    const checks = effectiveChecks(ctx.ref.evaluationChecks, evaluation.checks, {
      sub,
      assessment,
      flags,
      duplicateCac: flags.some((f) => f.code === "DUPLICATE_CAC"),
      flagsExplained: !!flagOverrideReason?.trim(),
      ctx,
    });
    return { checks, counts: countDecisionChecks(checks) };
  };
  const { checks, counts } = checksFor(evaluation.flagOverrideReason);

  return {
    row,
    sub,
    assessment,
    flags,
    evaluation,
    evaluationRow: ev,
    checks,
    counts,
    checksFor,
    status: evaluationStatus(evaluation, counts),
    recommended: recommendedOutcome(checks, counts, sub, assessment, evaluation, ctx.today),
  };
}

const otherSelect = { id: true, cacNo: true, registeredName: true, registrationNo: true } as const;

/**
 * A stored submission with everything the evaluation and workflow rules need: assessment, flags,
 * effective checks (manual + automatic) and their counts. Used by pages and by every workflow action,
 * so what the screen shows and what the server enforces always agree.
 */
export async function loadEvaluationState(db: Db | Tx, id: string, ctx: DomainContext) {
  const row = await db.submission.findUnique({ where: { id }, include: stateInclude });
  if (!row?.evaluation) return null;
  const others = await db.submission.findMany({ where: { id: { not: id } }, select: otherSelect });
  return buildState(row, row.payments.map(paymentFromRow), row.evaluation, others, ctx);
}

export type EvaluationState = NonNullable<Awaited<ReturnType<typeof loadEvaluationState>>>;

/** "key=value,key=value" per id, from one grouped query. */
async function grouped(query: Promise<{ id: string; pairs: string }[]>) {
  const rows = await query;
  return new Map(
    rows.map((r) => [r.id, r.pairs.split(",").map((p) => p.split("=") as [string, string])]),
  );
}

/**
 * Evaluation state for many submissions (dashboard, Evaluations list). Nested includes build an
 * object per document, answer and payment, which was most of the time at volume, so this loads flat
 * rows and groups documents and answers in SQL (see scripts/perf-dashboard.ts).
 */
export async function loadEvaluationStates(
  db: Db | Tx,
  ctx: DomainContext,
  where: Prisma.SubmissionWhereInput = {},
) {
  const [rows, all, evaluations, users, payments, documents, answers] = await Promise.all([
    db.submission.findMany({ where, orderBy: { ackSeq: "desc" } }),
    db.submission.findMany({ select: otherSelect }),
    db.evaluation.findMany(),
    db.user.findMany({ select: { id: true, name: true } }),
    db.payment.findMany({ where: { submissionId: { not: null } }, orderBy: { paymentSeq: "asc" } }),
    grouped(
      db.$queryRaw`SELECT "submissionId" AS id, string_agg("documentNumber"::text || '=' || "value"::text, ',') AS pairs
        FROM "DocumentChecklistItem" GROUP BY "submissionId"`,
    ),
    grouped(
      db.$queryRaw`SELECT "evaluationId" AS id, string_agg("checkId" || '=' || "value"::text, ',') AS pairs
        FROM "EvaluationCheckValue" GROUP BY "evaluationId"`,
    ),
  ]);

  const activityName = new Map(ctx.ref.activities.map((a) => [a.code, a.name]));
  const userName = new Map(users.map((u) => [u.id, { name: u.name }]));
  const nameOf = (id: string | null) => (id ? (userName.get(id) ?? null) : null);
  const evaluationOf = new Map(evaluations.map((e) => [e.submissionId, e]));
  const paymentsOf = new Map<string, PaymentInput[]>();
  for (const p of payments) {
    const list = paymentsOf.get(p.submissionId!);
    if (list) list.push(paymentFromRow(p));
    else paymentsOf.set(p.submissionId!, [paymentFromRow(p)]);
  }
  const index = duplicateIndex(all);

  return rows.flatMap((r) => {
    const ev = evaluationOf.get(r.id);
    if (!ev) return [];
    const row = {
      ...r,
      primaryActivity: { name: activityName.get(r.primaryActivityCode) ?? r.primaryActivityCode },
      secondaryActivity: r.secondaryActivityCode
        ? { name: activityName.get(r.secondaryActivityCode) ?? r.secondaryActivityCode }
        : null,
      documents: (documents.get(r.id) ?? []).map(([n, v]) => ({
        documentNumber: Number(n),
        value: CHECK_VALUE_FROM_LABEL[v]!,
      })),
      evaluation: { dateEvaluationStarted: ev.dateEvaluationStarted },
    };
    const evaluationRow: EvaluationRow = {
      ...ev,
      checks: (answers.get(ev.id) ?? []).map(([checkId, v]) => ({
        checkId,
        value: CHECK_VALUE_FROM_LABEL[v]!,
      })),
      evaluatingOfficer: nameOf(ev.evaluatingOfficerId),
      reviewingSupervisor: nameOf(ev.reviewingSupervisorId),
      approvingOfficer: nameOf(ev.approvingOfficerId),
    };
    return [buildState(row, paymentsOf.get(r.id) ?? [], evaluationRow, index, ctx)];
  });
}
