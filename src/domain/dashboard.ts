import { daysBetween, yearOf } from "./dates";
import { existingOperatorDeadline } from "./deadlines";
import type { EvaluationStatus } from "./evaluation";
import type { DataFlag } from "./flags";
import type { OwnUseAssessment, OwnUseInput } from "./own-use";
import type { ReferenceData, Settings } from "./reference";
import type { Assessment } from "./submission";
import {
  STATUS,
  STATUSES,
  isClosed,
  type IsoDate,
  type Kobo,
  type PaymentInput,
  type Status,
  type SubmissionInput,
} from "./types";

// SPEC §10 dashboard figures. Pure: the server loads the rows, this counts and sums them.

export interface DashboardSubmission {
  sub: SubmissionInput;
  assessment: Assessment;
  flags: readonly DataFlag[];
  evaluationStatus: EvaluationStatus;
}

export interface DashboardOwnUse {
  input: OwnUseInput;
  assessment: OwnUseAssessment;
}

export interface DashboardInput {
  today: IsoDate;
  settings: Settings;
  ref: ReferenceData;
  lgas: readonly string[];
  submissions: readonly DashboardSubmission[];
  ownUse: readonly DashboardOwnUse[];
  /** Every payment (submissions and own-use), including reversed ones (excluded here). */
  payments: readonly PaymentInput[];
  /** Show January–December of this year in the monthly charts instead of the default window. */
  monthYear?: number | null;
}

export interface CategoryRow {
  category: string;
  description: string;
  submissions: number;
  /** Null for Category I (own-use notifications are not registered). */
  registered: number | null;
  fees: Kobo;
  lateCharges: Kobo;
  waivers: Kobo;
  collected: Kobo;
  outstanding: Kobo;
}

export interface MonthRow {
  /** "2026-10" */
  month: string;
  submissions: number;
  registered: number;
  collected: Kobo;
}

export interface Dashboard {
  keyDates: { effectiveDate: IsoDate; registrationDeadline: IsoDate; daysToDeadline: number };
  submissions: {
    total: number;
    registered: number;
    provisional: number;
    inProgress: number;
    closed: number;
    ownUse: number;
    late: number;
  };
  workflow: { red: number; amber: number; flagged: number; averageDaysInQueue: number | null };
  evaluation: Record<EvaluationStatus, number>;
  money: {
    /** Due on live records: excludes Refused, Lapsed and Cancelled submissions. */
    totalDue: Kobo;
    /** Every active payment received, whatever the record's status. */
    collected: Kobo;
    verified: Kobo;
    /** Unpaid on live records. */
    outstanding: Kobo;
    /** Share of the live total due that has been paid: (due − outstanding) ÷ due; null if nothing is due. */
    collectionRate: number | null;
    /** Unpaid balances on Refused, Lapsed and Cancelled submissions, shown apart. */
    unpaidOnClosed: Kobo;
    /** Paid beyond what is due (credits / refunds), on any record. */
    overpaid: Kobo;
    overpaidSubmissions: number;
    overpaidOwnUse: number;
  };
  /** The months the monthly charts show. */
  monthWindow: {
    mode: "from-effective-date" | "rolling" | "year";
    year: number | null;
    years: number[];
  };
  byCategory: CategoryRow[];
  byStatus: { status: Status; count: number }[];
  byActivity: { code: string; name: string; count: number }[];
  byLga: { lga: string; registrants: number; ownUse: number }[];
  monthly: MonthRow[];
}

const sum = <T>(rows: readonly T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const monthOf = (d: IsoDate) => d.slice(0, 7);
const IN_PROGRESS: readonly Status[] = [STATUS.RECEIVED, STATUS.DEFICIENCY];
const CLOSED_NOT_REGISTERED: readonly Status[] = [STATUS.REFUSED, STATUS.LAPSED, STATUS.CANCELLED];

/** Months counted from year 0, so windows can be compared and stepped. */
const monthIndex = (d: IsoDate) => yearOf(d) * 12 + Number(d.slice(5, 7)) - 1;
const monthKey = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

/**
 * Months for the monthly charts: the 12 months from the Effective Date's month until those 12 have
 * passed, then a rolling last 12 months ending this month. A chosen year shows January–December.
 */
export function dashboardMonths(
  effectiveDate: IsoDate,
  today: IsoDate,
  year: number | null = null,
): { months: string[]; mode: "from-effective-date" | "rolling" | "year" } {
  if (year) {
    return { months: Array.from({ length: 12 }, (_, i) => monthKey(year * 12 + i)), mode: "year" };
  }
  const start = monthIndex(effectiveDate);
  const now = monthIndex(today);
  const rolling = now > start + 11;
  const first = rolling ? now - 11 : start;
  return {
    months: Array.from({ length: 12 }, (_, i) => monthKey(first + i)),
    mode: rolling ? "rolling" : "from-effective-date",
  };
}

/** Years a user can pick: from the Effective Date's year to this year. */
export function dashboardYears(effectiveDate: IsoDate, today: IsoDate): number[] {
  const from = yearOf(effectiveDate);
  const to = Math.max(from, yearOf(today));
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export function buildDashboard(input: DashboardInput): Dashboard {
  const { submissions: subs, ownUse, settings, today } = input;
  const activePayments = input.payments.filter((p) => p.status !== "REVERSED");
  const deadline = existingOperatorDeadline(settings);
  const statusOf = (s: DashboardSubmission) => s.sub.status!;

  const open = subs.filter((s) => s.assessment.daysInQueue !== null && !isClosed(statusOf(s)));
  const queueDays = open.map((s) => s.assessment.daysInQueue!);

  // Refused, Lapsed and Cancelled submissions are no longer expected to pay: their balances are shown
  // apart, not in total due, outstanding or the collection rate.
  const writtenOff = (s: DashboardSubmission) => CLOSED_NOT_REGISTERED.includes(statusOf(s));
  const live = subs.filter((s) => !writtenOff(s));
  const totalDue =
    sum(live, (s) => s.assessment.fees.totalDue) + sum(ownUse, (o) => o.assessment.feeDue);
  const outstanding =
    sum(live, (s) => Math.max(0, s.assessment.fees.balance)) +
    sum(ownUse, (o) => Math.max(0, o.assessment.balance));
  const collected = sum(activePayments, (p) => p.amount);
  const overpaidSubs = subs.filter((s) => s.assessment.fees.balance < 0);
  const overpaidOwnUse = ownUse.filter((o) => o.assessment.balance < 0);

  const byCategory: CategoryRow[] = input.ref.fees.map((fee) => {
    if (fee.category === "I") {
      return {
        category: "I",
        description: fee.description,
        submissions: ownUse.length,
        registered: null,
        fees: sum(ownUse, (o) => o.assessment.feeDue),
        lateCharges: 0,
        waivers: 0,
        collected: sum(ownUse, (o) => o.assessment.amountPaid),
        outstanding: sum(ownUse, (o) => Math.max(0, o.assessment.balance)),
      };
    }
    const rows = subs.filter((s) => s.assessment.categoryApplied === fee.category);
    return {
      category: fee.category,
      description: fee.description,
      submissions: rows.length,
      registered: rows.filter((s) => statusOf(s) === STATUS.REGISTERED).length,
      fees: sum(rows, (s) => s.assessment.fees.fee),
      lateCharges: sum(rows, (s) => s.assessment.fees.lateCharge),
      waivers: sum(rows, (s) => s.sub.approvedWaiver),
      collected: sum(rows, (s) => s.assessment.fees.amountPaid),
      outstanding: sum(
        rows.filter((s) => !writtenOff(s)),
        (s) => Math.max(0, s.assessment.fees.balance),
      ),
    };
  });

  const window = dashboardMonths(settings.effectiveDate, today, input.monthYear ?? null);
  const monthly = window.months.map((month) => ({
    month,
    submissions: subs.filter((s) => s.sub.dateSubmitted && monthOf(s.sub.dateSubmitted) === month)
      .length,
    registered: subs.filter(
      (s) => s.sub.certificateIssueDate && monthOf(s.sub.certificateIssueDate) === month,
    ).length,
    collected: sum(
      activePayments.filter((p) => monthOf(p.dateReceived) === month),
      (p) => p.amount,
    ),
  }));

  const evaluation: Record<EvaluationStatus, number> = {
    "Not assigned": 0,
    "In progress": 0,
    "Ready for decision": 0,
    Decided: 0,
  };
  for (const s of subs) evaluation[s.evaluationStatus]++;

  return {
    keyDates: {
      effectiveDate: settings.effectiveDate,
      registrationDeadline: deadline,
      daysToDeadline: daysBetween(today, deadline),
    },
    submissions: {
      total: subs.length,
      registered: subs.filter((s) => statusOf(s) === STATUS.REGISTERED).length,
      provisional: subs.filter((s) => statusOf(s) === STATUS.PROVISIONAL).length,
      inProgress: subs.filter((s) => IN_PROGRESS.includes(statusOf(s))).length,
      closed: subs.filter((s) => CLOSED_NOT_REGISTERED.includes(statusOf(s))).length,
      ownUse: ownUse.length,
      late: subs.filter((s) => s.assessment.daysLate > 0).length,
    },
    workflow: {
      red: subs.filter((s) => s.assessment.sla === "Red").length,
      amber: subs.filter((s) => s.assessment.sla === "Amber").length,
      flagged: subs.filter((s) => s.flags.length > 0).length,
      averageDaysInQueue: queueDays.length ? sum(queueDays, (d) => d) / queueDays.length : null,
    },
    evaluation,
    money: {
      totalDue,
      collected,
      verified: sum(
        activePayments.filter((p) => p.verifiedWithBank === "Y"),
        (p) => p.amount,
      ),
      outstanding,
      collectionRate: totalDue > 0 ? (totalDue - outstanding) / totalDue : null,
      unpaidOnClosed: sum(subs.filter(writtenOff), (s) => Math.max(0, s.assessment.fees.balance)),
      overpaid:
        sum(overpaidSubs, (s) => -s.assessment.fees.balance) +
        sum(overpaidOwnUse, (o) => -o.assessment.balance),
      overpaidSubmissions: overpaidSubs.length,
      overpaidOwnUse: overpaidOwnUse.length,
    },
    monthWindow: {
      mode: window.mode,
      year: input.monthYear ?? null,
      years: dashboardYears(settings.effectiveDate, today),
    },
    byCategory,
    byStatus: STATUSES.map((status) => ({
      status,
      count: subs.filter((s) => statusOf(s) === status).length,
    })),
    byActivity: input.ref.activities.map((a) => ({
      code: a.code,
      name: a.name,
      count: subs.filter((s) => s.assessment.primaryCode === a.code).length,
    })),
    byLga: input.lgas.map((lga) => ({
      lga,
      registrants: subs.filter((s) => s.sub.principalLga === lga).length,
      ownUse: ownUse.filter((o) => o.input.lga === lga).length,
    })),
    monthly,
  };
}

// --- Work queues (§10) -----------------------------------------------------------------

export interface QueueItem {
  id: string;
  ackNo: string;
  name: string;
  status: Status;
  evaluationStatus: EvaluationStatus;
  /** For "my assigned": the user's role(s) on it. */
  roles: string[];
  /** Overdue deficiencies: days past the response date. */
  daysOverdue?: number;
  determinationDue: IsoDate | null;
}

export interface QueueSubmission extends DashboardSubmission {
  officers: {
    evaluatingOfficerId: string | null;
    reviewingSupervisorId: string | null;
    approvingOfficerId: string | null;
  };
  finalDecision: string | null;
}

export function workQueues(rows: readonly QueueSubmission[], userId: string, today: IsoDate) {
  const item = (s: QueueSubmission, extra: Partial<QueueItem> = {}): QueueItem => ({
    id: s.sub.id,
    ackNo: s.sub.ackNo!,
    name: s.sub.registeredName!,
    status: s.sub.status!,
    evaluationStatus: s.evaluationStatus,
    roles: [],
    determinationDue: s.assessment.determinationDue,
    ...extra,
  });
  const open = rows.filter((s) => !isClosed(s.sub.status));

  const mine = open
    .filter((s) => !s.finalDecision)
    .map((s) => {
      const roles = [
        s.officers.evaluatingOfficerId === userId && "Evaluating officer",
        s.officers.reviewingSupervisorId === userId && "Reviewing supervisor",
        s.officers.approvingOfficerId === userId && "Approving officer",
      ].filter((r): r is string => !!r);
      return roles.length ? item(s, { roles }) : null;
    })
    .filter((r): r is QueueItem => r !== null);

  const overdueDeficiency = open
    .filter(
      (s) =>
        s.sub.status === STATUS.DEFICIENCY &&
        s.assessment.deficiencyResponseDue !== null &&
        today > s.assessment.deficiencyResponseDue,
    )
    .map((s) => item(s, { daysOverdue: daysBetween(s.assessment.deficiencyResponseDue!, today) }))
    .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));

  const readyForDecision = open
    .filter((s) => s.evaluationStatus === "Ready for decision")
    .map((s) => item(s))
    .sort((a, b) => (a.determinationDue ?? "9999").localeCompare(b.determinationDue ?? "9999"));

  return { mine, overdueDeficiency, readyForDecision };
}
