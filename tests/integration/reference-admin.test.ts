// Phase 8: fee table and activity map admin edits — reason required, audited, existing pricing kept.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { loadReferenceData } from "@/server/reference-data";
import { updateActivityMap, updateFeeTable, type FeeEditInput } from "@/server/reference-admin";
import { listRegister } from "@/server/register";
import type { Actor } from "@/server/types";
import { makeUser, resetDb, saveSubmission, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());

let admin: Actor, supervisor: Actor;
beforeEach(async () => {
  await resetDb(db);
  admin = await makeUser(db, ["ADMIN"]);
  supervisor = await makeUser(db, ["REVIEWING_SUPERVISOR"]);
});

async function feeRows(change: Partial<FeeEditInput> & { category: string }) {
  const { fees } = await loadReferenceData(db);
  return fees.map((f) => ({
    category: f.category,
    registrationFee: String(f.registrationFee / 100),
    lateInitial: String(f.lateInitial / 100),
    lateDaily: String(f.lateDaily / 100),
    lateDailyCap: String(f.lateDailyCap / 100),
    description: f.description,
    ...(f.category === change.category ? change : {}),
  }));
}

describe("fee table", () => {
  it("changes the fee for new submissions only; existing ones keep theirs and show out of date", async () => {
    const before = await saveSubmission(db, admin.id); // MGD 2.5 MW: Category E, ₦250,000
    const rows = await feeRows({ category: "E", registrationFee: "275,000" });
    const result = await updateFeeTable(db, admin, { rows, reason: "Schedule 3 revised (test)" });
    expect(result).toEqual({ changed: 1, stale: { submissions: 1, ownUse: 0 } });

    const [old] = await listRegister(db);
    expect(old).toMatchObject({ id: before.id, totalDue: 25_000_000, pricingStale: true });
    const after = await saveSubmission(db, admin.id);
    const fresh = (await listRegister(db)).find((r) => r.id === after.id)!;
    expect(fresh).toMatchObject({ totalDue: 27_500_000, pricingStale: false });

    const audit = await db.auditLog.findMany({ where: { action: "Fee table changed" } });
    expect(audit.map((a) => [a.userId, a.reference, a.detail])).toEqual([
      [
        admin.id,
        "Category E",
        "registration fee ₦250,000 → ₦275,000. Reason: Schedule 3 revised (test)",
      ],
    ]);
  });

  it("needs a reason, valid amounts and Admin; saving with no change writes nothing", async () => {
    const rows = await feeRows({ category: "E", registrationFee: "275,000" });
    await expect(updateFeeTable(db, admin, { rows, reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      updateFeeTable(db, supervisor, { rows, reason: "Schedule 3 revised" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const bad = await feeRows({ category: "E", lateDaily: "lots" });
    const error = await updateFeeTable(db, admin, { rows: bad, reason: "typo fix" }).catch(
      (e: unknown) => e,
    );
    expect((error as ValidationError).fieldErrors).toEqual({
      "E.lateDaily": ["Enter the late charge (per day) in naira"],
    });
    expect(
      await updateFeeTable(db, admin, {
        rows: await feeRows({ category: "E" }),
        reason: "no change at all",
      }),
    ).toEqual({ changed: 0, stale: null });
    expect(await db.auditLog.count({ where: { action: "Fee table changed" } })).toBe(0);
  });
});

describe("activity map", () => {
  it("re-maps an activity with a reason and audit entry; existing submissions keep their category", async () => {
    await saveSubmission(db, admin.id, { primaryActivityCode: "SUP", installedCapacityMw: null });
    const { activities } = await loadReferenceData(db);
    const rows = activities.map((a) =>
      a.code === "SUP" ? { ...a, cat10MwPlus: "F", cat1To10Mw: "F", catBelow1Mw: "F" } : a,
    );
    const result = await updateActivityMap(db, admin, {
      rows,
      reason: "Commission decision on SPEC §9.6",
    });
    expect(result).toEqual({ changed: 1, stale: { submissions: 1, ownUse: 0 } });
    const [row] = await listRegister(db);
    expect(row).toMatchObject({ category: "K", pricingStale: true });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "Activity map changed" } });
    expect(audit).toMatchObject({ reference: "Activity SUP", userId: admin.id });

    const toI = rows.map((a) => (a.code === "MET" ? { ...a, cat10MwPlus: "I" } : a));
    await expect(updateActivityMap(db, admin, { rows: toI, reason: "test" })).rejects.toThrow(
      /highlighted/,
    );
  });
});
