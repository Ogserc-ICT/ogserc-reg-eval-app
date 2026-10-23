import seed from "../../../seed-data.json";
import { addDays } from "../dates";
import { countDecisionChecks, effectiveChecks, type EffectiveCheck } from "../evaluation";
import { dataFlags, type OtherSubmission } from "../flags";
import { nairaToKobo } from "../money";
import { referenceDataFromSeed, settingsFromSeed, type Settings } from "../reference";
import { assessSubmission, type DomainContext } from "../submission";
import {
  STATUS,
  type CheckValue,
  type EvaluationInput,
  type PaymentInput,
  type SubmissionInput,
} from "../types";
import type { ApprovalInput } from "../workflow";

export const ref = referenceDataFromSeed(seed);
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

export const allDocs = (v: CheckValue): CheckValue[] => ref.schedule2Documents.map(() => v);

export function makeSubmission(overrides: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    id: "sub-1",
    ackNo: "OGSERC/ACK/2026/00001",
    registeredName: "Example Mini-Grid Ltd",
    dateSubmitted: ED,
    submissionChannel: "By hand",
    registrantType: "Company",
    cacNo: "RC123456",
    tin: null,
    address: "1 Example Road, Abeokuta",
    principalLga: "Abeokuta South",
    otherAreasServed: null,
    primaryActivity: activity("MGD"),
    secondaryActivity: null,
    installedCapacityMw: 2.5,
    customers: 500,
    licenceStatus: "NERC registration/permit (mini-grid/captive)",
    licenceNo: "NERC/MG/001",
    licenceExpiry: null,
    complianceOfficer: "Jane Doe",
    phone: "08012345678",
    email: "compliance@example.ng",
    operatingOnEffectiveDate: "Y",
    plannedStartDate: null,
    approvedWaiver: 0,
    categoryOverride: null,
    overrideReason: null,
    status: STATUS.RECEIVED,
    dateSubmissionComplete: null,
    deficiencyNoticeDate: null,
    certificateIssueDate: null,
    registrationNo: null,
    remarks: null,
    documents: allDocs(null),
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
    duplicateCac: others.some((o) => o.cacNo === sub.cacNo),
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
