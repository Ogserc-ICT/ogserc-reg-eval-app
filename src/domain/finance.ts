// Finance confirmation gate (docs/SPEC.md §4.12): a submission is acknowledged first and is released
// for evaluation only once payments confirmed by Finance cover what is required.

import { pendingPaymentsFor, type FeeSummary } from "./fees";
import { formatNaira } from "./money";
import type { Policy } from "./reference";
import { STATUS, isClosed, type Kobo, type PaymentInput, type Status } from "./types";

export interface FinanceGate {
  /** What confirmed payments must cover: fee − waiver, or the total due when the policy says so. */
  required: Kobo;
  /** Payments confirmed by Finance (not reversed). */
  confirmed: Kobo;
  /** Payments recorded but still with Finance. */
  pending: Kobo;
  pendingCount: number;
  cleared: boolean;
}

export function financeGate(
  fees: FeeSummary,
  reference: string | null,
  payments: readonly PaymentInput[],
  policy: Policy,
): FinanceGate {
  const required = policy.lateChargeRequiredForRelease ? fees.totalDue : fees.netFee;
  const pending = pendingPaymentsFor(reference, payments);
  return {
    required,
    confirmed: fees.amountPaid,
    pending: pending.reduce((sum, p) => sum + p.amount, 0),
    pendingCount: pending.length,
    cleared: fees.amountPaid >= required,
  };
}

/** Why the gate is closed, e.g. "Payment not yet confirmed by Finance: ₦0 of ₦250,000 confirmed". */
export function gateReason(gate: FinanceGate): string {
  const withFinance = gate.pendingCount
    ? `; ${formatNaira(gate.pending)} recorded and waiting for Finance`
    : "";
  return (
    `Payment not yet confirmed by Finance: ${formatNaira(gate.confirmed)} of ` +
    `${formatNaira(gate.required)} confirmed${withFinance}`
  );
}

export type StageNumber = 1 | 2 | 3 | 4 | 5;

export interface ProcessStage {
  stage: StageNumber;
  label: string;
}

/**
 * Derived process stage: 1 Acknowledged – awaiting payment, 2 Payment with Finance, 3 Payment
 * confirmed (released for evaluation automatically), 4 Evaluation and determination, 5 Closed.
 */
export function processStage(status: Status | null, gate: FinanceGate): ProcessStage {
  if (status && isClosed(status)) return { stage: 5, label: `Closed – ${status}` };
  if (status === STATUS.AWAITING || status === null) {
    if (gate.cleared) return { stage: 3, label: "Payment confirmed" };
    if (gate.pendingCount > 0) return { stage: 2, label: "Payment with Finance" };
    return { stage: 1, label: "Acknowledged – awaiting payment" };
  }
  return { stage: 4, label: "Evaluation and determination" };
}
