// SPEC §11 test fixtures. Each `describe` is one row of the table.
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { dataFlags } from "../flags";
import { recommendedOutcome } from "../evaluation";
import { checkOwnUseCapacity, ownUseEligibility, ownUseFeeDue } from "../own-use";
import { registrationDeadline } from "../deadlines";
import { assessSubmission } from "../submission";
import { nextAction } from "../next-action";
import { nextRegistrationSerial, registrationNoInUse } from "../numbers";
import { FINAL_DECISION, LICENCE, STATUS } from "../types";
import { approvalBlockers, approvalChanges, dailyReview, lapseBlockers } from "../workflow";
import {
  DEADLINE,
  ED,
  activity,
  allDocs,
  ctx,
  evaluate,
  makeEvaluation,
  makeSubmission,
  naira,
  payment,
  readySettings,
  ref,
  settings,
} from "./helpers";

describe("Example mini-grid: MGD, 2.5 MW, on time", () => {
  const sub = makeSubmission({
    primaryActivity: activity("MGD"),
    installedCapacityMw: 2.5,
    dateSubmitted: ED,
  });
  const a = assessSubmission(sub, [], ctx());

  it("is Category E with fee ₦250,000 and no late charge", () => {
    expect(a.categoryApplied).toBe("E");
    expect(a.fees.fee).toBe(naira(250_000));
    expect(a.daysLate).toBe(0);
    expect(a.fees.lateCharge).toBe(0);
  });
});

describe("Mighty Power: MSL, 60 MW, Unlicensed, submitted on Effective Date", () => {
  const sub = makeSubmission({
    registeredName: "Mighty Power Ltd",
    primaryActivity: activity("MSL"),
    installedCapacityMw: 60,
    licenceStatus: LICENCE.UNLICENSED,
    licenceNo: null,
    dateSubmitted: ED,
  });
  const a = assessSubmission(sub, [], ctx());
  const flags = dataFlags(sub, a, [], ctx());

  it("is Category F with fee ₦500,000", () => {
    expect(a.categoryApplied).toBe("F");
    expect(a.fees.fee).toBe(naira(500_000));
  });

  it('flags "Check licence status for multi-State licensee"', () => {
    expect(flags.map((f) => f.message)).toContain("Check licence status for multi-State licensee");
  });

  it("has licence application due = Effective Date + 90", () => {
    expect(a.licenceApplicationDue).toBe(addDays(ED, 90));
    expect(a.licenceApplicationDue).toBe("2027-01-20");
  });
});

describe("Late tier 2: Category D, 20 days late", () => {
  const sub = makeSubmission({
    primaryActivity: activity("GEN"),
    installedCapacityMw: 5,
    dateSubmitted: addDays(DEADLINE, 20),
  });
  const a = assessSubmission(sub, [], ctx(addDays(DEADLINE, 20)));

  it("late = 500,000 + min(100,000×20, 10,000,000) = ₦2,500,000; total ₦2,800,000", () => {
    expect(a.categoryApplied).toBe("D");
    expect(a.daysLate).toBe(20);
    expect(a.fees.lateCharge).toBe(naira(2_500_000));
    expect(a.fees.totalDue).toBe(naira(2_800_000));
  });
});

describe("Late tier 1 at cap: Category A, 150 days late", () => {
  const sub = makeSubmission({
    primaryActivity: activity("SDC"),
    dateSubmitted: addDays(DEADLINE, 150),
  });
  const a = assessSubmission(sub, [], ctx(addDays(DEADLINE, 150)));

  it("late = 1,000,000 + min(30,000,000, 20,000,000) = ₦21,000,000", () => {
    expect(a.categoryApplied).toBe("A");
    expect(a.daysLate).toBe(150);
    expect(a.fees.lateCharge).toBe(naira(21_000_000));
  });
});

describe("Late tier 3: Category K, 5 days late", () => {
  const sub = makeSubmission({
    primaryActivity: activity("SUP"),
    dateSubmitted: addDays(DEADLINE, 5),
  });
  const a = assessSubmission(sub, [], ctx(addDays(DEADLINE, 5)));

  it("late = 100,000 + 50,000 = ₦150,000", () => {
    expect(a.categoryApplied).toBe("K");
    expect(a.fees.lateCharge).toBe(naira(150_000));
  });
});

describe("Highest applies: primary GEN 5 MW (D, ₦300k) + secondary EST (G, ₦500k)", () => {
  it("is Category G", () => {
    const sub = makeSubmission({
      primaryActivity: activity("GEN"),
      secondaryActivity: activity("EST"),
      installedCapacityMw: 5,
    });
    expect(assessSubmission(sub, [], ctx()).categoryApplied).toBe("G");
  });
});

describe("A dominates: secondary SDC", () => {
  it.each(["GEN", "EST", "MGD", "INT"])("primary %s + secondary SDC is Category A", (primary) => {
    const sub = makeSubmission({
      primaryActivity: activity(primary),
      secondaryActivity: activity("SDC"),
      installedCapacityMw: 5,
    });
    expect(assessSubmission(sub, [], ctx()).categoryApplied).toBe("A");
  });
});

describe("Capacity tiers: GEN 0.5 / 5 / 15 MW", () => {
  it.each([
    [0.5, "K"],
    [5, "D"],
    [15, "C"],
  ])("GEN %s MW is Category %s", (mw, cat) => {
    const sub = makeSubmission({ primaryActivity: activity("GEN"), installedCapacityMw: mw });
    expect(assessSubmission(sub, [], ctx()).categoryApplied).toBe(cat);
  });
});

describe("New operator: not operating, start 2027-03-01", () => {
  it("has deadline 2027-01-30", () => {
    expect(registrationDeadline("N", "2027-03-01", settings)).toBe("2027-01-30");
    const sub = makeSubmission({ operatingOnEffectiveDate: "N", plannedStartDate: "2027-03-01" });
    expect(assessSubmission(sub, [], ctx()).registrationDeadline).toBe("2027-01-30");
  });
});

describe("Waiver: fee 500k, waiver 100k, paid 400k, no late charge", () => {
  const base = {
    primaryActivity: activity("EST"),
    approvedWaiver: naira(100_000),
  };
  const payments = [payment("OGSERC/ACK/2026/00001", 400_000)];

  it("is Paid and complete when documents are complete", () => {
    const a = assessSubmission(
      makeSubmission({ ...base, documents: allDocs("Y") }),
      payments,
      ctx(),
    );
    expect(a.fees.fee).toBe(naira(500_000));
    expect(a.fees.lateCharge).toBe(0);
    expect(a.fees.totalDue).toBe(naira(400_000));
    expect(a.fees.paymentStatus).toBe("Paid");
    expect(a.submissionComplete).toBe(true);
  });

  it("is Paid but not complete while a document is outstanding", () => {
    const docs = allDocs("Y");
    docs[3] = "N";
    const a = assessSubmission(makeSubmission({ ...base, documents: docs }), payments, ctx());
    expect(a.fees.paymentStatus).toBe("Paid");
    expect(a.submissionComplete).toBe(false);
  });
});

describe("Own-use: 150 / 650 / 1200 kW", () => {
  it("150 kW: warn and allow with confirmation, no fee", () => {
    expect(ownUseEligibility(150, settings)).toBe("Not required");
    expect(checkOwnUseCapacity(150, settings).outcome).toBe("confirm");
    expect(ownUseFeeDue(150, ref, settings)).toBe(0);
  });

  it("650 kW: Category I fee ₦100,000", () => {
    expect(ownUseEligibility(650, settings)).toBe("Notification required");
    expect(checkOwnUseCapacity(650, settings).outcome).toBe("ok");
    expect(ownUseFeeDue(650, ref, settings)).toBe(naira(100_000));
  });

  it("1200 kW: reject, register as captive generation", () => {
    const result = checkOwnUseCapacity(1200, settings);
    expect(result.outcome).toBe("reject");
    expect(result.outcome === "reject" && result.message).toContain("para 3(3)(c)");
  });
});

describe("Provisional: complete on day 0, no decision", () => {
  const day0 = "2026-11-02";
  const sub = makeSubmission({
    documents: allDocs("Y"),
    dateSubmissionComplete: day0,
    dateSubmitted: day0,
  });
  const payments = [payment(sub.ackNo!, 250_000, day0)];
  const reviewOn = (day: number) => {
    const today = addDays(day0, day);
    return dailyReview([{ sub, assessment: assessSubmission(sub, payments, ctx(today)) }], today);
  };

  it("day 30 daily review leaves it under review", () => {
    expect(reviewOn(30).toProvisional).toEqual([]);
  });

  it("day 31 daily review makes it Provisionally Registered, using the ack number", () => {
    const result = reviewOn(31);
    expect(result.toProvisional).toEqual([sub.id]);

    const provisional = { ...sub, status: STATUS.PROVISIONAL };
    const a = assessSubmission(provisional, payments, ctx(addDays(day0, 31)));
    expect(a.registrationNoInUse).toBe(sub.ackNo);
    expect(registrationNoInUse(null, STATUS.PROVISIONAL, sub.ackNo)).toBe(sub.ackNo);
    expect(nextAction(provisional, a, addDays(day0, 31))).toBe(
      "Determine and issue the certificate",
    );
  });

  it("recommends provisional registration once the determination period has passed", () => {
    const { checks, counts, assessment } = evaluate({ sub, payments, today: addDays(day0, 31) });
    expect(
      recommendedOutcome(checks, counts, sub, assessment, makeEvaluation(), addDays(day0, 31)),
    ).toBe(FINAL_DECISION.PROVISIONAL);
  });
});

describe("Lapse: deficiency on day 0", () => {
  const day0 = "2026-11-02";
  const sub = makeSubmission({ status: STATUS.DEFICIENCY, deficiencyNoticeDate: day0 });
  const blockersOn = (day: number) => {
    const today = addDays(day0, day);
    return lapseBlockers(sub.status, assessSubmission(sub, [], ctx(today)), today);
  };

  it("lapse is blocked on day 14", () => {
    expect(blockersOn(14)).not.toEqual([]);
  });

  it("lapse is allowed on day 15", () => {
    expect(blockersOn(15)).toEqual([]);
  });
});

describe("Approval blockers: each missing officer / pending check / failed check / incomplete", () => {
  it("a fully ready submission has no blockers", () => {
    expect(approvalBlockers(evaluate().approval)).toEqual([]);
  });

  it.each([
    ["evaluatingOfficerId", "No evaluating officer assigned"],
    ["reviewingSupervisorId", "No reviewing supervisor assigned"],
    ["approvingOfficerId", "No approving officer assigned"],
  ] as const)("missing %s is refused", (field, reason) => {
    const { approval } = evaluate({ evaluation: makeEvaluation({ [field]: null }) });
    expect(approvalBlockers(approval)).toContain(reason);
  });

  it("a pending check is refused", () => {
    const { approval } = evaluate({ manual: { "2.1": null } });
    expect(approvalBlockers(approval)).toContain("1 evaluation check(s) pending");
  });

  it("a failed check is refused", () => {
    const { approval } = evaluate({ manual: { "2.1": "N" } });
    expect(approvalBlockers(approval)).toContain("1 evaluation check(s) failed");
  });

  it("an incomplete submission is refused", () => {
    const docs = allDocs("Y");
    docs[0] = "N";
    const sub = makeSubmission({ documents: docs, dateSubmissionComplete: ED });
    expect(approvalBlockers(evaluate({ sub }).approval)).toContain(
      "Submission is not complete (documents or fees outstanding)",
    );
  });

  it("lists every reason when several fail at once", () => {
    const sub = makeSubmission({ documents: allDocs(null) });
    const { approval } = evaluate({
      sub,
      payments: [],
      manual: { "2.1": "N", "2.2": null },
      evaluation: makeEvaluation({ evaluatingOfficerId: null, reviewingSupervisorId: null }),
    });
    const reasons = approvalBlockers(approval);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "No evaluating officer assigned",
        "No reviewing supervisor assigned",
        "Submission is not complete (documents or fees outstanding)",
        expect.stringMatching(/check\(s\) failed$/),
        expect.stringMatching(/check\(s\) pending$/),
      ]),
    );
  });
});

describe("Separation: approver == evaluator", () => {
  it("approval is refused", () => {
    const { approval } = evaluate({
      evaluation: makeEvaluation({ evaluatingOfficerId: "u1", approvingOfficerId: "u1" }),
    });
    expect(approvalBlockers(approval)).toContain(
      "The approving officer cannot be the evaluating officer",
    );
  });
});

describe("Reg serial: 3 certificates in 2026, 1 in 2027", () => {
  it("numbers .../0001–0003 then 2027/.../0001, across categories", () => {
    const issued: string[] = [];
    const approve = (code: string, mw: number, today: string) => {
      const sub = makeSubmission({
        primaryActivity: activity(code),
        installedCapacityMw: mw,
        documents: allDocs("Y"),
      });
      const { approval } = evaluate({
        sub,
        payments: [payment(sub.ackNo!, 1_000_000)],
        today,
        settings: readySettings,
      });
      const serial = nextRegistrationSerial("OGSERC/REG", today, issued);
      const changes = approvalChanges(approval, "Approver", serial, today);
      issued.push(changes.submission.registrationNo!);
      return changes;
    };

    approve("MSL", 0, "2026-11-01");
    approve("GEN", 5, "2026-11-15");
    approve("MSL", 0, "2026-12-30");
    const first2027 = approve("MGD", 2, "2027-01-04");

    expect(issued).toEqual([
      "OGSERC/REG/2026/F-MSL/0001",
      "OGSERC/REG/2026/D-GEN/0002",
      "OGSERC/REG/2026/F-MSL/0003",
      "OGSERC/REG/2027/E-MGD/0001",
    ]);
    expect(first2027.submission.status).toBe(STATUS.REGISTERED);
    expect(first2027.submission.certificateIssueDate).toBe("2027-01-04");
    expect(first2027.evaluation.finalDecision).toBe(FINAL_DECISION.REGISTER);
    expect(first2027.auditDetail).toBe("OGSERC/REG/2027/E-MGD/0001 - approved by Approver");
  });
});
