// SPEC §4.12 Finance confirmation gate.
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { evaluate } from "./helpers";
import { processStage } from "../finance";
import { dataFlags } from "../flags";
import { nextAction } from "../next-action";
import { assessOwnUse } from "../own-use";
import { assessSubmission } from "../submission";
import { STATUS, type PaymentInput } from "../types";
import { approvalBlockers, dailyReview } from "../workflow";
import {
  ED,
  allDocs,
  ctx,
  makeSubmission,
  naira,
  payment,
  readySettings,
  ref,
  settings,
} from "./helpers";

const ACK = "OGSERC/ACK/2026/00001";
/** Acknowledged, MGD 2.5 MW (Category E, ₦250,000), all documents in, not yet released. */
const awaiting = (overrides = {}) =>
  makeSubmission({
    status: STATUS.AWAITING,
    releasedForEvaluationDate: null,
    documents: allDocs("Y"),
    ...overrides,
  });

describe("only payments confirmed by Finance count", () => {
  it("pending, rejected and reversed payments do not count towards paid, balance or completeness", () => {
    const pays: PaymentInput[] = [
      payment(ACK, 250_000, ED, "PENDING"),
      payment(ACK, 250_000, ED, "REJECTED"),
      { ...payment(ACK, 250_000, ED, "CONFIRMED"), status: "REVERSED" },
    ];
    const a = assessSubmission(awaiting(), pays, ctx());
    expect(a.fees).toMatchObject({
      amountPaid: 0,
      balance: naira(250_000),
      paymentStatus: "Unpaid",
    });
    expect(a.submissionComplete).toBe(false);
    expect(a.financeGate).toMatchObject({
      confirmed: 0,
      pending: naira(250_000),
      pendingCount: 1,
      cleared: false,
    });

    const confirmed = assessSubmission(awaiting(), [payment(ACK, 250_000)], ctx());
    expect(confirmed.fees.amountPaid).toBe(naira(250_000));
    expect(confirmed.submissionComplete).toBe(true);
  });

  it("applies to own-use notifications too", () => {
    const oun = {
      id: "o1",
      ounNo: "OGSERC/OUN/2026/0001",
      name: "Factory",
      dateFiled: ED,
      cacNo: null,
      lga: "Ifo",
      installedCapacityKw: 650,
      pricing: null,
    };
    const flagCtx = (payments: PaymentInput[]) => ({
      otherNotifications: [],
      registerCacNos: [],
      payments,
      ref,
      settings,
    });
    expect(assessOwnUse(oun, flagCtx([payment(oun.ounNo, 100_000, ED, "PENDING")]))).toMatchObject({
      amountPaid: 0,
      paymentStatus: "Unpaid",
    });
    expect(assessOwnUse(oun, flagCtx([payment(oun.ounNo, 100_000)]))).toMatchObject({
      amountPaid: naira(100_000),
      paymentStatus: "Paid",
    });
  });
});

describe("the gate", () => {
  it("requires fee − waiver by default, so an unpaid late charge does not hold it", () => {
    // 10 days late: fee ₦250,000 + late charge; waiver ₦50,000.
    const late = awaiting({ dateSubmitted: addDays(ED, 70), approvedWaiver: naira(50_000) });
    const a = assessSubmission(late, [payment(ACK, 200_000)], ctx(addDays(ED, 70)));
    expect(a.fees.lateCharge).toBeGreaterThan(0);
    expect(a.financeGate).toMatchObject({ required: naira(200_000), cleared: true });
  });

  it("requires the total due when “late charge required to release” is on", () => {
    const strict = {
      ...settings,
      policy: { ...settings.policy, lateChargeRequiredForRelease: true },
    };
    const late = awaiting({ dateSubmitted: addDays(ED, 70) });
    const a = assessSubmission(late, [payment(ACK, 250_000)], ctx(addDays(ED, 70), strict));
    expect(a.financeGate.required).toBe(a.fees.totalDue);
    expect(a.financeGate.cleared).toBe(false);
  });

  it("derives the process stage", () => {
    const stage = (status: (typeof STATUS)[keyof typeof STATUS], pays: PaymentInput[]) =>
      processStage(status, assessSubmission(awaiting({ status }), pays, ctx()).financeGate);
    expect(stage(STATUS.AWAITING, [])).toEqual({
      stage: 1,
      label: "Acknowledged – awaiting payment",
    });
    expect(stage(STATUS.AWAITING, [payment(ACK, 250_000, ED, "PENDING")])).toEqual({
      stage: 2,
      label: "Payment with Finance",
    });
    expect(stage(STATUS.AWAITING, [payment(ACK, 250_000)])).toEqual({
      stage: 3,
      label: "Payment confirmed",
    });
    expect(stage(STATUS.RECEIVED, [payment(ACK, 250_000)])).toEqual({
      stage: 4,
      label: "Evaluation and determination",
    });
    expect(stage(STATUS.REFUSED, [])).toEqual({ stage: 5, label: "Closed – Refused" });
  });

  it("has no SLA while awaiting payment, and a payment next action", () => {
    const today = addDays(ED, 45);
    const a = assessSubmission(awaiting(), [], ctx(today));
    expect(a.daysInQueue).toBe(45);
    expect(a.sla).toBeNull();
    expect(nextAction(awaiting(), a, today)).toBe(
      "Await payment of ₦250,000, then Finance confirmation",
    );
    const pending = assessSubmission(awaiting(), [payment(ACK, 250_000, ED, "PENDING")], ctx());
    expect(nextAction(awaiting(), pending, ED)).toBe(
      "Payment with Finance – awaiting confirmation",
    );
  });

  it("is an approval blocker with the amounts", () => {
    const { approval } = evaluate({
      sub: makeSubmission({ documents: allDocs("Y"), dateSubmissionComplete: ED }),
      payments: [payment(ACK, 250_000, ED, "PENDING")],
      settings: readySettings,
    });
    expect(approvalBlockers(approval)).toContain(
      "Payment not yet confirmed by Finance: ₦0 of ₦250,000 confirmed; ₦250,000 recorded and waiting for Finance",
    );
  });
});

describe("data flags (§2.12, §4.12)", () => {
  const codes = (sub: ReturnType<typeof makeSubmission>) =>
    dataFlags(sub, assessSubmission(sub, [], ctx()), [], ctx()).map((f) => f.code);

  it("flags evaluation started before Finance confirmed payment", () => {
    expect(codes(awaiting({ dateEvaluationStarted: ED }))).toContain("EVALUATION_BEFORE_PAYMENT");
    expect(
      codes(
        makeSubmission({ releasedForEvaluationDate: addDays(ED, 5), dateEvaluationStarted: ED }),
      ),
    ).toContain("EVALUATION_BEFORE_PAYMENT");
    expect(
      codes(makeSubmission({ releasedForEvaluationDate: ED, dateEvaluationStarted: ED })),
    ).not.toContain("EVALUATION_BEFORE_PAYMENT");
  });

  it("flags a status past acknowledgement without Finance confirmation", () => {
    expect(codes(makeSubmission({ releasedForEvaluationDate: null }))).toContain(
      "STATUS_WITHOUT_CONFIRMATION",
    );
    expect(
      codes(makeSubmission({ status: STATUS.REGISTERED, releasedForEvaluationDate: null })),
    ).toContain("STATUS_WITHOUT_CONFIRMATION");
    // Refusal (and cancellation) may happen before release; acknowledged ones are fine.
    expect(
      codes(makeSubmission({ status: STATUS.REFUSED, releasedForEvaluationDate: null })),
    ).not.toContain("STATUS_WITHOUT_CONFIRMATION");
    expect(codes(awaiting())).not.toContain("STATUS_WITHOUT_CONFIRMATION");
    expect(codes(makeSubmission())).not.toContain("STATUS_WITHOUT_CONFIRMATION");
  });
});

describe("daily review (§4.10, §4.12)", () => {
  const item = (sub: ReturnType<typeof makeSubmission>, pays: PaymentInput[], today: string) => ({
    sub,
    assessment: assessSubmission(sub, pays, ctx(today)),
  });

  it("releases acknowledged submissions whose confirmed payments clear the gate", () => {
    const today = addDays(ED, 10);
    const r = dailyReview(
      [
        item(awaiting({ id: "paid" }), [payment(ACK, 250_000)], today),
        item(awaiting({ id: "unpaid", ackNo: "U" }), [], today),
      ],
      today,
    );
    expect(r.toRelease).toEqual(["paid"]);
    expect(r.reminderDue).toEqual([]);
    expect(r.summary).toMatch(/; released for evaluation: 1$/);
  });

  it("counts unpaid acknowledgements past the reminder setting, only when it is set", () => {
    const today = addDays(ED, 31);
    const items = [item(awaiting({ id: "old", ackNo: "O" }), [], today)];
    const r = dailyReview(items, today, { unpaidReminderDays: 30 });
    expect(r.reminderDue).toEqual(["old"]);
    expect(r.summary).toMatch(/; unpaid acknowledgements 30\+ days: 1$/);
    expect(dailyReview(items, today, { unpaidReminderDays: null }).reminderDue).toEqual([]);
  });
});
