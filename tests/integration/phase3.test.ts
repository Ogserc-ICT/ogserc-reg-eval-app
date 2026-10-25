// Phase 3 services: intake, editing, documents, waiver, payments, own-use, bulk recalculation,
// the Register list, and password-change lockout.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { nairaToKobo as naira } from "@/domain/money";
import { ConfirmationRequiredError, ForbiddenError, ValidationError } from "@/server/errors";
import { createSubmission, setWaiver, updateDocuments, updateSubmission } from "@/server/intake";
import { createOwnUse, listOwnUse, recalculateOwnUsePricing, updateOwnUse } from "@/server/own-use";
import { recordPayment } from "@/server/payments";
import { recalculatePricingBulk } from "@/server/pricing";
import { getSubmissionDetail, listRegister } from "@/server/register";
import { hashSessionToken } from "@/server/session-store";
import type { Actor } from "@/server/types";
import { changeOwnPassword } from "@/server/users";
import { asWorkflow, confirmPayments, makeUser, resetDb, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());

let registry: Actor;
let finance: Actor;
let admin: Actor;
let evaluator: Actor;
beforeEach(async () => {
  await resetDb(db);
  registry = await makeUser(db, ["REGISTRY_OFFICER"]);
  finance = await makeUser(db, ["FINANCE_OFFICER"]);
  admin = await makeUser(db, ["ADMIN"]);
  evaluator = await makeUser(db, ["EVALUATING_OFFICER"]);
});

/** Form-shaped intake input (strings, as the form posts them). */
const intake = (o: Record<string, string> = {}) => ({
  registeredName: "Ogun Mini-Grid Ltd",
  dateSubmitted: "2026-10-22",
  submissionChannel: "By hand",
  registrantType: "Company",
  cacNo: "rc 123456",
  tin: "",
  address: "1 Example Road, Abeokuta",
  principalLga: "Abeokuta South",
  otherAreasServed: "",
  primaryActivityCode: "MGD",
  filingType: "NEW",
  formFiled: "REG-01E",
  installedCapacityMw: "2.5",
  customers: "1,200",
  licenceStatus: "NERC registration/permit (mini-grid/captive)",
  licences: [{ number: "NERC/MG/001" }],
  complianceOfficer: "Jane Doe",
  phone: "0801 234 5678",
  email: "compliance@example.ng",
  operatingOnEffectiveDate: "Y",
  plannedStartDate: "",
  categoryOverride: "",
  overrideReason: "",
  remarks: "",
  evaluatingOfficerId: "",
  ...o,
});

const lastAudit = () => db.auditLog.findFirstOrThrow({ orderBy: { id: "desc" } });

describe("createSubmission (§4.1)", () => {
  it("assigns the ack number, snapshots pricing, creates the evaluation and audits", async () => {
    const sub = await createSubmission(db, registry, intake());
    expect(sub).toMatchObject({
      ackNo: "OGSERC/ACK/2026/00001",
      status: "AWAITING_PAYMENT",
      cacNo: "RC123456",
      customers: 1200,
      pricedCategory: "E",
      pricedRegistrationFee: BigInt(naira(250_000)),
      createdById: registry.id,
    });
    expect(await db.evaluation.findUnique({ where: { submissionId: sub.id } })).toMatchObject({
      evaluatingOfficerId: null,
      dateEvaluationStarted: null,
    });
    expect(await lastAudit()).toMatchObject({
      action: "New submission",
      reference: sub.ackNo,
      detail: "Ogun Mini-Grid Ltd - Category E - Form REG-01E",
    });
    const second = await createSubmission(
      db,
      registry,
      intake({ cacNo: "RC999", registeredName: "Second Ltd" }),
    );
    expect(second.ackNo).toBe("OGSERC/ACK/2026/00002");
  });

  it("records an evaluating officer chosen at intake; the evaluation starts on release (§4.12)", async () => {
    const sub = await createSubmission(db, registry, intake({ evaluatingOfficerId: evaluator.id }));
    const ev = await db.evaluation.findUniqueOrThrow({ where: { submissionId: sub.id } });
    expect(ev.evaluatingOfficerId).toBe(evaluator.id);
    expect(ev.dateEvaluationStarted).toBeNull();
    await recordPayment(db, registry, {
      dateReceived: "2026-10-22",
      reference: sub.ackNo,
      purpose: "",
      channel: "",
      amount: "250000",
      rrr: "",
    });
    await confirmPayments(db, sub.ackNo);
    expect(
      (await db.evaluation.findUniqueOrThrow({ where: { submissionId: sub.id } }))
        .dateEvaluationStarted,
    ).not.toBeNull();
    await expect(
      createSubmission(db, registry, intake({ cacNo: "", evaluatingOfficerId: finance.id })),
    ).rejects.toMatchObject({
      fieldErrors: { evaluatingOfficerId: expect.any(Array) },
    });
  });

  it("asks for confirmation on a CAC number already on the Register (para 11(4))", async () => {
    await createSubmission(db, registry, intake());
    const err = await createSubmission(db, registry, intake({ registeredName: "Other" })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ConfirmationRequiredError);
    expect(err.message).toContain("OGSERC/ACK/2026/00001");
    const confirmed = await createSubmission(db, registry, intake({ registeredName: "Other" }), {
      confirmDuplicateCac: true,
    });
    expect((await lastAudit()).detail).toContain("duplicate CAC confirmed");
    expect(confirmed.ackNo).toBe("OGSERC/ACK/2026/00002");
  });

  it("validates formats, lists, dates and the override reason", async () => {
    const err = await createSubmission(
      db,
      registry,
      intake({
        cacNo: "123",
        phone: "12345",
        email: "x@",
        operatingOnEffectiveDate: "N",
        plannedStartDate: "",
      }),
    ).catch((e) => e);
    expect(Object.keys(err.fieldErrors).sort()).toEqual([
      "cacNo",
      "email",
      "phone",
      "plannedStartDate",
    ]);

    const refErr = await createSubmission(
      db,
      registry,
      intake({
        principalLga: "Lagos Island",
        primaryActivityCode: "XXX",
        dateSubmitted: "2099-01-01",
      }),
    ).catch((e) => e);
    expect(Object.keys(refErr.fieldErrors).sort()).toEqual([
      "dateSubmitted",
      "primaryActivityCode",
      "principalLga",
    ]);

    await expect(
      createSubmission(db, registry, intake({ categoryOverride: "G" })),
    ).rejects.toMatchObject({
      fieldErrors: { overrideReason: ["Give a reason for overriding Category E"] },
    });
    await expect(
      createSubmission(db, registry, intake({ categoryOverride: "I", overrideReason: "x" })),
    ).rejects.toMatchObject({
      fieldErrors: { categoryOverride: expect.any(Array) },
    });
    const overridden = await createSubmission(
      db,
      registry,
      intake({ categoryOverride: "G", overrideReason: "Estate network, board decision" }),
    );
    expect(overridden.pricedCategory).toBe("G");
  });

  it("is refused to roles without intake", async () => {
    await expect(createSubmission(db, finance, intake())).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.submission.count()).toBe(0);
  });
});

describe("updateSubmission", () => {
  it("records each change and leaves pricing to an admin", async () => {
    const sub = await createSubmission(db, registry, intake());
    await updateSubmission(
      db,
      registry,
      sub.id,
      intake({ installedCapacityMw: "12", primaryActivityCode: "GEN" }),
    );
    expect((await lastAudit()).detail).toBe("primary activity: MGD → GEN; capacity (MW): 2.5 → 12");
    const detail = await getSubmissionDetail(db, sub.id);
    expect(detail!.assessment.categoryApplied).toBe("E");
    expect(detail!.flags.map((f) => f.code)).toContain("PRICING_OUT_OF_DATE");
  });

  it("is refused to roles without editing; closed submissions are Admin-only, with a reason", async () => {
    const sub = await createSubmission(db, registry, intake());
    await expect(updateSubmission(db, finance, sub.id, intake())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await asWorkflow(db, (tx) =>
      tx.submission.update({ where: { id: sub.id }, data: { status: "REFUSED" } }),
    );
    await expect(
      updateSubmission(db, registry, sub.id, intake({ remarks: "late note" })),
    ).rejects.toThrow(/Only an administrator/);
    await expect(
      updateSubmission(db, admin, sub.id, intake({ remarks: "late note" })),
    ).rejects.toMatchObject({ fieldErrors: { changeReason: expect.any(Array) } });
    await updateSubmission(db, admin, sub.id, intake({ remarks: "late note" }), {
      changeReason: "Applicant letter of 1 Nov",
    });
    expect((await lastAudit()).detail).toBe(
      "remarks: (blank) → late note. Reason: Applicant letter of 1 Nov",
    );
    await expect(
      updateDocuments(db, registry, sub.id, { incorporation: "Y" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await updateDocuments(
      db,
      admin,
      sub.id,
      { incorporation: "Y" },
      { changeReason: "Found in post room" },
    );
    expect((await lastAudit()).detail).toContain("Reason: Found in post room");
  });

  it("ignores status and decision fields sent with an edit", async () => {
    const sub = await createSubmission(db, registry, intake());
    await updateSubmission(db, registry, sub.id, {
      ...intake({ remarks: "x" }),
      status: "REGISTERED",
      registrationNo: "OGSERC/REG/2026/E-MGD/0001",
    });
    expect(await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      status: "AWAITING_PAYMENT",
      registrationNo: null,
    });
  });
});

describe("documents checklist", () => {
  it("saves Y / N / N/A / blank and audits each change", async () => {
    const sub = await createSubmission(db, registry, intake());
    // REG-01E's list, by shared document key.
    await updateDocuments(db, registry, sub.id, {
      incorporation: "Y",
      constitution: "N",
      community_consent: "N/A",
    });
    await updateDocuments(db, registry, sub.id, {
      incorporation: "Y",
      constitution: "",
      licences: "Y",
    });
    const items = await db.documentChecklistItem.findMany({
      where: { submissionId: sub.id },
      orderBy: { documentKey: "asc" },
    });
    expect(items.map((i) => [i.documentKey, i.value])).toEqual([
      ["community_consent", "NA"],
      ["incorporation", "Y"],
      ["licences", "Y"],
    ]);
    expect((await lastAudit()).detail).toBe(
      "Constitutional documents (or equivalent): N → blank; Copy of every NERC or OGSERC permit or registration, by site: blank → Y",
    );
  });
});

describe("waiver (para 17(3))", () => {
  it("Finance or Admin only, with a reason, capped at the fee", async () => {
    const sub = await createSubmission(db, registry, intake());
    await expect(
      setWaiver(db, registry, sub.id, { amount: "50,000", reason: "Letter ref 12" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setWaiver(db, finance, sub.id, { amount: "300,000", reason: "Letter ref 12" }),
    ).rejects.toMatchObject({
      fieldErrors: { amount: ["Cannot exceed ₦250,000"] },
    });
    await setWaiver(db, finance, sub.id, {
      amount: "50,000",
      reason: "Commission letter OGSERC/W/12",
    });
    expect(await lastAudit()).toMatchObject({
      action: "Waiver set",
      detail: "₦0 → ₦50,000. Reason: Commission letter OGSERC/W/12",
    });
    expect((await getSubmissionDetail(db, sub.id))!.assessment.fees.totalDue).toBe(naira(200_000));
  });
});

describe("payments (§4.2)", () => {
  const pay = (o: Record<string, string> = {}) => ({
    dateReceived: "2026-10-22",
    reference: "OGSERC/ACK/2026/00001",
    purpose: "Registration fee",
    channel: "Remita",
    amount: "250,000",
    rrr: "RRR-1",
    ...o,
  });

  it("records against an Ack No., numbers it and audits; Paid once Finance confirms it", async () => {
    const sub = await createSubmission(db, registry, intake());
    const p = await recordPayment(db, registry, pay({ reference: "ogserc/ack/2026/00001" }));
    expect(p).toMatchObject({
      paymentNo: "OGSERC/PAY/2026/00001",
      submissionId: sub.id,
      amount: BigInt(naira(250_000)),
    });
    expect(await lastAudit()).toMatchObject({
      action: "Payment recorded",
      reference: sub.ackNo,
      detail: "₦250,000 - ref RRR-1 - OGSERC/PAY/2026/00001",
    });
    expect(p.financeStatus).toBe("PENDING");
    expect((await getSubmissionDetail(db, sub.id))!.assessment.fees.paymentStatus).toBe("Unpaid");
    await confirmPayments(db, sub.ackNo);
    expect((await getSubmissionDetail(db, sub.id))!.assessment.fees.paymentStatus).toBe("Paid");
  });

  it("rejects an unknown reference and asks before a duplicate RRR", async () => {
    await createSubmission(db, registry, intake());
    await expect(
      recordPayment(db, registry, pay({ reference: "OGSERC/ACK/2026/09999" })),
    ).rejects.toMatchObject({
      fieldErrors: { reference: expect.any(Array) },
    });
    await recordPayment(db, registry, pay());
    await expect(recordPayment(db, registry, pay({ rrr: "rrr-1" }))).rejects.toBeInstanceOf(
      ConfirmationRequiredError,
    );
    await recordPayment(db, registry, pay({ rrr: "rrr-1" }), { confirmDuplicateRrr: true });
    expect(await db.payment.count()).toBe(2);
  });
});

describe("own-use notifications (§4.3, Form REG-01I)", () => {
  /** Generator units as the form posts them: a JSON table. */
  const units = (...kw: number[]) =>
    JSON.stringify(
      kw.map((k, i) => ({
        makeModel: `Gen ${i + 1}`,
        capacityKw: String(k),
        fuel: "Gas",
        avgMonthlyMwh: "60",
      })),
    );
  const oun = (o: Record<string, string> = {}) => ({
    name: "Ifo Packaging Ltd",
    dateFiled: "2026-10-22",
    cacNo: "RC777",
    siteAddress: "Km 5 Ifo Road",
    lga: "Ifo",
    natureOfBusiness: "Packaging",
    gridConnected: "Y",
    distributionLicensee: "Ibadan DisCo",
    units: units(400, 250),
    contactPerson: "A. Bello",
    phone: "08012345678",
    email: "ops@ifo.ng",
    ...o,
  });

  it("650 kW: notification required, Category I fee snapshotted, numbered and audited", async () => {
    const row = await createOwnUse(db, registry, oun());
    expect(row).toMatchObject({
      ounNo: "OGSERC/OUN/2026/0001",
      pricedFee: BigInt(naira(100_000)),
      pricedThresholdKw: 200,
    });
    expect((await lastAudit()).detail).toBe(
      "Ifo Packaging Ltd - Form REG-01I - 650 kW (2 unit(s)) - Notification required - fee ₦100,000",
    );
    expect(await db.ownUseUnit.count({ where: { ownUseNotificationId: row.id } })).toBe(2);
    const [listed] = await listOwnUse(db);
    expect(listed!.assessment).toMatchObject({ feeDue: naira(100_000), paymentStatus: "Unpaid" });
    expect(listed!.assessment.flags.map((f) => f.code)).toEqual(["FEE_UNPAID"]);

    await recordPayment(db, finance, {
      dateReceived: "2026-10-22",
      reference: row.ounNo,
      purpose: "",
      channel: "",
      amount: "100000",
      rrr: "",
    });
    // Pending with Finance: not yet paid (§4.12).
    expect((await listOwnUse(db))[0]!.assessment.paymentStatus).toBe("Unpaid");
    await confirmPayments(db, row.ounNo);
    const [paid] = await listOwnUse(db);
    expect(paid!.assessment.paymentStatus).toBe("Paid");
  });

  it("150 kW in total needs confirmation; 1,200 kW in total is refused", async () => {
    await expect(
      createOwnUse(db, registry, oun({ units: units(100, 50), siteAddress: "Site A" })),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);
    const small = await createOwnUse(
      db,
      registry,
      oun({ units: units(100, 50), siteAddress: "Site A" }),
      { confirmBelowThreshold: true },
    );
    expect(small.pricedFee).toBe(0n);
    await expect(createOwnUse(db, registry, oun({ units: units(700, 500) }))).rejects.toMatchObject(
      {
        fieldErrors: { units: [expect.stringContaining("para 3(3)(c)")] },
      },
    );
    await expect(createOwnUse(db, registry, oun({ units: "[]" }))).rejects.toMatchObject({
      fieldErrors: { units: ["Add at least one generator unit"] },
    });
  });

  it("warns on a second notification for the same CAC number and site, not another site", async () => {
    await createOwnUse(db, registry, oun());
    await expect(createOwnUse(db, registry, oun())).rejects.toMatchObject({
      field: "confirmSameSite",
    });
    await createOwnUse(db, registry, oun({ siteAddress: "Plot 9 Sagamu Road" }));
    await createOwnUse(db, registry, oun(), { confirmSameSite: true });
    const flags = (await listOwnUse(db)).map((o) => o.assessment.flags.map((f) => f.code));
    expect(flags.filter((f) => f.includes("DUPLICATE_SITE"))).toHaveLength(2);
    expect(flags.flat()).not.toContain("DUPLICATE_CAC");
  });

  it("keeps its fee when the fee table changes, until an admin recalculates", async () => {
    const row = await createOwnUse(db, registry, oun());
    await db.feeCategory.update({
      where: { category: "I" },
      data: { registrationFee: BigInt(naira(150_000)) },
    });
    const [stale] = await listOwnUse(db);
    expect(stale!.assessment.feeDue).toBe(naira(100_000));
    expect(stale!.assessment.flags.map((f) => f.code)).toContain("PRICING_OUT_OF_DATE");
    await expect(
      db.ownUseNotification.update({ where: { id: row.id }, data: { pricedFee: 1n } }),
    ).rejects.toThrow(/admin recalculation/);
    await expect(
      recalculateOwnUsePricing(db, registry, row.id, { reason: "new fees" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await recalculateOwnUsePricing(db, admin, row.id, { reason: "Schedule 3 revised" });
    const [fresh] = await listOwnUse(db);
    expect(fresh!.assessment.feeDue).toBe(naira(150_000));
    expect((await lastAudit()).detail).toBe("fee ₦100,000 → ₦150,000. Reason: Schedule 3 revised");
  });

  it("edits are audited and flag a CAC already on the Register", async () => {
    await createSubmission(db, registry, intake({ cacNo: "RC777" }));
    const row = await createOwnUse(db, registry, oun());
    await updateOwnUse(db, registry, row.id, oun({ units: units(400, 300) }));
    expect((await lastAudit()).detail).toBe(
      "generator units: Gen 1, 400 kW, Gas, 60 MWh/month; Gen 2, 250 kW, Gas, 60 MWh/month → Gen 1, 400 kW, Gas, 60 MWh/month; Gen 2, 300 kW, Gas, 60 MWh/month",
    );
    const [listed] = await listOwnUse(db);
    expect(listed!.assessment.flags.map((f) => f.code)).toContain("CAC_ON_REGISTER");
  });
});

describe("bulk recalculation", () => {
  it("re-prices ticked submissions with one reason, auditing each, skipping registered ones", async () => {
    const a = await createSubmission(db, registry, intake({ cacNo: "RC1" }));
    const b = await createSubmission(
      db,
      registry,
      intake({ cacNo: "RC2", primaryActivityCode: "EST" }),
    );
    const c = await createSubmission(db, registry, intake({ cacNo: "RC3" }));
    await asWorkflow(db, (tx) =>
      tx.submission.update({
        where: { id: c.id },
        data: { registrationNo: "OGSERC/REG/2026/E-MGD/0001" },
      }),
    );
    await db.settings.update({
      where: { id: 1 },
      data: { effectiveDate: new Date("2026-11-15T00:00:00Z") },
    });

    const result = await recalculatePricingBulk(db, admin, [a.id, b.id, c.id], {
      reason: "Gazetted Effective Date",
    });
    expect(result.changed.sort()).toEqual([a.ackNo, b.ackNo].sort());
    expect(result.skipped).toEqual([{ ackNo: c.ackNo, reason: expect.stringContaining("locked") }]);
    const entries = await db.auditLog.findMany({ where: { action: "Pricing recalculated" } });
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.detail).toContain("Reason: Gazetted Effective Date");

    await expect(
      recalculatePricingBulk(db, registry, [a.id], { reason: "nope nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      recalculatePricingBulk(db, admin, [], { reason: "nothing ticked" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Register list", () => {
  it("searches and filters on stored and calculated fields", async () => {
    await createSubmission(db, registry, intake({ cacNo: "RC1", registeredName: "Alpha Power" }));
    await createSubmission(
      db,
      registry,
      intake({
        cacNo: "RC2",
        registeredName: "Beta Grid",
        primaryActivityCode: "EST",
        formFiled: "REG-01G",
      }),
    );
    await recordPayment(db, finance, {
      dateReceived: "2026-10-22",
      reference: "OGSERC/ACK/2026/00001",
      purpose: "",
      channel: "",
      amount: "250000",
      rrr: "",
    });
    await confirmPayments(db, "OGSERC/ACK/2026/00001");
    const names = async (f: Parameters<typeof listRegister>[1]) =>
      (await listRegister(db, f, "2026-10-25")).map((r) => r.registeredName);

    expect(await names({})).toEqual(["Beta Grid", "Alpha Power"]);
    expect(await names({ q: "alpha" })).toEqual(["Alpha Power"]);
    expect(await names({ q: "ack/2026/00002" })).toEqual(["Beta Grid"]);
    expect(await names({ category: "G" })).toEqual(["Beta Grid"]);
    expect(await names({ payment: "Paid" })).toEqual(["Alpha Power"]);
    expect(await names({ payment: "Unpaid" })).toEqual(["Beta Grid"]);
    expect(await names({ flagged: true })).toEqual([]);
    expect(await names({ form: "REG-01G" })).toEqual(["Beta Grid"]);
    expect(await names({ filing: "NEW" })).toEqual(["Beta Grid", "Alpha Power"]);
    expect(await names({ filing: "UPDATE" })).toEqual([]);
  });
});

describe("change-password lockout", () => {
  it("counts wrong current passwords; the fifth locks the account and ends every session", async () => {
    const me = await makeUser(db, ["VIEWER"], { password: "my real password" });
    const expires = new Date(Date.now() + 3_600_000);
    await db.session.createMany({
      data: [
        { tokenHash: hashSessionToken("a"), userId: me.id, expires },
        { tokenHash: hashSessionToken("b"), userId: me.id, expires },
      ],
    });
    const attempt = () =>
      changeOwnPassword(db, me, "a", {
        currentPassword: "guess",
        newPassword: "new password 1",
        confirmPassword: "new password 1",
      });
    for (let i = 0; i < 4; i++)
      await expect(attempt()).rejects.toThrow("Current password is incorrect.");
    expect(await db.session.count({ where: { userId: me.id } })).toBe(2);
    await expect(attempt()).rejects.toThrow(/locked and signed out/);
    expect(await db.session.count({ where: { userId: me.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).lockedUntil).not.toBeNull();
    expect((await lastAudit()).detail).toContain("change-password form");
  });
});
