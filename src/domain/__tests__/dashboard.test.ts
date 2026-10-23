import { describe, expect, it } from "vitest";
import {
  buildDashboard,
  dashboardMonths,
  dashboardYears,
  workQueues,
  type QueueSubmission,
} from "../dashboard";
import { addDays } from "../dates";
import { dataFlags } from "../flags";
import { assessOwnUse, type OwnUseInput } from "../own-use";
import { priceSubmission } from "../pricing";
import { assessSubmission } from "../submission";
import { STATUS, type PaymentInput, type SubmissionInput } from "../types";
import {
  DEADLINE,
  ED,
  activity,
  allDocs,
  ctx,
  makeSubmission,
  naira,
  payment,
  ref,
  settings,
} from "./helpers";

const TODAY = addDays(ED, 40);

function row(
  sub: SubmissionInput,
  payments: PaymentInput[] = [],
  evaluationStatus: QueueSubmission["evaluationStatus"] = "Not assigned",
) {
  const priced = { ...sub, pricing: priceSubmission(sub, ref, settings) };
  const c = ctx(TODAY);
  const assessment = assessSubmission(priced, payments, c);
  return { sub: priced, assessment, flags: dataFlags(priced, assessment, [], c), evaluationStatus };
}

const oun = (id: string, kw: number, lga = "Ifo"): OwnUseInput => ({
  id,
  ounNo: `OGSERC/OUN/2026/000${id}`,
  name: `Factory ${id}`,
  dateFiled: ED,
  cacNo: null,
  lga,
  installedCapacityKw: kw,
  pricing: null,
});

describe("dashboard months", () => {
  const ED_2026 = "2026-10-22";

  it("are the 12 months from the Effective Date's month while those months last", () => {
    expect(dashboardMonths(ED_2026, "2026-10-22")).toEqual({
      mode: "from-effective-date",
      months: [
        "2026-10",
        "2026-11",
        "2026-12",
        "2027-01",
        "2027-02",
        "2027-03",
        "2027-04",
        "2027-05",
        "2027-06",
        "2027-07",
        "2027-08",
        "2027-09",
      ],
    });
    // Still the first window in its last month.
    expect(dashboardMonths(ED_2026, "2027-09-30").mode).toBe("from-effective-date");
  });

  it("then roll: the last 12 months ending this month", () => {
    const w = dashboardMonths(ED_2026, "2027-10-01");
    expect(w.mode).toBe("rolling");
    expect([w.months[0], w.months[11]]).toEqual(["2026-11", "2027-10"]);
    expect(dashboardMonths(ED_2026, "2028-03-15").months[0]).toBe("2027-04");
  });

  it("show January to December of a chosen year", () => {
    const w = dashboardMonths(ED_2026, "2028-03-15", 2027);
    expect(w).toMatchObject({ mode: "year" });
    expect([w.months[0], w.months[11]]).toEqual(["2027-01", "2027-12"]);
  });

  it("offer the years from the Effective Date to now", () => {
    expect(dashboardYears(ED_2026, "2028-03-15")).toEqual([2026, 2027, 2028]);
    expect(dashboardYears(ED_2026, "2026-05-01")).toEqual([2026]);
  });
});

describe("buildDashboard (SPEC §10)", () => {
  const a = makeSubmission({ id: "a", ackNo: "A", documents: allDocs("Y"), principalLga: "Ifo" }); // E, ₦250k
  const b = makeSubmission({
    id: "b",
    ackNo: "B",
    registeredName: "Late Gen Ltd",
    cacNo: "RC2",
    primaryActivity: activity("GEN"),
    installedCapacityMw: 5,
    dateSubmitted: addDays(DEADLINE, 10),
    status: STATUS.DEFICIENCY,
    deficiencyNoticeDate: addDays(ED, 20),
  }); // D, late 10 days: ₦300k + ₦500k + ₦1m
  const c = makeSubmission({
    id: "c",
    ackNo: "C",
    registeredName: "Registered Ltd",
    cacNo: "RC3",
    status: STATUS.REGISTERED,
    registrationNo: "OGSERC/REG/2026/E-MGD/0001",
    certificateIssueDate: addDays(ED, 35),
    approvedWaiver: naira(50_000),
  }); // E, ₦200k after waiver
  const d = makeSubmission({
    id: "d",
    ackNo: "D",
    registeredName: "Refused Ltd",
    cacNo: "RC4",
    status: STATUS.REFUSED,
  });

  const pays: PaymentInput[] = [
    { ...payment("A", 250_000, ED), verifiedWithBank: "Y" },
    { ...payment("C", 200_000, addDays(ED, 30)), verifiedWithBank: "N" },
    { ...payment("C", 999_999, addDays(ED, 31)), status: "REVERSED" },
    { ...payment("OGSERC/OUN/2026/0001", 100_000, ED), verifiedWithBank: "Y" },
  ];
  const subs = [
    row(a, pays, "Ready for decision"),
    row(b, pays, "In progress"),
    row(c, pays, "Decided"),
    row(d, pays, "Decided"),
  ];
  const c2 = { otherNotifications: [], registerCacNos: [], payments: pays, ref, settings };
  const ownUse = [oun("1", 650, "Ifo"), oun("2", 150, "Odeda")].map((input) => ({
    input,
    assessment: assessOwnUse(input, c2),
  }));
  const dash = buildDashboard({
    today: TODAY,
    settings,
    ref,
    lgas: ["Ifo", "Odeda", "Ewekoro"],
    submissions: subs,
    ownUse,
    payments: pays,
  });

  it("key dates count down to the registration deadline", () => {
    expect(dash.keyDates).toEqual({
      effectiveDate: ED,
      registrationDeadline: DEADLINE,
      daysToDeadline: 20,
    });
  });

  it("counts submissions by state", () => {
    expect(dash.submissions).toEqual({
      total: 4,
      registered: 1,
      provisional: 0,
      inProgress: 2,
      closed: 1,
      ownUse: 2,
      late: 1,
    });
    expect(dash.evaluation).toEqual({
      "Not assigned": 0,
      "In progress": 1,
      "Ready for decision": 1,
      Decided: 2,
    });
  });

  it("sums money on live records; refused, lapsed and cancelled balances are shown apart", () => {
    // Due (live): A 250k + B 1.8m + C 200k + OUN 100k = 2.35m. D (Refused, 250k unpaid) is apart.
    // Collected counts every active payment: 250k + 200k + 100k.
    expect(dash.money).toEqual({
      totalDue: naira(2_350_000),
      collected: naira(550_000),
      verified: naira(350_000),
      outstanding: naira(1_800_000),
      collectionRate: (2_350_000 - 1_800_000) / 2_350_000,
      unpaidOnClosed: naira(250_000),
      overpaid: 0,
      overpaidSubmissions: 0,
      overpaidOwnUse: 0,
    });
  });

  it("shows overpayments as credits, never offsetting other balances", () => {
    const extra = { ...payment("A", 40_000, ED), verifiedWithBank: "Y" as const };
    const withCredit = buildDashboard({
      today: TODAY,
      settings,
      ref,
      lgas: [],
      submissions: subs.map((s) => (s.sub.id === "a" ? row(a, [...pays, extra]) : s)),
      ownUse,
      payments: [...pays, extra],
    });
    expect(withCredit.money).toMatchObject({
      overpaid: naira(40_000),
      overpaidSubmissions: 1,
      outstanding: naira(1_800_000),
      collected: naira(590_000),
    });
    expect(withCredit.money.collectionRate).toBeLessThanOrEqual(1);
  });

  it("breaks down by category, with Category I from own-use notifications", () => {
    const by = Object.fromEntries(dash.byCategory.map((r) => [r.category, r]));
    expect(by.E).toMatchObject({
      submissions: 3,
      registered: 1,
      fees: naira(750_000),
      waivers: naira(50_000),
      collected: naira(450_000),
      outstanding: 0, // the Refused one's ₦250,000 is in "unpaid on closed"
    });
    expect(by.D).toMatchObject({
      submissions: 1,
      lateCharges: naira(1_500_000),
      outstanding: naira(1_800_000),
    });
    expect(by.I).toMatchObject({
      submissions: 2,
      registered: null,
      fees: naira(100_000),
      collected: naira(100_000),
    });
  });

  it("breaks down by status, activity, LGA (registrants + own-use) and month", () => {
    expect(dash.byStatus.find((s) => s.status === STATUS.DEFICIENCY)?.count).toBe(1);
    expect(dash.byActivity.find((s) => s.code === "MGD")?.count).toBe(3);
    expect(dash.byLga).toEqual([
      { lga: "Ifo", registrants: 1, ownUse: 1 },
      { lga: "Odeda", registrants: 0, ownUse: 1 },
      { lga: "Ewekoro", registrants: 0, ownUse: 0 },
    ]);
    expect(dash.monthly[0]).toEqual({
      month: "2026-10",
      submissions: 3,
      registered: 0,
      collected: naira(350_000),
    });
    expect(dash.monthly[1]).toEqual({
      month: "2026-11",
      submissions: 0,
      registered: 1,
      collected: naira(200_000),
    });
    expect(dash.monthly[2]).toMatchObject({ month: "2026-12", submissions: 1 });
  });

  it("flags the deficiency response as overdue (Red) and averages open queue days", () => {
    expect(dash.workflow.red).toBe(1);
    // Open: A (40 days) and B (dated after "today", so 0 days, never negative).
    expect(dash.workflow.averageDaysInQueue).toBe(20);
  });
});

describe("workQueues (§10)", () => {
  const officers = {
    evaluatingOfficerId: "u1",
    reviewingSupervisorId: "u2",
    approvingOfficerId: "u3",
  };
  const q = (
    sub: SubmissionInput,
    evaluationStatus: QueueSubmission["evaluationStatus"],
    finalDecision: string | null = null,
  ): QueueSubmission => ({
    ...row(sub, [], evaluationStatus),
    officers,
    finalDecision,
  });
  const rows = [
    q(makeSubmission({ id: "r", ackNo: "R" }), "Ready for decision"),
    q(
      makeSubmission({ id: "o", ackNo: "O", status: STATUS.DEFICIENCY, deficiencyNoticeDate: ED }),
      "In progress",
    ),
    q(
      makeSubmission({ id: "x", ackNo: "X", status: STATUS.REGISTERED, registrationNo: "R1" }),
      "Decided",
      "Register (13(1)(a))",
    ),
  ];

  it("lists my assigned open evaluations with my role", () => {
    const { mine } = workQueues(rows, "u3", TODAY);
    expect(mine.map((m) => [m.ackNo, m.roles])).toEqual([
      ["R", ["Approving officer"]],
      ["O", ["Approving officer"]],
    ]);
    expect(workQueues(rows, "nobody", TODAY).mine).toEqual([]);
  });

  it("lists overdue deficiency responses awaiting lapse, and ready-for-decision work", () => {
    const { overdueDeficiency, readyForDecision } = workQueues(rows, "u1", TODAY);
    expect(overdueDeficiency.map((m) => [m.ackNo, m.daysOverdue])).toEqual([["O", 26]]);
    expect(readyForDecision.map((m) => m.ackNo)).toEqual(["R"]);
  });
});
