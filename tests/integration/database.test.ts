// Seed, DB↔domain mapping, integrity triggers and counters against a real Postgres.
import type { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import forms from "../../registration-forms.json";
import seed from "../../seed-data.json";
import { referenceDataFromSeed, settingsFromSeed } from "@/domain/reference";
import { COUNTER, nextCounter } from "@/server/counters";
import { loadList, loadReferenceData, loadSettings } from "@/server/reference-data";
import { ensureAdmin, seedReferenceData } from "@/server/seed";
import { asWorkflow, canSignInWith, makeUser, resetDb, saveSubmission, testDb } from "./helpers";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

const makeSubmission = (createdById: string) => saveSubmission(db, createdById);

describe("seed", () => {
  it("loads every reference table", async () => {
    expect(await db.feeCategory.count()).toBe(11);
    expect(await db.activity.count()).toBe(14);
    expect(await db.lga.count()).toBe(20);
    expect(await db.registrationForm.count()).toBe(11);
    expect(await db.formDocument.count()).toBe(
      forms.forms.reduce((n, f) => n + f.documents.length, 0),
    );
    expect(await db.evaluationCheck.count()).toBe(63);
    expect(await loadList(db, "licence_statuses")).toEqual(seed.licence_statuses);
  });

  it("round-trips to exactly the domain data built from seed-data.json", async () => {
    expect(await loadReferenceData(db)).toEqual(referenceDataFromSeed(seed, forms));
    expect(await loadSettings(db)).toEqual(settingsFromSeed(seed));
  });

  it("is idempotent and never overwrites edited values", async () => {
    await db.settings.update({ where: { id: 1 }, data: { chairmanName: "Engr. A. B." } });
    await db.feeCategory.update({ where: { category: "K" }, data: { registrationFee: 12_345n } });
    await seedReferenceData(db);
    expect((await loadSettings(db)).chairmanName).toBe("Engr. A. B.");
    expect(
      (await db.feeCategory.findUniqueOrThrow({ where: { category: "K" } })).registrationFee,
    ).toBe(12_345n);
    expect(await db.activity.count()).toBe(14);
  });

  it("creates the first admin once, with an audit entry", async () => {
    const first = await ensureAdmin(db, "Admin@OGSERC.gov.ng", "a long password 1", {
      production: false,
    });
    const second = await ensureAdmin(db, "admin@ogserc.gov.ng", "different password 2", {
      production: false,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.user.roles).toEqual(["ADMIN"]);
    expect(await canSignInWith(db, "admin@ogserc.gov.ng", "a long password 1")).toBe(true);
    expect(await db.auditLog.count({ where: { action: "User created" } })).toBe(1);
  });
});

describe("production admin password", () => {
  it("refuses a default or weak password in production and creates nothing", async () => {
    for (const weak of ["ChangeMe!2026", "Password12345!x", "short1A!", "alllowercaseletters"]) {
      await expect(
        ensureAdmin(db, "admin@ogserc.gov.ng", weak, { production: true }),
      ).rejects.toThrow(/Refusing to create the production admin/);
    }
    expect(await db.user.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("accepts a strong password in production", async () => {
    const { created } = await ensureAdmin(db, "admin@ogserc.gov.ng", "Tr1cky-Harmattan-Kettle", {
      production: true,
    });
    expect(created).toBe(true);
  });
});

describe("integrity rules", () => {
  it("allows one Settings row only", async () => {
    const row = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
    await expect(db.settings.create({ data: { ...row, id: 2 } })).rejects.toThrow();
  });

  it("never deletes submissions or payments", async () => {
    const user = await makeUser(db, ["REGISTRY_OFFICER"]);
    const sub = await makeSubmission(user.id);
    const pay = await db.payment.create({
      data: {
        paymentSeq: 1,
        paymentNo: "OGSERC/PAY/2026/00001",
        dateReceived: new Date("2026-10-22T00:00:00Z"),
        reference: sub.ackNo,
        submissionId: sub.id,
        amount: 25_000_000n,
        recordedById: user.id,
      },
    });
    await expect(db.payment.delete({ where: { id: pay.id } })).rejects.toThrow(/not allowed/);
    await expect(db.submission.delete({ where: { id: sub.id } })).rejects.toThrow(/not allowed/);
  });

  it("keeps the audit log append-only", async () => {
    const user = await makeUser(db, ["ADMIN"]);
    const row = await db.auditLog.create({ data: { userId: user.id, action: "Test" } });
    await expect(
      db.auditLog.update({ where: { id: row.id }, data: { detail: "edited" } }),
    ).rejects.toThrow(/not allowed/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/not allowed/);
  });

  it("locks the registration number once set", async () => {
    const user = await makeUser(db, ["REGISTRY_OFFICER"]);
    const sub = await makeSubmission(user.id);
    const where = { id: sub.id };
    const wf = (data: Prisma.SubmissionUpdateInput) =>
      asWorkflow(db, (tx) => tx.submission.update({ where, data }));
    await wf({ registrationNo: "OGSERC/REG/2026/E-MGD/0001" });
    // Even a workflow transaction cannot change or clear a locked number.
    await expect(wf({ registrationNo: "OGSERC/REG/2026/E-MGD/0002" })).rejects.toThrow(/locked/);
    await expect(wf({ registrationNo: null })).rejects.toThrow(/locked/);
    await db.submission.update({ where, data: { remarks: "other edits still allowed" } });
  });

  it("refuses direct changes to status, decisions and workflow dates", async () => {
    const user = await makeUser(db, ["REGISTRY_OFFICER"]);
    const sub = await makeSubmission(user.id);
    const where = { id: sub.id };
    for (const data of [
      { status: "REGISTERED" as const },
      { certificateIssueDate: new Date("2026-10-22T00:00:00Z") },
      { dateSubmissionComplete: new Date("2026-10-22T00:00:00Z") },
      { deficiencyNoticeDate: new Date("2026-10-22T00:00:00Z") },
      { registrationNo: "OGSERC/REG/2026/E-MGD/0001" },
    ]) {
      await expect(db.submission.update({ where, data })).rejects.toThrow(/workflow actions/);
    }
    await db.evaluation.create({ data: { submissionId: sub.id } });
    await expect(
      db.evaluation.update({
        where: { submissionId: sub.id },
        data: { finalDecision: "REGISTER" },
      }),
    ).rejects.toThrow(/workflow actions/);
    // A new submission must start as Received with no workflow dates.
    await expect(
      db.submission.create({
        data: {
          ackSeq: 99,
          ackNo: "OGSERC/ACK/2026/00099",
          registeredName: "Direct Insert Ltd",
          dateSubmitted: new Date("2026-10-22T00:00:00Z"),
          principalLga: "Ifo",
          formFiled: "REG-01E",
          primaryActivityCode: "MGD",
          licenceStatus: "Unlicensed",
          operatingOnEffectiveDate: true,
          createdById: user.id,
          pricedCategory: "E",
          pricedRegistrationFee: 25_000_000n,
          pricedLateInitial: 0n,
          pricedLateDaily: 0n,
          pricedLateDailyCap: 0n,
          pricedEffectiveDate: new Date("2026-10-22T00:00:00Z"),
          status: "REGISTERED",
        },
      }),
    ).rejects.toThrow(/workflow fields/);
  });

  it("links a payment to exactly one record and rejects non-positive amounts", async () => {
    const user = await makeUser(db, ["FINANCE_OFFICER"]);
    const base = {
      dateReceived: new Date("2026-10-22T00:00:00Z"),
      reference: "X",
      recordedById: user.id,
    };
    await expect(
      db.payment.create({ data: { ...base, paymentSeq: 1, paymentNo: "P1", amount: 100n } }),
    ).rejects.toThrow();
    const sub = await makeSubmission(user.id);
    await expect(
      db.payment.create({
        data: { ...base, paymentSeq: 2, paymentNo: "P2", amount: 0n, submissionId: sub.id },
      }),
    ).rejects.toThrow();
  });
});

describe("counters", () => {
  it("issues unique consecutive numbers under concurrency", async () => {
    const values = await Promise.all(
      Array.from({ length: 20 }, () => db.$transaction((tx) => nextCounter(tx, COUNTER.ACK))),
    );
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("does not consume a number when the transaction rolls back", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await nextCounter(tx, COUNTER.PAYMENT);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.$transaction((tx) => nextCounter(tx, COUNTER.PAYMENT))).toBe(1);
  });

  it("keeps a separate registration serial per year", async () => {
    const next = (name: string) => db.$transaction((tx) => nextCounter(tx, name));
    expect(await next(COUNTER.registration(2026))).toBe(1);
    expect(await next(COUNTER.registration(2026))).toBe(2);
    expect(await next(COUNTER.registration(2027))).toBe(1);
  });
});
