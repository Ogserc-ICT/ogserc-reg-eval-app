import { z } from "zod";
import { addDays, formatDate, isIsoDate, yearOf } from "@/domain/dates";
import { appToday } from "./clock";
import { checkIsEditable } from "@/domain/evaluation";
import { formatNaira } from "@/domain/money";
import { deficiencyNoticeRef } from "@/domain/numbers";
import { ROLE_LABELS, can, canEditChecks, type Role } from "@/domain/roles";
import { STATUS, isClosed, type IsoDate } from "@/domain/types";
import {
  REFUSAL_GROUNDS,
  approvalBlockers,
  approvalChanges,
  cancelBlockers,
  deciderProblems,
  deficiencyNoticeCheck,
  lapseBlockers,
  markComplete,
  officersOf,
  refusalBlockers,
  separationOfDutiesViolations,
} from "@/domain/workflow";
import { reasonSchema } from "@/lib/schemas";
import { writeAudit } from "./audit";
import { loadContext } from "./context";
import { COUNTER, nextCounter } from "./counters";
import {
  BlockedError,
  ConfirmationRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { storeCertificate, storeDeficiencyNotice } from "./documents";
import { loadEvaluationState, type EvaluationState } from "./evaluation-state";
import { fromIsoDate, toIsoDate } from "./reference-data";
import type { Actor, Db, Tx } from "./types";

// SPEC §4 workflow actions. Each: permission → load the current state inside the transaction →
// domain guard (every failing reason) → state change → audit entry, all in one transaction.

export interface WorkflowOptions {
  /** Today in Africa/Lagos; overridable for tests. */
  today?: IsoDate;
}

export const CONFIRM_DEFICIENCY = "confirmDeficiency";

function assertCan(actor: Actor, permission: Parameters<typeof can>[1]) {
  if (!can(actor.roles, permission)) throw new ForbiddenError();
}

/**
 * Lock the submission row, then load its evaluation state inside the transaction, so two people acting
 * on the same submission at once are handled one after the other and guards see committed data.
 */
async function stateFor(tx: Tx, id: string, today: IsoDate) {
  await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${id} FOR UPDATE`;
  const ctx = await loadContext(tx, today);
  const state = await loadEvaluationState(tx, id, ctx);
  if (!state) throw new NotFoundError("Submission not found.");
  return { ctx, state };
}

function blockIf(reasons: string[], message: string) {
  if (reasons.length) throw new BlockedError(message, reasons);
}

/**
 * A workflow transaction. Status, decision and the action-set dates are locked by DB triggers except
 * inside a transaction that sets `ogserc.workflow` (see the workflow-locks migration).
 */
function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('ogserc.workflow', 'on', true)`;
      return fn(tx);
    },
    { timeout: 30_000 },
  );
}

/** The latest deficiency notice not yet answered by a completing response, if any. */
function openNotice(tx: Tx, submissionId: string) {
  return tx.deficiencyNotice.findFirst({
    where: { submissionId, responseReceivedDate: null },
    orderBy: { seq: "desc" },
  });
}

// --- Assignment ---------------------------------------------------------------

const optionalId = z
  .string()
  .trim()
  .max(40)
  .transform((s) => s || null);
const assignSchema = z.object({
  evaluatingOfficerId: optionalId,
  reviewingSupervisorId: optionalId,
  approvingOfficerId: optionalId,
});

const OFFICER_FIELDS = [
  ["evaluatingOfficerId", "EVALUATING_OFFICER", "evaluating officer"],
  ["reviewingSupervisorId", "REVIEWING_SUPERVISOR", "reviewing supervisor"],
  ["approvingOfficerId", "APPROVING_OFFICER", "approving officer"],
] as const;

/** Assign the three officers (§1.3). Drop-downs are filtered by role; the server checks again (§5). */
export async function assignOfficers(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: WorkflowOptions = {},
) {
  assertCan(actor, "evaluation.assign");
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const next = parsed.data;
  const today = opts.today ?? appToday();

  return inTx(db, async (tx) => {
    const { state } = await stateFor(tx, id, today);
    if (state.evaluation.finalDecision) {
      throw new ValidationError("A final decision is recorded; officers can no longer change.");
    }
    const ids = [...new Set(Object.values(next).filter((v): v is string => !!v))];
    const users = await tx.user.findMany({ where: { id: { in: ids } } });
    const byId = new Map(users.map((u) => [u.id, u]));

    const fieldErrors: Record<string, string[]> = {};
    for (const [field, role, label] of OFFICER_FIELDS) {
      const userId = next[field];
      if (!userId) continue;
      const user = byId.get(userId);
      if (!user?.active || !user.roles.includes(role)) {
        fieldErrors[field] = [`Choose an active ${label} (role: ${ROLE_LABELS[role as Role]})`];
      }
    }
    if (Object.keys(fieldErrors).length) {
      throw new ValidationError("Please correct the highlighted fields.", fieldErrors);
    }
    blockIf(
      separationOfDutiesViolations(officersOf(next, state.row.createdById)),
      "This assignment breaks separation of duties.",
    );

    const before = state.evaluationRow;
    const name = (userId: string | null) =>
      userId ? (byId.get(userId)?.name ?? userId) : "(none)";
    const previousName = (field: (typeof OFFICER_FIELDS)[number][0]) =>
      ({
        evaluatingOfficerId: before.evaluatingOfficer?.name,
        reviewingSupervisorId: before.reviewingSupervisor?.name,
        approvingOfficerId: before.approvingOfficer?.name,
      })[field] ?? "(none)";
    const changes = OFFICER_FIELDS.filter(([field]) => before[field] !== next[field]).map(
      ([field, , label]) => `${label}: ${previousName(field)} → ${name(next[field])}`,
    );
    if (!changes.length) return 0;

    await tx.evaluation.update({
      where: { submissionId: id },
      data: {
        ...next,
        dateEvaluationStarted:
          before.dateEvaluationStarted ?? (next.evaluatingOfficerId ? fromIsoDate(today) : null),
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Officers assigned",
      reference: state.row.ackNo,
      detail: changes.join("; "),
    });
    return changes.length;
  });
}

// --- Checks -------------------------------------------------------------------

const checksSchema = z.object({
  values: z.record(z.string().regex(/^\d+\.\d+$/), z.enum(["Y", "N", "N/A", ""])),
  remarks: z
    .string()
    .trim()
    .max(4000)
    .transform((s) => s || null),
});

const CHECK_TO_DB = { Y: "Y", N: "N", "N/A": "NA" } as const;

/** Save manual EVAL-01 checks and remarks. Automatic checks are computed and never stored (§6). */
export async function saveChecks(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: WorkflowOptions = {},
) {
  assertCan(actor, "evaluation.editChecks");
  const parsed = checksSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const today = opts.today ?? appToday();

  return inTx(db, async (tx) => {
    const { state } = await stateFor(tx, id, today);
    if (!canEditChecks(actor, state.evaluation.evaluatingOfficerId)) {
      throw new ForbiddenError(
        "Only the assigned evaluating officer or a reviewing supervisor can edit these checks.",
      );
    }
    const changes: string[] = [];
    const locked: string[] = [];
    for (const [checkId, value] of Object.entries(parsed.data.values)) {
      const check = state.checks.find((c) => c.id === checkId);
      if (!check) throw new ValidationError(`Unknown check ${checkId}.`);
      const old = state.evaluation.checks[checkId] ?? "";
      if (old === value && check.mode === "manual") continue;
      if (!checkIsEditable(check, state.evaluation.finalDecision, state.sub.status)) {
        if ((check.value ?? "") !== value) locked.push(checkId);
        continue;
      }
      changes.push(`${checkId}: ${old || "blank"} → ${value || "blank"}`);
      const key = { evaluationId_checkId: { evaluationId: state.evaluationRow.id, checkId } };
      if (value === "")
        await tx.evaluationCheckValue.deleteMany({ where: key.evaluationId_checkId });
      else {
        await tx.evaluationCheckValue.upsert({
          where: key,
          create: { evaluationId: state.evaluationRow.id, checkId, value: CHECK_TO_DB[value] },
          update: { value: CHECK_TO_DB[value] },
        });
      }
    }
    if (locked.length) {
      throw new ValidationError(
        `These checks are automatic or locked and cannot be changed: ${locked.join(", ")}.`,
      );
    }
    const remarksChanged = parsed.data.remarks !== state.evaluation.evaluationRemarks;
    if (remarksChanged) {
      await tx.evaluation.update({
        where: { id: state.evaluationRow.id },
        data: { evaluationRemarks: parsed.data.remarks },
      });
      changes.push("remarks updated");
    }
    if (changes.length) {
      await writeAudit(tx, {
        userId: actor.id,
        action: "Evaluation checks updated",
        reference: state.row.ackNo,
        detail: changes.join("; "),
      });
    }
    return changes.length;
  });
}

/** Reviewing supervisor records that the evaluation has been reviewed. */
export async function recordReview(db: Db, actor: Actor, id: string, opts: WorkflowOptions = {}) {
  assertCan(actor, "evaluation.review");
  const today = opts.today ?? appToday();
  return inTx(db, async (tx) => {
    const { state } = await stateFor(tx, id, today);
    const reasons: string[] = [];
    if (state.evaluation.reviewingSupervisorId !== actor.id) {
      reasons.push("Only the assigned reviewing supervisor can record the review");
    }
    if (!state.evaluation.evaluatingOfficerId) reasons.push("No evaluating officer assigned");
    if (state.evaluation.finalDecision) reasons.push("A final decision is already recorded");
    blockIf(reasons, "The review cannot be recorded.");
    await tx.evaluation.update({
      where: { id: state.evaluationRow.id },
      data: { reviewDate: fromIsoDate(today) },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Evaluation reviewed",
      reference: state.row.ackNo,
      detail: `${state.counts.satisfied} satisfied, ${state.counts.failed} failed, ${state.counts.pending} pending`,
    });
  });
}

// --- Status changes -------------------------------------------------------------

function requireAssignedEvaluatorOrSupervisor(actor: Actor, state: EvaluationState) {
  if (!canEditChecks(actor, state.evaluation.evaluatingOfficerId)) {
    throw new ForbiddenError(
      "Only the assigned evaluating officer or a reviewing supervisor can do this.",
    );
  }
}

/**
 * §4.4 Mark complete: sets the completion date if empty, starting the determination clock. When the
 * response to a deficiency notice completes the submission, it returns to "Received - Under Review".
 */
export async function markSubmissionComplete(
  db: Db,
  actor: Actor,
  id: string,
  opts: WorkflowOptions = {},
) {
  assertCan(actor, "submission.markComplete");
  const today = opts.today ?? appToday();
  return inTx(db, async (tx) => {
    const { ctx, state } = await stateFor(tx, id, today);
    requireAssignedEvaluatorOrSupervisor(actor, state);
    const { sub, assessment } = state;
    blockIf(
      isClosed(sub.status) ? [`Submission is closed (${sub.status})`] : [],
      "Cannot mark complete.",
    );
    const result = markComplete(sub, assessment, today, ctx.settings);
    if (!result.ok) {
      throw new BlockedError("The submission is not complete.", [
        ...result.outstandingDocuments.map((d) => `Outstanding: ${d}`),
        ...(result.shortfall > 0 ? [`Unpaid: ${formatNaira(result.shortfall)}`] : []),
        "Obtain these, or issue a deficiency notice (para 13(1)(b)).",
      ]);
    }
    const reopens = sub.status === STATUS.DEFICIENCY;
    if (!result.changed && !reopens)
      return { changed: false as const, determinationDue: result.determinationDue };

    // The response to the deficiency notice completed the submission: record when.
    const notice = reopens ? await openNotice(tx, id) : null;
    if (notice) {
      await tx.deficiencyNotice.update({
        where: { id: notice.id },
        data: { responseReceivedDate: fromIsoDate(today) },
      });
    }
    await tx.submission.update({
      where: { id },
      data: {
        dateSubmissionComplete: fromIsoDate(result.dateSubmissionComplete),
        ...(reopens ? { status: "RECEIVED" as const } : {}),
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Submission complete",
      reference: sub.ackNo,
      detail:
        `Determination due ${formatDate(result.determinationDue)}` +
        (reopens
          ? `; response to ${notice?.noticeRef ?? "deficiency notice"} received ${formatDate(today)}, back to Received - Under Review`
          : ""),
    });
    return { changed: true as const, determinationDue: result.determinationDue };
  });
}

/** §4.5 Issue deficiency notice (para 13(1)(b)). */
export async function issueDeficiency(
  db: Db,
  actor: Actor,
  id: string,
  opts: WorkflowOptions & { confirm?: boolean } = {},
) {
  assertCan(actor, "deficiency.issue");
  const today = opts.today ?? appToday();
  return inTx(db, async (tx) => {
    const { ctx, state } = await stateFor(tx, id, today);
    const { sub, assessment: a } = state;
    const check = deficiencyNoticeCheck(sub.status, state.counts, a.submissionComplete);
    const unresolved = await openNotice(tx, id);
    blockIf(
      [
        ...check.blockers,
        ...(unresolved && !check.blockers.length
          ? [
              `${unresolved.noticeRef} has not been answered yet: mark the submission complete when it is`,
            ]
          : []),
      ],
      "A deficiency notice cannot be issued.",
    );
    if (check.needsConfirmation && !opts.confirm) {
      throw new ConfirmationRequiredError(CONFIRM_DEFICIENCY, check.needsConfirmation);
    }
    const responseDue = addDays(today, ctx.settings.deficiencyDays);
    const seq = (await tx.deficiencyNotice.count({ where: { submissionId: id } })) + 1;
    // SPEC §3 format; a second or later notice on the same submission gets a -2, -3… suffix.
    const noticeRef = deficiencyNoticeRef(sub.ackNo!, today) + (seq > 1 ? `-${seq}` : "");
    const notice = await tx.deficiencyNotice.create({
      data: {
        submissionId: id,
        seq,
        noticeRef,
        noticeDate: fromIsoDate(today),
        responseDue: fromIsoDate(responseDue),
        issuedById: actor.id,
      },
    });
    // The notice PDF is generated here only (SPEC §8.10), from the state that justified issuing it.
    await storeDeficiencyNotice(tx, actor, state, {
      id: notice.id,
      noticeRef,
      noticeDate: today,
      responseDue,
    });
    await tx.submission.update({
      where: { id },
      data: { status: "DEFICIENCY", deficiencyNoticeDate: fromIsoDate(today) },
    });
    const parts = [
      `${noticeRef}; response due ${formatDate(responseDue)}`,
      `${a.documents.outstandingList.length} document(s) outstanding`,
      `balance ${formatNaira(Math.max(0, a.fees.balance))}`,
      `${state.counts.failed} check(s) failed`,
    ];
    await writeAudit(tx, {
      userId: actor.id,
      action: "Deficiency notice issued",
      reference: sub.ackNo,
      detail: parts.join("; "),
    });
    return { responseDue, noticeRef };
  });
}

const approveSchema = z.object({
  flagOverrideReason: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null),
});

/** §4.6 Approve and register (para 13(1)(a)). */
export async function approveAndRegister(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: WorkflowOptions = {},
) {
  assertCan(actor, "submission.approve");
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const today = opts.today ?? appToday();

  return inTx(db, async (tx) => {
    const { ctx, state } = await stateFor(tx, id, today);
    const override = parsed.data.flagOverrideReason ?? state.evaluation.flagOverrideReason;
    const { counts } = state.checksFor(override);
    const approval = {
      sub: state.sub,
      assessment: state.assessment,
      evaluation: { ...state.evaluation, flagOverrideReason: override },
      counts,
      flags: state.flags,
      createdById: state.row.createdById,
      actorId: actor.id,
      settings: ctx.settings,
    };
    blockIf(approvalBlockers(approval), "Approval is blocked.");

    const serial = await nextCounter(tx, COUNTER.registration(yearOf(today)));
    const changes = approvalChanges(approval, actor.name, serial, today);
    await tx.submission.update({
      where: { id },
      data: {
        status: "REGISTERED",
        registrationNo: changes.submission.registrationNo,
        certificateIssueDate: fromIsoDate(today),
        dateSubmissionComplete: fromIsoDate(changes.submission.dateSubmissionComplete),
      },
    });
    await tx.evaluation.update({
      where: { id: state.evaluationRow.id },
      data: {
        finalDecision: "REGISTER",
        reviewDate: fromIsoDate(changes.evaluation.reviewDate),
        approvalDate: fromIsoDate(today),
        flagOverrideReason: state.flags.length ? override : state.evaluation.flagOverrideReason,
      },
    });
    const overridden =
      state.flags.length && override
        ? `; ${state.flags.length} data flag(s) overridden: ${override}`
        : "";
    // §4.6: the certificate is produced in the same transaction; if it cannot be, nothing is approved.
    await storeCertificate(tx, actor, id, ctx, { reissue: false });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Registered",
      reference: state.sub.ackNo,
      detail: changes.auditDetail + overridden,
    });
    return { registrationNo: changes.submission.registrationNo! };
  });
}

/** §4.7 Lapse (para 13(2)): only after the deficiency response period has ended. */
export async function lapseSubmission(
  db: Db,
  actor: Actor,
  id: string,
  opts: WorkflowOptions = {},
) {
  assertCan(actor, "submission.lapse");
  const today = opts.today ?? appToday();
  return inTx(db, async (tx) => {
    const { state } = await stateFor(tx, id, today);
    blockIf(
      lapseBlockers(state.sub.status, state.assessment, today),
      "The submission cannot lapse yet.",
    );
    await tx.submission.update({ where: { id }, data: { status: "LAPSED" } });
    await tx.evaluation.update({
      where: { id: state.evaluationRow.id },
      data: { finalDecision: "LAPSE", approvalDate: fromIsoDate(today) },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Lapsed",
      reference: state.sub.ackNo,
      detail: `No complete response by ${formatDate(state.assessment.deficiencyResponseDue!)} (para 13(2))`,
    });
  });
}

const showCauseSchema = z.object({
  showCauseDate: z.string().trim().refine(isIsoDate, "Enter a valid date (YYYY-MM-DD)"),
});

/** Record the date a show-cause notice was served (paras 13(3), 20), before any refusal. */
export async function recordShowCause(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: WorkflowOptions = {},
) {
  assertCan(actor, "showCause.record");
  const parsed = showCauseSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const today = opts.today ?? appToday();
  const { showCauseDate } = parsed.data;
  if (showCauseDate > today) {
    throw new ValidationError("Please correct the highlighted fields.", {
      showCauseDate: ["Cannot be in the future"],
    });
  }
  return inTx(db, async (tx) => {
    const { ctx, state } = await stateFor(tx, id, today);
    blockIf(
      isClosed(state.sub.status) ? [`Submission is closed (${state.sub.status})`] : [],
      "A show-cause notice cannot be recorded.",
    );
    const previous = toIsoDate(state.row.showCauseDate);
    await tx.submission.update({
      where: { id },
      data: { showCauseDate: fromIsoDate(showCauseDate) },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Show-cause notice served",
      reference: state.sub.ackNo,
      detail:
        `Served ${formatDate(showCauseDate)}; period ends ${formatDate(addDays(showCauseDate, ctx.settings.showCauseDays))}` +
        (previous ? ` (replaces ${formatDate(previous)})` : ""),
    });
  });
}

const refuseSchema = z.object({
  ground: z.string().trim(),
  details: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null),
});

/** §4.8 Refuse (paras 13(3), 20): after the show-cause period, on a ground the Order allows. */
export async function refuseSubmission(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: WorkflowOptions = {},
) {
  assertCan(actor, "submission.refuse");
  const parsed = refuseSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const today = opts.today ?? appToday();
  return inTx(db, async (tx) => {
    const { ctx, state } = await stateFor(tx, id, today);
    blockIf(
      [
        ...refusalBlockers(
          state.sub.status,
          toIsoDate(state.row.showCauseDate),
          parsed.data.ground || null,
          today,
          ctx.settings,
        ),
        ...deciderProblems(state.evaluation, state.row.createdById, actor.id),
      ],
      "Refusal is blocked.",
    );
    const reasons = parsed.data.details
      ? `${parsed.data.ground}: ${parsed.data.details}`
      : parsed.data.ground;
    await tx.submission.update({ where: { id }, data: { status: "REFUSED" } });
    await tx.evaluation.update({
      where: { id: state.evaluationRow.id },
      data: { finalDecision: "REFUSE", reasons, approvalDate: fromIsoDate(today) },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Refused",
      reference: state.sub.ackNo,
      detail: reasons,
    });
  });
}

/** §4.9 Cancel (admin only, para 14), with a reason. */
export async function cancelSubmission(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: WorkflowOptions = {},
) {
  assertCan(actor, "submission.cancel");
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const today = opts.today ?? appToday();
  return inTx(db, async (tx) => {
    const { state } = await stateFor(tx, id, today);
    blockIf(cancelBlockers(state.sub.status, parsed.data.reason), "Cancellation is blocked.");
    await tx.submission.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.evaluation.update({
      where: { id: state.evaluationRow.id },
      data: { reasons: `Cancelled: ${parsed.data.reason}` },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Cancelled",
      reference: state.sub.ackNo,
      detail: `Was ${state.sub.status}. Reason: ${parsed.data.reason}`,
    });
  });
}

/**
 * Admin: reopen a decision made in error, with a reason. Refused, Lapsed and Cancelled records go back
 * to where the decision found them; a Registered decision cannot be reopened (its number is locked:
 * cancel it instead, para 14).
 */
export async function reopenDecision(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: WorkflowOptions = {},
) {
  assertCan(actor, "decision.reopen");
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const today = opts.today ?? appToday();
  return inTx(db, async (tx) => {
    const { state } = await stateFor(tx, id, today);
    const { sub, row } = state;
    const status = sub.status!;
    if (status === STATUS.REGISTERED) {
      throw new BlockedError("This decision cannot be reopened.", [
        `Registered as ${row.registrationNo}: the registration number is locked. Cancel the registration instead (para 14).`,
      ]);
    }
    if (!isClosed(status)) {
      throw new BlockedError("There is no decision to reopen.", [`The submission is ${status}`]);
    }
    const unresolved = await openNotice(tx, id);
    const reinstate = status === STATUS.CANCELLED && !!row.registrationNo;
    const next = reinstate ? "REGISTERED" : unresolved ? "DEFICIENCY" : "RECEIVED";
    const nextLabel = {
      REGISTERED: STATUS.REGISTERED,
      DEFICIENCY: STATUS.DEFICIENCY,
      RECEIVED: STATUS.RECEIVED,
    }[next];

    await tx.submission.update({ where: { id }, data: { status: next } });
    await tx.evaluation.update({
      where: { id: state.evaluationRow.id },
      data: reinstate
        ? { reasons: null }
        : { finalDecision: null, reasons: null, approvalDate: null },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Decision reopened",
      reference: sub.ackNo,
      detail: `${status} → ${nextLabel}. Reason: ${parsed.data.reason}`,
    });
    return { status: nextLabel };
  });
}

export { REFUSAL_GROUNDS };
