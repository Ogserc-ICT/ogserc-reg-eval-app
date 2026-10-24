import { describe, expect, it } from "vitest";
import { formatDate } from "../dates";
import { planNotifications, type SubmissionSubject } from "../notifications";

const sub = (over: Partial<SubmissionSubject> = {}): SubmissionSubject => ({
  id: "s1",
  ackNo: "OGSERC/ACK/2026/00001",
  name: "Ogun Sunrise Mini-Grid Ltd",
  createdById: "registry",
  evaluatingOfficerId: null,
  reviewingSupervisorId: null,
  approvingOfficerId: null,
  ...over,
});

const audiences = (plans: ReturnType<typeof planNotifications>) => plans.map((p) => p.audience);

describe("notifications: the next person in line", () => {
  it("a new submission tells Finance, linking to the record", () => {
    const [plan, ...rest] = planNotifications({ kind: "submissionCreated", sub: sub() });
    expect(rest).toHaveLength(0);
    expect(plan!.audience).toEqual({ userIds: [], roles: ["FINANCE_OFFICER"] });
    expect(plan!.title).toBe("New submission awaiting payment");
    expect(plan!.body).toBe("OGSERC/ACK/2026/00001 – Ogun Sunrise Mini-Grid Ltd");
    expect(plan!.href).toBe("/submissions/s1");
    expect(plan!.reference).toBe("OGSERC/ACK/2026/00001");
  });

  it("an own-use notification tells Finance only when a fee is due", () => {
    const base = { kind: "ownUseCreated" as const, id: "o1", ounNo: "OUN/1", name: "Mill" };
    expect(planNotifications({ ...base, fee: 0 })).toEqual([]);
    const [plan] = planNotifications({ ...base, fee: 5_000_000 });
    expect(plan!.audience.roles).toEqual(["FINANCE_OFFICER"]);
    expect(plan!.body).toContain("₦50,000");
    expect(plan!.href).toBe("/own-use/o1");
  });

  it("a recorded payment goes to the Finance Desk; a rejected one back to its recorder", () => {
    const [recorded] = planNotifications({
      kind: "paymentRecorded",
      paymentNo: "PAY/1",
      reference: "ACK/1",
      amount: 25_000_000,
    });
    expect(recorded!.audience.roles).toEqual(["FINANCE_OFFICER"]);
    expect(recorded!.href).toBe("/finance");
    expect(recorded!.body).toBe("PAY/1: ₦250,000 for ACK/1");

    const [rejected] = planNotifications({
      kind: "paymentRejected",
      paymentNo: "PAY/1",
      reference: "ACK/1",
      recordedById: "registry",
      reason: "Not on the statement",
      href: "/submissions/s1",
    });
    expect(rejected!.audience).toEqual({ userIds: ["registry"], roles: [] });
    expect(rejected!.body).toContain("Not on the statement");
  });

  it("release tells the assigned evaluator, or supervisors when nobody is assigned", () => {
    expect(audiences(planNotifications({ kind: "released", sub: sub() }))).toEqual([
      { userIds: [], roles: ["REVIEWING_SUPERVISOR"] },
    ]);
    const [plan] = planNotifications({
      kind: "released",
      sub: sub({ evaluatingOfficerId: "eva" }),
    });
    expect(plan!.audience).toEqual({ userIds: ["eva"], roles: [] });
    expect(plan!.title).toBe("Ready for evaluation");
    expect(plan!.href).toBe("/submissions/s1/evaluation");
  });

  it("assignment tells each newly assigned officer in their own words", () => {
    const plans = planNotifications({
      kind: "officersAssigned",
      sub: sub(),
      assigned: { evaluatingOfficerId: "eva", approvingOfficerId: "appr" },
    });
    expect(plans.map((p) => [p.audience.userIds, p.title])).toEqual([
      [["eva"], "You are the evaluating officer"],
      [["appr"], "You are the approving officer"],
    ]);
    expect(planNotifications({ kind: "officersAssigned", sub: sub(), assigned: {} })).toEqual([]);
  });

  it("complete → supervisor, reviewed → approver, falling back to the role", () => {
    const complete = { kind: "submissionComplete" as const, determinationDue: "2026-11-23" };
    expect(audiences(planNotifications({ ...complete, sub: sub() }))).toEqual([
      { userIds: [], roles: ["REVIEWING_SUPERVISOR"] },
    ]);
    const [toSupervisor] = planNotifications({
      ...complete,
      sub: sub({ reviewingSupervisorId: "sup" }),
    });
    expect(toSupervisor!.audience).toEqual({ userIds: ["sup"], roles: [] });
    expect(toSupervisor!.body).toContain(`Determination due ${formatDate("2026-11-23")}`);

    expect(audiences(planNotifications({ kind: "reviewed", sub: sub() }))).toEqual([
      { userIds: [], roles: ["APPROVING_OFFICER"] },
    ]);
    expect(
      audiences(planNotifications({ kind: "reviewed", sub: sub({ approvingOfficerId: "appr" }) })),
    ).toEqual([{ userIds: ["appr"], roles: [] }]);
  });

  it("a deficiency notice tells the registry officer and the evaluator", () => {
    const [plan] = planNotifications({
      kind: "deficiencyIssued",
      sub: sub({ evaluatingOfficerId: "eva" }),
      responseDue: "2026-12-01",
    });
    expect(plan!.audience).toEqual({ userIds: ["registry", "eva"], roles: [] });
    expect(plan!.body).toContain(`Response due ${formatDate("2026-12-01")}`);
  });

  it("a decision tells the creator and every assigned officer", () => {
    const [plan] = planNotifications({
      kind: "decided",
      outcome: "Registered",
      sub: sub({
        evaluatingOfficerId: "eva",
        reviewingSupervisorId: "sup",
        approvingOfficerId: "appr",
      }),
    });
    expect(plan!.title).toBe("Registered");
    expect(plan!.audience).toEqual({ userIds: ["registry", "eva", "sup", "appr"], roles: [] });
  });

  it("a provisional registration tells the assigned deciders, else both roles", () => {
    expect(audiences(planNotifications({ kind: "provisional", sub: sub() }))).toEqual([
      { userIds: [], roles: ["REVIEWING_SUPERVISOR", "APPROVING_OFFICER"] },
    ]);
    expect(
      audiences(
        planNotifications({ kind: "provisional", sub: sub({ approvingOfficerId: "appr" }) }),
      ),
    ).toEqual([{ userIds: ["appr"], roles: [] }]);
  });
});
