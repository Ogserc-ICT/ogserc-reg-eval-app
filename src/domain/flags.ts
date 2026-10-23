import { overrideNeedsReason } from "./category";
import { licenceNeedsRenewal } from "./deadlines";
import { findActivity } from "./reference";
import type { Assessment, DomainContext } from "./submission";
import { LICENCE, STATUS, type Status, type SubmissionInput } from "./types";
import { isValidCac, isValidTin } from "./validation";

export interface DataFlag {
  code: string;
  message: string;
}

/** The fields of other Register rows that duplicate checks look at. */
export interface OtherSubmission {
  id: string;
  cacNo: string | null;
  registeredName: string | null;
  registrationNo: string | null;
}

/** §2.12 "Missing required field": fields marked * in §1.1. */
const REQUIRED_FIELDS: { key: keyof SubmissionInput; label: string }[] = [
  { key: "registeredName", label: "registered name" },
  { key: "dateSubmitted", label: "date submitted" },
  { key: "principalLga", label: "principal LGA" },
  { key: "primaryActivity", label: "primary activity" },
  { key: "licenceStatus", label: "licence status" },
  { key: "operatingOnEffectiveDate", label: "operating on Effective Date" },
  { key: "status", label: "status" },
];

/**
 * Activity codes treated as "generation-related" for the ≥10 MW category check (§2.12 new rule).
 * MGD is excluded because the map puts every mini-grid in Category E. Confirm with the Commission.
 */
export const GENERATION_CODES = ["GEN", "CPT"];

/**
 * Statuses only reachable through release for evaluation (§4.12). Refused and Cancelled are not here:
 * a submission may be refused, or cancelled, while still awaiting payment.
 */
const PAST_ACKNOWLEDGEMENT: readonly Status[] = [
  STATUS.RECEIVED,
  STATUS.DEFICIENCY,
  STATUS.PROVISIONAL,
  STATUS.REGISTERED,
  STATUS.LAPSED,
];

const LICENCE_NOT_HELD: readonly string[] = [LICENCE.UNLICENSED, LICENCE.PENDING];

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Other submissions indexed by normalised CAC number, name and registration number, so duplicate
 * checks are lookups rather than scans. Build once per list (see `duplicateIndex`).
 */
export interface DuplicateIndex {
  cac: Map<string, string[]>;
  name: Map<string, string[]>;
  registrationNo: Map<string, string[]>;
}

export function duplicateIndex(rows: readonly OtherSubmission[]): DuplicateIndex {
  const index: DuplicateIndex = { cac: new Map(), name: new Map(), registrationNo: new Map() };
  const put = (map: Map<string, string[]>, key: string, id: string) => {
    if (!key) return;
    const ids = map.get(key);
    if (ids) ids.push(id);
    else map.set(key, [id]);
  };
  for (const o of rows) {
    put(index.cac, norm(o.cacNo), o.id);
    put(index.name, norm(o.registeredName), o.id);
    if (o.registrationNo) put(index.registrationNo, o.registrationNo, o.id);
  }
  return index;
}

/** Another submission (not `selfId`) has this key. */
const takenByOther = (map: Map<string, string[]>, key: string, selfId: string) =>
  !!key && (map.get(key) ?? []).some((id) => id !== selfId);

/** §2.12 data flags. */
export function dataFlags(
  sub: SubmissionInput,
  a: Assessment,
  others: readonly OtherSubmission[] | DuplicateIndex,
  ctx: DomainContext,
): DataFlag[] {
  const { ref, settings, today } = ctx;
  const flags: DataFlag[] = [];
  const add = (code: string, message: string) => flags.push({ code, message });
  const index = Array.isArray(others) ? duplicateIndex(others) : (others as DuplicateIndex);

  if (sub.cacNo?.trim() && takenByOther(index.cac, norm(sub.cacNo), sub.id)) {
    add(
      "DUPLICATE_CAC",
      "Duplicate CAC number on another submission (one registration per person, para 11(4))",
    );
  }
  if (sub.registeredName?.trim() && takenByOther(index.name, norm(sub.registeredName), sub.id)) {
    add("DUPLICATE_NAME", "Duplicate registered name");
  }

  const missing = REQUIRED_FIELDS.filter(({ key }) => {
    const v = sub[key];
    return v === null || (typeof v === "string" && v.trim() === "");
  });
  if (missing.length) {
    add("MISSING_REQUIRED", `Missing required field: ${missing.map((m) => m.label).join(", ")}`);
  }

  if (sub.primaryActivity && !findActivity(sub.primaryActivity, ref)) {
    add("UNKNOWN_ACTIVITY", "Primary activity not in the activities list");
  }
  if (sub.secondaryActivity && !findActivity(sub.secondaryActivity, ref)) {
    add("UNKNOWN_SECONDARY_ACTIVITY", "Secondary activity not in the activities list");
  }

  const primary = findActivity(sub.primaryActivity, ref);
  if (primary?.capacityBased && sub.installedCapacityMw === null) {
    add("NO_CAPACITY", `Capacity-based activity (${primary.code}) with no installed capacity`);
  }

  if (overrideNeedsReason(sub.categoryOverride, a.categoryAuto, sub.overrideReason)) {
    add("OVERRIDE_NO_REASON", "Category overridden with no reason");
  }

  if (sub.certificateIssueDate && !a.submissionComplete) {
    add("CERT_NOT_COMPLETE", "Certificate dated but submission not complete");
  }
  if (
    sub.certificateIssueDate &&
    sub.status !== STATUS.REGISTERED &&
    sub.status !== STATUS.CANCELLED
  ) {
    add("CERT_STATUS", "Certificate dated but status not Registered/Cancelled");
  }
  if (sub.status === STATUS.REGISTERED && !sub.certificateIssueDate) {
    add("REGISTERED_NO_CERT_DATE", "Registered without certificate date");
  }
  if (a.registrationNoInUse && takenByOther(index.registrationNo, a.registrationNoInUse, sub.id)) {
    add("DUPLICATE_REG_NO", "Duplicate registration number");
  }

  if (licenceNeedsRenewal(sub.licenceExpiry, a.effectiveDate, settings.licenceExpiryWindowDays)) {
    add(
      "LICENCE_RENEWAL",
      "Licence expires within 6 months of the Effective Date – renewal (para 8(5))",
    );
  }
  if (a.primaryCode === "CPT" && (sub.installedCapacityMw ?? 0) < 1) {
    add("CPT_BELOW_1MW", "Own-use below 1 MW is excluded – use Own-Use Notifications");
  }
  if (a.primaryCode === "MSL" && sub.licenceStatus !== LICENCE.MULTI_STATE) {
    add("MSL_LICENCE", "Check licence status for multi-State licensee");
  }
  if (sub.operatingOnEffectiveDate === "N" && !sub.plannedStartDate) {
    add("NO_START_DATE", "Not operating on Effective Date and no planned start date");
  }
  if (sub.dateSubmitted && sub.dateSubmitted > today) {
    add("FUTURE_SUBMISSION", "Date submitted is in the future");
  }
  if (a.licenceApplicationDue && today > a.licenceApplicationDue) {
    add("LICENCE_APPLICATION_OVERDUE", "Unlicensed and licence application overdue (para 18(2))");
  }

  // New rules (§8.4, §8.5).
  if (sub.licenceStatus && LICENCE_NOT_HELD.includes(sub.licenceStatus) && sub.licenceNo?.trim()) {
    add(
      "LICENCE_NO_WITHOUT_LICENCE",
      `Licence number entered but licence status is "${sub.licenceStatus}"`,
    );
  }
  if (
    sub.licenceStatus &&
    !LICENCE_NOT_HELD.includes(sub.licenceStatus) &&
    !sub.licenceNo?.trim()
  ) {
    add("LICENCE_NO_MISSING", "Licence held but no licence number entered");
  }
  if (
    a.primaryCode &&
    GENERATION_CODES.includes(a.primaryCode) &&
    (sub.installedCapacityMw ?? 0) >= 10 &&
    !["A", "B", "C"].includes(a.categoryApplied ?? "")
  ) {
    add(
      "GENERATION_CATEGORY",
      "Generation of 10 MW or more but the applied category is not C (or A/B)",
    );
  }
  if (sub.cacNo?.trim() && !isValidCac(sub.cacNo)) {
    add("CAC_FORMAT", "CAC number format is invalid (expected RC, BN or IT followed by digits)");
  }
  if (sub.tin?.trim() && !isValidTin(sub.tin, settings.policy.tinPattern)) {
    add("TIN_FORMAT", "TIN format is invalid");
  }

  // Finance confirmation gate (§4.12).
  if (
    sub.dateEvaluationStarted &&
    (!sub.releasedForEvaluationDate || sub.dateEvaluationStarted < sub.releasedForEvaluationDate)
  ) {
    add("EVALUATION_BEFORE_PAYMENT", "Evaluation started before Finance confirmed payment");
  }
  if (sub.status && PAST_ACKNOWLEDGEMENT.includes(sub.status) && !sub.releasedForEvaluationDate) {
    add(
      "STATUS_WITHOUT_CONFIRMATION",
      "Status moved past acknowledgement without Finance confirmation",
    );
  }

  // Snapshot pricing: the saved pricing no longer matches the submission's data or current rules.
  if (a.pricingChanges.length) {
    add(
      "PRICING_OUT_OF_DATE",
      `Saved pricing differs from current rules (${a.pricingChanges.join("; ")}) – an admin may recalculate`,
    );
  }

  return flags;
}
