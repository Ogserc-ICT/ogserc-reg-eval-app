// Notifications written by the real services, in the same transaction as the change they report.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { confirmPayment } from "@/server/finance";
import { createSubmission } from "@/server/intake";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
} from "@/server/notifications";
import { recordPayment } from "@/server/payments";
import type { Actor } from "@/server/types";
import { assignOfficers } from "@/server/workflow";
import { makeUser, resetDb, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());

let registry: Actor, finance1: Actor, finance2: Actor, retiredFinance: Actor;
let supervisor: Actor, evaluator: Actor, approver: Actor;

beforeEach(async () => {
  await resetDb(db);
  registry = await makeUser(db, ["REGISTRY_OFFICER"]);
  finance1 = await makeUser(db, ["FINANCE_OFFICER"]);
  finance2 = await makeUser(db, ["FINANCE_OFFICER"]);
  retiredFinance = await makeUser(db, ["FINANCE_OFFICER"], { active: false });
  supervisor = await makeUser(db, ["REVIEWING_SUPERVISOR"]);
  evaluator = await makeUser(db, ["EVALUATING_OFFICER"]);
  approver = await makeUser(db, ["APPROVING_OFFICER"]);
});

const TODAY = "2026-10-22";

const form = {
  registeredName: "Ogun Sunrise Mini-Grid Ltd",
  dateSubmitted: TODAY,
  submissionChannel: "",
  registrantType: "Company",
  cacNo: "RC 445566",
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
};

/** Titles of each user's notifications, newest first. */
async function inbox(...users: Actor[]) {
  return Promise.all(
    users.map(async (u) => (await listNotifications(db, u)).items.map((n) => n.title)),
  );
}

describe("notifications follow the workflow", () => {
  it("submission → Finance; payment → the other Finance officer; release → supervisors; assignment → the officers", async () => {
    const sub = await createSubmission(db, registry, form);
    expect(await inbox(finance1, finance2, retiredFinance, registry, supervisor)).toEqual([
      ["New submission awaiting payment"],
      ["New submission awaiting payment"],
      [], // inactive
      [], // caused it
      [],
    ]);

    await recordPayment(db, finance1, {
      dateReceived: TODAY,
      reference: sub.ackNo,
      purpose: "",
      channel: "",
      amount: "250000",
      rrr: "",
    });
    const [f1, f2] = await inbox(finance1, finance2);
    expect(f1).toEqual(["New submission awaiting payment"]); // recorded it, cannot confirm it
    expect(f2).toEqual(["Payment to confirm", "New submission awaiting payment"]);

    const payment = await db.payment.findFirstOrThrow({ where: { reference: sub.ackNo } });
    const { released } = await confirmPayment(
      db,
      finance2,
      payment.id,
      { verified: true, remarks: "" },
      { today: TODAY },
    );
    expect(released).toBe(true);
    expect(await inbox(supervisor, evaluator)).toEqual([
      ["Payment confirmed: assign officers"],
      [],
    ]);

    await assignOfficers(
      db,
      supervisor,
      sub.id,
      {
        evaluatingOfficerId: evaluator.id,
        reviewingSupervisorId: supervisor.id,
        approvingOfficerId: approver.id,
      },
      { today: TODAY },
    );
    expect(await inbox(evaluator, approver, supervisor)).toEqual([
      ["You are the evaluating officer"],
      ["You are the approving officer"],
      ["Payment confirmed: assign officers"], // assigned themselves: no notice
    ]);

    const [notice] = (await listNotifications(db, evaluator)).items;
    expect(notice!.href).toBe(`/submissions/${sub.id}/evaluation`);

    // Re-saving the same officers tells nobody again.
    await assignOfficers(
      db,
      supervisor,
      sub.id,
      {
        evaluatingOfficerId: evaluator.id,
        reviewingSupervisorId: supervisor.id,
        approvingOfficerId: approver.id,
      },
      { today: TODAY },
    );
    expect((await listNotifications(db, evaluator)).items).toHaveLength(1);
  });

  it("a person in two audiences of one event is told once", async () => {
    const both = await makeUser(db, ["REVIEWING_SUPERVISOR", "APPROVING_OFFICER"]);
    await db.$transaction((tx) =>
      notify(tx, null, {
        kind: "provisional",
        sub: {
          id: "x",
          ackNo: "ACK/1",
          name: "N",
          createdById: null,
          evaluatingOfficerId: null,
          reviewingSupervisorId: null,
          approvingOfficerId: null,
        },
      }),
    );
    expect(await inbox(both, supervisor, approver)).toEqual([
      ["Provisionally registered (para 13(4))"],
      ["Provisionally registered (para 13(4))"],
      ["Provisionally registered (para 13(4))"],
    ]);
  });

  it("a failed change leaves no notification behind", async () => {
    await expect(
      createSubmission(db, registry, { ...form, principalLga: "Not an LGA" }),
    ).rejects.toThrow();
    expect(await db.notification.count()).toBe(0);
  });
});

describe("reading notifications", () => {
  it("counts unread, and users can only mark their own", async () => {
    await createSubmission(db, registry, form);
    const mine = await listNotifications(db, finance1);
    expect(mine.unread).toBe(1);
    const id = mine.items[0]!.id;

    await markNotificationRead(db, finance2, id); // not theirs: nothing happens
    expect((await listNotifications(db, finance1)).unread).toBe(1);

    await markNotificationRead(db, finance1, id);
    const after = await listNotifications(db, finance1);
    expect(after.unread).toBe(0);
    expect(after.items[0]!.read).toBe(true);

    expect((await listNotifications(db, finance2)).unread).toBe(1);
    await markAllNotificationsRead(db, finance2);
    expect((await listNotifications(db, finance2)).unread).toBe(0);
  });

  it("reading is not audited, so it does not wake other users' pages", async () => {
    await createSubmission(db, registry, form);
    const before = await db.auditLog.count();
    await markAllNotificationsRead(db, finance1);
    expect(await db.auditLog.count()).toBe(before);
  });
});
