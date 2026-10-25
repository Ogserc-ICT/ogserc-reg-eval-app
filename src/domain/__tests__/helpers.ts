import formsFile from "../../../registration-forms.json";
import seed from "../../../seed-data.json";
import { categoryApplied, categoryAuto } from "../category";
import { addDays } from "../dates";
import { countDecisionChecks, effectiveChecks, type EffectiveCheck } from "../evaluation";
import { dataFlags, type OtherSubmission } from "../flags";
import { NO_CONDITIONS, PAYMENT_EVIDENCE_KEY, findForm, formCodeFor } from "../forms";
import { nairaToKobo } from "../money";
import { referenceDataFromSeed, settingsFromSeed, type Settings } from "../reference";
import { assessSubmission, type DomainContext } from "../submission";
import {
  FILING,
  STATUS,
  type CheckValue,
  type EvaluationInput,
  type LicenceInput,
  type PaymentInput,
  type SubmissionInput,
} from "../types";
import type { ApprovalInput } from "../workflow";

export const ref = referenceDataFromSeed(seed, formsFile);
export const settings = settingsFromSeed(seed);
/** Effective Date placeholder from the seed: 2026-10-22. */
export const ED = settings.effectiveDate;
/** Existing-operator registration deadline: ED + 60 = 2026-12-21. */
export const DEADLINE = addDays(ED, 60);

/** Settings with real signatory names, so the certificate is not blocked. */
export const readySettings: Settings = {
  ...settings,
  chairmanName: "A. Chairman",
  commissionerName: "B. Commissioner",
};

export function activity(code: string): string {
  const a = ref.activities.find((x) => x.code === code);
  if (!a) throw new Error(`No activity ${code}`);
  return a.name;
}

/**
 * Every manual checklist item set to `v` (evidence of payment ticks itself): of one form, or of
 * every form when none is given, so the result satisfies whichever form a submission is on.
 */
export function allDocs(v: CheckValue, form?: string): Record<string, CheckValue> {
  const forms = form ? [findForm(form, ref.forms)] : ref.forms;
  if (forms.some((f) => !f)) throw new Error(`No form ${form}`);
  return Object.fromEntries(
    forms
      .flatMap((f) => f!.documents)
      .filter((d) => d.key !== PAYMENT_EVIDENCE_KEY)
      .map((d) => [d.key, v]),
  );
}

/** A row of the licences table. */
export function licence(number: string | null, expiryDate: string | null = null): LicenceInput {
  return {
    type: "NERC registration/permit (mini-grid/captive)",
    issuingAuthority: "NERC",
    number,
    issueDate: null,
    expiryDate,
    activityCovered: null,
  };
}

/** Another Register row, for duplicate and linked-filing checks. */
export function other(overrides: Partial<OtherSubmission> & { id: string }): OtherSubmission {
  return {
    cacNo: null,
    registeredName: null,
    registrationNo: null,
    filingType: FILING.NEW,
    linkedSubmissionId: null,
    status: STATUS.RECEIVED,
    dateSubmitted: ED,
    certificateIssueDate: null,
    ...overrides,
  };
}

/**
 * A submission, by default filed on the right form for its category and with that category
 * confirmed by the evaluator (as a ready submission would be). Override `formFiled` or
 * `confirmedCategory` to test anything else.
 */
export function makeSubmission(overrides: Partial<SubmissionInput> = {}): SubmissionInput {
  const sub = makeRawSubmission(overrides);
  const category = categoryApplied(sub.categoryOverride, categoryAuto(sub, ref, settings.policy));
  return {
    ...sub,
    formFiled: "formFiled" in overrides ? sub.formFiled : category && formCodeFor(category),
    confirmedCategory: "confirmedCategory" in overrides ? sub.confirmedCategory : category,
  };
}

function makeRawSubmission(overrides: Partial<SubmissionInput>): SubmissionInput {
  return {
    id: "sub-1",
    ackNo: "OGSERC/ACK/2026/00001",
    filingType: FILING.NEW,
    formFiled: "REG-01E",
    linkedSubmissionId: null,
    registeredName: "Example Mini-Grid Ltd",
    dateSubmitted: ED,
    submissionChannel: "By hand",
    registrantType: "Company",
    cacNo: "RC123456",
    tin: null,
    address: "1 Example Road, Abeokuta",
    principalLga: "Abeokuta South",
    lgasServed: [],
    otherAreasServed: null,
    primaryActivity: activity("MGD"),
    otherActivities: [],
    installedCapacityMw: 2.5,
    customers: 500,
    licenceStatus: "NERC registration/permit (mini-grid/captive)",
    licences: [licence("NERC/MG/001")],
    complianceOfficer: "Jane Doe",
    phone: "08012345678",
    email: "compliance@example.ng",
    operatingOnEffectiveDate: "Y",
    plannedStartDate: null,
    approvedWaiver: 0,
    categoryOverride: null,
    overrideReason: null,
    confirmedCategory: null,
    categoryConfirmedReason: null,
    status: STATUS.RECEIVED,
    dateSubmissionComplete: null,
    deficiencyNoticeDate: null,
    certificateIssueDate: null,
    registrationNo: null,
    remarks: null,
    documents: {},
    conditions: { ...NO_CONDITIONS },
    pricing: null,
    // Released for evaluation (Finance-confirmed) unless a test says otherwise (§4.12).
    releasedForEvaluationDate: ED,
    dateEvaluationStarted: null,
    ...overrides,
  };
}

export function makeEvaluation(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    evaluatingOfficerId: "evaluator",
    reviewingSupervisorId: "supervisor",
    approvingOfficerId: "approver",
    dateEvaluationStarted: ED,
    checks: {},
    evaluationRemarks: null,
    finalDecision: null,
    reasons: null,
    reviewDate: null,
    approvalDate: null,
    flagOverrideReason: null,
    ...overrides,
  };
}

export function ctx(today = ED, s: Settings = settings): DomainContext {
  return { ref, settings: s, today };
}

/** A payment, confirmed by Finance unless stated (only confirmed payments count, §4.12). */
export function payment(
  reference: string,
  naira: number,
  dateReceived = ED,
  financeStatus: PaymentInput["financeStatus"] = "CONFIRMED",
): PaymentInput {
  return { reference, amount: nairaToKobo(naira), dateReceived, financeStatus };
}

export const naira = nairaToKobo;

/** Every check answered Y; auto rules override where they apply. */
export const allManualY: Record<string, CheckValue> = Object.fromEntries(
  ref.evaluationChecks.map((d) => [d.id, "Y"]),
);

export interface Scenario {
  sub: SubmissionInput;
  payments: PaymentInput[];
  others: OtherSubmission[];
  evaluation: EvaluationInput;
  /** Overrides on top of `allManualY`. */
  manual: Record<string, CheckValue>;
  today: string;
  settings: Settings;
}

/** Runs a scenario through the real domain functions and returns everything the workflow guards need. */
export function evaluate(partial: Partial<Scenario> = {}) {
  const sub =
    partial.sub ?? makeSubmission({ documents: allDocs("Y"), dateSubmissionComplete: ED });
  const s = partial.settings ?? readySettings;
  const today = partial.today ?? ED;
  const c = ctx(today, s);
  const payments = partial.payments ?? [payment(sub.ackNo!, 250_000)];
  const others = partial.others ?? [];
  const assessment = assessSubmission(sub, payments, c);
  const flags = dataFlags(sub, assessment, others, c);
  const evaluation = partial.evaluation ?? makeEvaluation();
  const manual = { ...allManualY, ...partial.manual };
  const checks: EffectiveCheck[] = effectiveChecks(ref.evaluationChecks, manual, {
    sub,
    assessment,
    flags,
    // As the server does: the duplicate-CAC flag, which compares registrations, not filings.
    duplicateCac: flags.some((f) => f.code === "DUPLICATE_CAC"),
    flagsExplained: !!evaluation.flagOverrideReason,
    ctx: c,
  });
  const counts = countDecisionChecks(checks);
  const approval: ApprovalInput = {
    sub,
    assessment,
    evaluation,
    counts,
    flags,
    createdById: "registry",
    actorId: evaluation.approvingOfficerId ?? "approver",
    settings: s,
  };
  return { sub, assessment, flags, checks, counts, evaluation, approval, ctx: c };
}
