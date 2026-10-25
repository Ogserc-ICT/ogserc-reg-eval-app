// Category forms REG-01A to K, part 1 (common core and documents), through the services.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadContext } from "@/server/context";
import {
  BlockedError,
  ConfirmationRequiredError,
  ForbiddenError,
  ValidationError,
} from "@/server/errors";
import { loadEvaluationState } from "@/server/evaluation-state";
import { createSubmission, updateDocuments, updateSubmission } from "@/server/intake";
import {
  createOwnUse,
  getOwnUseDetail,
  registerOwnUse,
  updateOwnUseDocuments,
} from "@/server/own-use";
import { recordPayment } from "@/server/payments";
import { getSubmissionDetail } from "@/server/register";
import { updateSettings } from "@/server/settings";
import { settingsFromRow } from "@/server/reference-data";
import type { Actor } from "@/server/types";
import {
  approveAndRegister,
  assignOfficers,
  confirmCategory,
  markSubmissionComplete,
  saveChecks,
} from "@/server/workflow";
import { getOwnUseVerification } from "@/server/verify";
import {
  confirmPayments,
  formDocuments,
  makeUser,
  resetDb,
  testDb,
  technicalAnswers,
} from "./helpers";

const db = testDb();

/** REG-01E's category-specific sections answered, at each capacity these tests use. */
const TECHNICAL: Record<string, string> = {
  "2.5": technicalAnswers("REG-01E", 2.5),
};
afterAll(() => db.$disconnect());

const TODAY = "2026-10-22";
let registry: Actor, evaluator: Actor, supervisor: Actor, approver: Actor, admin: Actor;
let seq = 0;

beforeEach(async () => {
  await resetDb(db);
  registry = await makeUser(db, ["REGISTRY_OFFICER"]);
  evaluator = await makeUser(db, ["EVALUATING_OFFICER"]);
  supervisor = await makeUser(db, ["REVIEWING_SUPERVISOR"]);
  approver = await makeUser(db, ["APPROVING_OFFICER"]);
  admin = await makeUser(db, ["ADMIN"]);
  await db.settings.update({
    where: { id: 1 },
    data: { chairmanName: "Engr. A. Chair", commissionerName: "Barr. B. Commissioner" },
  });
});

const audits = (action: string) =>
  db.auditLog.findMany({ where: { action }, orderBy: { id: "asc" } });

/** The intake form's fields as posted (tables and multi-selects as JSON or arrays). */
const intake = (o: Record<string, unknown> = {}) => {
  seq++;
  return {
    filingType: "NEW",
    formFiled: "REG-01E",
    technicalData: TECHNICAL["2.5"],
    linkedRegistrationNo: "",
    registeredName: `Registrant ${seq} Ltd`,
    dateSubmitted: TODAY,
    submissionChannel: "By hand",
    registrantType: "Company",
    cacNo: `RC${500 + seq}`,
    tin: "",
    address: "1 Example Road",
    principalLga: "Ifo",
    otherAreasServed: "",
    primaryActivityCode: "MGD",
    installedCapacityMw: "2.5",
    customers: "",
    licenceStatus: "NERC registration/permit (mini-grid/captive)",
    licences: JSON.stringify([
      { type: "Mini-grid permit", number: "NERC/MG/9", expiryDate: "2028-01-31" },
    ]),
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
  };
};

const pay = async (reference: string, amount: string) => {
  await recordPayment(db, registry, {
    dateReceived: TODAY,
    reference,
    purpose: "",
    channel: "",
    amount,
    rrr: "",
  });
  await confirmPayments(db, reference, TODAY);
};

const assignAll = (id: string) =>
  assignOfficers(
    db,
    supervisor,
    id,
    {
      evaluatingOfficerId: evaluator.id,
      reviewingSupervisorId: supervisor.id,
      approvingOfficerId: approver.id,
    },
    { today: TODAY },
  );

const state = async (id: string) =>
  (await loadEvaluationState(db, id, await loadContext(db, TODAY)))!;

/** Fee confirmed, documents in, officers assigned, category confirmed, every check Y. */
async function ready(id: string, ackNo: string, fee = "250000", form = "REG-01E") {
  await updateDocuments(db, registry, id, formDocuments(form));
  if (fee) await pay(ackNo, fee);
  await assignAll(id);
  const row = await db.submission.findUniqueOrThrow({ where: { id } });
  await confirmCategory(
    db,
    evaluator,
    id,
    { category: row.formFiled.slice(-1), reason: "" },
    { today: TODAY },
  );
  const s = await state(id);
  const values = Object.fromEntries(
    s.checks.filter((c) => c.mode === "manual" && !c.postApproval).map((c) => [c.id, "Y"]),
  );
  await saveChecks(db, evaluator, id, { values, remarks: "" }, { today: TODAY });
  await markSubmissionComplete(db, evaluator, id, { today: TODAY });
}

describe("intake on Forms REG-01A to K", () => {
  it("requires the form filed and filing type, and refuses REG-01I", async () => {
    await expect(createSubmission(db, registry, intake({ formFiled: "" }))).rejects.toMatchObject({
      fieldErrors: { formFiled: ["Choose the form filed (REG-01A to REG-01K)"] },
    });
    await expect(
      createSubmission(db, registry, intake({ formFiled: "REG-01I" })),
    ).rejects.toMatchObject({
      fieldErrors: { formFiled: [expect.stringContaining("own-use notification")] },
    });
    await expect(createSubmission(db, registry, intake({ filingType: "" }))).rejects.toMatchObject({
      fieldErrors: { filingType: ["Choose the filing type"] },
    });
  });

  it("saves the common sections and tables, and highest applies across every other activity", async () => {
    const sub = await createSubmission(
      db,
      registry,
      intake({
        formFiled: "REG-01G",
        tradingName: "Sunrise Power",
        incorporationDate: "2019-04-01",
        operationalAddress: "Plot 4, Ifo",
        website: "https://sunrise.ng",
        lgasServed: JSON.stringify(["Ifo", "Ewekoro"]),
        otherActivityCodes: JSON.stringify(["MET", "EST"]),
        shareholders: JSON.stringify([
          { name: "A. Bello", nationality: "Nigeria", percentHolding: "60", beneficialOwner: "Y" },
          { name: "", nationality: "", percentHolding: "", beneficialOwner: "" },
        ]),
        directors: JSON.stringify([
          { name: "C. Okafor", position: "MD", phone: "08012345678", email: "" },
        ]),
        mdName: "C. Okafor",
        confidentialityClaims: JSON.stringify([{ item: "Tariff model", reasons: "Commercial" }]),
        hseIncidents: JSON.stringify([
          {
            date: "2026-03-01",
            location: "Ifo",
            type: "Outage over 24 h",
            description: "Feeder fault",
          },
        ]),
        signatory1Name: "C. Okafor",
        signatory1Designation: "Director",
        interconnectedMinigrid: "N",
      }),
    );
    expect(sub).toMatchObject({
      formFiled: "REG-01G",
      pricedCategory: "G",
      lgasServed: ["Ifo", "Ewekoro"],
    });
    const d = (await getSubmissionDetail(db, sub.id, TODAY))!;
    expect(d.details.shareholders).toHaveLength(1); // the blank row is dropped
    expect(d.details.otherActivities.map((a) => a.activityCode)).toEqual(["MET", "EST"]);
    expect(d.details.licences.map((l) => l.number)).toEqual(["NERC/MG/9"]);
    expect(d.assessment.nearestLicenceExpiry).toBe("2028-01-31");
    expect(d.details.hseIncidents[0]).toMatchObject({ type: "Outage over 24 h" });
    // REG-01G's list; the form and the calculated category agree, so no mismatch flag.
    expect(d.assessment.documentsForm).toBe("REG-01G");
    expect(d.flags.map((f) => f.code)).not.toContain("FORM_CATEGORY_MISMATCH");
  });

  it("reports table rows by number, and LGAs and activities not on the lists", async () => {
    await expect(
      createSubmission(
        db,
        registry,
        intake({
          licences: JSON.stringify([{ number: "A" }, { number: "B", expiryDate: "31/01/2028" }]),
          lgasServed: JSON.stringify(["Atlantis"]),
        }),
      ),
    ).rejects.toMatchObject({
      fieldErrors: { licences: ["Row 2: Expiry date: enter a valid date (YYYY-MM-DD)"] },
    });
    await expect(
      createSubmission(
        db,
        registry,
        intake({ lgasServed: ["Atlantis"], otherActivityCodes: ["XYZ"] }),
      ),
    ).rejects.toMatchObject({
      fieldErrors: {
        lgasServed: ["Not in the LGA list: Atlantis"],
        otherActivityCodes: ["Not in the activities list: XYZ"],
      },
    });
  });

  it("audits edits of tables with their old and new values", async () => {
    const sub = await createSubmission(db, registry, intake());
    await updateSubmission(
      db,
      registry,
      sub.id,
      intake({
        registeredName: sub.registeredName,
        cacNo: sub.cacNo,
        licences: JSON.stringify([{ type: "Mini-grid permit", number: "NERC/MG/10" }]),
      }),
    );
    const [entry] = await audits("Submission updated");
    expect(entry!.detail).toBe(
      "licences: Mini-grid permit, No. NERC/MG/9, expires 31 January 2028 → Mini-grid permit, No. NERC/MG/10",
    );
  });
});

describe("documents of the form filed", () => {
  it("ticks evidence of payment once Finance confirms the fee, and it cannot be set by hand", async () => {
    const sub = await createSubmission(db, registry, intake());
    await expect(updateDocuments(db, registry, sub.id, { payment_evidence: "Y" })).rejects.toThrow(
      /set automatically/,
    );
    await expect(
      updateDocuments(db, registry, sub.id, { nemsa_accreditation: "Y" }),
    ).rejects.toThrow(/not on this submission's checklist/);
    const evidence = async () =>
      (await getSubmissionDetail(db, sub.id, TODAY))!.documents.find(
        (d) => d.key === "payment_evidence",
      );
    expect((await evidence())?.value).toBeNull();
    await recordPayment(db, registry, {
      dateReceived: TODAY,
      reference: sub.ackNo,
      purpose: "",
      channel: "",
      amount: "250000",
      rrr: "",
    });
    expect((await evidence())?.value).toBeNull(); // still with Finance
    await confirmPayments(db, sub.ackNo, TODAY);
    expect((await evidence())?.value).toBe("Y");
  });

  it("makes a conditional item N/A when its condition is No", async () => {
    const sub = await createSubmission(db, registry, intake({ interconnectedMinigrid: "N" }));
    const item = (await getSubmissionDetail(db, sub.id, TODAY))!.documents.find(
      (d) => d.key === "interconnection_agreement",
    );
    expect(item).toMatchObject({ value: "N/A", mode: "auto-na" });
    await expect(
      updateDocuments(db, registry, sub.id, { interconnection_agreement: "Y" }),
    ).rejects.toThrow(/set automatically/);
  });

  it("completeness needs the whole REG-01E list as well as the confirmed fee (Finance gate)", async () => {
    const sub = await createSubmission(db, registry, intake());
    await pay(sub.ackNo, "250000");
    await assignAll(sub.id);
    await expect(
      markSubmissionComplete(db, evaluator, sub.id, { today: TODAY }),
    ).rejects.toBeInstanceOf(BlockedError);
    await updateDocuments(db, registry, sub.id, formDocuments());
    const r = await markSubmissionComplete(db, evaluator, sub.id, { today: TODAY });
    expect(r.changed).toBe(true);
  });
});

describe("Category confirmed (check 1.10)", () => {
  it("is for the assigned evaluator or a supervisor, after Finance confirmation, and audited", async () => {
    const sub = await createSubmission(db, registry, intake());
    await expect(
      confirmCategory(db, evaluator, sub.id, { category: "E", reason: "" }, { today: TODAY }),
    ).rejects.toBeInstanceOf(BlockedError); // payment not yet confirmed
    await pay(sub.ackNo, "250000");
    await assignAll(sub.id);
    const other = await makeUser(db, ["EVALUATING_OFFICER"]);
    await expect(
      confirmCategory(db, other, sub.id, { category: "E", reason: "" }, { today: TODAY }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await state(sub.id)).checks.find((c) => c.id === "1.10")?.value).toBeNull();
    await confirmCategory(db, evaluator, sub.id, { category: "E", reason: "" }, { today: TODAY });
    expect((await state(sub.id)).checks.find((c) => c.id === "1.10")?.value).toBe("Y");
    expect((await audits("Category confirmed"))[0]!.detail).toBe(
      "Category E confirmed (form filed REG-01E)",
    );
  });

  it("needs a reason when it differs from the form; the re-categorised form's documents then apply", async () => {
    // A 5 MW generator filed on the "below 1 MW" form K.
    const sub = await createSubmission(
      db,
      registry,
      intake({ formFiled: "REG-01K", primaryActivityCode: "GEN", installedCapacityMw: "5" }),
    );
    await pay(sub.ackNo, "300000");
    await assignAll(sub.id);
    expect((await state(sub.id)).flags.map((f) => f.code)).toContain("FORM_CATEGORY_MISMATCH");
    await expect(
      confirmCategory(db, evaluator, sub.id, { category: "D", reason: "" }, { today: TODAY }),
    ).rejects.toBeInstanceOf(ValidationError);
    await confirmCategory(
      db,
      evaluator,
      sub.id,
      { category: "D", reason: "5 MW plant" },
      { today: TODAY },
    );
    const s = await state(sub.id);
    expect(s.checks.find((c) => c.id === "1.10")?.value).toBe("Y");
    expect(s.flags.map((f) => f.code)).not.toContain("FORM_CATEGORY_MISMATCH");
    expect(s.assessment.documentsForm).toBe("REG-01D");
    expect((await audits("Category confirmed"))[0]!.detail).toBe(
      "Category D confirmed (form filed REG-01K); accepted and re-categorised: 5 MW plant; documents now follow REG-01D",
    );
  });

  it("does not change the fee: a different confirmed category is flagged for recalculation", async () => {
    const sub = await createSubmission(db, registry, intake());
    await pay(sub.ackNo, "250000");
    await assignAll(sub.id);
    await confirmCategory(
      db,
      evaluator,
      sub.id,
      { category: "G", reason: "Estate network really" },
      { today: TODAY },
    );
    const s = await state(sub.id);
    expect(s.assessment.categoryApplied).toBe("E");
    expect(s.flags.map((f) => f.code)).toContain("CONFIRMED_CATEGORY_NOT_CHARGED");
  });
});

describe("updates and annual confirmations", () => {
  async function registered() {
    const sub = await createSubmission(
      db,
      registry,
      intake({ registeredName: "Sunrise Ltd", cacNo: "RC4242" }),
    );
    await ready(sub.id, sub.ackNo);
    const r = await approveAndRegister(
      db,
      approver,
      sub.id,
      { flagOverrideReason: "" },
      { today: TODAY },
    );
    return { ...sub, registrationNo: r.registrationNo };
  }

  it("must quote the registration number of a Registered record", async () => {
    await expect(
      createSubmission(db, registry, intake({ filingType: "UPDATE" })),
    ).rejects.toMatchObject({
      fieldErrors: { linkedRegistrationNo: [expect.stringContaining("registration number")] },
    });
    await expect(
      createSubmission(
        db,
        registry,
        intake({ filingType: "UPDATE", linkedRegistrationNo: "OGSERC/REG/2026/E-MGD/0099" }),
        { today: TODAY },
      ),
    ).rejects.toMatchObject({
      fieldErrors: {
        linkedRegistrationNo: ["No registered submission has this registration number"],
      },
    });
  });

  it("an update has no fee, is released at once, and changes the registration only when approved", async () => {
    const reg = await registered();
    const update = await createSubmission(
      db,
      registry,
      intake({
        filingType: "UPDATE",
        linkedRegistrationNo: reg.registrationNo,
        registeredName: "Sunrise Energy Ltd",
        cacNo: "RC4242", // the registration's own CAC number: not a duplicate
        address: "9 New Road, Ifo",
      }),
      { today: TODAY },
    );
    expect(update).toMatchObject({
      status: "AWAITING_PAYMENT",
      pricedRegistrationFee: 0n,
      pricedDeadline: null,
      linkedSubmissionId: reg.id,
    });
    expect((await db.submission.findUniqueOrThrow({ where: { id: update.id } })).status).toBe(
      "RECEIVED",
    );
    expect((await audits("Released for evaluation")).at(-1)!.detail).toContain("nothing to pay");
    expect((await audits("Update: material change (para 16(1)) filed"))[0]!.reference).toBe(
      reg.ackNo,
    );

    const pending = (await getSubmissionDetail(db, update.id, TODAY))!;
    expect(pending.filingChanges?.map((c) => [c.label, c.before, c.after])).toEqual([
      ["registered name", "Sunrise Ltd", "Sunrise Energy Ltd"],
      ["registered address", "1 Example Road", "9 New Road, Ifo"],
    ]);
    expect(pending.flags.map((f) => f.code)).not.toContain("DUPLICATE_CAC");
    // The registered record is not touched yet.
    expect((await db.submission.findUniqueOrThrow({ where: { id: reg.id } })).registeredName).toBe(
      "Sunrise Ltd",
    );

    await ready(update.id, update.ackNo, "");
    const r = await approveAndRegister(
      db,
      approver,
      update.id,
      { flagOverrideReason: "" },
      { today: TODAY },
    );
    expect(r).toMatchObject({ registrationNo: reg.registrationNo });
    const after = await db.submission.findUniqueOrThrow({ where: { id: reg.id } });
    expect(after).toMatchObject({
      registeredName: "Sunrise Energy Ltd",
      address: "9 New Road, Ifo",
      registrationNo: reg.registrationNo,
      certificateNeedsReissue: true,
    });
    const applied = await db.submission.findUniqueOrThrow({ where: { id: update.id } });
    expect(applied).toMatchObject({
      status: "APPLIED",
      registrationNo: null,
      certificateIssueDate: null,
    });
    const onRegistration = (await audits("Changes applied")).find(
      (a) => a.reference === reg.ackNo,
    )!;
    expect(onRegistration.detail).toBe(
      `Update: material change (para 16(1)) approved (${update.ackNo}) on 22 October 2026: registered name: Sunrise Ltd → Sunrise Energy Ltd; registered address: 1 Example Road → 9 New Road, Ifo; certificate needs reissue`,
    );
    expect(
      await db.generatedDocument.count({ where: { submissionId: update.id, kind: "CERTIFICATE" } }),
    ).toBe(0);
  });

  it("an annual confirmation with no changes is accepted and audited on the registration", async () => {
    const reg = await registered();
    const annual = await createSubmission(
      db,
      registry,
      intake({
        filingType: "ANNUAL",
        linkedRegistrationNo: reg.registrationNo,
        registeredName: "Sunrise Ltd",
        cacNo: "RC4242",
      }),
      { today: TODAY },
    );
    await ready(annual.id, annual.ackNo, "");
    await approveAndRegister(db, approver, annual.id, { flagOverrideReason: "" }, { today: TODAY });
    const [entry] = await audits("Annual confirmation accepted");
    expect(entry).toMatchObject({ reference: reg.ackNo });
    expect(entry!.detail).toContain("Annual confirmation 2026 accepted");
    expect(entry!.detail).toContain("no changes");
  });

  it("pay the registration fee when the setting says so", async () => {
    const reg = await registered();
    const row = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
    const s = settingsFromRow(row);
    await updateSettings(db, admin, {
      ...s,
      ...s.policy,
      feesRevisedOn: s.feesRevisedOn ?? "",
      tinPattern: s.policy.tinPattern ?? "",
      unpaidReminderDays: "",
      filingFeeOnUpdates: true,
    });
    expect((await audits("Settings updated")).at(-1)!.detail).toBe(
      "filingFeeOnUpdates: false → true",
    );
    const update = await createSubmission(
      db,
      registry,
      intake({ filingType: "UPDATE", linkedRegistrationNo: reg.registrationNo, cacNo: "RC4242" }),
      { today: TODAY },
    );
    expect(update.pricedRegistrationFee).toBe(25_000_000n);
    expect((await db.submission.findUniqueOrThrow({ where: { id: update.id } })).status).toBe(
      "AWAITING_PAYMENT",
    );
  });
});

describe("own-use (REG-01I) documents and certificate", () => {
  const oun = () => ({
    name: "Ifo Bottling Ltd",
    dateFiled: TODAY,
    cacNo: "RC9001",
    siteAddress: "Plot 2 Ifo",
    lga: "Ifo",
    natureOfBusiness: "",
    gridConnected: "",
    distributionLicensee: "",
    units: JSON.stringify([{ capacityKw: "400" }, { capacityKw: "250", fuel: "Diesel" }]),
    contactPerson: "",
    phone: "",
    email: "",
  });

  it("registers with an I-CPT number and a certificate only while the setting is on", async () => {
    const row = await createOwnUse(db, registry, oun());
    await updateOwnUseDocuments(db, registry, row.id, {
      incorporation: "Y",
      nameplate_photos: "Y",
    });
    await pay(row.ounNo, "100000");
    const d = (await getOwnUseDetail(db, row.id, TODAY))!;
    expect(d.assessment.documents.documentsComplete).toBe(true);

    await expect(
      registerOwnUse(db, approver, row.id, { flagOverrideReason: "" }, { today: TODAY }),
    ).rejects.toMatchObject({
      reasons: ["Own-use certificates are switched off in Settings"],
    });
    await db.settings.update({ where: { id: 1 }, data: { ownUseCertificate: true } });
    await expect(
      registerOwnUse(db, registry, row.id, { flagOverrideReason: "" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const r = await registerOwnUse(
      db,
      approver,
      row.id,
      { flagOverrideReason: "" },
      { today: TODAY },
    );
    expect(r.registrationNo).toBe("OGSERC/REG/2026/I-CPT/0001");
    expect(
      await db.generatedDocument.count({
        where: { ownUseNotificationId: row.id, kind: "CERTIFICATE" },
      }),
    ).toBe(1);
    const v = (await getOwnUseVerification(db, approver, row.id))!;
    expect(v).toMatchObject({ verdict: "current", registrationNo: r.registrationNo });
    // Locked once set.
    await expect(
      db.ownUseNotification.update({ where: { id: row.id }, data: { registrationNo: "X" } }),
    ).rejects.toThrow(/locked/);
    await expect(
      registerOwnUse(db, approver, row.id, { flagOverrideReason: "" }, { today: TODAY }),
    ).rejects.toBeInstanceOf(BlockedError);
  });

  it("warns about the same CAC number and site address", async () => {
    await createOwnUse(db, registry, oun());
    await expect(createOwnUse(db, registry, oun())).rejects.toBeInstanceOf(
      ConfirmationRequiredError,
    );
  });
});

describe("category-specific sections (part 2)", () => {
  /** REG-01D answers as the form posts them (text), for a 5 MW captive plant. */
  const captive = (installed = "5") =>
    JSON.stringify({
      "REG-01D": {
        notApplicable: ["operations"],
        sections: {
          generation_activity: { activity: ["captive"], total_mw: installed, cod: "2024" },
          generating_plant: { plant: [{ unit: "GT1", installed, fuel: "Gas" }] },
          grid_offtake: {
            network: "none",
            offtakers: [{ offtaker: "Own use", type: "own_use", contracted_mw: installed }],
          },
        },
      },
    });
  const gen = (o: Record<string, unknown> = {}) =>
    intake({
      formFiled: "REG-01D",
      primaryActivityCode: "GEN",
      installedCapacityMw: "5",
      technicalData: captive(),
      ...o,
    });

  it("stores the answers typed, and they decide the checklist and the flags", async () => {
    const sub = await createSubmission(db, registry, gen(), { today: TODAY });
    const stored = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(stored.technicalData).toMatchObject({
      "REG-01D": {
        notApplicable: ["operations"],
        sections: { generation_activity: { activity: ["captive"], total_mw: 5 } },
      },
    });
    const d = (await getSubmissionDetail(db, sub.id, TODAY))!;
    const item = (k: string) => d.documents.find((x) => x.key === k);
    // Captive only and not grid-connected: no offtake or connection agreement needed.
    expect(item("ppa_offtake")?.mode).toBe("auto-na");
    expect(item("connection_agreement")?.mode).toBe("auto-na");
    expect(d.assessment.technical.forms[0]!.outstanding).toEqual([]);
    expect(d.flags.map((f) => f.code)).not.toContain("TECHNICAL_INCOMPLETE");
  });

  it("refuses badly typed answers, saying where, and flags a capacity that does not match", async () => {
    await expect(
      createSubmission(db, registry, gen({ technicalData: captive("five") }), { today: TODAY }),
    ).rejects.toMatchObject({
      fieldErrors: {
        technicalData: expect.arrayContaining([
          "REG-01D Generating plant: Generating plant, row 1: Installed MW must be a number",
        ]),
      },
    });
    const sub = await createSubmission(db, registry, gen({ technicalData: captive("4") }), {
      today: TODAY,
    });
    const d = (await getSubmissionDetail(db, sub.id, TODAY))!;
    expect(d.flags.find((f) => f.code === "TECHNICAL_CAPACITY_MISMATCH")?.message).toContain(
      "Installed capacity is 5 MW",
    );
  });

  it("an approved update applies its changed answers to the registration", async () => {
    const reg = await createSubmission(db, registry, intake({ cacNo: "RC7070" }), { today: TODAY });
    await ready(reg.id, reg.ackNo);
    const { registrationNo } = await approveAndRegister(
      db,
      approver,
      reg.id,
      { flagOverrideReason: "" },
      { today: TODAY },
    );
    const before = (await db.submission.findUniqueOrThrow({ where: { id: reg.id } }))
      .technicalData as Record<string, { sections: Record<string, Record<string, unknown>> }>;
    const changed = structuredClone(before);
    changed["REG-01E"]!.sections.minigrid_type!.grant = "REA, ₦20m, 2025";
    const update = await createSubmission(
      db,
      registry,
      intake({
        filingType: "UPDATE",
        linkedRegistrationNo: registrationNo,
        registeredName: reg.registeredName,
        cacNo: "RC7070",
        technicalData: JSON.stringify(changed),
      }),
      { today: TODAY },
    );
    const pending = (await getSubmissionDetail(db, update.id, TODAY))!;
    expect(pending.filingChanges?.map((c) => [c.label, c.after])).toEqual([
      ["REG-01E Mini-grid type: Grant or subsidy programme, amount and year", "REA, ₦20m, 2025"],
    ]);
    await ready(update.id, update.ackNo, "");
    await approveAndRegister(db, approver, update.id, { flagOverrideReason: "" }, { today: TODAY });
    const after = (await db.submission.findUniqueOrThrow({ where: { id: reg.id } }))
      .technicalData as typeof before;
    expect(after["REG-01E"]!.sections.minigrid_type!.grant).toBe("REA, ₦20m, 2025");
  });

  it("audits each changed answer with its old and new value", async () => {
    const sub = await createSubmission(db, registry, gen(), { today: TODAY });
    await updateSubmission(
      db,
      registry,
      sub.id,
      gen({ registeredName: sub.registeredName, cacNo: sub.cacNo, technicalData: captive("5.5") }),
    );
    const [entry] = await audits("Submission updated");
    expect(entry!.detail).toContain(
      "REG-01D Generation activity: Total installed capacity at all sites (MW): 5 MW → 5.5 MW",
    );
    expect(entry!.detail).toContain(
      "REG-01D Generating plant: Generating plant: GT1, Gas, 5 MW → GT1, Gas, 5.5 MW",
    );
  });
});
