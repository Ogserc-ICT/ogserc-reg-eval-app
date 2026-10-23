// SPEC §4.12 Finance confirmation gate, against a real database.
import { execSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";
import { runDailyReview } from "@/server/daily-review";
import { generateEvaluationForm, previewDeficiencyNotice } from "@/server/documents";
import { BlockedError, ForbiddenError, ValidationError } from "@/server/errors";
import { confirmPayment, financeDesk, rejectPayment } from "@/server/finance";
import { createSubmission, updateDocuments } from "@/server/intake";
import { recordPayment, reversePayment } from "@/server/payments";
import { fromIsoDate } from "@/server/reference-data";
import { getSubmissionDetail } from "@/server/register";
import { loadSettings } from "@/server/reference-data";
import { updateSettings } from "@/server/settings";
import type { Actor } from "@/server/types";
import {
  assignOfficers,
  issueDeficiency,
  markSubmissionComplete,
  recordShowCause,
  refuseSubmission,
  saveChecks,
} from "@/server/workflow";
import { asWorkflow, makeUser, resetDb, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());

const TODAY = "2026-10-22";
let registry: Actor,
  finance: Actor,
  finance2: Actor,
  evaluator: Actor,
  supervisor: Actor,
  approver: Actor,
  admin: Actor;

beforeEach(async () => {
  await resetDb(db);
  registry = await makeUser(db, ["REGISTRY_OFFICER"]);
  finance = await makeUser(db, ["FINANCE_OFFICER"]);
  finance2 = await makeUser(db, ["FINANCE_OFFICER"]);
  evaluator = await makeUser(db, ["EVALUATING_OFFICER"]);
  supervisor = await makeUser(db, ["REVIEWING_SUPERVISOR"]);
  approver = await makeUser(db, ["APPROVING_OFFICER"]);
  admin = await makeUser(db, ["ADMIN"]);
});

const form = (o: Record<string, string> = {}) => ({
  registeredName: "Gate Test Ltd",
  dateSubmitted: TODAY,
  submissionChannel: "",
  registrantType: "Company",
  cacNo: "RC4242",
  tin: "",
  address: "",
  principalLga: "Ifo",
  otherAreasServed: "",
  primaryActivityCode: "MGD",
  secondaryActivityCode: "",
  installedCapacityMw: "2.5",
  customers: "",
  licenceStatus: "NERC registration/permit (mini-grid/captive)",
  licenceNo: "NERC/MG/1",
  licenceExpiry: "",
  complianceOfficer: "",
  phone: "",
  email: "",
  operatingOnEffectiveDate: "Y",
  plannedStartDate: "",
  categoryOverride: "",
  overrideReason: "",
  remarks: "",
  evaluatingOfficerId: "",
  ...o,
});

const pay = (reference: string, amount: string, by: Actor = registry) =>
  recordPayment(db, by, {
    dateReceived: TODAY,
    reference,
    purpose: "",
    channel: "",
    amount,
    rrr: "",
  });
const confirm = (id: string, by: Actor = finance) =>
  confirmPayment(db, by, id, { verified: true, remarks: "" }, { today: TODAY });
const row = (id: string) => db.submission.findUniqueOrThrow({ where: { id } });
const audit = (action: string) =>
  db.auditLog.findMany({ where: { action }, orderBy: { id: "asc" } });

describe("acknowledgement and Finance confirmation", () => {
  it("starts acknowledged; payments are pending until Finance confirms; confirming releases", async () => {
    const sub = await createSubmission(db, registry, form({ evaluatingOfficerId: evaluator.id }));
    expect(await row(sub.id)).toMatchObject({
      status: "AWAITING_PAYMENT",
      releasedForEvaluationDate: null,
    });
    const p = await pay(sub.ackNo, "250000");
    expect(p.financeStatus).toBe("PENDING");
    let d = (await getSubmissionDetail(db, sub.id, TODAY))!;
    expect(d.assessment.processStage).toEqual({ stage: 2, label: "Payment with Finance" });
    expect(d.assessment.fees.amountPaid).toBe(0);

    const desk = await financeDesk(db, finance, TODAY);
    expect(desk.pending.map((x) => [x.paymentNo, x.daysWaiting, x.recordedByMe])).toEqual([
      [p.paymentNo, 0, false],
    ]);

    expect(await confirm(p.id)).toEqual({ released: true });
    expect(await row(sub.id)).toMatchObject({ status: "RECEIVED" });
    expect((await row(sub.id)).releasedForEvaluationDate?.toISOString().slice(0, 10)).toBe(TODAY);
    // An evaluating officer chosen at intake starts on release.
    const ev = await db.evaluation.findUniqueOrThrow({ where: { submissionId: sub.id } });
    expect(ev.dateEvaluationStarted?.toISOString().slice(0, 10)).toBe(TODAY);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
      financeStatus: "CONFIRMED",
      financeDecidedById: finance.id,
      verifiedWithBank: true,
    });
    const [confirmed] = await audit("Payment confirmed");
    expect(confirmed).toMatchObject({ userId: finance.id, reference: sub.ackNo });
    const [released] = await audit("Released for evaluation");
    expect(released).toMatchObject({
      userId: finance.id,
      reference: sub.ackNo,
      detail: `₦250,000 confirmed of ₦250,000 required (confirmation of ${p.paymentNo})`,
    });
    d = (await getSubmissionDetail(db, sub.id, TODAY))!;
    expect(d.assessment.processStage.stage).toBe(4);
    expect(d.flags.map((f) => f.code)).not.toContain("STATUS_WITHOUT_CONFIRMATION");
  });

  it("releases only once confirmed payments cover fee − waiver", async () => {
    const sub = await createSubmission(db, registry, form());
    const first = await pay(sub.ackNo, "100000");
    const second = await pay(sub.ackNo, "150000");
    expect(await confirm(first.id)).toEqual({ released: false });
    expect((await row(sub.id)).status).toBe("AWAITING_PAYMENT");
    expect(await confirm(second.id)).toEqual({ released: true });
    expect((await row(sub.id)).status).toBe("RECEIVED");
  });

  it("needs the bank tick, Finance, and someone other than the recorder", async () => {
    const sub = await createSubmission(db, registry, form());
    const p = await pay(sub.ackNo, "250000", finance);
    await expect(
      confirmPayment(db, finance2, p.id, { verified: false, remarks: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      confirmPayment(db, registry, p.id, { verified: true, remarks: "" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const err = await confirm(p.id, finance).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlockedError);
    expect((err as BlockedError).reasons).toEqual([
      "You recorded it; another Finance officer must confirm it (separation of duties)",
    ]);
    expect((await financeDesk(db, finance, TODAY)).pending[0]!.recordedByMe).toBe(true);
    // The database refuses it too.
    await expect(
      db.payment.update({
        where: { id: p.id },
        data: {
          financeStatus: "CONFIRMED",
          financeDecidedById: finance.id,
          financeDecidedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/Payment_confirmer_not_recorder/);
    await confirm(p.id, finance2);
  });

  it("rejection needs a reason, never counts, and every decision is final", async () => {
    const sub = await createSubmission(db, registry, form());
    const p = await pay(sub.ackNo, "250000");
    await expect(rejectPayment(db, finance, p.id, { reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await rejectPayment(db, finance, p.id, { reason: "Not on the bank statement" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
      financeStatus: "REJECTED",
      financeRemarks: "Not on the bank statement",
    });
    expect((await getSubmissionDetail(db, sub.id, TODAY))!.assessment.fees.amountPaid).toBe(0);
    await expect(confirm(p.id)).rejects.toThrow(/already rejected/);
    await expect(reversePayment(db, finance, p.id, { reason: "tidy up please" })).rejects.toThrow(
      /never counted/,
    );
    await expect(
      db.payment.update({ where: { id: p.id }, data: { financeRemarks: "changed" } }),
    ).rejects.toThrow(/final/);
    expect((await audit("Payment rejected"))[0]).toMatchObject({
      userId: finance.id,
      detail: expect.stringContaining("Reason: Not on the bank statement"),
    });
  });
});

describe("the payment gate", () => {
  it("blocks evaluation actions and PDFs until confirmed, auditing every attempt; refusal stays", async () => {
    const sub = await createSubmission(db, registry, form());
    await assignOfficers(db, supervisor, sub.id, {
      evaluatingOfficerId: evaluator.id,
      reviewingSupervisorId: supervisor.id,
      approvingOfficerId: approver.id,
    });
    await pay(sub.ackNo, "250000"); // recorded, not confirmed
    const blocked = async (attempt: Promise<unknown>) => {
      const e = await attempt.catch((x: unknown) => x);
      expect(e).toBeInstanceOf(BlockedError);
      expect((e as BlockedError).reasons).toEqual([
        "Payment not yet confirmed by Finance: ₦0 of ₦250,000 confirmed; ₦250,000 recorded and waiting for Finance",
      ]);
    };
    await blocked(saveChecks(db, evaluator, sub.id, { values: { "2.1": "Y" }, remarks: "" }));
    await blocked(markSubmissionComplete(db, evaluator, sub.id, { today: TODAY }));
    await blocked(issueDeficiency(db, supervisor, sub.id, { today: TODAY }));
    await blocked(generateEvaluationForm(db, evaluator, sub.id, TODAY));
    await blocked(previewDeficiencyNotice(db, evaluator, sub.id, TODAY));
    const attempts = await audit("Blocked - awaiting Finance confirmation");
    expect(attempts.map((a) => a.detail?.split(":")[0])).toEqual([
      "Evaluation",
      "Mark complete",
      "Deficiency notice",
      "Evaluation form",
      "Deficiency notice draft",
    ]);
    expect(attempts.every((a) => a.reference === sub.ackNo)).toBe(true);
    expect(await db.evaluationCheckValue.count()).toBe(0);

    // Refusal is not gated (after show-cause).
    await recordShowCause(db, approver, sub.id, { showCauseDate: "2026-10-01" }, { today: TODAY });
    await refuseSubmission(
      db,
      approver,
      sub.id,
      { ground: "False or misleading information", details: "" },
      { today: TODAY },
    );
    expect((await row(sub.id)).status).toBe("REFUSED");
  });

  it("closes again when a confirmed payment is reversed (Finance or Admin, with a reason)", async () => {
    const sub = await createSubmission(db, registry, form());
    const p = await pay(sub.ackNo, "250000");
    await confirm(p.id);
    await expect(reversePayment(db, registry, p.id, { reason: "Bounced" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await reversePayment(db, admin, p.id, { reason: "Cheque bounced" });
    expect((await row(sub.id)).status).toBe("RECEIVED"); // released stays released
    await expect(
      markSubmissionComplete(db, evaluator, sub.id, { today: TODAY }),
    ).rejects.toBeInstanceOf(BlockedError);
  });

  it("“late charge required to release” uses the total due; turning it off releases at once", async () => {
    const values = async (late: boolean) => {
      const current = await loadSettings(db);
      return {
        ...current,
        ...current.policy,
        feesRevisedOn: "",
        tinPattern: "",
        unpaidReminderDays: "",
        lateChargeRequiredForRelease: late,
      };
    };
    await updateSettings(db, admin, await values(true));
    // An earlier Effective Date makes a submission today late: fee ₦250,000 plus a late charge.
    await db.settings.update({
      where: { id: 1 },
      data: { effectiveDate: fromIsoDate("2026-07-01") },
    });
    const late = await createSubmission(db, registry, form());
    await confirm((await pay(late.ackNo, "250000")).id);
    expect((await row(late.id)).status).toBe("AWAITING_PAYMENT");

    await updateSettings(db, admin, await values(false));
    expect((await row(late.id)).status).toBe("RECEIVED");
    const [released] = await audit("Released for evaluation");
    expect(released).toMatchObject({
      userId: admin.id,
      detail: expect.stringContaining("(Finance gate setting changed)"),
    });
    expect((await audit("Settings updated")).map((a) => a.detail)).toEqual([
      "lateChargeRequiredForRelease: false → true",
      "lateChargeRequiredForRelease: true → false",
    ]);
  });

  it("the daily review releases a missed one and counts unpaid acknowledgements past the reminder", async () => {
    const missed = await createSubmission(db, registry, form());
    const p = await pay(missed.ackNo, "250000");
    // Confirmed without the release (e.g. a failure in between).
    await db.payment.update({
      where: { id: p.id },
      data: {
        financeStatus: "CONFIRMED",
        financeDecidedById: finance.id,
        financeDecidedAt: new Date(),
      },
    });
    const unpaid = await createSubmission(
      db,
      registry,
      form({ cacNo: "RC4343", registeredName: "Unpaid Ltd", dateSubmitted: "2026-09-01" }),
    );
    await db.settings.update({ where: { id: 1 }, data: { unpaidReminderDays: 30 } });

    const run = await runDailyReview(db, null, { today: TODAY });
    expect(run.released.map((r) => r.ackNo)).toEqual([missed.ackNo]);
    expect(run.reminderDue.map((r) => r.ackNo)).toEqual([unpaid.ackNo]);
    expect(run.summary).toMatch(
      /released for evaluation: 1; unpaid acknowledgements 30\+ days: 1$/,
    );
    expect((await row(missed.id)).status).toBe("RECEIVED");
    expect((await audit("Released for evaluation"))[0]).toMatchObject({
      userId: null,
      detail: expect.stringContaining("(daily review)"),
    });
  });
});

describe("existing records (data migration)", () => {
  const MIGRATION = "prisma/migrations/20261024090200_finance_gate_existing_records/migration.sql";

  it("dry run lists, then the migration moves, open records with no confirmed payment, auditing each", async () => {
    const make = async (name: string, cac: string, status: string, extra = {}) => {
      const s = await createSubmission(db, registry, form({ registeredName: name, cacNo: cac }));
      await asWorkflow(db, (tx) =>
        tx.submission.update({
          where: { id: s.id },
          data: { status: status as never, ...extra },
        }),
      );
      return s;
    };
    const received = await make("Received Ltd", "RC1", "RECEIVED");
    const deficiency = await make("Deficiency Ltd", "RC2", "DEFICIENCY", {
      deficiencyNoticeDate: fromIsoDate(TODAY),
    });
    const provisional = await make("Provisional Ltd", "RC3", "PROVISIONAL");
    const confirmedOne = await make("Confirmed Ltd", "RC4", "RECEIVED", {
      releasedForEvaluationDate: fromIsoDate(TODAY),
    });
    const registered = await make("Registered Ltd", "RC5", "REGISTERED", {
      certificateIssueDate: fromIsoDate(TODAY),
      registrationNo: "OGSERC/REG/2026/E-MGD/0001",
    });
    await pay(received.ackNo, "250000"); // pending: does not save it
    await confirm((await pay(confirmedOne.ackNo, "250000")).id);
    await updateDocuments(db, registry, received.id, { "1": "Y" });

    const url = inject("databaseUrl");
    const dryRun = execSync("npx tsx scripts/finance-gate-dry-run.ts", {
      env: { ...process.env, DATABASE_URL: url },
    }).toString();
    expect(dryRun).toContain('Would return to "Acknowledged - Awaiting Payment": 3');
    expect(dryRun).toContain("from Received - Under Review: 1");
    expect(dryRun).toContain("from Deficiency Notice Issued: 1");
    expect(dryRun).toContain("from Provisionally Registered: 1");
    expect(dryRun).toContain("Payments that will be Pending until Finance confirms them: 1");
    // Nothing changed by the dry run.
    expect((await row(received.id)).status).toBe("RECEIVED");

    execSync(`npx prisma db execute --file ${MIGRATION} --url "${url}"`, { stdio: "pipe" });

    for (const s of [received, deficiency, provisional]) {
      expect((await row(s.id)).status).toBe("AWAITING_PAYMENT");
    }
    expect((await row(confirmedOne.id)).status).toBe("RECEIVED");
    expect((await row(registered.id)).status).toBe("REGISTERED");
    const moved = await audit("Returned to awaiting payment");
    expect(moved.map((a) => [a.reference, a.userId])).toEqual([
      [received.ackNo, null],
      [deficiency.ackNo, null],
      [provisional.ackNo, null],
    ]);
    expect(moved[1]!.detail).toBe(
      "Deficiency Notice Issued → Acknowledged - Awaiting Payment. Finance confirmation gate introduced: no payment confirmed by Finance yet (data migration).",
    );
    const [summary] = await audit("Finance gate introduced");
    expect(summary!.detail).toBe(
      "3 submission(s) returned to Acknowledged - Awaiting Payment; 1 payment(s) recorded before the gate are Pending until Finance confirms them.",
    );
    // The workflow lock is back on afterwards.
    await expect(
      db.submission.update({ where: { id: received.id }, data: { status: "RECEIVED" } }),
    ).rejects.toThrow(/workflow actions/);
  });
});
