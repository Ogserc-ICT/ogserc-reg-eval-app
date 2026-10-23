import { activityCode, categoryAuto, categoryDescription } from "./category";
import {
  daysLate,
  deficiencyResponseDue,
  determinationDue,
  licenceApplicationDue,
  registrationDeadline,
} from "./deadlines";
import { isSubmissionComplete, summariseDocuments, type DocumentSummary } from "./documents";
import { feeSummary, type FeeSummary } from "./fees";
import { financeGate, processStage, type FinanceGate, type ProcessStage } from "./finance";
import { registrationNoInUse } from "./numbers";
import { priceSubmission, pricingDifferences, type PricingSnapshot } from "./pricing";
import type { ReferenceData, Settings } from "./reference";
import { daysInQueue, slaLight, type SlaLight } from "./sla";
import { isClosed, type IsoDate, type PaymentInput, type SubmissionInput } from "./types";

export interface DomainContext {
  ref: ReferenceData;
  settings: Settings;
  /** Today in Africa/Lagos. */
  today: IsoDate;
}

/** Every calculated field of a Register row (SPEC §2). Derived on read; never edited. */
export interface Assessment {
  primaryCode: string | null;
  secondaryCode: string | null;
  /** Category the current activity map gives (may differ from the snapshot). */
  categoryAuto: string | null;
  /** Category charged: from the pricing snapshot once saved. */
  categoryApplied: string | null;
  categoryDescription: string | null;
  /** Pricing in use: the saved snapshot, or current pricing for an unsaved submission. */
  pricing: PricingSnapshot | null;
  /** What an admin recalculation would produce today. */
  pricingCurrent: PricingSnapshot | null;
  /** Differences between the saved snapshot and current pricing; empty when up to date. */
  pricingChanges: string[];
  /** Effective Date this submission is assessed under (from the snapshot). */
  effectiveDate: IsoDate;
  registrationDeadline: IsoDate | null;
  daysLate: number;
  fees: FeeSummary;
  documents: DocumentSummary;
  submissionComplete: boolean;
  determinationDue: IsoDate | null;
  deficiencyResponseDue: IsoDate | null;
  licenceApplicationDue: IsoDate | null;
  open: boolean;
  daysInQueue: number | null;
  sla: SlaLight | null;
  registrationNoInUse: string | null;
  /** Finance confirmation gate: confirmed payments against what release requires. */
  financeGate: FinanceGate;
  processStage: ProcessStage;
}

export function assessSubmission(
  sub: SubmissionInput,
  payments: readonly PaymentInput[],
  ctx: DomainContext,
): Assessment {
  const { ref, settings, today } = ctx;
  const current = priceSubmission(sub, ref, settings);
  const pricing = sub.pricing ?? current;
  const effectiveDate = sub.pricing?.effectiveDate ?? settings.effectiveDate;
  const deadline = sub.pricing
    ? sub.pricing.deadline
    : registrationDeadline(sub.operatingOnEffectiveDate, sub.plannedStartDate, settings);
  const late = daysLate(sub.dateSubmitted, deadline);
  const fees = feeSummary(
    { terms: pricing, daysLate: late, approvedWaiver: sub.approvedWaiver, reference: sub.ackNo },
    payments,
    settings.policy,
  );
  const documents = summariseDocuments(sub.documents, ref.schedule2Documents);
  const detDue = determinationDue(sub.dateSubmissionComplete, settings);
  const defDue = deficiencyResponseDue(sub.deficiencyNoticeDate, settings);
  const queue = daysInQueue(sub.status, sub.dateSubmitted, today);
  const gate = financeGate(fees, sub.ackNo, payments, settings.policy);
  const applied = pricing?.category ?? null;
  return {
    primaryCode: activityCode(sub.primaryActivity, ref),
    secondaryCode: activityCode(sub.secondaryActivity, ref),
    categoryAuto: categoryAuto(sub, ref),
    categoryApplied: applied,
    categoryDescription: categoryDescription(applied, ref),
    pricing,
    pricingCurrent: current,
    pricingChanges: sub.pricing ? pricingDifferences(sub.pricing, current) : [],
    effectiveDate,
    registrationDeadline: deadline,
    daysLate: late,
    fees,
    documents,
    submissionComplete: isSubmissionComplete(documents, fees, settings.policy),
    determinationDue: detDue,
    deficiencyResponseDue: defDue,
    licenceApplicationDue: licenceApplicationDue(sub.licenceStatus, { ...settings, effectiveDate }),
    open: !isClosed(sub.status),
    daysInQueue: queue,
    sla: slaLight(
      {
        status: sub.status,
        daysInQueue: queue,
        determinationDue: detDue,
        deficiencyResponseDue: defDue,
      },
      today,
      settings,
    ),
    registrationNoInUse: registrationNoInUse(sub.registrationNo, sub.status, sub.ackNo),
    financeGate: gate,
    processStage: processStage(sub.status, gate),
  };
}
