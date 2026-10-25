import type {
  DocumentChecklistItem,
  Payment,
  Prisma,
  Submission,
  SubmissionLicence,
} from "@prisma/client";
import type { OtherSubmission } from "@/domain/flags";
import { CONDITION_KEYS, type ConditionKey, type Conditions } from "@/domain/forms";
import type { PricingSnapshot } from "@/domain/pricing";
import {
  STATUS,
  type CheckValue,
  type LicenceInput,
  type PaymentInput,
  type Status,
  type SubmissionInput,
} from "@/domain/types";
import { fromIsoDate, koboToNumber, toIsoDate } from "./reference-data";
import type { Db, Tx } from "./types";

// DB rows ↔ domain inputs for the Register.

export const STATUS_FROM_DB: Record<Submission["status"], Status> = {
  AWAITING_PAYMENT: STATUS.AWAITING,
  RECEIVED: STATUS.RECEIVED,
  DEFICIENCY: STATUS.DEFICIENCY,
  PROVISIONAL: STATUS.PROVISIONAL,
  REGISTERED: STATUS.REGISTERED,
  LAPSED: STATUS.LAPSED,
  REFUSED: STATUS.REFUSED,
  CANCELLED: STATUS.CANCELLED,
  APPLIED: STATUS.APPLIED,
};

export const CHECK_FROM_DB: Record<DocumentChecklistItem["value"], CheckValue> = {
  Y: "Y",
  N: "N",
  NA: "N/A",
};

export const CHECK_TO_DB = { Y: "Y", N: "N", "N/A": "NA" } as const;

/** Submission column holding each document condition (Y/N/blank as true/false/null). */
export const CONDITION_COLUMNS = {
  holds_any_licence: "holdsAnyLicence",
  multi_state_licensee: "multiStateLicensee",
  generation_for_sale: "generationForSale",
  grid_connected: "gridConnected",
  interconnected_minigrid: "interconnectedMinigrid",
  f_distribution: "fDistribution",
  f_trading: "fTrading",
  g_disco_bulk_supply: "gDiscoBulkSupply",
  sub_franchise: "subFranchise",
} as const satisfies Record<ConditionKey, keyof Submission>;

const yn = (b: boolean | null): "Y" | "N" | null => (b === null ? null : b ? "Y" : "N");

export function conditionsFromRow(row: Pick<Submission, (typeof CONDITION_COLUMNS)[ConditionKey]>) {
  return Object.fromEntries(
    CONDITION_KEYS.map((k) => [k, yn(row[CONDITION_COLUMNS[k]])]),
  ) as Conditions;
}

export function conditionsToColumns(c: Conditions) {
  return Object.fromEntries(
    CONDITION_KEYS.map((k) => [CONDITION_COLUMNS[k], c[k] === null ? null : c[k] === "Y"]),
  ) as Record<(typeof CONDITION_COLUMNS)[ConditionKey], boolean | null>;
}

export type PricingColumns = Pick<
  Submission,
  | "pricedCategory"
  | "pricedRegistrationFee"
  | "pricedLateInitial"
  | "pricedLateDaily"
  | "pricedLateDailyCap"
  | "pricedDeadline"
  | "pricedEffectiveDate"
>;

export function pricingToColumns(p: PricingSnapshot): PricingColumns {
  return {
    pricedCategory: p.category,
    pricedRegistrationFee: BigInt(p.registrationFee),
    pricedLateInitial: BigInt(p.lateInitial),
    pricedLateDaily: BigInt(p.lateDaily),
    pricedLateDailyCap: BigInt(p.lateDailyCap),
    pricedDeadline: fromIsoDate(p.deadline),
    pricedEffectiveDate: fromIsoDate(p.effectiveDate),
  };
}

export function pricingFromColumns(row: PricingColumns): PricingSnapshot {
  return {
    category: row.pricedCategory,
    registrationFee: koboToNumber(row.pricedRegistrationFee),
    lateInitial: koboToNumber(row.pricedLateInitial),
    lateDaily: koboToNumber(row.pricedLateDaily),
    lateDailyCap: koboToNumber(row.pricedLateDailyCap),
    deadline: toIsoDate(row.pricedDeadline),
    effectiveDate: toIsoDate(row.pricedEffectiveDate),
  };
}

export function licenceFromRow(l: SubmissionLicence): LicenceInput {
  return {
    type: l.type,
    issuingAuthority: l.issuingAuthority,
    number: l.number,
    issueDate: toIsoDate(l.issueDate),
    expiryDate: toIsoDate(l.expiryDate),
    activityCovered: l.activityCovered,
  };
}

export const submissionInclude = {
  primaryActivity: true,
  otherActivities: {
    orderBy: { sortOrder: "asc" },
    include: { activity: { select: { name: true } } },
  },
  licences: { orderBy: { sortOrder: "asc" } },
  documents: true,
  evaluation: { select: { dateEvaluationStarted: true } },
} satisfies Prisma.SubmissionInclude;

/** What `submissionFromRow` reads: the row, activity names, licences, checklist and evaluation start. */
export type SubmissionRowLike = Submission & {
  primaryActivity: { name: string };
  otherActivities: { activityCode: string; activity: { name: string } }[];
  licences: SubmissionLicence[];
  documents: { documentKey: string; value: DocumentChecklistItem["value"] }[];
  evaluation: { dateEvaluationStarted: Date | null } | null;
};

export function submissionFromRow(row: SubmissionRowLike): SubmissionInput {
  return {
    id: row.id,
    ackNo: row.ackNo,
    filingType: row.filingType,
    formFiled: row.formFiled,
    linkedSubmissionId: row.linkedSubmissionId,
    registeredName: row.registeredName,
    dateSubmitted: toIsoDate(row.dateSubmitted),
    submissionChannel: row.submissionChannel,
    registrantType: row.registrantType,
    cacNo: row.cacNo,
    tin: row.tin,
    address: row.address,
    principalLga: row.principalLga,
    lgasServed: row.lgasServed,
    otherAreasServed: row.otherAreasServed,
    primaryActivity: row.primaryActivity.name,
    otherActivities: row.otherActivities.map((a) => a.activity.name),
    installedCapacityMw:
      row.installedCapacityMw === null ? null : row.installedCapacityMw.toNumber(),
    customers: row.customers,
    licenceStatus: row.licenceStatus,
    licences: row.licences.map(licenceFromRow),
    complianceOfficer: row.complianceOfficer,
    phone: row.phone,
    email: row.email,
    operatingOnEffectiveDate: row.operatingOnEffectiveDate ? "Y" : "N",
    plannedStartDate: toIsoDate(row.plannedStartDate),
    approvedWaiver: koboToNumber(row.approvedWaiver),
    categoryOverride: row.categoryOverride,
    overrideReason: row.overrideReason,
    confirmedCategory: row.confirmedCategory,
    categoryConfirmedReason: row.categoryConfirmedReason,
    status: STATUS_FROM_DB[row.status],
    dateSubmissionComplete: toIsoDate(row.dateSubmissionComplete),
    deficiencyNoticeDate: toIsoDate(row.deficiencyNoticeDate),
    certificateIssueDate: toIsoDate(row.certificateIssueDate),
    registrationNo: row.registrationNo,
    remarks: row.remarks,
    documents: Object.fromEntries(
      row.documents.map((d) => [d.documentKey, CHECK_FROM_DB[d.value]]),
    ),
    conditions: conditionsFromRow(row),
    pricing: pricingFromColumns(row),
    releasedForEvaluationDate: toIsoDate(row.releasedForEvaluationDate),
    dateEvaluationStarted: toIsoDate(row.evaluation?.dateEvaluationStarted ?? null),
  };
}

/** Columns duplicate and linked-filing checks need from every other submission. */
export const otherSelect = {
  id: true,
  cacNo: true,
  registeredName: true,
  registrationNo: true,
  filingType: true,
  linkedSubmissionId: true,
  status: true,
  dateSubmitted: true,
  certificateIssueDate: true,
} as const satisfies Prisma.SubmissionSelect;

export function otherFromRow(r: Pick<Submission, keyof typeof otherSelect>): OtherSubmission {
  return {
    id: r.id,
    cacNo: r.cacNo,
    registeredName: r.registeredName,
    registrationNo: r.registrationNo,
    filingType: r.filingType,
    linkedSubmissionId: r.linkedSubmissionId,
    status: STATUS_FROM_DB[r.status],
    dateSubmitted: toIsoDate(r.dateSubmitted),
    certificateIssueDate: toIsoDate(r.certificateIssueDate),
  };
}

export function paymentFromRow(row: Payment): PaymentInput {
  return {
    reference: row.reference,
    amount: koboToNumber(row.amount),
    dateReceived: toIsoDate(row.dateReceived),
    rrr: row.rrr,
    verifiedWithBank: row.verifiedWithBank ? "Y" : "N",
    status: row.status,
    financeStatus: row.financeStatus,
  };
}

/** A stored submission with its payments, as domain inputs. */
export async function loadSubmission(db: Db | Tx, id: string) {
  const row = await db.submission.findUnique({ where: { id }, include: submissionInclude });
  if (!row) return null;
  const payments = await db.payment.findMany({ where: { submissionId: id } });
  return { sub: submissionFromRow(row), payments: payments.map(paymentFromRow) };
}
