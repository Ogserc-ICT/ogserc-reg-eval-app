import { existingOperatorDeadline } from "./deadlines";
import { paymentsFor, type PaymentStatus } from "./fees";
import { formatNaira } from "./money";
import type { DataFlag } from "./flags";
import { findFeeRow, type ReferenceData, type Settings } from "./reference";
import type { IsoDate, Kobo, PaymentInput } from "./types";

/** Para 3(3)(c): own-use generation of 1 MW or more registers as captive generation. */
export const OWN_USE_MAX_KW = 1000;
export const OWN_USE_CATEGORY = "I";

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
  lga: string | null;
  installedCapacityKw: number | null;
  /** Saved snapshot; null for an unsaved notification (priced live). */
  pricing: OwnUsePricing | null;
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
  eligibility: OwnUseEligibility | null;
  /** From the snapshot once saved. */
  feeDue: Kobo;
  amountPaid: Kobo;
  balance: Kobo;
  paymentStatus: PaymentStatus;
  filedLate: boolean;
  pricingCurrent: OwnUsePricing | null;
  pricingChanges: string[];
  flags: DataFlag[];
}

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();

/** §4.3: everything shown for an own-use notification. */
export function assessOwnUse(oun: OwnUseInput, c: OwnUseFlagContext): OwnUseAssessment {
  const kw = oun.installedCapacityKw;
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
      ["installed capacity", oun.installedCapacityKw],
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
  if (oun.cacNo?.trim()) {
    if (c.otherNotifications.some((o) => o.id !== oun.id && norm(o.cacNo) === norm(oun.cacNo))) {
      flags.push({
        code: "DUPLICATE_CAC",
        message: "Duplicate CAC number among own-use notifications",
      });
    }
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

  return {
    eligibility: kw === null ? null : ownUseEligibility(kw, thresholdSettings),
    feeDue,
    amountPaid,
    balance,
    paymentStatus:
      feeDue === 0 ? "Nil" : balance <= 0 ? "Paid" : amountPaid > 0 ? "Part-paid" : "Unpaid",
    filedLate: !!oun.dateFiled && ownUseFiledLate(oun.dateFiled, c.settings),
    pricingCurrent: current,
    pricingChanges,
    flags,
  };
}

/** §4.3 flags for an own-use notification. */
export function ownUseFlags(oun: OwnUseInput, c: OwnUseFlagContext): DataFlag[] {
  return assessOwnUse(oun, c).flags;
}
