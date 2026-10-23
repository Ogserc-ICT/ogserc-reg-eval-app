import type { DocumentChecklistItem, Payment, Prisma, Submission } from "@prisma/client";
import type { PricingSnapshot } from "@/domain/pricing";
import {
  STATUS,
  type CheckValue,
  type PaymentInput,
  type Status,
  type SubmissionInput,
} from "@/domain/types";
import { fromIsoDate, koboToNumber, toIsoDate } from "./reference-data";
import type { Db, Tx } from "./types";

// DB rows ↔ domain inputs for the Register.

export const STATUS_FROM_DB: Record<Submission["status"], Status> = {
  RECEIVED: STATUS.RECEIVED,
  DEFICIENCY: STATUS.DEFICIENCY,
  PROVISIONAL: STATUS.PROVISIONAL,
  REGISTERED: STATUS.REGISTERED,
  LAPSED: STATUS.LAPSED,
  REFUSED: STATUS.REFUSED,
  CANCELLED: STATUS.CANCELLED,
};

export const CHECK_FROM_DB: Record<DocumentChecklistItem["value"], CheckValue> = {
  Y: "Y",
  N: "N",
  NA: "N/A",
};

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

export const submissionInclude = {
  primaryActivity: true,
  secondaryActivity: true,
  documents: true,
} satisfies Prisma.SubmissionInclude;

/** What `submissionFromRow` reads: the row, its activity names and its checklist values. */
export type SubmissionRowLike = Submission & {
  primaryActivity: { name: string };
  secondaryActivity: { name: string } | null;
  documents: { documentNumber: number; value: DocumentChecklistItem["value"] }[];
};

export function submissionFromRow(row: SubmissionRowLike, documentCount: number): SubmissionInput {
  const documents: CheckValue[] = Array.from({ length: documentCount }, () => null);
  for (const d of row.documents) documents[d.documentNumber - 1] = CHECK_FROM_DB[d.value];
  return {
    id: row.id,
    ackNo: row.ackNo,
    registeredName: row.registeredName,
    dateSubmitted: toIsoDate(row.dateSubmitted),
    submissionChannel: row.submissionChannel,
    registrantType: row.registrantType,
    cacNo: row.cacNo,
    tin: row.tin,
    address: row.address,
    principalLga: row.principalLga,
    otherAreasServed: row.otherAreasServed,
    primaryActivity: row.primaryActivity.name,
    secondaryActivity: row.secondaryActivity?.name ?? null,
    installedCapacityMw:
      row.installedCapacityMw === null ? null : row.installedCapacityMw.toNumber(),
    customers: row.customers,
    licenceStatus: row.licenceStatus,
    licenceNo: row.licenceNo,
    licenceExpiry: toIsoDate(row.licenceExpiry),
    complianceOfficer: row.complianceOfficer,
    phone: row.phone,
    email: row.email,
    operatingOnEffectiveDate: row.operatingOnEffectiveDate ? "Y" : "N",
    plannedStartDate: toIsoDate(row.plannedStartDate),
    approvedWaiver: koboToNumber(row.approvedWaiver),
    categoryOverride: row.categoryOverride,
    overrideReason: row.overrideReason,
    status: STATUS_FROM_DB[row.status],
    dateSubmissionComplete: toIsoDate(row.dateSubmissionComplete),
    deficiencyNoticeDate: toIsoDate(row.deficiencyNoticeDate),
    certificateIssueDate: toIsoDate(row.certificateIssueDate),
    registrationNo: row.registrationNo,
    remarks: row.remarks,
    documents,
    pricing: pricingFromColumns(row),
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
  };
}

/** A stored submission with its payments, as domain inputs. */
export async function loadSubmission(db: Db | Tx, id: string) {
  const [row, documentCount] = await Promise.all([
    db.submission.findUnique({ where: { id }, include: submissionInclude }),
    db.schedule2Document.count(),
  ]);
  if (!row) return null;
  const payments = await db.payment.findMany({ where: { submissionId: id } });
  return { sub: submissionFromRow(row, documentCount), payments: payments.map(paymentFromRow) };
}
