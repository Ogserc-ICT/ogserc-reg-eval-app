import { z } from "zod";
import { daysBetween } from "@/domain/dates";
import { gateReason } from "@/domain/finance";
import { formatNaira } from "@/domain/money";
import { can } from "@/domain/roles";
import { STATUS, type IsoDate } from "@/domain/types";
import { reasonSchema } from "@/lib/schemas";
import { writeAudit } from "./audit";
import { notify, subjectOf } from "./notifications";
import { appToday } from "./clock";
import { loadContext } from "./context";
import { BlockedError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { loadEvaluationState, loadEvaluationStates } from "./evaluation-state";
import { fromIsoDate, koboToNumber } from "./reference-data";
import type { Actor, Db, Tx } from "./types";

// Finance confirmation gate (SPEC §4.12). A submission is acknowledged first; only payments confirmed
// by a Finance officer count, and it is released for evaluation once they cover what is required.

export const RELEASED_ACTION = "Released for evaluation";
export const BLOCKED_ACTION = "Blocked - awaiting Finance confirmation";

const allowWorkflow = (tx: Tx) => tx.$queryRaw`SELECT set_config('ogserc.workflow', 'on', true)`;

/** Lagos calendar date of an instant (Lagos is UTC+1 all year). */
const lagosDate = (d: Date): IsoDate =>
  new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);

/**
 * Release one acknowledged submission for evaluation if confirmed payments now clear the gate:
 * status → Received - Under Review, release date recorded, evaluation start dated if an evaluating
 * officer is already assigned. Call inside the transaction that changed what the gate depends on.
 */
export async function releaseIfCleared(
  tx: Tx,
  actorId: string | null,
  submissionId: string,
  today: IsoDate,
  trigger: string,
): Promise<boolean> {
  const ctx = await loadContext(tx, today);
  const state = await loadEvaluationState(tx, submissionId, ctx);
  if (!state || state.sub.status !== STATUS.AWAITING || !state.assessment.financeGate.cleared) {
    return false;
  }
  await allowWorkflow(tx);
  await tx.submission.update({
    where: { id: submissionId },
    data: { status: "RECEIVED", releasedForEvaluationDate: fromIsoDate(today) },
  });
  if (state.evaluationRow.evaluatingOfficerId && !state.evaluationRow.dateEvaluationStarted) {
    await tx.evaluation.update({
      where: { id: state.evaluationRow.id },
      data: { dateEvaluationStarted: fromIsoDate(today) },
    });
  }
  const gate = state.assessment.financeGate;
  await writeAudit(tx, {
    userId: actorId,
    action: RELEASED_ACTION,
    reference: state.sub.ackNo,
    detail: `${formatNaira(gate.confirmed)} confirmed of ${formatNaira(gate.required)} required (${trigger})`,
  });
  await notify(tx, actorId, { kind: "released", sub: subjectOf(state) });
  return true;
}

/** Release every acknowledged submission whose confirmed payments clear the gate (daily review, settings). */
export async function releaseEligible(
  tx: Tx,
  actorId: string | null,
  today: IsoDate,
  trigger: string,
) {
  const ctx = await loadContext(tx, today);
  const states = await loadEvaluationStates(tx, ctx, { status: "AWAITING_PAYMENT" });
  const released: string[] = [];
  for (const s of states) {
    if (s.assessment.financeGate.cleared) {
      if (await releaseIfCleared(tx, actorId, s.sub.id, today, trigger)) released.push(s.sub.id);
    }
  }
  return released;
}

/**
 * The payment gate in front of evaluation actions: evaluation, mark complete, deficiency notice,
 * approval, the evaluation form and certificate PDFs (refusal is not gated). When payment is not yet
 * confirmed, the attempt is audited and refused with the reason; when it is but the release was
 * missed, the submission is released first.
 */
export async function requireFinanceGate(
  db: Db,
  actor: Actor,
  submissionId: string,
  action: string,
  today: IsoDate = appToday(),
) {
  const ctx = await loadContext(db, today);
  const state = await loadEvaluationState(db, submissionId, ctx);
  if (!state) throw new NotFoundError("Submission not found.");
  const gate = state.assessment.financeGate;
  if (gate.cleared) {
    if (state.sub.status === STATUS.AWAITING) {
      await db.$transaction((tx) =>
        releaseIfCleared(
          tx,
          actor.id,
          submissionId,
          today,
          `${action} attempted after confirmation`,
        ),
      );
    }
    return;
  }
  const reason = gateReason(gate);
  await db.$transaction((tx) =>
    writeAudit(tx, {
      userId: actor.id,
      action: BLOCKED_ACTION,
      reference: state.sub.ackNo,
      detail: `${action}: ${reason}`,
    }),
  );
  throw new BlockedError(`${action} is not available until Finance confirms payment.`, [reason]);
}

// --- Finance decisions ------------------------------------------------------------------------

const confirmSchema = z.object({
  verified: z.literal(true, {
    errorMap: () => ({ message: "Tick “verified against bank/Remita” to confirm" }),
  }),
  remarks: z
    .string()
    .trim()
    .max(1000)
    .transform((s) => s || null),
});

function assertFinance(actor: Actor) {
  if (!can(actor.roles, "payment.confirm")) throw new ForbiddenError();
}

async function pendingPayment(tx: Tx, paymentId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundError("Payment not found.");
  if (payment.status === "REVERSED")
    throw new ValidationError("This payment is reversed; it cannot be confirmed or rejected.");
  if (payment.financeStatus !== "PENDING") {
    throw new ValidationError(
      `This payment is already ${payment.financeStatus === "CONFIRMED" ? "confirmed" : "rejected"}.`,
    );
  }
  return payment;
}

/**
 * Finance confirms a payment against the bank statement or Remita. The officer who recorded it cannot
 * confirm it. If confirmed payments now clear the gate, the submission is released for evaluation in
 * the same transaction.
 */
export async function confirmPayment(
  db: Db,
  actor: Actor,
  paymentId: string,
  input: unknown,
  opts: { today?: IsoDate } = {},
) {
  assertFinance(actor);
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const today = opts.today ?? appToday();

  return db.$transaction(async (tx) => {
    const payment = await pendingPayment(tx, paymentId);
    if (payment.recordedById === actor.id) {
      throw new BlockedError("You cannot confirm this payment.", [
        "You recorded it; another Finance officer must confirm it (separation of duties)",
      ]);
    }
    if (payment.submissionId) {
      await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${payment.submissionId} FOR UPDATE`;
    }
    const now = new Date();
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        financeStatus: "CONFIRMED",
        financeDecidedById: actor.id,
        financeDecidedAt: now,
        financeRemarks: parsed.data.remarks,
        verifiedWithBank: true,
        verifiedById: actor.id,
        verifiedAt: now,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Payment confirmed",
      reference: payment.reference,
      detail:
        `${payment.paymentNo} ${formatNaira(koboToNumber(payment.amount))} - verified against bank/Remita` +
        (parsed.data.remarks ? `. Remarks: ${parsed.data.remarks}` : ""),
    });
    const released = payment.submissionId
      ? await releaseIfCleared(
          tx,
          actor.id,
          payment.submissionId,
          today,
          `confirmation of ${payment.paymentNo}`,
        )
      : false;
    return { released };
  });
}

/** Finance rejects a payment (not found on the statement, wrong account…). A reason is required. */
export async function rejectPayment(db: Db, actor: Actor, paymentId: string, input: unknown) {
  assertFinance(actor);
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return db.$transaction(async (tx) => {
    const payment = await pendingPayment(tx, paymentId);
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        financeStatus: "REJECTED",
        financeDecidedById: actor.id,
        financeDecidedAt: new Date(),
        financeRemarks: parsed.data.reason,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Payment rejected",
      reference: payment.reference,
      detail: `${payment.paymentNo} ${formatNaira(koboToNumber(payment.amount))}. Reason: ${parsed.data.reason}`,
    });
    await notify(tx, actor.id, {
      kind: "paymentRejected",
      paymentNo: payment.paymentNo,
      reference: payment.reference,
      recordedById: payment.recordedById,
      reason: parsed.data.reason,
      href: payment.submissionId
        ? `/submissions/${payment.submissionId}`
        : payment.ownUseNotificationId
          ? `/own-use/${payment.ownUseNotificationId}`
          : "/payments",
    });
  });
}

/** The Finance Desk: payments waiting for a decision (oldest first) and recent decisions. */
export async function financeDesk(db: Db, actor: Actor, today: IsoDate = appToday()) {
  assertFinance(actor);
  const select = {
    id: true,
    paymentNo: true,
    dateReceived: true,
    reference: true,
    purpose: true,
    channel: true,
    amount: true,
    rrr: true,
    createdAt: true,
    recordedById: true,
    financeStatus: true,
    financeDecidedAt: true,
    financeRemarks: true,
    recordedBy: { select: { name: true } },
    financeDecidedBy: { select: { name: true } },
    submission: { select: { id: true, registeredName: true } },
    ownUseNotification: { select: { id: true, name: true } },
  } as const;
  const [pending, decided] = await Promise.all([
    db.payment.findMany({
      where: { status: "ACTIVE", financeStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
      select,
    }),
    db.payment.findMany({
      where: { financeStatus: { in: ["CONFIRMED", "REJECTED"] } },
      orderBy: { financeDecidedAt: "desc" },
      take: 20,
      select,
    }),
  ]);
  const shape = (p: (typeof pending)[number]) => ({
    id: p.id,
    paymentNo: p.paymentNo,
    dateReceived: p.dateReceived,
    reference: p.reference,
    payer: p.submission?.registeredName ?? p.ownUseNotification?.name ?? "",
    href: p.submission
      ? `/submissions/${p.submission.id}`
      : p.ownUseNotification
        ? `/own-use/${p.ownUseNotification.id}`
        : null,
    purpose: p.purpose,
    channel: p.channel,
    amount: koboToNumber(p.amount),
    rrr: p.rrr,
    recordedBy: p.recordedBy.name,
    recordedByMe: p.recordedById === actor.id,
    daysWaiting: Math.max(0, daysBetween(lagosDate(p.createdAt), today)),
    financeStatus: p.financeStatus,
    decidedBy: p.financeDecidedBy?.name ?? null,
    decidedAt: p.financeDecidedAt,
    remarks: p.financeRemarks,
  });
  return { pending: pending.map(shape), decided: decided.map(shape) };
}
