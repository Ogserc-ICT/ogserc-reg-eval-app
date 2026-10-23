import type { SlaLight } from "@/domain/sla";
import { dataFlags, duplicateIndex, type DataFlag, type OtherSubmission } from "@/domain/flags";
import type { PaymentStatus } from "@/domain/fees";
import { nextAction } from "@/domain/next-action";
import { assessSubmission, type DomainContext } from "@/domain/submission";
import { STATUS, type PaymentInput, type Status, type SubmissionInput } from "@/domain/types";
import { loadContext } from "./context";
import { loadEvaluationState } from "./evaluation-state";
import { koboToNumber } from "./reference-data";
import { paymentFromRow, submissionFromRow, submissionInclude } from "./submissions";
import type { Db } from "./types";

const CLOSED_UNPAID: readonly Status[] = [STATUS.REFUSED, STATUS.LAPSED, STATUS.CANCELLED];

export interface RegisterFilters {
  q?: string;
  status?: string;
  category?: string;
  lga?: string;
  activity?: string;
  payment?: string;
  sla?: string;
  flagged?: boolean;
  stalePricing?: boolean;
  late?: boolean;
  /** Paid more than is due (credits). */
  overpaid?: boolean;
  /** Refused, Lapsed or Cancelled with a balance still unpaid. */
  closedUnpaid?: boolean;
}

/** Register filters from the page's query string (shared by the page and its export). */
export function registerFiltersFrom(get: (key: string) => string): RegisterFilters {
  return {
    q: get("q"),
    status: get("status"),
    category: get("category"),
    lga: get("lga"),
    activity: get("activity"),
    payment: get("payment"),
    sla: get("sla"),
    flagged: get("flagged") === "1",
    stalePricing: get("stale") === "1",
    late: get("late") === "1",
    overpaid: get("overpaid") === "1",
    closedUnpaid: get("closedUnpaid") === "1",
  };
}

export interface RegisterRow {
  id: string;
  ackNo: string;
  registeredName: string;
  dateSubmitted: string;
  status: Status;
  /** Derived process stage (§4.12), e.g. "2. Payment with Finance". */
  stage: string;
  category: string | null;
  activityCode: string | null;
  principalLga: string;
  registrationNoInUse: string | null;
  totalDue: number;
  amountPaid: number;
  balance: number;
  paymentStatus: PaymentStatus;
  daysLate: number;
  daysInQueue: number | null;
  sla: SlaLight | null;
  flags: DataFlag[];
  pricingStale: boolean;
  nextAction: string;
}

function toOther(sub: SubmissionInput): OtherSubmission {
  return {
    id: sub.id,
    cacNo: sub.cacNo,
    registeredName: sub.registeredName,
    registrationNo: sub.registrationNo,
  };
}

async function loadAll(db: Db, ctx: DomainContext) {
  const [rows, payments] = await Promise.all([
    db.submission.findMany({ include: submissionInclude, orderBy: { ackSeq: "desc" } }),
    db.payment.findMany({ where: { submissionId: { not: null } } }),
  ]);
  const docCount = ctx.ref.schedule2Documents.length;
  const subs = rows.map((r) => submissionFromRow(r, docCount));
  const paymentInputs = payments.map(paymentFromRow);
  return { subs, paymentInputs, others: subs.map(toOther) };
}

/**
 * Every submission with its assessment and Register row, filtered and searched, newest first. Shared
 * by the Register page and its export, so both always list the same records.
 */
export async function assessRegister(db: Db, filters: RegisterFilters = {}, today?: string) {
  const ctx = await loadContext(db, today);
  const { subs, paymentInputs, others } = await loadAll(db, ctx);
  const index = duplicateIndex(others);
  const paymentsByRef = new Map<string, PaymentInput[]>();
  for (const p of paymentInputs) {
    const list = paymentsByRef.get(p.reference);
    if (list) list.push(p);
    else paymentsByRef.set(p.reference, [p]);
  }
  const q = filters.q?.trim().toLowerCase();

  const entries = subs.map((sub) => {
    const a = assessSubmission(sub, paymentsByRef.get(sub.ackNo ?? "") ?? [], ctx);
    const row: RegisterRow = {
      id: sub.id,
      ackNo: sub.ackNo!,
      registeredName: sub.registeredName!,
      dateSubmitted: sub.dateSubmitted!,
      status: sub.status!,
      stage: `${a.processStage.stage}. ${a.processStage.label}`,
      category: a.categoryApplied,
      activityCode: a.primaryCode,
      principalLga: sub.principalLga!,
      registrationNoInUse: a.registrationNoInUse,
      totalDue: a.fees.totalDue,
      amountPaid: a.fees.amountPaid,
      balance: a.fees.balance,
      paymentStatus: a.fees.paymentStatus,
      daysLate: a.daysLate,
      daysInQueue: a.daysInQueue,
      sla: a.sla,
      flags: dataFlags(sub, a, index, ctx),
      pricingStale: a.pricingChanges.length > 0,
      nextAction: nextAction(sub, a, ctx.today),
    };
    const search = [sub.ackNo, sub.registeredName, sub.cacNo, sub.tin, a.registrationNoInUse]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return { sub, assessment: a, row, search };
  });

  return entries
    .filter(({ row: r, search }) => {
      if (q && !search.includes(q)) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.category && r.category !== filters.category) return false;
      if (filters.lga && r.principalLga !== filters.lga) return false;
      if (filters.activity && r.activityCode !== filters.activity) return false;
      if (filters.payment && r.paymentStatus !== filters.payment) return false;
      if (filters.sla && r.sla !== filters.sla) return false;
      if (filters.flagged && !r.flags.length) return false;
      if (filters.stalePricing && !r.pricingStale) return false;
      if (filters.late && r.daysLate === 0) return false;
      if (filters.overpaid && r.balance >= 0) return false;
      if (filters.closedUnpaid && !(CLOSED_UNPAID.includes(r.status) && r.balance > 0)) {
        return false;
      }
      return true;
    })
    .map(({ sub, assessment, row }) => ({ sub, assessment, row }));
}

/** The Register with every calculated column, filtered and searched. */
export async function listRegister(db: Db, filters: RegisterFilters = {}, today?: string) {
  return (await assessRegister(db, filters, today)).map((e) => e.row);
}

/** Everything the submission page shows. */
export async function getSubmissionDetail(db: Db, id: string, today?: string) {
  const ctx = await loadContext(db, today);
  const state = await loadEvaluationState(db, id, ctx);
  if (!state) return null;
  const { row, sub, assessment, flags, evaluationRow: ev } = state;
  const deficiencyNotices = await db.deficiencyNotice.findMany({
    where: { submissionId: id },
    orderBy: { seq: "asc" },
    include: { issuedBy: { select: { name: true } } },
  });
  const audit = await db.auditLog.findMany({
    where: { reference: row.ackNo },
    orderBy: { id: "desc" },
    take: 100,
    include: { user: { select: { name: true } } },
  });
  return {
    row,
    sub,
    assessment,
    flags,
    nextAction: nextAction(sub, assessment, ctx.today),
    documents: ctx.ref.schedule2Documents.map((name, i) => ({
      number: i + 1,
      name,
      value: sub.documents[i] ?? null,
    })),
    payments: row.payments.map((p) => ({ ...p, amountKobo: koboToNumber(p.amount) })),
    evaluation: {
      status: state.status,
      counts: state.counts,
      recommended: state.recommended,
      evaluatingOfficer: ev.evaluatingOfficer?.name ?? null,
      reviewingSupervisor: ev.reviewingSupervisor?.name ?? null,
      approvingOfficer: ev.approvingOfficer?.name ?? null,
      finalDecision: state.evaluation.finalDecision,
    },
    deficiencyNotices,
    audit,
    ctx,
  };
}
