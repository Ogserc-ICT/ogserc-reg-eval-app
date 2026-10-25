// Phase 7: the §4.10 daily review against a real database.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runDailyReview } from "@/server/daily-review";
import { createSubmission } from "@/server/intake";
import { fromIsoDate } from "@/server/reference-data";
import type { Actor } from "@/server/types";
import { asWorkflow, makeUser, resetDb, testDb, technicalAnswers } from "./helpers";

const db = testDb();

/** REG-01E's category-specific sections answered, at each capacity these tests use. */
const TECHNICAL: Record<string, string> = {
  "2": technicalAnswers("REG-01E", 2),
};
afterAll(() => db.$disconnect());

let registry: Actor, supervisor: Actor, evaluator: Actor, admin: Actor;

beforeEach(async () => {
  await resetDb(db);
  registry = await makeUser(db, ["REGISTRY_OFFICER"]);
  supervisor = await makeUser(db, ["REVIEWING_SUPERVISOR"]);
  evaluator = await makeUser(db, ["EVALUATING_OFFICER"]);
  admin = await makeUser(db, ["ADMIN"]);
});

const form = (name: string, cac: string) => ({
  registeredName: name,
  dateSubmitted: "2026-10-22",
  submissionChannel: "",
  registrantType: "Company",
  cacNo: cac,
  tin: "",
  address: "",
  principalLga: "Ifo",
  otherAreasServed: "",
  primaryActivityCode: "MGD",
  filingType: "NEW",
  formFiled: "REG-01E",
  technicalData: TECHNICAL["2"],
  installedCapacityMw: "2",
  customers: "",
  licenceStatus: "NERC registration/permit (mini-grid/captive)",
  licences: [{ number: "N/1" }],
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

/** Released and complete on 22 Oct 2026, so determination is due 21 November 2026. */
async function completeSubmission(name: string, cac: string) {
  const sub = await createSubmission(db, registry, form(name, cac));
  await asWorkflow(db, (tx) =>
    tx.submission.update({
      where: { id: sub.id },
      data: {
        status: "RECEIVED",
        releasedForEvaluationDate: fromIsoDate("2026-10-22"),
        dateSubmissionComplete: fromIsoDate("2026-10-22"),
      },
    }),
  );
  return sub;
}

const statusOf = async (id: string) =>
  (await db.submission.findUniqueOrThrow({ where: { id } })).status;

describe("runDailyReview", () => {
  it("makes overdue determinations Provisionally Registered, once, with audit entries", async () => {
    const a = await completeSubmission("Alpha Grid Ltd", "RC1");

    const day30 = await runDailyReview(db, null, { today: "2026-11-21" });
    expect(day30.provisional).toEqual([]);
    expect(await statusOf(a.id)).toBe("RECEIVED");

    const day31 = await runDailyReview(db, supervisor, { today: "2026-11-22" });
    expect(day31.provisional.map((p) => p.ackNo)).toEqual([a.ackNo]);
    expect(await statusOf(a.id)).toBe("PROVISIONAL");

    const again = await runDailyReview(db, null, { today: "2026-11-22" });
    expect(again.provisional).toEqual([]);

    const audit = await db.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(audit.filter((e) => e.action === "Provisional registration")).toHaveLength(1);
    const provisional = audit.find((e) => e.action === "Provisional registration")!;
    expect(provisional).toMatchObject({ userId: supervisor.id, reference: a.ackNo });
    expect(provisional.detail).toContain("para 13(4)");

    const summaries = audit.filter((e) => e.action === "Daily review");
    expect(summaries).toHaveLength(3);
    expect(summaries[0]!.userId).toBeNull();
    expect(summaries[0]!.detail).toMatch(/^Scheduled for 21 November 2026\. Provisional today: 0;/);
    expect(summaries[1]!.detail).toMatch(
      /^Run now by User \d+ for 22 November 2026\. Provisional today: 1;/,
    );
  });

  it("lists overdue deficiency responses without lapsing them", async () => {
    const a = await createSubmission(db, registry, form("Alpha Grid Ltd", "RC1"));
    await asWorkflow(db, (tx) =>
      tx.submission.update({
        where: { id: a.id },
        data: { status: "DEFICIENCY", deficiencyNoticeDate: fromIsoDate("2026-10-22") },
      }),
    );
    const run = await runDailyReview(db, null, { today: "2026-11-06" });
    expect(run.overdueDeficiency.map((p) => p.ackNo)).toEqual([a.ackNo]);
    expect(await statusOf(a.id)).toBe("DEFICIENCY");
  });

  it("locks a Registered record that has no registration number", async () => {
    const a = await completeSubmission("Alpha Grid Ltd", "RC1");
    await asWorkflow(db, (tx) =>
      tx.submission.update({
        where: { id: a.id },
        data: { status: "REGISTERED", certificateIssueDate: fromIsoDate("2026-11-01") },
      }),
    );
    const run = await runDailyReview(db, null, { today: "2026-11-02" });
    expect(run.locked.map((p) => p.ackNo)).toEqual([a.ackNo]);
    const row = await db.submission.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.registrationNo).toBe("OGSERC/REG/2026/E-MGD/0001");
    expect(run.summary).toContain("numbers locked: 1");
  });

  it("Run now is for supervisors and admins only", async () => {
    await expect(runDailyReview(db, evaluator)).rejects.toThrow(/permission/i);
    await expect(runDailyReview(db, registry)).rejects.toThrow(/permission/i);
    await expect(runDailyReview(db, admin)).resolves.toBeTruthy();
  });
});
