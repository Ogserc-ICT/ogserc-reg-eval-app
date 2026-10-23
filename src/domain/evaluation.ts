import { licenceNeedsRenewal } from "./deadlines";
import type { DataFlag } from "./flags";
import type { EvaluationCheckDef } from "./reference";
import type { Assessment, DomainContext } from "./submission";
import {
  FINAL_DECISION,
  LICENCE,
  STATUS,
  type CheckValue,
  type EvaluationInput,
  type FinalDecision,
  type IsoDate,
  type Status,
  type SubmissionInput,
} from "./types";

/**
 * How a check gets its value:
 * - "auto": computed, read-only
 * - "auto-na": currently N/A because its condition does not apply, read-only
 * - "manual": entered by the evaluating officer
 */
export type CheckMode = "auto" | "auto-na" | "manual";

export interface EffectiveCheck {
  id: string;
  stage: string;
  text: string;
  value: CheckValue;
  mode: CheckMode;
  postApproval: boolean;
}

export function isPostApprovalCheck(id: string): boolean {
  return id.startsWith("9.");
}

export interface AutoCheckContext {
  sub: SubmissionInput;
  assessment: Assessment;
  flags: readonly DataFlag[];
  /** Another submission has the same CAC number (check 1.5). */
  duplicateCac: boolean;
  /** Unresolved data flags have a written explanation (check 7.6 "resolved or explained"). */
  flagsExplained: boolean;
  ctx: DomainContext;
}

type Rule = { mode: "auto"; value: CheckValue } | { mode: "na-unless"; applies: boolean };

/** §6: rule for each automatic check; checks with no rule are manual. */
function autoRules(c: AutoCheckContext): Record<string, Rule> {
  const { sub, assessment: a } = c;
  const auto = (value: CheckValue): Rule => ({ mode: "auto", value });
  const naUnless = (applies: boolean): Rule => ({ mode: "na-unless", applies });
  const yn = (ok: boolean): CheckValue => (ok ? "Y" : "N");

  const unlicensed = sub.licenceStatus === LICENCE.UNLICENSED;
  const multiState = a.primaryCode === "MSL" || sub.licenceStatus === LICENCE.MULTI_STATE;
  const lateCheck: CheckValue = a.daysLate === 0 ? "N/A" : yn(a.fees.lateCharge > 0);
  const docsComplete = a.documents.documentsComplete;

  return {
    "1.1": auto(yn(!!sub.ackNo)),
    "1.3": auto(yn(!!a.primaryCode)),
    "1.4": auto(yn(!(a.primaryCode === "CPT" && (sub.installedCapacityMw ?? 0) < 1))),
    "1.5": auto(yn(!c.duplicateCac)),
    "1.7": naUnless(multiState),
    "1.8": auto(yn(a.daysLate === 0)),
    "1.9": auto(lateCheck),
    // New (§6): no licence, so nothing to list or confirm.
    "2.4": naUnless(!unlicensed),
    "3.0": auto(yn(docsComplete)),
    "3.1": naUnless(!docsComplete),
    "3.2": naUnless(!!sub.registrantType && sub.registrantType !== "Company"),
    "4.2": naUnless(!unlicensed),
    "4.3": auto(
      sub.licenceExpiry
        ? yn(
            !licenceNeedsRenewal(
              sub.licenceExpiry,
              a.effectiveDate,
              c.ctx.settings.licenceExpiryWindowDays,
            ),
          )
        : "N/A",
    ),
    "4.9": naUnless(unlicensed),
    "5.3": naUnless(sub.approvedWaiver > 0),
    "5.4": auto(lateCheck),
    "5.5": auto(yn(a.fees.balance <= 0)),
    "7.1": naUnless(unlicensed),
    "7.3": naUnless(multiState),
    "7.5": auto("N/A"),
    "7.6": auto(yn(c.flags.length === 0 || c.flagsExplained)),
    "9.1": auto(sub.certificateIssueDate && sub.status === STATUS.REGISTERED ? "Y" : null),
    "9.2": auto(sub.registrationNo ? "Y" : null),
  };
}

/**
 * Checks that are always computed (§6 "auto"); nothing entered for them is ever used. The other
 * checks are entered by hand, some becoming N/A automatically when their condition does not apply.
 */
export const AUTOMATIC_CHECK_IDS: readonly string[] = [
  "1.1",
  "1.3",
  "1.4",
  "1.5",
  "1.8",
  "1.9",
  "3.0",
  "4.3",
  "5.4",
  "5.5",
  "7.5",
  "7.6",
  "9.1",
  "9.2",
];

/** Merge manual entries with §6 automatic values. */
export function effectiveChecks(
  defs: readonly EvaluationCheckDef[],
  manual: Record<string, CheckValue>,
  c: AutoCheckContext,
): EffectiveCheck[] {
  const rules = autoRules(c);
  return defs.map((d) => {
    const rule = rules[d.id];
    const base = {
      id: d.id,
      stage: d.stage,
      text: d.text,
      postApproval: isPostApprovalCheck(d.id),
    };
    if (rule?.mode === "auto") return { ...base, value: rule.value, mode: "auto" };
    if (rule?.mode === "na-unless" && !rule.applies)
      return { ...base, value: "N/A", mode: "auto-na" };
    return { ...base, value: manual[d.id] ?? null, mode: "manual" };
  });
}

export interface CheckCounts {
  total: number;
  satisfied: number;
  failed: number;
  na: number;
  pending: number;
}

/** Counts over the decision checks (stages 1–7) only. */
export function countDecisionChecks(checks: readonly EffectiveCheck[]): CheckCounts {
  const decision = checks.filter((c) => !c.postApproval);
  const count = (v: CheckValue) => decision.filter((c) => c.value === v).length;
  return {
    total: decision.length,
    satisfied: count("Y"),
    failed: count("N"),
    na: count("N/A"),
    pending: count(null),
  };
}

/** §4.11 */
export function evaluationProgress(counts: CheckCounts): number {
  return counts.total === 0 ? 0 : (counts.satisfied + counts.failed + counts.na) / counts.total;
}

/** §4.11: all post-approval checks are Y or N/A. */
export function fileClosed(checks: readonly EffectiveCheck[]): boolean {
  return checks.filter((c) => c.postApproval).every((c) => c.value === "Y" || c.value === "N/A");
}

export type EvaluationStatus = "Decided" | "Not assigned" | "In progress" | "Ready for decision";

/** §4.11 */
export function evaluationStatus(ev: EvaluationInput, counts: CheckCounts): EvaluationStatus {
  if (ev.finalDecision) return "Decided";
  if (!ev.evaluatingOfficerId) return "Not assigned";
  return counts.pending > 0 ? "In progress" : "Ready for decision";
}

export type RecommendedOutcome = FinalDecision | "Evaluation in progress";

/** §4.11 */
export function recommendedOutcome(
  checks: readonly EffectiveCheck[],
  counts: CheckCounts,
  sub: SubmissionInput,
  a: Assessment,
  ev: EvaluationInput,
  today: IsoDate,
): RecommendedOutcome {
  const value = (id: string) => checks.find((c) => c.id === id)?.value ?? null;
  if (value("1.3") === "N" || value("1.4") === "N") return FINAL_DECISION.REDIRECT;
  if (
    sub.status === STATUS.DEFICIENCY &&
    a.deficiencyResponseDue &&
    today > a.deficiencyResponseDue
  ) {
    return FINAL_DECISION.LAPSE;
  }
  if (a.determinationDue && !ev.finalDecision && today > a.determinationDue)
    return FINAL_DECISION.PROVISIONAL;
  if (counts.failed > 0) return FINAL_DECISION.DEFICIENCY;
  if (counts.pending > 0) return "Evaluation in progress";
  return FINAL_DECISION.REGISTER;
}

/**
 * Whether a check may be changed now. Automatic checks never; decision checks (stages 1–7) only until
 * a final decision is recorded; post-approval checks (9.x) only once the submission is Registered.
 */
export function checkIsEditable(
  check: EffectiveCheck,
  finalDecision: FinalDecision | null,
  status: Status | null,
): boolean {
  if (check.mode !== "manual") return false;
  if (check.postApproval) return status === STATUS.REGISTERED;
  return !finalDecision;
}
