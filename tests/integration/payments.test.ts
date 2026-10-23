// Payment reversals: reason required, Finance or Admin only, original row kept and visible.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { nairaToKobo as naira } from "@/domain/money";
import { assessSubmission } from "@/domain/submission";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { reversePayment } from "@/server/payments";
import { loadReferenceData, loadSettings } from "@/server/reference-data";
import { loadSubmission } from "@/server/submissions";
import type { Actor } from "@/server/types";
import { makeUser, resetDb, saveSubmission, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());

let finance: Actor;
let submissionId: string;
let ackNo: string;
let seq = 0;

beforeEach(async () => {
  await resetDb(db);
  finance = await makeUser(db, ["FINANCE_OFFICER"]);
  const sub = await saveSubmission(db, finance.id); // MGD, Category E, ₦250,000
  submissionId = sub.id;
  ackNo = sub.ackNo;
});

function recordPayment(nairaAmount: number) {
  seq++;
  return db.payment.create({
    data: {
      paymentSeq: seq,
      paymentNo: `OGSERC/PAY/2026/${String(seq).padStart(5, "0")}`,
      dateReceived: new Date("2026-10-23T00:00:00Z"),
      reference: ackNo,
      submissionId,
      amount: BigInt(naira(nairaAmount)),
      recordedById: finance.id,
    },
  });
}

async function amountPaid() {
  const loaded = await loadSubmission(db, submissionId);
  const ctx = {
    ref: await loadReferenceData(db),
    settings: await loadSettings(db),
    today: "2026-10-25",
  };
  return assessSubmission(loaded!.sub, loaded!.payments, ctx).fees.amountPaid;
}

describe("reversePayment", () => {
  it("marks the payment reversed with who, when and why; it stays on record but stops counting", async () => {
    const wrong = await recordPayment(250_000);
    await recordPayment(100_000);
    expect(await amountPaid()).toBe(naira(350_000));

    await reversePayment(db, finance, wrong.id, { reason: "Duplicate entry of RRR 1234" });

    const row = await db.payment.findUniqueOrThrow({ where: { id: wrong.id } });
    expect(row).toMatchObject({
      status: "REVERSED",
      reversalReason: "Duplicate entry of RRR 1234",
      reversedById: finance.id,
      amount: BigInt(naira(250_000)),
    });
    expect(row.reversedAt).toBeInstanceOf(Date);
    expect(await db.payment.count({ where: { submissionId } })).toBe(2);
    expect(await amountPaid()).toBe(naira(100_000));
    expect(await db.auditLog.findFirstOrThrow({ orderBy: { id: "desc" } })).toMatchObject({
      userId: finance.id,
      action: "Payment reversed",
      reference: ackNo,
      detail: `${wrong.paymentNo} ₦250,000. Reason: Duplicate entry of RRR 1234`,
    });
  });

  it("is open to Finance and Admin only", async () => {
    const payment = await recordPayment(250_000);
    for (const roles of [
      ["REGISTRY_OFFICER"],
      ["APPROVING_OFFICER", "REVIEWING_SUPERVISOR"],
      ["VIEWER"],
    ] as const) {
      const actor = await makeUser(db, [...roles]);
      await expect(
        reversePayment(db, actor, payment.id, { reason: "not mine to do" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const admin = await makeUser(db, ["ADMIN"]);
    await reversePayment(db, admin, payment.id, { reason: "Posted to wrong file" });
  });

  it("requires a reason and is final", async () => {
    const payment = await recordPayment(250_000);
    await expect(reversePayment(db, finance, payment.id, { reason: "" })).rejects.toMatchObject({
      fieldErrors: { reason: expect.any(Array) },
    });
    await reversePayment(db, finance, payment.id, { reason: "Bounced transfer" });
    await expect(
      reversePayment(db, finance, payment.id, { reason: "again" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("database rules for payments", () => {
  it("refuses edits to what was received", async () => {
    const payment = await recordPayment(250_000);
    await expect(
      db.payment.update({ where: { id: payment.id }, data: { amount: 1n } }),
    ).rejects.toThrow(/cannot be edited/);
    await db.payment.update({ where: { id: payment.id }, data: { verifiedWithBank: true } });
  });

  it("refuses a reversal without a reason, and undoing a reversal", async () => {
    const payment = await recordPayment(250_000);
    await expect(
      db.payment.update({ where: { id: payment.id }, data: { status: "REVERSED" } }),
    ).rejects.toThrow(/Payment_reversal_fields/);
    await reversePayment(db, finance, payment.id, { reason: "Bounced transfer" });
    await expect(
      db.payment.update({
        where: { id: payment.id },
        data: { status: "ACTIVE", reversalReason: null, reversedById: null, reversedAt: null },
      }),
    ).rejects.toThrow(/final/);
  });
});
