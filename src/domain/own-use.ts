import { certificateDateParts } from "./dates";
import { existingOperatorDeadline } from "./deadlines";
import {
  effectiveDocuments,
  paymentEvidenceValue,
  summariseDocuments,
  type DocumentSummary,
} from "./documents";
import { paymentsFor, type PaymentStatus } from "./fees";
import { NO_CONDITIONS, OWN_USE_FORM, findForm } from "./forms";
import { formatNaira } from "./money";
import type { DataFlag } from "./flags";
import { certificateSerial, formatRegistrationNo } from "./numbers";
import { findFeeRow, type ReferenceData, type Settings } from "./reference";
import type { CheckValue, IsoDate, Kobo, PaymentInput } from "./types";
import { separationOfDutiesViolations, signatoriesMissing } from "./workflow";

/** Para 3(3)(c): own-use generation of 1 MW or more registers as captive generation. */
export const OWN_USE_MAX_KW = 1000;
export const OWN_USE_CATEGORY = "I";
/** Activity code in an own-use registration number (REG-01I covers captive generation, CPT). */
export const OWN_USE_ACTIVITY_CODE = "CPT";

/** A generator at the site (REG-01I Section C). */
export interface OwnUseUnitInput {
  makeModel: string | null;
  capacityKw: number;
  fuel: string | null;
  avgMonthlyMwh: number | null;
}

/** Installed capacity of the site: the sum of its units; null when no unit is recorded. */
export function totalCapacityKw(units: readonly OwnUseUnitInput[]): number | null {
  if (!units.length) return null;
  // Sum in thousandths of a kW (the column's precision), so 0.1 + 0.2 stays 0.3.
  return units.reduce((sum, u) => sum + Math.round(u.capacityKw * 1000), 0) / 1000;
}

export type OwnUseEligibility = "Not required" | "Notification required" | "Register as operator";

export function ownUseEligibility(capacityKw: number, settings: Settings): OwnUseEligibility {
  if (capacityKw >= OWN_USE_MAX_KW) return "Register as operator";
  if (capacityKw < settings.ownUseThresholdKw) return "Not required";
  return "Notification required";
}

export type OwnUseCapacityCheck =
  | { outcome: "ok" }
  | { outcome: "confirm"; message: string }
  | { outcome: "reject"; message: string };

/** §4.3 save rules for the installed capacity. */
export function checkOwnUseCapacity(capacityKw: number, settings: Settings): OwnUseCapacityCheck {
  switch (ownUseEligibility(capacityKw, settings)) {
    case "Register as operator":
      return { outcome: "reject", message: "Register as captive generation (para 3(3)(c))" };
    case "Not required":
      return {
        outcome: "confirm",
        message: `Below ${settings.ownUseThresholdKw} kW: does not need to notify (para 3(4))`,
      };
    default:
      return { outcome: "ok" };
  }
}

export function ownUseFeeDue(capacityKw: number, ref: ReferenceData, settings: Settings): Kobo {
  if (ownUseEligibility(capacityKw, settings) !== "Notification required") return 0;
  return findFeeRow(OWN_USE_CATEGORY, ref)?.registrationFee ?? 0;
}

/** "Filed after deadline?": filed after the existing-operator registration deadline. */
export function ownUseFiledLate(dateFiled: IsoDate, settings: Settings): boolean {
  return dateFiled > existingOperatorDeadline(settings);
}

/** Fee and threshold frozen on the notification when saved (docs/DECISIONS.md). */
export interface OwnUsePricing {
  fee: Kobo;
  thresholdKw: number;
}

/** Price a notification under the current fee table and threshold. */
export function priceOwnUse(
  capacityKw: number,
  ref: ReferenceData,
  settings: Settings,
): OwnUsePricing {
  return { fee: ownUseFeeDue(capacityKw, ref, settings), thresholdKw: settings.ownUseThresholdKw };
}

export interface OwnUseInput {
  id: string;
  ounNo: string | null;
  name: string | null;
  dateFiled: IsoDate | null;
  cacNo: string | null;
  siteAddress: string | null;
  lga: string | null;
  units: OwnUseUnitInput[];
  /** Stored checklist values by document key (REG-01I list). */
  documents: Record<string, CheckValue>;
  /** Saved snapshot; null for an unsaved notification (priced live). */
  pricing: OwnUsePricing | null;
  /** Set when registered with a certificate (only when the "own-use certificate" setting is on). */
  registrationNo: string | null;
  certificateIssueDate: IsoDate | null;
}

export interface OwnUseFlagContext {
  otherNotifications: readonly OwnUseInput[];
  /** CAC numbers on the Register (submissions). */
  registerCacNos: readonly (string | null)[];
  payments: readonly PaymentInput[];
  ref: ReferenceData;
  settings: Settings;
}

export interface OwnUseAssessment {
  /** Sum of the generator units. */
  installedCapacityKw: number | null;
  eligibility: OwnUseEligibility | null;
  /** From the snapshot once saved. */
  feeDue: Kobo;
  amountPaid: Kobo;
  balance: Kobo;
  paymentStatus: PaymentStatus;
  filedLate: boolean;
  pricingCurrent: OwnUsePricing | null;
  pricingChanges: string[];
  /** REG-01I Schedule 2 list. */
  documents: DocumentSummary;
  flags: DataFlag[];
}

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** One notification per site: the same CAC number at the same site address. */
export function sameSite(
  a: Pick<OwnUseInput, "cacNo" | "siteAddress">,
  b: Pick<OwnUseInput, "cacNo" | "siteAddress">,
): boolean {
  return (
    !!norm(a.cacNo) &&
    !!norm(a.siteAddress) &&
    norm(a.cacNo) === norm(b.cacNo) &&
    norm(a.siteAddress) === norm(b.siteAddress)
  );
}

/** §4.3: everything shown for an own-use notification. */
export function assessOwnUse(oun: OwnUseInput, c: OwnUseFlagContext): OwnUseAssessment {
  const kw = totalCapacityKw(oun.units);
  const current = kw === null ? null : priceOwnUse(kw, c.ref, c.settings);
  const pricing = oun.pricing ?? current;
  const thresholdSettings = pricing
    ? { ...c.settings, ownUseThresholdKw: pricing.thresholdKw }
    : c.settings;
  const feeDue = pricing?.fee ?? 0;
  const amountPaid = paymentsFor(oun.ounNo, c.payments).reduce((sum, p) => sum + p.amount, 0);
  const balance = feeDue - amountPaid;

  const pricingChanges: string[] = [];
  if (oun.pricing && current) {
    if (oun.pricing.fee !== current.fee) {
      pricingChanges.push(`fee ${formatNaira(oun.pricing.fee)} → ${formatNaira(current.fee)}`);
    }
    if (oun.pricing.thresholdKw !== current.thresholdKw) {
      pricingChanges.push(`threshold ${oun.pricing.thresholdKw} kW → ${current.thresholdKw} kW`);
    }
  }

  const flags: DataFlag[] = [];
  const missing = (
    [
      ["name", oun.name],
      ["date filed", oun.dateFiled],
      ["LGA", oun.lga],
      ["generator units", kw],
    ] as const
  )
    .filter(([, v]) => v === null || v === "")
    .map(([label]) => label);
  if (missing.length) {
    flags.push({
      code: "MISSING_REQUIRED",
      message: `Missing required field: ${missing.join(", ")}`,
    });
  }
  // One notification per site; the same registrant may notify several sites.
  if (c.otherNotifications.some((o) => o.id !== oun.id && sameSite(o, oun))) {
    flags.push({
      code: "DUPLICATE_SITE",
      message: "Another own-use notification has the same CAC number and site address",
    });
  }
  if (oun.cacNo?.trim()) {
    if (c.registerCacNos.some((cac) => norm(cac) === norm(oun.cacNo))) {
      flags.push({ code: "CAC_ON_REGISTER", message: "CAC number is also on the Register" });
    }
  }
  if (amountPaid < feeDue) flags.push({ code: "FEE_UNPAID", message: "Fee not fully paid" });
  if (pricingChanges.length) {
    flags.push({
      code: "PRICING_OUT_OF_DATE",
      message: `Saved pricing differs from current rules (${pricingChanges.join("; ")}) – an admin may recalculate`,
    });
  }

  const form = findForm(OWN_USE_FORM, c.ref.forms);
  const documents = summariseDocuments(
    effectiveDocuments(
      (form?.documents ?? []).map((d) => ({ ...d, form: OWN_USE_FORM })),
      oun.documents,
      NO_CONDITIONS,
      paymentEvidenceValue({ netFee: feeDue, amountPaid }),
    ),
  );

  return {
    installedCapacityKw: kw,
    eligibility: kw === null ? null : ownUseEligibility(kw, thresholdSettings),
    feeDue,
    amountPaid,
    balance,
    paymentStatus:
      feeDue === 0 ? "Nil" : balance <= 0 ? "Paid" : amountPaid > 0 ? "Part-paid" : "Unpaid",
    filedLate: !!oun.dateFiled && ownUseFiledLate(oun.dateFiled, c.settings),
    pricingCurrent: current,
    pricingChanges,
    documents,
    flags,
  };
}

// --- Registration with a certificate (setting "own-use certificate", default off) ---------------

export interface OwnUseRegistrationInput {
  oun: OwnUseInput;
  assessment: OwnUseAssessment;
  settings: Settings;
  createdById: string;
  actorId: string;
  /** Approver's written reason for registering despite flags (when flags do not block outright). */
  flagOverrideReason: string | null;
}

/** Every reason an own-use notification cannot be registered now. */
export function ownUseRegistrationBlockers(input: OwnUseRegistrationInput): string[] {
  const { oun, assessment: a, settings } = input;
  const reasons: string[] = [];
  if (!settings.policy.ownUseCertificate) {
    reasons.push("Own-use certificates are switched off in Settings");
  }
  if (oun.registrationNo) reasons.push(`Already registered as ${oun.registrationNo}`);
  if (a.eligibility !== "Notification required") {
    reasons.push(
      `Capacity ${a.installedCapacityKw ?? 0} kW: ${a.eligibility ?? "no generator units recorded"}`,
    );
  }
  if (a.amountPaid < a.feeDue) {
    reasons.push(
      `Fee not confirmed by Finance: ${formatNaira(a.amountPaid)} of ${formatNaira(a.feeDue)}`,
    );
  }
  if (!a.documents.documentsComplete) {
    reasons.push(`Documents outstanding: ${a.documents.outstandingList.join("; ")}`);
  }
  // The unpaid fee is already a reason above.
  const flags = a.flags.filter((f) => f.code !== "FEE_UNPAID");
  if (flags.length) {
    const list = flags.map((f) => f.message).join("; ");
    if (settings.policy.flagsBlockApproval) {
      reasons.push(`${flags.length} unresolved data flag(s): ${list}`);
    } else if (!input.flagOverrideReason?.trim()) {
      reasons.push(
        `${flags.length} unresolved data flag(s) with no written override reason: ${list}`,
      );
    }
  }
  reasons.push(
    ...separationOfDutiesViolations({
      evaluatingOfficerId: null,
      reviewingSupervisorId: null,
      approvingOfficerId: input.actorId,
      createdById: input.createdById,
    }),
  );
  if (signatoriesMissing(settings)) {
    reasons.push("Certificate signatory names are not set in Settings");
  }
  return reasons;
}

/** Registration number for an own-use notification: OGSERC/REG/{yyyy}/I-CPT/{serial}. */
export function ownUseRegistrationNo(settings: Settings, today: IsoDate, serial: number): string {
  return formatRegistrationNo(
    settings.registrationPrefix,
    today,
    OWN_USE_CATEGORY,
    OWN_USE_ACTIVITY_CODE,
    serial,
  );
}

/** CERT-01 fields for a registered own-use notification (TEMPLATES.md §3, own-use). */
export function ownUseCertificateFields(
  oun: OwnUseInput,
  a: OwnUseAssessment,
  ref: ReferenceData,
  settings: Settings,
) {
  const regNo = oun.registrationNo!;
  const date = certificateDateParts(oun.certificateIssueDate!);
  const description = findFeeRow(OWN_USE_CATEGORY, ref)?.description ?? "";
  return {
    SERIAL: certificateSerial(regNo),
    REG_NO: regNo,
    NAME: (oun.name ?? "").toUpperCase(),
    CAC: oun.cacNo?.trim() || "N/A",
    ADDRESS: oun.siteAddress?.trim() || "—",
    CATEGORY: `${OWN_USE_CATEGORY} — ${description}`.trim(),
    ACTIVITY: `Own-use generation, ${a.installedCapacityKw ?? 0} kW (para 3(4))`,
    OTHER: "None",
    AREA: oun.lga ?? "—",
    LICENCE: "Not applicable (own-use notification)",
    DAY: date.day,
    MONTH: date.month,
    YEAR: date.year,
    CHAIR_NAME: settings.chairmanName.trim(),
    COMM_NAME: settings.commissionerName.trim(),
  };
}

/** §4.3 flags for an own-use notification. */
export function ownUseFlags(oun: OwnUseInput, c: OwnUseFlagContext): DataFlag[] {
  return assessOwnUse(oun, c).flags;
}
