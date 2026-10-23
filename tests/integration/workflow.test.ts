// Phase 4: EVAL-01 checks and the §4 workflow actions, against a real Postgres.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BlockedError,
  ConfirmationRequiredError,
  ForbiddenError,
  ValidationError,
} from "@/server/errors";
import { loadContext } from "@/server/context";
import { loadEvaluationState } from "@/server/evaluation-state";
import { createSubmission, updateDocuments, updateSubmission } from "@/server/intake";
import { getSubmissionDetail } from "@/server/register";
import { recordPayment } from "@/server/payments";
import type { Actor } from "@/server/types";
import {
  approveAndRegister,
  assignOfficers,
  cancelSubmission,
  issueDeficiency,
  lapseSubmission,
  markSubmissionComplete,
  recordReview,
  recordShowCause,
  refuseSubmission,
  reopenDecision,
  saveChecks,
} from "@/server/workflow";
import { asWorkflow, confirmPayments, makeUser, resetDb, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());

const TODAY = "2026-10-22";
let registry: Actor,
  evaluator: Actor,
  evaluator2: Actor,
  supervisor: Actor,
  approver: Actor,
  admin: Actor;
let seq = 0;

beforeEach(async () => {
  await resetDb(db);
  registry = await makeUser(db, ["REGISTRY_OFFICER"]);
  evaluator = await makeUser(db, ["EVALUATING_OFFICER"]);
  evaluator2 = await makeUser(db, ["EVALUATING_OFFICER", "REVIEWING_SUPERVISOR"]);
  supervisor = await makeUser(db, ["REVIEWING_SUPERVISOR"]);
  approver = await makeUser(db, ["APPROVING_OFFICER"]);
  admin = await makeUser(db, ["ADMIN"]);
  await db.settings.update({
    where: { id: 1 },
    data: { chairmanName: "Engr. A. Chair", commissionerName: "Barr. B. Commissioner" },
  });
});

const lastAudit = () => db.auditLog.findFirstOrThrow({ orderBy: { id: "desc" } });

async function newSubmission(overrides: Record<string, string> = {}) {
  seq++;
  return createSubmission(db, registry, {
    registeredName: `Registrant ${seq} Ltd`,
    dateSubmitted: TODAY,
    submissionChannel: "",
    registrantType: "Company",
    cacNo: `RC${100 + seq}`,
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
    ...overrides,
  });
}

const assignAll = (id: string, o: Partial<Record<"e" | "s" | "a", string>> = {}) =>
  assignOfficers(db, supervisor, id, {
    evaluatingOfficerId: o.e ?? evaluator.id,
    reviewingSupervisorId: o.s ?? supervisor.id,
    approvingOfficerId: o.a ?? approver.id,
  });

const completeDocs = (id: string) =>
  updateDocuments(
    db,
    registry,
    id,
    Object.fromEntries(Array.from({ length: 13 }, (_, i) => [String(i + 1), "Y"])),
  );

/** Record the ₦250,000 fee and have Finance confirm it (§4.12), which releases the submission. */
async function payAndConfirm(ackNo: string) {
  await recordPayment(db, registry, {
    dateReceived: TODAY,
    reference: ackNo,
    purpose: "",
    channel: "",
    amount: "250000",
    rrr: "",
  });
  await confirmPayments(db, ackNo, TODAY);
}

async function completeDocsAndPay(id: string, ackNo: string) {
  await completeDocs(id);
  await payAndConfirm(ackNo);
}

/** A submission whose fee Finance has confirmed: released for evaluation, documents outstanding. */
async function released(overrides: Record<string, string> = {}) {
  const sub = await newSubmission(overrides);
  await payAndConfirm(sub.ackNo);
  return sub;
}

/** Every manual decision check answered (Y unless overridden). */
async function answerChecks(
  id: string,
  overrides: Record<string, string> = {},
  by: Actor = evaluator,
) {
  const state = (await loadEvaluationState(db, id, await loadContext(db, TODAY)))!;
  const values = Object.fromEntries(
    state.checks.filter((c) => c.mode === "manual" && !c.postApproval).map((c) => [c.id, "Y"]),
  );
  return saveChecks(
    db,
    by,
    id,
    { values: { ...values, ...overrides }, remarks: "" },
    { today: TODAY },
  );
}

async function readyForApproval() {
  const sub = await newSubmission();
  await completeDocsAndPay(sub.id, sub.ackNo);
  await assignAll(sub.id);
  await answerChecks(sub.id);
  await markSubmissionComplete(db, evaluator, sub.id, { today: TODAY });
  return sub;
}

describe("assignOfficers", () => {
  it("assigns by role, starts the evaluation date and audits names", async () => {
    const sub = await released();
    await assignAll(sub.id);
    const ev = await db.evaluation.findUniqueOrThrow({ where: { submissionId: sub.id } });
    expect(ev).toMatchObject({
      evaluatingOfficerId: evaluator.id,
      reviewingSupervisorId: supervisor.id,
      approvingOfficerId: approver.id,
    });
    expect(ev.dateEvaluationStarted).not.toBeNull();
    expect((await lastAudit()).detail).toBe(
      `evaluating officer: (none) → ${evaluator.name}; reviewing supervisor: (none) → ${supervisor.name}; approving officer: (none) → ${approver.name}`,
    );
  });

  it("enforces roles and separation of duties on the server", async () => {
    const sub = await newSubmission();
    await expect(assignAll(sub.id, { e: approver.id })).rejects.toMatchObject({
      fieldErrors: { evaluatingOfficerId: expect.any(Array) },
    });
    // The same person as evaluator and supervisor.
    const err = await assignAll(sub.id, { e: evaluator2.id, s: evaluator2.id }).catch((e) => e);
    expect(err).toBeInstanceOf(BlockedError);
    expect(err.reasons).toContain("The reviewing supervisor cannot be the evaluating officer");
    await expect(
      assignOfficers(db, registry, sub.id, {
        evaluatingOfficerId: evaluator.id,
        reviewingSupervisorId: "",
        approvingOfficerId: "",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("saveChecks (EVAL-01)", () => {
  it("lets the assigned evaluator or a supervisor answer manual checks, never automatic ones", async () => {
    const sub = await released();
    await assignAll(sub.id);
    await saveChecks(db, evaluator, sub.id, {
      values: { "2.1": "Y", "2.2": "N" },
      remarks: "Ownership unclear",
    });
    expect((await lastAudit()).detail).toBe("2.1: blank → Y; 2.2: blank → N; remarks updated");

    await expect(
      saveChecks(db, evaluator2, sub.id, { values: { "2.1": "N" }, remarks: "" }),
    ).resolves.toBeGreaterThan(0); // evaluator2 is also a supervisor
    const other = await makeUser(db, ["EVALUATING_OFFICER"]);
    await expect(
      saveChecks(db, other, sub.id, { values: { "2.1": "Y" }, remarks: "" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // 1.1 is automatic (Y once the ack number exists).
    await expect(
      saveChecks(db, evaluator, sub.id, { values: { "1.1": "N" }, remarks: "" }),
    ).rejects.toThrow(/automatic or locked.*1\.1/);
  });
});

describe("markSubmissionComplete (§4.4)", () => {
  it("lists what is outstanding instead of changing anything", async () => {
    const sub = await released();
    await assignAll(sub.id);
    const err = await markSubmissionComplete(db, evaluator, sub.id, { today: TODAY }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(BlockedError);
    // The fee is confirmed (it had to be, to get here); the documents are not.
    expect(err.reasons.filter((r: string) => r.startsWith("Unpaid"))).toEqual([]);
    expect(err.reasons.filter((r: string) => r.startsWith("Outstanding:"))).toHaveLength(13);
    expect(
      (await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).dateSubmissionComplete,
    ).toBeNull();
  });

  it("starts the determination clock, and a completed deficiency response returns to review", async () => {
    const sub = await released();
    await assignAll(sub.id);
    await issueDeficiency(db, supervisor, sub.id, { today: TODAY });
    await completeDocs(sub.id);
    await markSubmissionComplete(db, evaluator, sub.id, { today: "2026-10-25" });
    const row = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.status).toBe("RECEIVED");
    expect(row.dateSubmissionComplete?.toISOString().slice(0, 10)).toBe("2026-10-25");
    expect((await lastAudit()).detail).toBe(
      "Determination due 24 November 2026; response to OGSERC/DEF/2026/00001 received 25 October 2026, back to Received - Under Review",
    );
  });
});

describe("issueDeficiency (§4.5)", () => {
  it("sets the status and date, audits the response deadline, and cannot be re-issued while outstanding", async () => {
    const sub = await released();
    await issueDeficiency(db, supervisor, sub.id, { today: TODAY });
    expect(await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      status: "DEFICIENCY",
    });
    expect((await lastAudit()).detail).toMatch(
      /^OGSERC\/DEF\/2026\/00001; response due 5 November 2026; 13 document\(s\) outstanding/,
    );
    await expect(issueDeficiency(db, supervisor, sub.id, { today: TODAY })).rejects.toBeInstanceOf(
      BlockedError,
    );
    await expect(issueDeficiency(db, evaluator, sub.id, { today: TODAY })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("asks for confirmation when nothing has failed and the submission is complete", async () => {
    const sub = await readyForApproval();
    await expect(issueDeficiency(db, supervisor, sub.id, { today: TODAY })).rejects.toBeInstanceOf(
      ConfirmationRequiredError,
    );
    await issueDeficiency(db, supervisor, sub.id, { today: TODAY, confirm: true });
  });
});

describe("approveAndRegister (§4.6)", () => {
  it("lists every blocking reason", async () => {
    const sub = await released();
    const err = await approveAndRegister(
      db,
      approver,
      sub.id,
      { flagOverrideReason: "" },
      { today: TODAY },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(BlockedError);
    expect(err.reasons).toEqual(
      expect.arrayContaining([
        "No evaluating officer assigned",
        "No reviewing supervisor assigned",
        "No approving officer assigned",
        "Submission is not complete (documents or fees outstanding)",
        expect.stringMatching(/evaluation check\(s\) failed$/),
        expect.stringMatching(/evaluation check\(s\) pending$/),
      ]),
    );
  });

  it("registers: locked number from the yearly counter, dates, decision and audit", async () => {
    const first = await readyForApproval();
    await recordReview(db, supervisor, first.id, { today: TODAY });
    const { registrationNo } = await approveAndRegister(
      db,
      approver,
      first.id,
      { flagOverrideReason: "" },
      { today: TODAY },
    );
    expect(registrationNo).toBe("OGSERC/REG/2026/E-MGD/0001");
    const row = await db.submission.findUniqueOrThrow({
      where: { id: first.id },
      include: { evaluation: true },
    });
    expect(row).toMatchObject({ status: "REGISTERED", registrationNo });
    expect(row.certificateIssueDate?.toISOString().slice(0, 10)).toBe(TODAY);
    expect(row.evaluation).toMatchObject({ finalDecision: "REGISTER" });
    expect(await lastAudit()).toMatchObject({
      action: "Registered",
      userId: approver.id,
      detail: `${registrationNo} - approved by ${approver.name}`,
    });
    await expect(
      db.submission.update({ where: { id: first.id }, data: { registrationNo: "X" } }),
    ).rejects.toThrow(/locked/);

    const second = await readyForApproval();
    expect(
      (
        await approveAndRegister(
          db,
          approver,
          second.id,
          { flagOverrideReason: "" },
          { today: TODAY },
        )
      ).registrationNo,
    ).toBe("OGSERC/REG/2026/E-MGD/0002");
    await expect(
      approveAndRegister(db, approver, second.id, { flagOverrideReason: "" }, { today: TODAY }),
    ).rejects.toBeInstanceOf(BlockedError);
  });

  it("enforces separation of duties and the assigned approver", async () => {
    const sub = await readyForApproval();
    const otherApprover = await makeUser(db, ["APPROVING_OFFICER"]);
    const err = await approveAndRegister(
      db,
      otherApprover,
      sub.id,
      { flagOverrideReason: "" },
      { today: TODAY },
    ).catch((e) => e);
    expect(err.reasons).toContain("Only the assigned approving officer can decide");

    // The creator cannot approve their own intake.
    const both = await makeUser(db, ["REGISTRY_OFFICER", "APPROVING_OFFICER"]);
    const own = await createSubmission(db, both, {
      registeredName: "Own Intake Ltd",
      dateSubmitted: TODAY,
      submissionChannel: "",
      registrantType: "Company",
      cacNo: "RC999999",
      tin: "",
      address: "",
      principalLga: "Ifo",
      otherAreasServed: "",
      primaryActivityCode: "MGD",
      secondaryActivityCode: "",
      installedCapacityMw: "2",
      customers: "",
      licenceStatus: "NERC registration/permit (mini-grid/captive)",
      licenceNo: "N/1",
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
    });
    const blocked = await assignAll(own.id, { a: both.id }).catch((e) => e);
    expect(blocked.reasons).toContain(
      "The approving officer cannot be the user who created the submission",
    );
  });

  it("requires a written override for data flags, and records it", async () => {
    const sub = await readyForApproval();
    // A flag: licence held but no licence number.
    await db.submission.update({ where: { id: sub.id }, data: { licenceNo: null } });
    const err = await approveAndRegister(
      db,
      approver,
      sub.id,
      { flagOverrideReason: "" },
      { today: TODAY },
    ).catch((e) => e);
    expect(err.reasons.some((r: string) => r.includes("no written override reason"))).toBe(true);

    await approveAndRegister(
      db,
      approver,
      sub.id,
      { flagOverrideReason: "NERC confirmed number by letter" },
      { today: TODAY },
    );
    expect((await lastAudit()).detail).toContain(
      "1 data flag(s) overridden: NERC confirmed number by letter",
    );
    expect(
      (await db.evaluation.findUniqueOrThrow({ where: { submissionId: sub.id } }))
        .flagOverrideReason,
    ).toBe("NERC confirmed number by letter");
  });

  it("is blocked while a signatory is '[Name]'", async () => {
    const sub = await readyForApproval();
    await db.settings.update({ where: { id: 1 }, data: { commissionerName: "[Name]" } });
    const err = await approveAndRegister(
      db,
      approver,
      sub.id,
      { flagOverrideReason: "" },
      { today: TODAY },
    ).catch((e) => e);
    expect(err.reasons).toContain("Certificate signatory names are not set in Settings");
  });
});

describe("lapseSubmission (§4.7)", () => {
  it("is blocked on day 14 of the response period and allowed on day 15", async () => {
    const sub = await released();
    await issueDeficiency(db, supervisor, sub.id, { today: TODAY });
    await expect(
      lapseSubmission(db, supervisor, sub.id, { today: "2026-11-05" }),
    ).rejects.toBeInstanceOf(BlockedError);
    await lapseSubmission(db, supervisor, sub.id, { today: "2026-11-06" });
    expect(
      await db.submission.findUniqueOrThrow({
        where: { id: sub.id },
        include: { evaluation: true },
      }),
    ).toMatchObject({
      status: "LAPSED",
      evaluation: { finalDecision: "LAPSE" },
    });
    expect((await lastAudit()).action).toBe("Lapsed");
    await expect(
      lapseSubmission(db, approver, sub.id, { today: "2026-11-06" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("refuseSubmission (§4.8)", () => {
  it("needs a show-cause notice whose 14 days have passed, a permitted ground, and the assigned approver", async () => {
    const sub = await newSubmission();
    await assignAll(sub.id);
    const refuse = (
      today: string,
      ground = "False or misleading information",
      by: Actor = approver,
    ) =>
      refuseSubmission(
        db,
        by,
        sub.id,
        { ground, details: "CAC report contradicts declared directors" },
        { today },
      );

    let err = await refuse(TODAY).catch((e) => e);
    expect(err.reasons).toContain("No show-cause notice date recorded");

    await recordShowCause(db, supervisor, sub.id, { showCauseDate: TODAY }, { today: TODAY });
    expect((await lastAudit()).detail).toBe("Served 22 October 2026; period ends 5 November 2026");
    err = await refuse("2026-11-04").catch((e) => e);
    expect(err.reasons).toEqual(["The 14-day show-cause period has not ended"]);
    err = await refuse("2026-11-05", "Did not like them").catch((e) => e);
    expect(err.reasons).toEqual(["Grounds must be one allowed by the Order"]);
    const other = await makeUser(db, ["APPROVING_OFFICER"]);
    err = await refuse("2026-11-05", undefined, other).catch((e) => e);
    expect(err.reasons).toEqual(["Only the assigned approving officer can decide"]);

    await refuse("2026-11-05");
    expect(
      await db.submission.findUniqueOrThrow({
        where: { id: sub.id },
        include: { evaluation: true },
      }),
    ).toMatchObject({
      status: "REFUSED",
      evaluation: {
        finalDecision: "REFUSE",
        reasons: "False or misleading information: CAC report contradicts declared directors",
      },
    });
  });

  it("refuses a show-cause date in the future", async () => {
    const sub = await newSubmission();
    await expect(
      recordShowCause(db, supervisor, sub.id, { showCauseDate: "2026-12-01" }, { today: TODAY }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("cancelSubmission (§4.9)", () => {
  it("is admin-only, needs a reason, and works on a registered submission (para 14)", async () => {
    const sub = await readyForApproval();
    await approveAndRegister(db, approver, sub.id, { flagOverrideReason: "" }, { today: TODAY });
    await expect(
      cancelSubmission(db, approver, sub.id, { reason: "Ceased operations" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelSubmission(db, admin, sub.id, { reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await cancelSubmission(
      db,
      admin,
      sub.id,
      { reason: "Ceased operations in Ogun State" },
      { today: TODAY },
    );
    expect(await lastAudit()).toMatchObject({
      action: "Cancelled",
      detail: "Was Registered. Reason: Ceased operations in Ogun State",
    });
    await expect(
      cancelSubmission(db, admin, sub.id, { reason: "Again please" }),
    ).rejects.toBeInstanceOf(BlockedError);
  });
});

describe("deficiency notices", () => {
  it("record when the response completed the submission, and allow a new notice afterwards", async () => {
    const sub = await released();
    await assignAll(sub.id);
    const first = await issueDeficiency(db, supervisor, sub.id, { today: TODAY });
    expect(first.noticeRef).toBe("OGSERC/DEF/2026/00001");
    await completeDocs(sub.id);
    await markSubmissionComplete(db, evaluator, sub.id, { today: "2026-10-30" });

    const notices = await db.deficiencyNotice.findMany({ where: { submissionId: sub.id } });
    expect(notices).toHaveLength(1);
    expect(notices[0]!.responseReceivedDate?.toISOString().slice(0, 10)).toBe("2026-10-30");
    expect((await lastAudit()).detail).toContain(
      "response to OGSERC/DEF/2026/00001 received 30 October 2026",
    );

    // Resolved, so a new notice may be issued (nothing failed and it is complete: confirm first).
    const second = await issueDeficiency(db, supervisor, sub.id, {
      today: "2026-11-02",
      confirm: true,
    });
    expect(second.noticeRef).toBe("OGSERC/DEF/2026/00001-2");
    expect(await db.deficiencyNotice.count({ where: { submissionId: sub.id } })).toBe(2);
    // …but not a third while the second is outstanding.
    await expect(
      issueDeficiency(db, supervisor, sub.id, { today: "2026-11-03", confirm: true }),
    ).rejects.toBeInstanceOf(BlockedError);
  });
});

describe("reopenDecision (Admin)", () => {
  it("returns a refused submission to review, with a reason", async () => {
    const sub = await released();
    await assignAll(sub.id);
    await recordShowCause(db, supervisor, sub.id, { showCauseDate: TODAY }, { today: TODAY });
    await refuseSubmission(
      db,
      approver,
      sub.id,
      { ground: "Non-payment of fees or charges", details: "" },
      { today: "2026-11-05" },
    );
    await expect(
      reopenDecision(db, approver, sub.id, { reason: "Refused in error" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reopenDecision(db, admin, sub.id, { reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(
      await reopenDecision(db, admin, sub.id, { reason: "Payment was made; bank delay" }),
    ).toEqual({ status: "Received - Under Review" });
    expect(
      await db.submission.findUniqueOrThrow({
        where: { id: sub.id },
        include: { evaluation: true },
      }),
    ).toMatchObject({
      status: "RECEIVED",
      evaluation: { finalDecision: null, reasons: null, approvalDate: null },
    });
    expect(await lastAudit()).toMatchObject({
      action: "Decision reopened",
      detail: "Refused → Received - Under Review. Reason: Payment was made; bank delay",
    });
  });

  it("returns a lapsed submission to its unanswered deficiency notice", async () => {
    const sub = await released();
    await issueDeficiency(db, supervisor, sub.id, { today: TODAY });
    await lapseSubmission(db, supervisor, sub.id, { today: "2026-11-06" });
    expect(
      await reopenDecision(db, admin, sub.id, { reason: "Response was received on time by email" }),
    ).toEqual({ status: "Deficiency Notice Issued" });
  });

  it("reinstates a cancelled registration, but never reopens a registration itself", async () => {
    const sub = await readyForApproval();
    await approveAndRegister(db, approver, sub.id, { flagOverrideReason: "" }, { today: TODAY });
    await expect(
      reopenDecision(db, admin, sub.id, { reason: "Wrong submission" }),
    ).rejects.toBeInstanceOf(BlockedError);
    await cancelSubmission(db, admin, sub.id, { reason: "Ceased operations" }, { today: TODAY });
    expect(
      await reopenDecision(db, admin, sub.id, { reason: "Cancelled the wrong record" }),
    ).toEqual({ status: "Registered" });
    expect(await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      status: "REGISTERED",
      registrationNo: "OGSERC/REG/2026/E-MGD/0001",
    });
  });
});

describe("Admin assigns officers", () => {
  it("is allowed, with separation of duties still enforced", async () => {
    const sub = await newSubmission();
    await assignOfficers(db, admin, sub.id, {
      evaluatingOfficerId: evaluator.id,
      reviewingSupervisorId: supervisor.id,
      approvingOfficerId: approver.id,
    });
    expect((await lastAudit()).userId).toBe(admin.id);
    const err = await assignOfficers(db, admin, sub.id, {
      evaluatingOfficerId: evaluator2.id,
      reviewingSupervisorId: evaluator2.id,
      approvingOfficerId: approver.id,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BlockedError);
  });
});

describe("approving a Provisionally Registered submission", () => {
  it("registers it: the ack number in use is replaced by the registration number", async () => {
    const sub = await readyForApproval();
    // What the daily review does on day 31 (para 13(4)); the job itself arrives in Phase 7.
    await asWorkflow(db, (tx) =>
      tx.submission.update({ where: { id: sub.id }, data: { status: "PROVISIONAL" } }),
    );
    const before = (await getSubmissionDetail(db, sub.id, "2026-12-01"))!;
    expect(before.assessment.registrationNoInUse).toBe(sub.ackNo);
    expect(before.nextAction).toBe("Determine and issue the certificate");

    const { registrationNo } = await approveAndRegister(
      db,
      approver,
      sub.id,
      { flagOverrideReason: "" },
      { today: "2026-12-01" },
    );
    const after = (await getSubmissionDetail(db, sub.id, "2026-12-01"))!;
    expect(after.sub.status).toBe("Registered");
    expect(after.assessment.registrationNoInUse).toBe(registrationNo);
    expect(registrationNo).toBe("OGSERC/REG/2026/E-MGD/0001");
  });
});

describe("Registered records: certificate fields", () => {
  it("only Admin edits them, with a reason, and the certificate is marked for reissue", async () => {
    const sub = await readyForApproval();
    await approveAndRegister(db, approver, sub.id, { flagOverrideReason: "" }, { today: TODAY });
    const row = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    const form = (o: Record<string, string>) => ({
      registeredName: row.registeredName,
      dateSubmitted: TODAY,
      submissionChannel: "",
      registrantType: "Company",
      cacNo: row.cacNo ?? "",
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
      ...o,
    });
    await expect(
      updateSubmission(db, registry, sub.id, form({ phone: "08012345678" })),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // A field not on the certificate: no reissue.
    await updateSubmission(db, admin, sub.id, form({ phone: "08012345678" }), {
      changeReason: "Applicant gave a new number",
    });
    expect(
      (await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).certificateNeedsReissue,
    ).toBe(false);

    // A certificate field: reissue.
    await updateSubmission(
      db,
      admin,
      sub.id,
      form({ phone: "08012345678", address: "5 New Road, Abeokuta" }),
      { changeReason: "Change of registered address (letter 3 Dec)" },
    );
    expect(
      (await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).certificateNeedsReissue,
    ).toBe(true);
    expect((await lastAudit()).detail).toBe(
      "address: (blank) → 5 New Road, Abeokuta; certificate needs reissue. Reason: Change of registered address (letter 3 Dec)",
    );
  });
});
