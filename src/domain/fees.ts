import { NO_FEE_TERMS, feeTermsFor, type FeeTerms } from "./pricing";
import type { Policy, ReferenceData } from "./reference";
import type { IsoDate, Kobo, PaymentInput } from "./types";

export type PaymentStatus = "Nil" | "Paid" | "Part-paid" | "Unpaid";

/** Current registration fee for a category (new pricing; existing submissions use their snapshot). */
export function registrationFee(category: string | null, ref: ReferenceData): Kobo {
  return feeTermsFor(category, ref).registrationFee;
}

/** Schedule 3 Part B: initial charge plus a capped daily charge. */
export function lateChargeFor(terms: FeeTerms, daysLate: number): Kobo {
  if (daysLate <= 0) return 0;
  return terms.lateInitial + Math.min(terms.lateDaily * daysLate, terms.lateDailyCap);
}

export function lateCharge(category: string | null, daysLate: number, ref: ReferenceData): Kobo {
  return lateChargeFor(feeTermsFor(category, ref), daysLate);
}

/** A payment that counts: not reversed, and confirmed by Finance (the Finance gate). */
export const countsAsPaid = (p: PaymentInput) =>
  p.status !== "REVERSED" && p.financeStatus === "CONFIRMED";

/** A payment still with Finance: not reversed, neither confirmed nor rejected. */
export const isWithFinance = (p: PaymentInput) =>
  p.status !== "REVERSED" && p.financeStatus === "PENDING";

/**
 * Payments that count, matched on a reference. Reversed, pending and rejected payments stay on
 * record but never count towards amount paid, balance, completeness or collections.
 */
export function paymentsFor(
  reference: string | null,
  payments: readonly PaymentInput[],
): PaymentInput[] {
  if (!reference) return [];
  return payments.filter((p) => p.reference === reference && countsAsPaid(p));
}

/** Payments recorded against a reference that are still waiting for Finance. */
export function pendingPaymentsFor(
  reference: string | null,
  payments: readonly PaymentInput[],
): PaymentInput[] {
  if (!reference) return [];
  return payments.filter((p) => p.reference === reference && isWithFinance(p));
}

export interface FeeSummary {
  fee: Kobo;
  lateCharge: Kobo;
  /** fee − waiver, floored at 0: the amount §2.7 compares against. */
  netFee: Kobo;
  totalDue: Kobo;
  amountPaid: Kobo;
  lastPaymentDate: IsoDate | null;
  balance: Kobo;
  paymentStatus: PaymentStatus;
}

export interface FeeInput {
  /** The submission's pricing snapshot (or current terms for an unsaved one); null = no category. */
  terms: FeeTerms | null;
  daysLate: number;
  approvedWaiver: Kobo;
  /** Ack No. (or OUN No.) the payments are matched on. */
  reference: string | null;
}

/** §2.5 */
export function feeSummary(
  input: FeeInput,
  payments: readonly PaymentInput[],
  policy: Policy,
): FeeSummary {
  const terms = input.terms ?? NO_FEE_TERMS;
  const fee = terms.registrationFee;
  const late = lateChargeFor(terms, input.daysLate);
  const netFee = Math.max(0, fee - input.approvedWaiver);
  const totalDue = policy.waiverAppliesToLateCharge
    ? Math.max(0, fee + late - input.approvedWaiver)
    : netFee + late;
  const matched = paymentsFor(input.reference, payments);
  const amountPaid = matched.reduce((sum, p) => sum + p.amount, 0);
  const lastPaymentDate =
    amountPaid > 0 ? matched.map((p) => p.dateReceived).reduce((a, b) => (b > a ? b : a)) : null;
  const balance = totalDue - amountPaid;
  const paymentStatus: PaymentStatus =
    totalDue === 0 ? "Nil" : balance <= 0 ? "Paid" : amountPaid > 0 ? "Part-paid" : "Unpaid";
  return {
    fee,
    lateCharge: late,
    netFee,
    totalDue,
    amountPaid,
    lastPaymentDate,
    balance,
    paymentStatus,
  };
}
