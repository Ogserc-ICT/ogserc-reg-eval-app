// Phase 5: generated PDFs — content, storage with SHA-256, versions, permissions and immutability.
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BlockedError, ForbiddenError, ValidationError } from "@/server/errors";
import {
  generateAcknowledgement,
  generateEvaluationForm,
  getDocumentForDownload,
  previewDeficiencyNotice,
  reissueCertificate,
} from "@/server/documents";
import { loadContext } from "@/server/context";
import { loadEvaluationState } from "@/server/evaluation-state";
import { createSubmission, updateDocuments, updateSubmission } from "@/server/intake";
import { recordPayment } from "@/server/payments";
import type { Actor } from "@/server/types";
import {
  approveAndRegister,
  assignOfficers,
  issueDeficiency,
  markSubmissionComplete,
  saveChecks,
} from "@/server/workflow";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { getVerification } from "@/server/verify";
import { pdfText, renderPage } from "../support/pdf";
import {
  confirmFormCategory,
  confirmPayments,
  formDocuments,
  makeUser,
  resetDb,
  testDb,
} from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());

const TODAY = "2026-10-22";
let registry: Actor, evaluator: Actor, supervisor: Actor, approver: Actor, admin: Actor;

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

const form = (o: Record<string, string> = {}) => ({
  registeredName: "Ogun Sunrise Mini-Grid Ltd",
  dateSubmitted: TODAY,
  submissionChannel: "By hand",
  registrantType: "Company",
  cacNo: "RC445566",
  tin: "",
  address: "1 Example Road, Abeokuta",
  principalLga: "Ifo",
  otherAreasServed: "Ewekoro",
  primaryActivityCode: "MGD",
  filingType: "NEW",
  formFiled: "REG-01E",
  installedCapacityMw: "2.5",
  customers: "",
  licenceStatus: "NERC registration/permit (mini-grid/captive)",
  licences: [{ number: "NERC/MG/77" }],
  complianceOfficer: "Jane Doe",
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

const newSubmission = (o: Record<string, string> = {}) => createSubmission(db, registry, form(o));

/** Fee recorded and confirmed by Finance: released for evaluation (§4.12). */
async function released(o: Record<string, string> = {}) {
  const sub = await newSubmission(o);
  await recordPayment(db, registry, {
    dateReceived: TODAY,
    reference: sub.ackNo,
    purpose: "",
    channel: "",
    amount: "250000",
    rrr: "",
  });
  await confirmPayments(db, sub.ackNo, TODAY);
  return sub;
}

async function assign(id: string) {
  await assignOfficers(db, supervisor, id, {
    evaluatingOfficerId: evaluator.id,
    reviewingSupervisorId: supervisor.id,
    approvingOfficerId: approver.id,
  });
}

async function readyAndRegistered() {
  const sub = await newSubmission();
  await updateDocuments(db, registry, sub.id, formDocuments());
  await recordPayment(db, registry, {
    dateReceived: TODAY,
    reference: sub.ackNo,
    purpose: "",
    channel: "",
    amount: "250000",
    rrr: "",
  });
  await confirmPayments(db, sub.ackNo, TODAY);
  await assign(sub.id);
  await confirmFormCategory(db, evaluator, sub.id, TODAY);
  const state = (await loadEvaluationState(db, sub.id, await loadContext(db, TODAY)))!;
  const values = Object.fromEntries(
    state.checks.filter((c) => c.mode === "manual" && !c.postApproval).map((c) => [c.id, "Y"]),
  );
  await saveChecks(db, evaluator, sub.id, { values, remarks: "" }, { today: TODAY });
  await markSubmissionComplete(db, evaluator, sub.id, { today: TODAY });
  const { registrationNo } = await approveAndRegister(
    db,
    approver,
    sub.id,
    { flagOverrideReason: "" },
    { today: TODAY },
  );
  return { sub, registrationNo };
}

const docs = (
  submissionId: string,
  kind?: "ACKNOWLEDGEMENT" | "EVALUATION_FORM" | "DEFICIENCY_NOTICE" | "CERTIFICATE",
) =>
  db.generatedDocument.findMany({
    where: { submissionId, ...(kind ? { kind } : {}) },
    orderBy: { version: "asc" },
  });

const textOf = async (bytes: Uint8Array | Buffer) =>
  (await pdfText(new Uint8Array(bytes))).join("\n");

describe("acknowledgement letter (para 10(3))", () => {
  it("is stored with its SHA-256 and the merged wording", async () => {
    const sub = await newSubmission({ licenceStatus: "Unlicensed", licences: "[]" });
    const doc = await generateAcknowledgement(db, registry, sub.id, TODAY);
    const [row] = await docs(sub.id, "ACKNOWLEDGEMENT");
    expect(row).toMatchObject({
      version: 1,
      fileName: "OGSERC-ACK-2026-00001-acknowledgement-v1.pdf",
      supersededAt: null,
    });
    expect(row!.sha256).toBe(createHash("sha256").update(row!.content).digest("hex"));
    expect(doc.sha256).toBe(row!.sha256);

    const text = await textOf(row!.content);
    expect(text).toContain("ACKNOWLEDGEMENT OF REGISTRATION SUBMISSION");
    expect(text).toContain("OGSERC/ACK/2026/00001");
    expect(text).toContain("22 October 2026 by hand");
    expect(text).toContain(
      "Category E — Mini-grids and interconnected mini-grids (subject to evaluation)",
    );
    expect(text).toContain("₦250,000");
    // REG-01E's list; the letter also says which form and filing it is.
    expect(text).toContain("New registration, on Form REG-01E");
    expect(text).toContain(
      "Pending: Certificate of incorporation / registration (or community or cooperative registration)",
    );
    expect(text).toContain("Evidence of payment of the registration fee — please supply");
    expect(text).toContain("within thirty (30) days");
    // Unlicensed: paragraph 18 obligation with the licence application date.
    expect(text).toContain("must apply for the appropriate licence or permit by 20 January 2027");
    expect(text).toContain("This acknowledgement is not a Registration Certificate.");
  });

  it("prints 'Pending: none.' only, when nothing is pending", async () => {
    const sub = await newSubmission();
    await updateDocuments(db, registry, sub.id, formDocuments());
    // Evidence of payment ticks itself once Finance confirms the fee.
    await recordPayment(db, registry, {
      dateReceived: TODAY,
      reference: sub.ackNo,
      purpose: "",
      channel: "",
      amount: "250000",
      rrr: "",
    });
    await confirmPayments(db, sub.ackNo, TODAY);
    await generateAcknowledgement(db, registry, sub.id, TODAY);
    const text = await textOf((await docs(sub.id, "ACKNOWLEDGEMENT"))[0]!.content);
    expect(text).toContain("Pending: none.");
    expect(text).not.toContain("please supply these");
  });

  it("a new version supersedes the old; only registry staff generate it", async () => {
    const sub = await newSubmission();
    await generateAcknowledgement(db, registry, sub.id, TODAY);
    await generateAcknowledgement(db, registry, sub.id, TODAY);
    const rows = await docs(sub.id, "ACKNOWLEDGEMENT");
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[0]!.supersededAt).not.toBeNull();
    expect(rows[1]!.supersededAt).toBeNull();
    await expect(generateAcknowledgement(db, evaluator, sub.id, TODAY)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await db.auditLog.findFirstOrThrow({ orderBy: { id: "desc" } })).detail).toMatch(
      /^Acknowledgement letter v2, SHA-256 [0-9a-f]{64}$/,
    );
  });
});

describe("deficiency notice (para 13(1)(b))", () => {
  it("is generated by the Issue action and linked to the notice, with failed checks and remarks", async () => {
    const sub = await released();
    await assign(sub.id);
    await saveChecks(
      db,
      evaluator,
      sub.id,
      { values: { "2.2": "N" }, remarks: "Shareholding schedule missing" },
      { today: TODAY },
    );
    await issueDeficiency(db, supervisor, sub.id, { today: TODAY });

    const [row] = await docs(sub.id, "DEFICIENCY_NOTICE");
    const notice = await db.deficiencyNotice.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(row!.deficiencyNoticeId).toBe(notice.id);
    const text = await textOf(row!.content);
    expect(text).toContain("NOTICE OF DEFICIENCY");
    expect(text).toContain("OGSERC/DEF/2026/00001");
    expect(text).toContain("by 5 November 2026");
    expect(text).toContain(
      "B. Ownership: shareholders ≥5%, directors and beneficial owners (check 2.2)",
    );
    expect(text).toContain("Evaluator's remarks: Shareholding schedule missing");
    expect(text).toContain("Total due ₦250,000; paid ₦250,000; balance ₦0"); // confirmed by Finance
    expect(text).not.toContain("DRAFT");
  });

  it("can be previewed as a watermarked draft that is never stored", async () => {
    const sub = await released();
    const bytes = await previewDeficiencyNotice(db, evaluator, sub.id, TODAY);
    const text = await textOf(bytes);
    expect(text).toContain("DRAFT – NOT ISSUED");
    expect(text).toContain("DRAFT – OGSERC/ACK/2026/00001");
    expect(await docs(sub.id)).toHaveLength(0);
    await expect(previewDeficiencyNotice(db, registry, sub.id, TODAY)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("certificate (CERT-01)", () => {
  it("is produced inside the approval, with the §7 fields", async () => {
    const { sub, registrationNo } = await readyAndRegistered();
    const [cert] = await docs(sub.id, "CERTIFICATE");
    expect(cert).toMatchObject({ version: 1, generatedById: approver.id });
    const text = await textOf(cert!.content);
    expect(text).toContain("CERTIFICATE OF REGISTRATION");
    expect(text).toContain(`Certificate Serial No.: ${registrationNo.slice(-4)}`);
    expect(text).toContain(registrationNo);
    expect(text).toContain("OGUN SUNRISE MINI-GRID LTD");
    expect(text).toContain("RC445566");
    expect(text).toContain("E — Mini-grids and interconnected mini-grids");
    expect(text).toContain("Ifo; Ewekoro");
    expect(text).toContain("NERC registration/permit (mini-grid/captive), No. NERC/MG/77");
    expect(text).toContain("Issued at Abeokuta this 22nd day of October, 2026");
    expect(text).toContain("Engr. A. Chair");
    expect(text).toContain("Barr. B. Commissioner");
    expect(text).not.toContain("Reissued");
  });

  it("carries a QR code that leads to the internal verification page", async () => {
    const { sub, registrationNo } = await readyAndRegistered();
    const [cert] = await docs(sub.id, "CERTIFICATE");
    const png = await renderPage(new Uint8Array(cert!.content), 1, 3);
    const image = await loadImage(png);
    const canvas = createCanvas(image.width, image.height);
    const g = canvas.getContext("2d");
    g.drawImage(image, 0, 0);
    // The QR code sits bottom right; decode that corner.
    const [x, y, w, h] = [
      image.width * 0.8,
      image.height * 0.65,
      image.width * 0.2,
      image.height * 0.3,
    ];
    const data = g.getImageData(x, y, w, h);
    const code = jsQR(new Uint8ClampedArray(data.data), data.width, data.height);
    expect(code?.data).toBe(`http://localhost:3000/verify/${sub.id}`);

    const v = await getVerification(db, registry, sub.id);
    expect(v).toMatchObject({
      verdict: "current",
      registrationNo,
      name: "Ogun Sunrise Mini-Grid Ltd",
    });
    expect(v!.certificates.map((c) => [c.version, c.supersededAt])).toEqual([[1, null]]);
  });

  it("Admin reissues after a certificate-field correction; the old version is superseded", async () => {
    const { sub } = await readyAndRegistered();
    await updateSubmission(db, admin, sub.id, form({ address: "5 New Road, Abeokuta" }), {
      changeReason: "Change of registered address (letter 3 Dec)",
    });
    expect(
      (await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).certificateNeedsReissue,
    ).toBe(true);

    await expect(
      reissueCertificate(db, approver, sub.id, { reason: "address changed" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reissueCertificate(db, admin, sub.id, { reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await reissueCertificate(
      db,
      admin,
      sub.id,
      { reason: "Change of registered address" },
      "2026-12-04",
    );

    const [v1, v2] = await docs(sub.id, "CERTIFICATE");
    expect(v1!.supersededAt).not.toBeNull();
    expect(v2).toMatchObject({
      version: 2,
      supersededAt: null,
      note: "Reissued 4 December 2026: Change of registered address",
    });
    expect(
      (await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).certificateNeedsReissue,
    ).toBe(false);
    const text = await textOf(v2!.content);
    expect(text).toContain("5 New Road, Abeokuta");
    expect(text).toContain("Reissued 4 December 2026");
    expect(text).toContain("Issued at Abeokuta this 22nd day of October, 2026");
  });

  it("is never produced for a submission that is not registered", async () => {
    const sub = await newSubmission();
    await expect(
      reissueCertificate(db, admin, sub.id, { reason: "Try anyway" }),
    ).rejects.toBeInstanceOf(BlockedError);
  });
});

describe("evaluation form EVAL-01", () => {
  it("prints every check, the result and the signature rows", async () => {
    const { sub, registrationNo } = await readyAndRegistered();
    await generateEvaluationForm(db, evaluator, sub.id, TODAY);
    const text = await textOf((await docs(sub.id, "EVALUATION_FORM"))[0]!.content);
    expect(text).toContain("REGISTRATION EVALUATION FORM (OGSERC/EVAL-01)");
    for (const id of ["1.1", "2.15", "3.2", "4.13", "5.5", "6.4", "7.6", "9.7"])
      expect(text).toContain(id);
    expect(text).toContain("Register (13(1)(a))");
    expect(text).toContain(registrationNo);
    expect(text).toContain("Approving officer — signature / date");
    expect(text).toContain("POST-APPROVAL ACTIONS");
  });
});

describe("stored documents", () => {
  it("download checks the hash; documents cannot be changed or deleted", async () => {
    const sub = await newSubmission();
    const doc = await generateAcknowledgement(db, registry, sub.id, TODAY);
    const download = await getDocumentForDownload(db, evaluator, doc.id);
    expect(Buffer.from(download.bytes).subarray(0, 5).toString()).toBe("%PDF-");

    await expect(
      db.generatedDocument.update({
        where: { id: doc.id },
        data: { content: Buffer.from("%PDF-forged") },
      }),
    ).rejects.toThrow(/cannot be changed/);
    await expect(db.generatedDocument.delete({ where: { id: doc.id } })).rejects.toThrow(
      /not allowed/,
    );
    const viewer = await makeUser(db, []);
    await expect(getDocumentForDownload(db, viewer, doc.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
