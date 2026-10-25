import { overrideNeedsReason } from "./category";
import { yearOf } from "./dates";
import { annualConfirmationDue, licenceNeedsRenewal } from "./deadlines";
import { formCodeFor } from "./forms";
import { capacitiesAgree } from "./technical";
import { findActivity } from "./reference";
import type { Assessment, DomainContext } from "./submission";
import {
  FILING,
  LICENCE,
  STATUS,
  isClosed,
  isLinkedFiling,
  type FilingType,
  type IsoDate,
  type Status,
  type SubmissionInput,
} from "./types";
import { isValidCac, isValidTin } from "./validation";

export interface DataFlag {
  code: string;
  message: string;
}

/** The fields of other Register rows that duplicate and linked-filing checks look at. */
export interface OtherSubmission {
  id: string;
  cacNo: string | null;
  registeredName: string | null;
  registrationNo: string | null;
  filingType: FilingType;
  /** Updates and annual confirmations: the registered submission they belong to. */
  linkedSubmissionId: string | null;
  status: Status | null;
  dateSubmitted: IsoDate | null;
  /** A registration's certificate date (its year decides when annual confirmations fall due). */
  certificateIssueDate: IsoDate | null;
}

/**
 * A registration and the updates and annual confirmations filed against it share a CAC number and
 * name by design, so duplicate checks compare registrations ("families"), not individual records.
 */
const familyOf = (o: { id: string; linkedSubmissionId: string | null }) =>
  o.linkedSubmissionId ?? o.id;

/** §2.12 "Missing required field": fields marked * in §1.1. */
const REQUIRED_FIELDS: { key: keyof SubmissionInput; label: string }[] = [
  { key: "registeredName", label: "registered name" },
  { key: "dateSubmitted", label: "date submitted" },
  { key: "formFiled", label: "form filed" },
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
  STATUS.APPLIED,
];

const LICENCE_NOT_HELD: readonly string[] = [LICENCE.UNLICENSED, LICENCE.PENDING];

/** Filings that never took effect and do not count as filed. */
const NOT_FILED: readonly (Status | null)[] = [STATUS.REFUSED, STATUS.LAPSED, STATUS.CANCELLED];

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "01-31" → "31 January". */
export function annualDueLabel(mmdd: string): string {
  const [m, d] = mmdd.split("-").map(Number);
  return `${d} ${MONTH_NAMES[(m ?? 1) - 1]}`;
}

/**
 * Other submissions indexed by normalised CAC number, name and registration number (values are
 * family ids), so duplicate checks are lookups rather than scans; plus each record by id and the
 * annual confirmations filed against each registration. Build once per list (see `duplicateIndex`).
 */
export interface DuplicateIndex {
  cac: Map<string, string[]>;
  name: Map<string, string[]>;
  registrationNo: Map<string, string[]>;
  byId: Map<string, OtherSubmission>;
  /** Annual confirmations, keyed by the id of the registration they confirm. */
  annual: Map<string, OtherSubmission[]>;
}

export function duplicateIndex(rows: readonly OtherSubmission[]): DuplicateIndex {
  const index: DuplicateIndex = {
    cac: new Map(),
    name: new Map(),
    registrationNo: new Map(),
    byId: new Map(),
    annual: new Map(),
  };
  const put = <T>(map: Map<string, T[]>, key: string, value: T) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const o of rows) {
    const family = familyOf(o);
    put(index.cac, norm(o.cacNo), family);
    put(index.name, norm(o.registeredName), family);
    if (o.registrationNo) put(index.registrationNo, o.registrationNo, family);
    index.byId.set(o.id, o);
    if (o.filingType === FILING.ANNUAL && o.linkedSubmissionId) put(index.annual, family, o);
  }
  return index;
}

/** Another registration (not the family `self`) has this key. */
const takenByOther = (map: Map<string, string[]>, key: string, self: string) =>
  !!key && (map.get(key) ?? []).some((family) => family !== self);

/**
 * A Registered record whose annual confirmation for this year is overdue (para 16(2)): registered
 * before this year, the due date has passed, and no annual confirmation was filed this year (one
 * refused, lapsed or cancelled does not count).
 */
export function annualConfirmationOverdue(
  sub: Pick<SubmissionInput, "id" | "filingType" | "status" | "certificateIssueDate">,
  index: DuplicateIndex,
  ctx: Pick<DomainContext, "settings" | "today">,
): boolean {
  if (sub.filingType !== FILING.NEW || sub.status !== STATUS.REGISTERED) return false;
  if (!sub.certificateIssueDate) return false;
  const year = yearOf(ctx.today);
  if (yearOf(sub.certificateIssueDate) >= year) return false;
  if (!(ctx.today > annualConfirmationDue(year, ctx.settings))) return false;
  const filed = (index.annual.get(sub.id) ?? []).some(
    (o) => !!o.dateSubmitted && yearOf(o.dateSubmitted) === year && !NOT_FILED.includes(o.status),
  );
  return !filed;
}

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
  const self = familyOf(sub);

  if (sub.cacNo?.trim() && takenByOther(index.cac, norm(sub.cacNo), self)) {
    add(
      "DUPLICATE_CAC",
      "Duplicate CAC number on another submission (one registration per person, para 11(4))",
    );
  }
  if (sub.registeredName?.trim() && takenByOther(index.name, norm(sub.registeredName), self)) {
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
  const unknownOther = sub.otherActivities.filter((n) => !findActivity(n, ref));
  if (unknownOther.length) {
    add(
      "UNKNOWN_OTHER_ACTIVITY",
      `Other activity not in the activities list: ${unknownOther.join(", ")}`,
    );
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
  if (a.registrationNoInUse && takenByOther(index.registrationNo, a.registrationNoInUse, self)) {
    add("DUPLICATE_REG_NO", "Duplicate registration number");
  }

  if (
    licenceNeedsRenewal(a.nearestLicenceExpiry, a.effectiveDate, settings.licenceExpiryWindowDays)
  ) {
    add(
      "LICENCE_RENEWAL",
      "Licence expires within 6 months of the Effective Date – renewal (para 8(5))",
    );
  }
  if (a.primaryCode === "CPT" && (sub.installedCapacityMw ?? 0) < 1) {
    add(
      "CPT_BELOW_1MW",
      "Own-use below 1 MW is excluded – use Form REG-01I (own-use notification)",
    );
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

  // New rules (§8.4, §8.5), over the licences table.
  const numbered = sub.licences.some((l) => !!l.number?.trim());
  if (sub.licenceStatus && LICENCE_NOT_HELD.includes(sub.licenceStatus) && numbered) {
    add(
      "LICENCE_NO_WITHOUT_LICENCE",
      `Licence number entered but licence status is "${sub.licenceStatus}"`,
    );
  }
  if (sub.licenceStatus && !LICENCE_NOT_HELD.includes(sub.licenceStatus) && !numbered) {
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

  // Form filed (REG-01A to K) against the category: the confirmed one, else the one charged.
  const charged = a.categoryApplied;
  const target = sub.confirmedCategory ?? charged;
  if (sub.formFiled && a.formCategory && target && a.formCategory !== target) {
    if (!sub.confirmedCategory) {
      add(
        "FORM_CATEGORY_MISMATCH",
        `Form filed (${sub.formFiled}) does not match the calculated category (${target}) – confirm the category`,
      );
    } else if (settings.policy.wrongFormHandling === "REQUIRE_CORRECT_FORM") {
      add(
        "FORM_CATEGORY_MISMATCH",
        `Filed on ${sub.formFiled} but the category is confirmed as ${target} – the applicant must file on ${formCodeFor(target)}`,
      );
    } else if (!sub.categoryConfirmedReason?.trim()) {
      add(
        "FORM_CATEGORY_MISMATCH",
        `Filed on ${sub.formFiled} but confirmed as Category ${target} with no reason recorded`,
      );
    }
  }
  if (sub.confirmedCategory && charged && sub.confirmedCategory !== charged) {
    add(
      "CONFIRMED_CATEGORY_NOT_CHARGED",
      `Category confirmed as ${sub.confirmedCategory} but Category ${charged} is charged – correct the activities or capacity, or override the category, then an admin recalculates`,
    );
  }

  // Category-specific sections (optional at intake; gaps and inconsistencies are flagged).
  const own = a.technical.forms.find((f) => f.form === a.documentsForm);
  if (own?.outstanding.length) {
    add("TECHNICAL_INCOMPLETE", `${own.form} sections not complete: ${own.outstanding.join("; ")}`);
  }
  if (sub.installedCapacityMw !== null) {
    const differ = a.technical.capacities.filter(
      (c) => !capacitiesAgree(c.mw, sub.installedCapacityMw!),
    );
    if (differ.length) {
      add(
        "TECHNICAL_CAPACITY_MISMATCH",
        `Installed capacity is ${sub.installedCapacityMw} MW, but ${differ
          .map((c) => `${c.form} ${c.label} gives ${Number(c.mw.toFixed(3))} MW`)
          .join("; ")}`,
      );
    }
  }

  // Updates and annual confirmations (para 16).
  if (isLinkedFiling(sub.filingType)) {
    const linked = sub.linkedSubmissionId ? index.byId.get(sub.linkedSubmissionId) : undefined;
    if (!sub.linkedSubmissionId) {
      add(
        "LINKED_REGISTRATION",
        "Not linked to a registered submission (quote its registration number)",
      );
    } else if (linked && linked.status !== STATUS.REGISTERED && !isClosed(sub.status)) {
      add(
        "LINKED_REGISTRATION",
        `The linked registration ${linked.registrationNo ?? "(no number)"} is ${linked.status}, not Registered`,
      );
    }
    // An annual confirmation counts for the calendar year it is filed in; it is late when one was
    // due that year (the registration is from an earlier year) and the due date had passed.
    if (
      sub.filingType === FILING.ANNUAL &&
      sub.dateSubmitted &&
      linked?.certificateIssueDate &&
      yearOf(linked.certificateIssueDate) < yearOf(sub.dateSubmitted) &&
      sub.dateSubmitted > annualConfirmationDue(yearOf(sub.dateSubmitted), settings)
    ) {
      add(
        "ANNUAL_LATE",
        `Annual confirmation filed after ${annualDueLabel(settings.annualConfirmationDue)} (para 16(2))`,
      );
    }
  }
  if (annualConfirmationOverdue(sub, index, ctx)) {
    add(
      "ANNUAL_CONFIRMATION_OVERDUE",
      `Annual confirmation for ${yearOf(today)} not filed by ${annualDueLabel(settings.annualConfirmationDue)} (para 16(2))`,
    );
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
