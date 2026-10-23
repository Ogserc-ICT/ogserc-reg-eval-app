// Phase 6: the dashboard loader against a real database.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@/domain/dates";
import { appToday } from "@/server/clock";
import { loadContext } from "@/server/context";
import { getDashboard } from "@/server/dashboard";
import { loadEvaluationState, loadEvaluationStates } from "@/server/evaluation-state";
import { createSubmission } from "@/server/intake";
import { createOwnUse } from "@/server/own-use";
import { listRegister } from "@/server/register";
import { recordPayment, reversePayment, verifyPayment } from "@/server/payments";
import type { Actor } from "@/server/types";
import { assignOfficers, issueDeficiency } from "@/server/workflow";
import { generateFakeData } from "../../scripts/seed-fake";
import { makeUser, resetDb, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());

const TODAY = "2026-10-22";
let registry: Actor, finance: Actor, evaluator: Actor, supervisor: Actor, approver: Actor;

beforeEach(async () => {
  await resetDb(db);
  registry = await makeUser(db, ["REGISTRY_OFFICER"]);
  finance = await makeUser(db, ["FINANCE_OFFICER"]);
  evaluator = await makeUser(db, ["EVALUATING_OFFICER"]);
  supervisor = await makeUser(db, ["REVIEWING_SUPERVISOR"]);
  approver = await makeUser(db, ["APPROVING_OFFICER"]);
});

const form = (name: string, cac: string, lga: string) => ({
  registeredName: name,
  dateSubmitted: TODAY,
  submissionChannel: "",
  registrantType: "Company",
  cacNo: cac,
  tin: "",
  address: "",
  principalLga: lga,
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

describe("getDashboard", () => {
  it("counts the Register, own-use and payments, and builds each user's queues", async () => {
    const a = await createSubmission(db, registry, form("Alpha Grid Ltd", "RC1", "Ifo"));
    const b = await createSubmission(db, registry, form("Beta Grid Ltd", "RC2", "Odeda"));
    await assignOfficers(db, supervisor, a.id, {
      evaluatingOfficerId: evaluator.id,
      reviewingSupervisorId: supervisor.id,
      approvingOfficerId: approver.id,
    });
    await issueDeficiency(db, supervisor, b.id, { today: TODAY });
    const oun = await createOwnUse(db, registry, {
      name: "Ifo Bottling",
      dateFiled: TODAY,
      cacNo: "",
      siteAddress: "",
      lga: "Ifo",
      natureOfBusiness: "",
      gridConnected: "",
      distributionLicensee: "",
      units: "",
      installedCapacityKw: "650",
      fuel: "",
      avgMonthlyOutputMwh: "",
      contactPerson: "",
      phone: "",
      email: "",
    });
    const pay = (reference: string, amount: string) =>
      recordPayment(db, finance, {
        dateReceived: TODAY,
        reference,
        purpose: "",
        channel: "",
        amount,
        rrr: "",
      });
    const p1 = await pay(a.ackNo, "250000");
    await verifyPayment(db, finance, p1.id);
    const p2 = await pay(b.ackNo, "100000");
    await reversePayment(db, finance, p2.id, { reason: "Posted to the wrong file" });
    await pay(oun.ounNo, "100000");

    const { dashboard: d, queues } = await getDashboard(db, evaluator, { today: "2026-11-10" });
    expect(d.submissions).toMatchObject({ total: 2, inProgress: 2, ownUse: 1 });
    expect(d.money).toMatchObject({
      totalDue: 60_000_000, // ₦250k × 2 + ₦100k own-use
      collected: 35_000_000, // the reversed ₦100k does not count
      verified: 25_000_000,
      outstanding: 25_000_000,
    });
    expect(d.byLga.find((l) => l.lga === "Ifo")).toEqual({ lga: "Ifo", registrants: 1, ownUse: 1 });
    expect(d.byCategory.find((r) => r.category === "I")).toMatchObject({
      submissions: 1,
      collected: 10_000_000,
    });
    expect(d.monthly[0]).toMatchObject({ submissions: 2, collected: 35_000_000 });

    expect(queues.mine.map((q) => [q.name, q.roles])).toEqual([
      ["Alpha Grid Ltd", ["Evaluating officer"]],
    ]);
    // B's 14-day response period ended on 5 November.
    expect(queues.overdueDeficiency.map((q) => [q.name, q.daysOverdue])).toEqual([
      ["Beta Grid Ltd", 5],
    ]);
    expect(
      (await getDashboard(db, approver, { today: "2026-11-10" })).queues.mine.map((q) => q.roles),
    ).toEqual([["Approving officer"]]);
  });
});

describe("list loading at volume", () => {
  it("the flat list loader gives the same state as the full single-submission loader", async () => {
    await generateFakeData(db, {
      count: 80,
      ownUse: 5,
      seed: 3,
      effectiveDate: addDays(appToday(), -300),
    });
    const ctx = await loadContext(db);
    const states = await loadEvaluationStates(db, ctx);
    expect(states).toHaveLength(80);
    for (const s of states) {
      const one = (await loadEvaluationState(db, s.row.id, ctx))!;
      expect(s.sub).toEqual(one.sub);
      expect(s.assessment).toEqual(one.assessment);
      expect(s.flags).toEqual(one.flags);
      expect(s.evaluation).toEqual(one.evaluation);
      expect(s.counts).toEqual(one.counts);
      expect([s.status, s.recommended]).toEqual([one.status, one.recommended]);
      expect(s.evaluationRow.evaluatingOfficer).toEqual(one.evaluationRow.evaluatingOfficer);
    }
  });

  it("the Register's credit and closed-unpaid filters list what the dashboard tiles count", async () => {
    await generateFakeData(db, {
      count: 300,
      ownUse: 0,
      seed: 11,
      effectiveDate: addDays(appToday(), -300),
    });
    const { dashboard: d } = await getDashboard(db, approver);
    const overpaid = await listRegister(db, { overpaid: true });
    const closedUnpaid = await listRegister(db, { closedUnpaid: true });
    expect(overpaid.length).toBeGreaterThan(0);
    expect(closedUnpaid.length).toBeGreaterThan(0);
    expect(overpaid).toHaveLength(d.money.overpaidSubmissions);
    expect(overpaid.reduce((s, r) => s - r.balance, 0)).toBe(d.money.overpaid);
    expect(closedUnpaid.reduce((s, r) => s + r.balance, 0)).toBe(d.money.unpaidOnClosed);
    // Closed files are outside the rate: what is still due excludes them.
    const all = await listRegister(db);
    const open = all.filter((r) => !["Refused", "Lapsed", "Cancelled"].includes(r.status));
    expect(open.reduce((s, r) => s + Math.max(0, r.balance), 0)).toBe(d.money.outstanding);
  });

  it("the fake-data generator refuses production and a database that already has submissions", async () => {
    await createSubmission(db, registry, form("Alpha Grid Ltd", "RC1", "Ifo"));
    await expect(generateFakeData(db, { count: 5, ownUse: 0, seed: 1 })).rejects.toThrow(
      /already has 1 submissions/,
    );
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(
        generateFakeData(db, { count: 5, ownUse: 0, seed: 1, allowExisting: true }),
      ).rejects.toThrow(/development only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
