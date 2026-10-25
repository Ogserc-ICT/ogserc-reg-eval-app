// Edge cases for §2.12 flags, §4 workflow guards, §4.11 evaluation and §6 auto checks.
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import {
  evaluationProgress,
  evaluationStatus,
  fileClosed,
  recommendedOutcome,
} from "../evaluation";
import { dataFlags, type OtherSubmission } from "../flags";
import { ownUseFiledLate, ownUseFlags, type OwnUseInput } from "../own-use";
import { assessSubmission } from "../submission";
import { FINAL_DECISION, LICENCE, STATUS } from "../types";
import {
  approvalBlockers,
  cancelBlockers,
  dailyReview,
  deficiencyNoticeCheck,
  lapseBlockers,
  markComplete,
  refusalBlockers,
  separationOfDutiesViolations,
} from "../workflow";
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
  licence,
  other as otherRow,
} from "./helpers";

const codes = (
  overrides: Parameters<typeof makeSubmission>[0],
  others: OtherSubmission[] = [],
  today = ED,
) => {
  const sub = makeSubmission(overrides);
  const c = ctx(today);
  return dataFlags(sub, assessSubmission(sub, [], c), others, c).map((f) => f.code);
};

describe("data flags (§2.12)", () => {
  it("raises none on a clean record", () => {
    expect(codes({})).toEqual([]);
  });

  it("finds duplicates on other submissions only", () => {
    const other = otherRow({
      id: "sub-2",
      cacNo: "rc123456",
      registeredName: " example  mini-grid ltd ",
    });
    expect(codes({}, [other])).toEqual(expect.arrayContaining(["DUPLICATE_CAC", "DUPLICATE_NAME"]));
    expect(codes({}, [{ ...other, id: "sub-1" }])).toEqual([]);
  });

  it("finds a duplicate registration number", () => {
    const other = otherRow({ id: "sub-2", registrationNo: "R/1" });
    expect(
      codes(
        {
          registrationNo: "R/1",
          status: STATUS.REGISTERED,
          certificateIssueDate: ED,
          documents: allDocs("Y"),
        },
        [other],
      ),
    ).toContain("DUPLICATE_REG_NO");
  });

  it("lists missing required fields", () => {
    const sub = makeSubmission({ registeredName: " ", principalLga: null });
    const c = ctx();
    const flag = dataFlags(sub, assessSubmission(sub, [], c), [], c).find(
      (f) => f.code === "MISSING_REQUIRED",
    );
    expect(flag?.message).toBe("Missing required field: registered name, principal LGA");
  });

  it("flags unknown activities and missing capacity", () => {
    expect(codes({ primaryActivity: "Bitcoin mining" })).toContain("UNKNOWN_ACTIVITY");
    expect(codes({ otherActivities: ["Bitcoin mining"] })).toContain("UNKNOWN_OTHER_ACTIVITY");
    expect(codes({ installedCapacityMw: null })).toContain("NO_CAPACITY");
    expect(codes({ primaryActivity: activity("EST"), installedCapacityMw: null })).not.toContain(
      "NO_CAPACITY",
    );
  });

  it("flags an override without a reason", () => {
    expect(codes({ categoryOverride: "G" })).toContain("OVERRIDE_NO_REASON");
    expect(codes({ categoryOverride: "G", overrideReason: "Board decision" })).not.toContain(
      "OVERRIDE_NO_REASON",
    );
    expect(codes({ categoryOverride: "E" })).not.toContain("OVERRIDE_NO_REASON");
  });

  it("flags certificate inconsistencies", () => {
    expect(codes({ certificateIssueDate: ED })).toEqual(
      expect.arrayContaining(["CERT_NOT_COMPLETE", "CERT_STATUS"]),
    );
    expect(codes({ status: STATUS.REGISTERED })).toContain("REGISTERED_NO_CERT_DATE");
  });

  it("flags licence renewal, CPT below 1 MW, MSL licence", () => {
    expect(codes({ licences: [licence("N/1", addDays(ED, 100))] })).toContain("LICENCE_RENEWAL");
    // The nearest expiry of several licences counts.
    expect(
      codes({ licences: [licence("N/1", addDays(ED, 900)), licence("N/2", addDays(ED, 100))] }),
    ).toContain("LICENCE_RENEWAL");
    expect(codes({ licences: [licence("N/1", addDays(ED, 900))] })).not.toContain(
      "LICENCE_RENEWAL",
    );
    expect(codes({ primaryActivity: activity("CPT"), installedCapacityMw: 0.8 })).toContain(
      "CPT_BELOW_1MW",
    );
    expect(
      codes({ primaryActivity: activity("MSL"), licenceStatus: LICENCE.MULTI_STATE }),
    ).not.toContain("MSL_LICENCE");
  });

  it("flags timing problems", () => {
    expect(codes({ operatingOnEffectiveDate: "N" })).toContain("NO_START_DATE");
    expect(codes({ dateSubmitted: addDays(ED, 1) })).toContain("FUTURE_SUBMISSION");
    const unlicensed = { licenceStatus: LICENCE.UNLICENSED, licences: [] };
    expect(codes(unlicensed, [], addDays(ED, 90))).not.toContain("LICENCE_APPLICATION_OVERDUE");
    expect(codes(unlicensed, [], addDays(ED, 91))).toContain("LICENCE_APPLICATION_OVERDUE");
  });

  it("flags contradictory licence data (new rules)", () => {
    expect(codes({ licenceStatus: LICENCE.UNLICENSED, licences: [licence("X1")] })).toContain(
      "LICENCE_NO_WITHOUT_LICENCE",
    );
    expect(codes({ licenceStatus: LICENCE.PENDING, licences: [licence("X1")] })).toContain(
      "LICENCE_NO_WITHOUT_LICENCE",
    );
    expect(codes({ licences: [] })).toContain("LICENCE_NO_MISSING");
    // A licence row without a number does not count as a number.
    expect(codes({ licences: [licence(null)] })).toContain("LICENCE_NO_MISSING");
    expect(codes({ licences: [licence(null), licence("N/2")] })).not.toContain(
      "LICENCE_NO_MISSING",
    );
    expect(codes({ licenceStatus: LICENCE.UNLICENSED, licences: [] })).not.toContain(
      "LICENCE_NO_MISSING",
    );
  });

  it("flags ≥10 MW generation outside C/A/B", () => {
    const gen = { primaryActivity: activity("GEN"), installedCapacityMw: 15 };
    expect(codes(gen)).not.toContain("GENERATION_CATEGORY");
    expect(codes({ ...gen, categoryOverride: "D", overrideReason: "x" })).toContain(
      "GENERATION_CATEGORY",
    );
  });

  it("flags CAC and TIN format", () => {
    expect(codes({ cacNo: "123456" })).toContain("CAC_FORMAT");
    const sub = makeSubmission({ tin: "12" });
    const strict = { ...settings, policy: { ...settings.policy, tinPattern: "^\\d{8}-\\d{4}$" } };
    const c = ctx(ED, strict);
    expect(dataFlags(sub, assessSubmission(sub, [], c), [], c).map((f) => f.code)).toContain(
      "TIN_FORMAT",
    );
    expect(codes({ tin: "12" })).not.toContain("TIN_FORMAT");
  });
});

describe("evaluation auto checks (§6)", () => {
  const value = (checks: ReturnType<typeof evaluate>["checks"], id: string) =>
    checks.find((c) => c.id === id);

  it("counts 56 decision checks", () => {
    expect(evaluate().counts.total).toBe(56);
  });

  it("marks 2.4 and 4.2 N/A when Unlicensed (new rule)", () => {
    const sub = makeSubmission({ licenceStatus: LICENCE.UNLICENSED, licences: [] });
    const { checks } = evaluate({ sub });
    expect(value(checks, "2.4")).toMatchObject({ value: "N/A", mode: "auto-na" });
    expect(value(checks, "4.2")).toMatchObject({ value: "N/A", mode: "auto-na" });
    expect(value(checks, "4.9")).toMatchObject({ value: "Y", mode: "manual" });
    expect(value(checks, "7.1")).toMatchObject({ value: "Y", mode: "manual" });
  });

  it("leaves conditional checks manual (and blank) when the condition applies", () => {
    const sub = makeSubmission({
      primaryActivity: activity("MSL"),
      licenceStatus: LICENCE.MULTI_STATE,
    });
    const { checks } = evaluate({ sub, manual: { "1.7": null } });
    expect(value(checks, "1.7")).toMatchObject({ value: null, mode: "manual" });
    expect(value(checks, "7.3")?.mode).toBe("manual");
  });

  it("computes scope checks 1.3, 1.4, 1.5", () => {
    expect(
      value(evaluate({ sub: makeSubmission({ primaryActivity: "Nope" }) }).checks, "1.3")?.value,
    ).toBe("N");
    const cpt = makeSubmission({ primaryActivity: activity("CPT"), installedCapacityMw: 0.5 });
    expect(value(evaluate({ sub: cpt }).checks, "1.4")?.value).toBe("N");
    const dup = evaluate({
      others: [otherRow({ id: "x", cacNo: "RC123456" })],
    });
    expect(value(dup.checks, "1.5")?.value).toBe("N");
  });

  it("computes lateness checks 1.8, 1.9, 5.4", () => {
    const onTime = evaluate().checks;
    expect(["1.8", "1.9", "5.4"].map((id) => value(onTime, id)?.value)).toEqual([
      "Y",
      "N/A",
      "N/A",
    ]);
    const late = evaluate({
      sub: makeSubmission({ dateSubmitted: addDays(DEADLINE, 2) }),
      today: addDays(DEADLINE, 2),
    }).checks;
    expect(["1.8", "1.9", "5.4"].map((id) => value(late, id)?.value)).toEqual(["N", "Y", "Y"]);
  });

  it("computes document, fee and licence-expiry checks", () => {
    const incomplete = evaluate({ sub: makeSubmission() }).checks;
    expect(value(incomplete, "3.0")?.value).toBe("N");
    expect(value(incomplete, "3.1")?.mode).toBe("manual");
    expect(value(evaluate().checks, "3.1")?.value).toBe("N/A");
    expect(value(evaluate({ payments: [] }).checks, "5.5")?.value).toBe("N");
    expect(value(evaluate().checks, "4.3")?.value).toBe("N/A");
    const expiring = makeSubmission({
      licences: [licence("N/1", addDays(ED, 30))],
      documents: allDocs("Y"),
    });
    expect(value(evaluate({ sub: expiring }).checks, "4.3")?.value).toBe("N");
    const fine = makeSubmission({
      licences: [licence("N/1", addDays(ED, 400))],
      documents: allDocs("Y"),
    });
    expect(value(evaluate({ sub: fine }).checks, "4.3")?.value).toBe("Y");
  });

  it("marks 3.2 N/A for companies and empty type, manual otherwise", () => {
    expect(value(evaluate().checks, "3.2")?.mode).toBe("auto-na");
    const coop = makeSubmission({ registrantType: "Cooperative" });
    expect(value(evaluate({ sub: coop }).checks, "3.2")?.mode).toBe("manual");
  });

  it("7.6 is Y with no flags or with an explanation, N otherwise", () => {
    const flagged = makeSubmission({
      documents: allDocs("Y"),
      dateSubmissionComplete: ED,
      licences: [],
    });
    expect(value(evaluate({ sub: flagged }).checks, "7.6")?.value).toBe("N");
    const explained = evaluate({
      sub: flagged,
      evaluation: makeEvaluation({ flagOverrideReason: "Licence no. pending from NERC" }),
    });
    expect(value(explained.checks, "7.6")?.value).toBe("Y");
  });

  it("tracks post-approval checks and file closure", () => {
    const { checks } = evaluate();
    expect(value(checks, "9.1")?.value).toBeNull();
    expect(fileClosed(checks)).toBe(false);
    const registered = makeSubmission({
      status: STATUS.REGISTERED,
      certificateIssueDate: ED,
      registrationNo: "R/1",
      documents: allDocs("Y"),
    });
    expect(fileClosed(evaluate({ sub: registered }).checks)).toBe(true);
  });
});

describe("evaluation status and recommended outcome (§4.11)", () => {
  const outcome = (r: ReturnType<typeof evaluate>, today = ED) =>
    recommendedOutcome(r.checks, r.counts, r.sub, r.assessment, r.evaluation, today);

  it("derives status", () => {
    const r = evaluate();
    expect(evaluationStatus(r.evaluation, r.counts)).toBe("Ready for decision");
    expect(evaluationStatus(makeEvaluation({ evaluatingOfficerId: null }), r.counts)).toBe(
      "Not assigned",
    );
    expect(evaluationStatus(r.evaluation, evaluate({ manual: { "2.1": null } }).counts)).toBe(
      "In progress",
    );
    expect(
      evaluationStatus(makeEvaluation({ finalDecision: FINAL_DECISION.REGISTER }), r.counts),
    ).toBe("Decided");
  });

  it("recommends in priority order", () => {
    expect(outcome(evaluate())).toBe(FINAL_DECISION.REGISTER);
    expect(outcome(evaluate({ manual: { "2.1": null } }))).toBe("Evaluation in progress");
    expect(outcome(evaluate({ manual: { "2.1": "N" } }))).toBe(FINAL_DECISION.DEFICIENCY);
    const cpt = makeSubmission({
      primaryActivity: activity("CPT"),
      installedCapacityMw: 0.5,
      documents: allDocs("Y"),
    });
    expect(outcome(evaluate({ sub: cpt }))).toBe(FINAL_DECISION.REDIRECT);
    const def = makeSubmission({ status: STATUS.DEFICIENCY, deficiencyNoticeDate: ED });
    expect(outcome(evaluate({ sub: def }), addDays(ED, 15))).toBe(FINAL_DECISION.LAPSE);
  });

  it("computes progress over 55 checks", () => {
    expect(evaluationProgress(evaluate().counts)).toBe(1);
    expect(evaluationProgress(evaluate({ manual: { "2.1": null } }).counts)).toBeCloseTo(54 / 55);
  });
});

describe("workflow guards (§4, §5)", () => {
  it("separation of duties catches every pairing", () => {
    expect(
      separationOfDutiesViolations({
        evaluatingOfficerId: "a",
        reviewingSupervisorId: "a",
        approvingOfficerId: "a",
        createdById: "a",
      }),
    ).toHaveLength(4);
    expect(
      separationOfDutiesViolations({
        evaluatingOfficerId: null,
        reviewingSupervisorId: null,
        approvingOfficerId: null,
        createdById: null,
      }),
    ).toEqual([]);
  });

  it("blocks approval by the submission's creator, a non-assigned approver, and on closed records", () => {
    const r = evaluate();
    expect(approvalBlockers({ ...r.approval, createdById: "approver" })).toContain(
      "The approving officer cannot be the user who created the submission",
    );
    expect(approvalBlockers({ ...r.approval, actorId: "someone-else" })).toContain(
      "Only the assigned approving officer can decide",
    );
    const closed = evaluate({
      sub: makeSubmission({ status: STATUS.REFUSED, documents: allDocs("Y") }),
    });
    expect(approvalBlockers(closed.approval)).toContain("Submission is closed (Refused)");
  });

  it("blocks approval while signatories are '[Name]'", () => {
    expect(approvalBlockers(evaluate({ settings }).approval)).toContain(
      "Certificate signatory names are not set in Settings",
    );
  });

  it("blocks approval on flags unless an override reason is recorded, or always under the strict policy", () => {
    const flagged = makeSubmission({
      documents: allDocs("Y"),
      dateSubmissionComplete: ED,
      licences: [],
    });
    const blocked = approvalBlockers(evaluate({ sub: flagged }).approval);
    expect(blocked.some((r) => r.includes("unresolved data flag"))).toBe(true);

    const overridden = evaluate({
      sub: flagged,
      evaluation: makeEvaluation({ flagOverrideReason: "NERC confirmed by letter" }),
    });
    expect(approvalBlockers(overridden.approval)).toEqual([]);

    const strict = {
      ...readySettings,
      policy: { ...readySettings.policy, flagsBlockApproval: true },
    };
    const strictRun = evaluate({
      sub: flagged,
      settings: strict,
      evaluation: makeEvaluation({ flagOverrideReason: "x" }),
    });
    expect(
      approvalBlockers(strictRun.approval).some((r) => r.includes("unresolved data flag")),
    ).toBe(true);
  });

  it("marks complete only when complete, keeping an existing date", () => {
    const sub = makeSubmission({ documents: allDocs("Y") });
    const pays = [payment(sub.ackNo!, 250_000)];
    expect(markComplete(sub, assessSubmission(sub, pays, ctx()), ED, settings)).toEqual({
      ok: true,
      dateSubmissionComplete: ED,
      determinationDue: "2026-11-21",
      changed: true,
    });
    const dated = { ...sub, dateSubmissionComplete: "2026-10-25" };
    expect(
      markComplete(dated, assessSubmission(dated, pays, ctx()), addDays(ED, 5), settings),
    ).toMatchObject({
      dateSubmissionComplete: "2026-10-25",
      changed: false,
    });
    const notYet = markComplete(
      sub,
      assessSubmission(sub, [payment(sub.ackNo!, 100_000)], ctx()),
      ED,
      settings,
    );
    expect(notYet).toMatchObject({ ok: false, shortfall: naira(150_000) });
  });

  it("guards the deficiency notice", () => {
    const counts = evaluate().counts;
    expect(deficiencyNoticeCheck(STATUS.LAPSED, counts, false).blockers).not.toEqual([]);
    expect(deficiencyNoticeCheck(STATUS.RECEIVED, counts, true).needsConfirmation).not.toBeNull();
    expect(deficiencyNoticeCheck(STATUS.RECEIVED, { ...counts, failed: 1 }, true)).toEqual({
      blockers: [],
      needsConfirmation: null,
    });
  });

  it("allows lapse only from Deficiency Notice Issued", () => {
    const sub = makeSubmission({ status: STATUS.RECEIVED, deficiencyNoticeDate: ED });
    expect(
      lapseBlockers(sub.status, assessSubmission(sub, [], ctx(addDays(ED, 30))), addDays(ED, 30)),
    ).not.toEqual([]);
  });

  it("refuses only after the 14-day show-cause period with a permitted ground", () => {
    const ok = (today: string, ground: string | null = "False or misleading information") =>
      refusalBlockers(STATUS.RECEIVED, ED, ground, today, settings);
    expect(ok(addDays(ED, 13))).toEqual(["The 14-day show-cause period has not ended"]);
    expect(ok(addDays(ED, 14))).toEqual([]);
    expect(ok(addDays(ED, 14), null)).toEqual(["Grounds for refusal are required"]);
    expect(ok(addDays(ED, 14), "Did not like them")).toEqual([
      "Grounds must be one allowed by the Order",
    ]);
    expect(
      refusalBlockers(STATUS.RECEIVED, null, "False or misleading information", ED, settings),
    ).toEqual(["No show-cause notice date recorded"]);
  });

  it("requires a reason to cancel", () => {
    expect(cancelBlockers(STATUS.REGISTERED, "Ceased operations")).toEqual([]);
    expect(cancelBlockers(STATUS.REGISTERED, " ")).toEqual(["A reason is required"]);
    expect(cancelBlockers(STATUS.CANCELLED, "x")).not.toEqual([]);
  });

  it("daily review lists overdue deficiencies, numbers to lock, and a summary", () => {
    const today = addDays(ED, 20);
    const items = [
      makeSubmission({ id: "d", status: STATUS.DEFICIENCY, deficiencyNoticeDate: ED }),
      makeSubmission({ id: "r", status: STATUS.REGISTERED, certificateIssueDate: ED }),
      makeSubmission({ id: "p", status: STATUS.PROVISIONAL, dateSubmissionComplete: "2026-08-01" }),
    ].map((sub) => ({ sub, assessment: assessSubmission(sub, [], ctx(today)) }));
    const result = dailyReview(items, today);
    expect(result).toMatchObject({
      toProvisional: [],
      overdueDeficiency: ["d"],
      toLock: ["r"],
      red: 1,
    });
    expect(result.summary).toContain("overdue deficiency responses: 1");
  });
});

describe("own-use notifications (§4.3)", () => {
  const unit = (capacityKw: number) => ({
    makeModel: null,
    capacityKw,
    fuel: "Diesel",
    avgMonthlyMwh: null,
  });
  const base: OwnUseInput = {
    id: "o1",
    ounNo: "OGSERC/OUN/2026/0001",
    name: "Factory Ltd",
    dateFiled: ED,
    cacNo: "RC1",
    siteAddress: "Plot 1, Ifo Industrial Estate",
    lga: "Ifo",
    units: [unit(400), unit(250)],
    documents: {},
    pricing: null,
    registrationNo: null,
    certificateIssueDate: null,
  };
  const flagCtx = (over: Partial<Parameters<typeof ownUseFlags>[1]> = {}) => ({
    otherNotifications: [],
    registerCacNos: [],
    payments: [],
    ref,
    settings,
    ...over,
  });

  it("flags an unpaid fee until the Category I fee is paid", () => {
    expect(ownUseFlags(base, flagCtx()).map((f) => f.code)).toEqual(["FEE_UNPAID"]);
    expect(ownUseFlags(base, flagCtx({ payments: [payment(base.ounNo!, 100_000)] }))).toEqual([]);
    expect(ownUseFlags({ ...base, units: [unit(100), unit(50)] }, flagCtx())).toEqual([]);
  });

  it("flags the same CAC and site address, missing fields and a CAC on the Register", () => {
    const flags = ownUseFlags(
      { ...base, lga: null },
      flagCtx({
        otherNotifications: [{ ...base, id: "o2", siteAddress: " plot 1,  ifo industrial estate" }],
        registerCacNos: ["rc1"],
        payments: [payment(base.ounNo!, 100_000)],
      }),
    ).map((f) => f.code);
    expect(flags).toEqual(["MISSING_REQUIRED", "DUPLICATE_SITE", "CAC_ON_REGISTER"]);
  });

  it("allows one registrant several sites (no duplicate-CAC flag between notifications)", () => {
    const flags = ownUseFlags(
      base,
      flagCtx({
        otherNotifications: [{ ...base, id: "o2", siteAddress: "Plot 9, Sagamu Interchange" }],
        payments: [payment(base.ounNo!, 100_000)],
      }),
    );
    expect(flags).toEqual([]);
  });

  it("needs at least one generator unit", () => {
    const flags = ownUseFlags({ ...base, units: [] }, flagCtx()).map((f) => f.message);
    expect(flags).toContain("Missing required field: generator units");
  });

  it("shows filed after the existing-operator deadline", () => {
    expect(ownUseFiledLate(DEADLINE, settings)).toBe(false);
    expect(ownUseFiledLate(addDays(DEADLINE, 1), settings)).toBe(true);
  });
});

describe("automatic checks", () => {
  it("AUTOMATIC_CHECK_IDS are exactly the checks always computed", async () => {
    const { AUTOMATIC_CHECK_IDS } = await import("../evaluation");
    const { evaluate } = await import("./helpers");
    const ids = evaluate({})
      .checks.filter((c) => c.mode === "auto")
      .map((c) => c.id);
    expect(new Set(ids)).toEqual(new Set(AUTOMATIC_CHECK_IDS));
  });
});
