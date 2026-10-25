import {
  activityCode,
  categoryAuto,
  categoryDescription,
  otherActivityCategories,
} from "./category";
import {
  daysLate,
  deficiencyResponseDue,
  determinationDue,
  licenceApplicationDue,
  nearestLicenceExpiry,
  registrationDeadline,
} from "./deadlines";
import {
  documentList,
  effectiveDocuments,
  isSubmissionComplete,
  paymentEvidenceValue,
  summariseDocuments,
  type DocumentSummary,
} from "./documents";
import {
  categoryOfForm,
  findForm,
  formForCategory,
  type Conditions,
  type RegistrationFormDef,
} from "./forms";
import {
  declaredCapacities,
  derivedConditions,
  formProgress,
  type FormProgress,
} from "./technical";
import { feeSummary, type FeeSummary } from "./fees";
import { financeGate, processStage, type FinanceGate, type ProcessStage } from "./finance";
import { registrationNoInUse } from "./numbers";
import { priceSubmission, pricingDifferences, type PricingSnapshot } from "./pricing";
import type { ReferenceData, Settings } from "./reference";
import { daysInQueue, slaLight, type SlaLight } from "./sla";
import {
  LICENCE,
  isClosed,
  isLinkedFiling,
  type IsoDate,
  type PaymentInput,
  type SubmissionInput,
} from "./types";

export interface DomainContext {
  ref: ReferenceData;
  settings: Settings;
  /** Today in Africa/Lagos. */
  today: IsoDate;
}

/** Every calculated field of a Register row (SPEC §2). Derived on read; never edited. */
export interface Assessment {
  primaryCode: string | null;
  /** Codes of the other activities that are in the activities list. */
  otherCodes: string[];
  /** Category of the form filed (REG-01E → E). */
  formCategory: string | null;
  /** Form whose document list applies (see `documentsForm`). */
  documentsForm: string | null;
  /** Earliest expiry in the licences table. */
  nearestLicenceExpiry: IsoDate | null;
  /** Document conditions in force: from the licence status and the technical answers, else stored. */
  conditions: Conditions;
  /**
   * Category-specific sections: the documents form's first, then each other activity's form, with
   * how far each is filled in; and every installed capacity they state.
   */
  technical: {
    forms: FormProgress[];
    capacities: { form: string; label: string; mw: number }[];
  };
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

/**
 * The form whose Schedule 2 list the submission must satisfy: the form filed, or, once the evaluator
 * has confirmed another category and wrong forms are accepted (re-categorised), that category's form.
 * Shared keys mean documents already received carry over to the new list.
 */
export function documentsForm(
  sub: SubmissionInput,
  ctx: DomainContext,
): RegistrationFormDef | null {
  const { forms } = ctx.ref;
  if (sub.confirmedCategory && ctx.settings.policy.wrongFormHandling === "ACCEPT") {
    const confirmed = formForCategory(sub.confirmedCategory, forms);
    if (confirmed) return confirmed;
  }
  return findForm(sub.formFiled, forms) ?? formForCategory(sub.pricing?.category ?? null, forms);
}

/** Forms whose technical sections the submission answers: its own, then each other activity's. */
export function technicalForms(sub: SubmissionInput, ctx: DomainContext): string[] {
  const main = documentsForm(sub, ctx);
  const others = otherActivityCategories(sub, ctx.ref, ctx.settings.policy)
    .map((c) => formForCategory(c, ctx.ref.forms))
    .filter((f): f is RegistrationFormDef => !!f && f.category !== "I");
  return [...new Set([main, ...others].filter((f) => !!f).map((f) => f!.form))].filter(
    (f) => !!ctx.ref.technical[f],
  );
}

/**
 * The document conditions in force: "holds any licence" from the licence status (anything but
 * Unlicensed); the others from the technical answers where they decide it; otherwise the stored answer.
 */
export function effectiveConditions(
  sub: SubmissionInput,
  forms: readonly string[],
  ctx: DomainContext,
): Conditions {
  const derived = derivedConditions(ctx.ref.technical, sub.technicalData, forms);
  return {
    ...sub.conditions,
    ...Object.fromEntries(Object.entries(derived).filter(([, v]) => v)),
    ...(sub.licenceStatus
      ? { holds_any_licence: sub.licenceStatus === LICENCE.UNLICENSED ? "N" : "Y" }
      : {}),
  } as Conditions;
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
  // Updates and annual confirmations have no registration deadline (no late charge).
  const deadline = sub.pricing
    ? sub.pricing.deadline
    : isLinkedFiling(sub.filingType)
      ? null
      : registrationDeadline(sub.operatingOnEffectiveDate, sub.plannedStartDate, settings);
  const late = daysLate(sub.dateSubmitted, deadline);
  const fees = feeSummary(
    { terms: pricing, daysLate: late, approvedWaiver: sub.approvedWaiver, reference: sub.ackNo },
    payments,
    settings.policy,
  );
  const form = documentsForm(sub, ctx);
  const techForms = technicalForms(sub, ctx);
  const conditions = effectiveConditions(sub, techForms, ctx);
  const otherForms = otherActivityCategories(sub, ref, settings.policy)
    .map((c) => formForCategory(c, ref.forms))
    .filter((f): f is RegistrationFormDef => !!f && f.category !== "I");
  const documents = summariseDocuments(
    effectiveDocuments(
      documentList(form, otherForms, settings.policy),
      sub.documents,
      conditions,
      paymentEvidenceValue(fees),
    ),
  );
  const detDue = determinationDue(sub.dateSubmissionComplete, settings);
  const defDue = deficiencyResponseDue(sub.deficiencyNoticeDate, settings);
  const queue = daysInQueue(sub.status, sub.dateSubmitted, today);
  const gate = financeGate(fees, sub.ackNo, payments, settings.policy);
  const applied = pricing?.category ?? null;
  return {
    primaryCode: activityCode(sub.primaryActivity, ref),
    otherCodes: sub.otherActivities
      .map((n) => activityCode(n, ref))
      .filter((c): c is string => !!c),
    formCategory: categoryOfForm(sub.formFiled, ref.forms),
    documentsForm: form?.form ?? null,
    nearestLicenceExpiry: nearestLicenceExpiry(sub.licences),
    conditions,
    technical: {
      forms: techForms
        .map((f) => formProgress(f, ref.technical, sub.technicalData, conditions))
        .filter((p): p is FormProgress => !!p),
      capacities: declaredCapacities(ref.technical, sub.technicalData, techForms),
    },
    categoryAuto: categoryAuto(sub, ref, settings.policy),
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
