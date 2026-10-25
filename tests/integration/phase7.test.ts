// Phase 7: workbook import, Register export and the audit log viewer, against a real database.
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exportAudit, listAudit } from "@/server/audit-log";
import { runDailyReview } from "@/server/daily-review";
import { BlockedError, ForbiddenError, ValidationError } from "@/server/errors";
import { createSubmission } from "@/server/intake";
import { exportRegister } from "@/server/register-export";
import type { Actor } from "@/server/types";
import { commitImport, previewImport, uploadWorkbook } from "@/server/workbook-import";
import { makeUser, resetDb, testDb, technicalAnswers } from "./helpers";

const db = testDb();

/** REG-01E's category-specific sections answered, at each capacity these tests use. */
const TECHNICAL: Record<string, string> = {
  "1": technicalAnswers("REG-01E", 1),
};
afterAll(() => db.$disconnect());

const WORKBOOK = "reference/OGSERC_Registration_and_Evaluation_System.xlsm";
const ACK = "OGSERC/ACK/2026/00002";
const REG = "OGSERC/REG/2026/F-MSL/0001";
let bytes: Uint8Array;
let admin: Actor, registry: Actor, viewer: Actor;

beforeAll(() => {
  bytes = new Uint8Array(readFileSync(WORKBOOK));
});

beforeEach(async () => {
  await resetDb(db);
  admin = await makeUser(db, ["ADMIN"]);
  registry = await makeUser(db, ["REGISTRY_OFFICER"]);
  viewer = await makeUser(db, ["VIEWER"]);
  // Staff named as in the workbook's Staff sheet; only the approver has the matching role.
  const approver = await makeUser(db, ["APPROVING_OFFICER"]);
  await db.user.update({ where: { id: approver.id }, data: { name: "Kamiye" } });
});

/** The reference workbook with some Register cells changed (e.g. to introduce an error). */
async function editedWorkbook(cells: Record<string, string>) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Register")!;
  for (const [address, value] of Object.entries(cells)) ws.getCell(address).value = value;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const upload = (b = bytes, name = "OGSERC_Registration_and_Evaluation_System.xlsm") =>
  uploadWorkbook(db, admin, { name, bytes: b });

describe("workbook import", () => {
  it("previews, then imports the reference workbook with its numbers, and audits it", async () => {
    const { id } = await upload();
    const { summary, plan } = await previewImport(db, admin, id);
    expect(summary).toMatchObject({
      submissions: 1,
      ownUse: 0,
      payments: 1,
      errors: 0,
      pricingDifferences: 0,
    });
    expect(plan.problems.filter((p) => p.level === "skipped")).toHaveLength(4); // example rows

    await commitImport(db, admin, id);

    const sub = await db.submission.findUniqueOrThrow({
      where: { ackNo: ACK },
      include: { documents: true, evaluation: { include: { checks: true } }, payments: true },
    });
    expect(sub).toMatchObject({
      registeredName: "MIGHTY POWER",
      status: "REGISTERED",
      registrationNo: REG,
      primaryActivityCode: "MSL",
      pricedCategory: "F",
      createdById: admin.id,
    });
    // The workbook's 13 items on REG-01F's keys: items 7, 12 and 13 have no single match.
    expect(sub.formFiled).toBe("REG-01F");
    expect(sub.documents).toHaveLength(10);
    expect(sub.evaluation).toMatchObject({ finalDecision: "REGISTER", reasons: "satisfactory" });
    expect(sub.evaluation!.checks).toHaveLength(41);
    expect(sub.evaluation!.evaluatingOfficerId).toBeNull(); // "Blessing" is not a user
    expect(sub.evaluation!.approvingOfficerId).not.toBeNull(); // "Kamiye"
    expect(sub.payments.map((p) => [p.paymentNo, Number(p.amount)])).toEqual([
      ["OGSERC/PAY/2026/00003", 50_000_000],
    ]);

    // Counters continue after the imported numbers.
    const counters = Object.fromEntries(
      (await db.counter.findMany()).map((c) => [c.name, c.value]),
    );
    expect(counters).toMatchObject({ ACK: 2, PAY: 3, "REG:2026": 1 });
    const next = await createSubmission(db, registry, {
      registeredName: "After Import Ltd",
      dateSubmitted: "2026-10-22",
      submissionChannel: "",
      registrantType: "",
      cacNo: "",
      tin: "",
      address: "",
      principalLga: "Ifo",
      otherAreasServed: "",
      primaryActivityCode: "MGD",
      filingType: "NEW",
      formFiled: "REG-01E",
      technicalData: TECHNICAL["1"],
      installedCapacityMw: "1",
      customers: "",
      licenceStatus: "NERC registration/permit (mini-grid/captive)",
      licences: [],
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
    expect(next.ackNo).toBe("OGSERC/ACK/2026/00003");

    const audit = await db.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["Workbook uploaded", "Imported from workbook", "Workbook imported"]),
    );
    expect(audit.filter((a) => a.action.startsWith("Workbook: "))).toHaveLength(9);
    const upload1 = await db.workbookImport.findUniqueOrThrow({ where: { id } });
    expect(upload1.importedById).toBe(admin.id);
    expect(upload1.summary).toContain("1 submissions");
  });

  it("imports once: the same upload is refused, a second upload has nothing new", async () => {
    const { id } = await upload();
    await commitImport(db, admin, id);
    await expect(commitImport(db, admin, id)).rejects.toThrow(/already been imported/);

    const again = await upload();
    const { summary } = await previewImport(db, admin, again.id);
    expect(summary).toMatchObject({ submissions: 0, payments: 0, errors: 0 });
    await expect(commitImport(db, admin, again.id)).rejects.toThrow(/nothing new/);
    expect(await db.submission.count()).toBe(1);
  });

  it("imports nothing while any error remains, and says where each one is", async () => {
    const { id } = await upload(await editedWorkbook({ J6: "Lagos Island" }));
    const { summary, plan } = await previewImport(db, admin, id);
    expect(summary.errors).toBe(1);
    expect(plan.problems.find((p) => p.level === "error")).toMatchObject({
      sheet: "Register",
      row: 6,
      reference: ACK,
      message: 'Principal LGA "Lagos Island" is not in the app\'s list',
    });
    const error = await commitImport(db, admin, id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedError);
    expect((error as BlockedError).reasons).toEqual([
      `Register row 6 (${ACK}): Principal LGA "Lagos Island" is not in the app's list`,
    ]);
    expect(await db.submission.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
  });

  it("is Admin only, accepts only the workbook, and keeps uploads permanently", async () => {
    await expect(uploadWorkbook(db, registry, { name: "w.xlsm", bytes })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      uploadWorkbook(db, admin, { name: "notes.xlsx", bytes: new TextEncoder().encode("hello") }),
    ).rejects.toThrow(/could not be read/);
    const other = new ExcelJS.Workbook();
    other.addWorksheet("Sheet1");
    await expect(
      uploadWorkbook(db, admin, {
        name: "other.xlsx",
        bytes: new Uint8Array(await other.xlsx.writeBuffer()),
      }),
    ).rejects.toThrow(/missing sheet\(s\) Register/);
    await expect(uploadWorkbook(db, admin, { name: "w.csv", bytes })).rejects.toBeInstanceOf(
      ValidationError,
    );

    const { id } = await upload();
    await expect(db.workbookImport.delete({ where: { id } })).rejects.toThrow(/never deleted/);
    await commitImport(db, admin, id);
    await expect(
      db.workbookImport.update({ where: { id }, data: { summary: "changed" } }),
    ).rejects.toThrow(/cannot be changed/);
  });
});

describe("Register export", () => {
  it("exports the filtered Register as CSV and Excel, and audits each export", async () => {
    await commitImport(db, admin, (await upload()).id);

    const csv = await exportRegister(db, viewer, "csv", {}, "2026-10-23");
    expect(csv.fileName).toBe("ogserc-register-2026-10-23.csv");
    const lines = (csv.body as string).replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toMatch(/^Acknowledgement No\.,Registered Name,Date Submitted,/);
    expect(lines[1]).toContain(`${ACK},MIGHTY POWER,2026-10-22,`);
    expect(lines[1]).toContain(REG);
    expect(lines[1]).toContain(",500000,"); // fee in naira

    const xlsx = await exportRegister(db, admin, "xlsx", { status: "Registered" }, "2026-10-23");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Register")!;
    expect(ws.getCell("A2").value).toBe("Acknowledgement No.");
    expect(ws.getCell("A3").value).toBe(ACK);
    expect(ws.getCell("C3").value).toEqual(new Date("2026-10-22T00:00:00Z"));
    expect(ws.rowCount).toBe(3);

    const none = await exportRegister(db, admin, "csv", { status: "Lapsed" });
    expect(none.rows).toBe(0);

    const audit = await db.auditLog.findMany({ where: { action: "Register exported" } });
    expect(audit.map((a) => [a.userId, a.detail])).toEqual([
      [viewer.id, "CSV, 1 submissions"],
      [admin.id, "XLSX, 1 submissions; filters status=Registered"],
      [admin.id, "CSV, 0 submissions; filters status=Lapsed"],
    ]);
  });
});

describe("audit log viewer", () => {
  it("lists, filters and exports entries; Admin only", async () => {
    await commitImport(db, admin, (await upload()).id);
    await runDailyReview(db, null);

    const all = await listAudit(db, admin, {});
    expect(all.total).toBeGreaterThan(10);
    expect(all.rows[0]!.action).toBe("Daily review"); // newest first
    expect(all.rows[0]!.user).toBeNull();

    const imported = await listAudit(db, admin, { action: "Imported from workbook", q: "mighty" });
    expect(imported.rows.map((r) => [r.reference, r.href])).toEqual([
      [
        ACK,
        `/submissions/${(await db.submission.findUniqueOrThrow({ where: { ackNo: ACK } })).id}`,
      ],
    ]);
    expect((await listAudit(db, admin, { user: "system" })).rows.map((r) => r.action)).toEqual([
      "Daily review",
    ]);
    expect((await listAudit(db, admin, { from: "2000-01-01", to: "2000-01-02" })).total).toBe(0);

    await expect(listAudit(db, registry, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportAudit(db, viewer, {})).rejects.toBeInstanceOf(ForbiddenError);

    const rows = await exportAudit(db, admin, { action: "Workbook imported" });
    expect(rows).toHaveLength(1);
    const last = await db.auditLog.findFirstOrThrow({ orderBy: { id: "desc" } });
    expect(last).toMatchObject({
      userId: admin.id,
      action: "Audit log exported",
      detail: "1 entries; filters action=Workbook imported",
    });
  });
});
