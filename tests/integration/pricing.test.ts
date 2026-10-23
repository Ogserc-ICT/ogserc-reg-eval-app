// Snapshot pricing: fee-table and Settings edits never change an existing submission.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dataFlags } from "@/domain/flags";
import { nairaToKobo as naira } from "@/domain/money";
import { assessSubmission } from "@/domain/submission";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { recalculatePricing } from "@/server/pricing";
import { loadReferenceData, loadSettings } from "@/server/reference-data";
import { loadSubmission } from "@/server/submissions";
import type { Actor } from "@/server/types";
import { asWorkflow, makeUser, resetDb, saveSubmission, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());

let admin: Actor;
let registry: Actor;
beforeEach(async () => {
  await resetDb(db);
  admin = await makeUser(db, ["ADMIN"]);
  registry = await makeUser(db, ["REGISTRY_OFFICER", "FINANCE_OFFICER", "APPROVING_OFFICER"]);
});

/** Effective Date 2026-10-22 + 60 days; 20 days later is 2027-01-10. */
const TWENTY_DAYS_LATE = "2027-01-10";

async function assess(id: string, today = TWENTY_DAYS_LATE) {
  const loaded = await loadSubmission(db, id);
  const ctx = { ref: await loadReferenceData(db), settings: await loadSettings(db), today };
  const assessment = assessSubmission(loaded!.sub, loaded!.payments, ctx);
  return { assessment, flags: dataFlags(loaded!.sub, assessment, [], ctx) };
}

/** Category D (GEN 5 MW), 20 days late: ₦300,000 + ₦500,000 + min(₦100,000 × 20, ₦10m) = ₦2.8m. */
const saveLateGen = () =>
  saveSubmission(db, registry.id, {
    primaryActivityCode: "GEN",
    installedCapacityMw: 5,
    dateSubmitted: TWENTY_DAYS_LATE,
  });

const raiseCategoryD = () =>
  db.feeCategory.update({
    where: { category: "D" },
    data: {
      registrationFee: BigInt(naira(400_000)),
      lateInitial: BigInt(naira(600_000)),
      lateDaily: BigInt(naira(150_000)),
      lateDailyCap: BigInt(naira(12_000_000)),
    },
  });

describe("snapshot at save", () => {
  it("stores category, fee terms, deadline and the Effective Date used", async () => {
    const row = await saveLateGen();
    expect(row).toMatchObject({
      pricedCategory: "D",
      pricedRegistrationFee: BigInt(naira(300_000)),
      pricedLateInitial: BigInt(naira(500_000)),
      pricedLateDaily: BigInt(naira(100_000)),
      pricedLateDailyCap: BigInt(naira(10_000_000)),
    });
    expect(row.pricedDeadline?.toISOString().slice(0, 10)).toBe("2026-12-21");
    expect(row.pricedEffectiveDate.toISOString().slice(0, 10)).toBe("2026-10-22");
  });
});

describe("later edits do not change existing submissions", () => {
  it("a fee-table edit leaves an existing submission's total due unchanged", async () => {
    const existing = await saveLateGen();
    const before = (await assess(existing.id)).assessment.fees;
    expect(before.totalDue).toBe(naira(2_800_000));

    await raiseCategoryD();

    const after = await assess(existing.id);
    expect(after.assessment.fees).toEqual(before);
    expect(after.assessment.categoryApplied).toBe("D");

    // A submission saved after the edit is priced under the new table:
    // ₦400,000 + ₦600,000 + min(₦150,000 × 20, ₦12m) = ₦4.0m.
    const fresh = await saveLateGen();
    expect((await assess(fresh.id)).assessment.fees.totalDue).toBe(naira(4_000_000));
  });

  it("flags the existing submission so an admin can decide whether to recalculate", async () => {
    const existing = await saveLateGen();
    expect((await assess(existing.id)).flags.map((f) => f.code)).not.toContain(
      "PRICING_OUT_OF_DATE",
    );
    await raiseCategoryD();
    const { assessment, flags } = await assess(existing.id);
    expect(assessment.pricingChanges).toEqual([
      "fee ₦300,000 → ₦400,000",
      "late initial ₦500,000 → ₦600,000",
      "late daily ₦100,000 → ₦150,000",
      "late cap ₦10,000,000 → ₦12,000,000",
    ]);
    expect(flags.map((f) => f.code)).toContain("PRICING_OUT_OF_DATE");
  });

  it("a Settings edit leaves the deadline, days late and licence dates unchanged", async () => {
    const existing = await saveSubmission(db, registry.id, {
      dateSubmitted: TWENTY_DAYS_LATE,
      licenceStatus: "Unlicensed",
    });
    const before = (await assess(existing.id)).assessment;
    expect(before.registrationDeadline).toBe("2026-12-21");
    expect(before.licenceApplicationDue).toBe("2027-01-20");

    await db.settings.update({
      where: { id: 1 },
      data: { effectiveDate: new Date("2026-12-01T00:00:00Z"), registrationPeriodDays: 90 },
    });

    const after = (await assess(existing.id)).assessment;
    expect(after.registrationDeadline).toBe("2026-12-21");
    expect(after.daysLate).toBe(20);
    expect(after.fees.totalDue).toBe(before.fees.totalDue);
    expect(after.licenceApplicationDue).toBe("2027-01-20");
    expect(after.effectiveDate).toBe("2026-10-22");
  });

  it("the database refuses to change the snapshot outside a recalculation", async () => {
    const existing = await saveLateGen();
    await expect(
      db.submission.update({ where: { id: existing.id }, data: { pricedRegistrationFee: 1n } }),
    ).rejects.toThrow(/admin recalculation/);
    await expect(
      db.submission.update({
        where: { id: existing.id },
        data: { pricedDeadline: new Date("2027-01-31T00:00:00Z") },
      }),
    ).rejects.toThrow(/admin recalculation/);
    // Other fields stay editable.
    await db.submission.update({ where: { id: existing.id }, data: { remarks: "ok" } });
  });
});

describe("admin recalculation", () => {
  it("re-prices under the current rules, with the reason and every change in the audit log", async () => {
    const existing = await saveLateGen();
    await raiseCategoryD();
    const result = await recalculatePricing(db, admin, existing.id, {
      reason: "Commission approved revised Schedule 3 for pending files",
    });
    expect(result.changed).toBe(true);
    expect((await assess(existing.id)).assessment.fees.totalDue).toBe(naira(4_000_000));
    expect((await assess(existing.id)).flags.map((f) => f.code)).not.toContain(
      "PRICING_OUT_OF_DATE",
    );

    const audit = await db.auditLog.findFirstOrThrow({ orderBy: { id: "desc" } });
    expect(audit).toMatchObject({
      userId: admin.id,
      action: "Pricing recalculated",
      reference: existing.ackNo,
    });
    expect(audit.detail).toBe(
      "fee ₦300,000 → ₦400,000; late initial ₦500,000 → ₦600,000; late daily ₦100,000 → ₦150,000; " +
        "late cap ₦10,000,000 → ₦12,000,000. Reason: Commission approved revised Schedule 3 for pending files",
    );
  });

  it("is admin-only and needs a reason", async () => {
    const existing = await saveLateGen();
    await raiseCategoryD();
    await expect(
      recalculatePricing(db, registry, existing.id, { reason: "trying it" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recalculatePricing(db, admin, existing.id, { reason: " " })).rejects.toMatchObject(
      {
        fieldErrors: { reason: expect.any(Array) },
      },
    );
    expect((await assess(existing.id)).assessment.fees.totalDue).toBe(naira(2_800_000));
  });

  it("is refused once the registration number is locked", async () => {
    const existing = await saveLateGen();
    await asWorkflow(db, (tx) =>
      tx.submission.update({
        where: { id: existing.id },
        data: { registrationNo: "OGSERC/REG/2027/D-GEN/0001", status: "REGISTERED" },
      }),
    );
    await raiseCategoryD();
    await expect(
      recalculatePricing(db, admin, existing.id, { reason: "late fee review" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("writes nothing when pricing is already current", async () => {
    const existing = await saveLateGen();
    const before = await db.auditLog.count();
    const result = await recalculatePricing(db, admin, existing.id, { reason: "routine check" });
    expect(result.changed).toBe(false);
    expect(await db.auditLog.count()).toBe(before);
  });
});
