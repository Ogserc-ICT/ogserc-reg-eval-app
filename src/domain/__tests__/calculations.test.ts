// Edge cases for SPEC §2 calculated fields and §3 number formats.
import { describe, expect, it } from "vitest";
import { categoryAuto, categoryForActivity } from "../category";
import {
  addDays,
  certificateDateParts,
  daysBetween,
  formatDate,
  isIsoDate,
  todayInLagos,
} from "../dates";
import { licenceNeedsRenewal } from "../deadlines";
import { effectiveDocuments, summariseDocuments } from "../documents";
import { NO_CONDITIONS, findForm } from "../forms";
import { feeSummary, type FeeInput } from "../fees";
import { feeTermsFor } from "../pricing";
import type { Policy } from "../reference";
import type { PaymentInput } from "../types";
import { formatNaira } from "../money";
import { nextAction } from "../next-action";
import {
  certificateSerial,
  deficiencyNoticeRef,
  formatAckNo,
  formatOunNo,
  formatPaymentNo,
  nextRegistrationSerial,
} from "../numbers";
import { findActivity } from "../reference";
import { assessSubmission } from "../submission";
import { STATUS } from "../types";
import { isValidCac, isValidEmail, isValidPhone, isValidTin } from "../validation";
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

describe("seed reference data", () => {
  it("has the 11 forms REG-01A to K and 56 + 7 evaluation checks", () => {
    expect(ref.forms.map((f) => f.form)).toEqual("ABCDEFGHIJK".split("").map((c) => `REG-01${c}`));
    expect(ref.evaluationChecks).toHaveLength(63);
    expect(ref.evaluationChecks.filter((c) => c.id.startsWith("9."))).toHaveLength(7);
  });

  it("converts fees to kobo", () => {
    expect(ref.fees.find((f) => f.category === "A")?.registrationFee).toBe(100_000_000);
  });

  it("reads settings", () => {
    expect(settings.effectiveDate).toBe("2026-10-22");
    expect(settings.registrationPeriodDays).toBe(60);
    expect(settings.chairmanName).toBe("[Name]");
  });
});

describe("dates", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -30)).toBe("2027-01-30");
    expect(daysBetween("2026-10-22", "2026-12-21")).toBe(60);
    expect(daysBetween("2026-12-21", "2026-10-22")).toBe(-60);
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("22/10/2026")).toBe(false);
  });

  it("uses Africa/Lagos (UTC+1) for today", () => {
    expect(todayInLagos(new Date("2026-10-21T23:30:00Z"))).toBe("2026-10-22");
    expect(todayInLagos(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-21");
  });

  it("formats dates and certificate parts", () => {
    expect(formatDate("2026-11-05")).toBe("5 November 2026");
    expect(certificateDateParts("2026-10-22")).toEqual({
      day: "22nd",
      month: "October",
      year: "2026",
    });
    expect(certificateDateParts("2026-10-11").day).toBe("11th");
    expect(certificateDateParts("2026-10-01").day).toBe("1st");
    expect(certificateDateParts("2026-10-23").day).toBe("23rd");
  });
});

describe("money", () => {
  it("formats kobo as naira", () => {
    expect(formatNaira(naira(2_800_000))).toBe("₦2,800,000");
    expect(formatNaira(123_450)).toBe("₦1,234.50");
    expect(formatNaira(0)).toBe("₦0");
    expect(formatNaira(-5000)).toBe("-₦50");
  });
});

describe("category", () => {
  const gen = findActivity(activity("GEN"), ref);

  it("uses tier boundaries at exactly 1 and 10 MW", () => {
    expect(categoryForActivity(gen, 0.999, settings.policy)).toBe("K");
    expect(categoryForActivity(gen, 1, settings.policy)).toBe("D");
    expect(categoryForActivity(gen, 9.999, settings.policy)).toBe("D");
    expect(categoryForActivity(gen, 10, settings.policy)).toBe("C");
    expect(categoryForActivity(gen, null, settings.policy)).toBe("K");
  });

  it("is empty with no or unknown primary activity, even with a secondary", () => {
    expect(
      categoryAuto(
        { primaryActivity: null, otherActivities: [activity("SDC")], installedCapacityMw: 5 },
        ref,
        settings.policy,
      ),
    ).toBeNull();
    expect(
      categoryAuto(
        { primaryActivity: "Nonsense", otherActivities: [], installedCapacityMw: 5 },
        ref,
        settings.policy,
      ),
    ).toBeNull();
  });

  it("B dominates when no A", () => {
    expect(
      categoryAuto(
        {
          primaryActivity: activity("EST"),
          otherActivities: [activity("INT")],
          installedCapacityMw: 0,
        },
        ref,
        settings.policy,
      ),
    ).toBe("B");
  });

  it("keeps the primary category on a fee tie", () => {
    // MGD (E, ₦250k) + MET (H, ₦250k)
    expect(
      categoryAuto(
        {
          primaryActivity: activity("MGD"),
          otherActivities: [activity("MET")],
          installedCapacityMw: 2,
        },
        ref,
        settings.policy,
      ),
    ).toBe("E");
    expect(
      categoryAuto(
        {
          primaryActivity: activity("MET"),
          otherActivities: [activity("MGD")],
          installedCapacityMw: 2,
        },
        ref,
        settings.policy,
      ),
    ).toBe("H");
  });

  it("keeps the primary category when the secondary fee is lower", () => {
    expect(
      categoryAuto(
        {
          primaryActivity: activity("EST"),
          otherActivities: [activity("GEN")],
          installedCapacityMw: 5,
        },
        ref,
        settings.policy,
      ),
    ).toBe("G");
  });

  it("applies the override and its fee", () => {
    const a = assessSubmission(
      makeSubmission({ categoryOverride: "G", overrideReason: "Estate network" }),
      [],
      ctx(),
    );
    expect(a.categoryAuto).toBe("E");
    expect(a.categoryApplied).toBe("G");
    expect(a.fees.fee).toBe(naira(500_000));
    expect(a.categoryDescription).toBe("Private, estate and industrial-park networks");
  });
});

describe("deadlines", () => {
  it("adds the extension to the existing-operator deadline", () => {
    const s = { ...settings, extensionDays: 10 };
    const a = assessSubmission(
      makeSubmission({ dateSubmitted: addDays(DEADLINE, 10) }),
      [],
      ctx(ED, s),
    );
    expect(a.registrationDeadline).toBe(addDays(DEADLINE, 10));
    expect(a.daysLate).toBe(0);
  });

  it("is on time on the deadline and 1 day late the day after", () => {
    expect(assessSubmission(makeSubmission({ dateSubmitted: DEADLINE }), [], ctx()).daysLate).toBe(
      0,
    );
    expect(
      assessSubmission(makeSubmission({ dateSubmitted: addDays(DEADLINE, 1) }), [], ctx()).daysLate,
    ).toBe(1);
  });

  it("has no deadline and no late days for a new operator with no start date", () => {
    const a = assessSubmission(
      makeSubmission({ operatingOnEffectiveDate: "N", plannedStartDate: null }),
      [],
      ctx(),
    );
    expect(a.registrationDeadline).toBeNull();
    expect(a.daysLate).toBe(0);
  });

  it("computes determination and deficiency due dates", () => {
    const a = assessSubmission(
      makeSubmission({ dateSubmissionComplete: "2026-11-01", deficiencyNoticeDate: "2026-11-01" }),
      [],
      ctx(),
    );
    expect(a.determinationDue).toBe("2026-12-01");
    expect(a.deficiencyResponseDue).toBe("2026-11-15");
  });

  it("flags licence renewal within 183 days of the Effective Date", () => {
    expect(licenceNeedsRenewal(addDays(ED, 183), ED, 183)).toBe(true);
    expect(licenceNeedsRenewal(addDays(ED, 184), ED, 183)).toBe(false);
    expect(licenceNeedsRenewal(null, ED, 183)).toBe(false);
  });
});

describe("fees and payments", () => {
  const ack = "OGSERC/ACK/2026/00001";
  const input = { category: "E", daysLate: 0, approvedWaiver: 0, reference: ack };
  /** Fee summary under the current fee table for a category. */
  const feesFor = (
    i: Omit<FeeInput, "terms"> & { category: string | null },
    pays: PaymentInput[],
    policy: Policy,
  ) => feeSummary({ ...i, terms: i.category ? feeTermsFor(i.category, ref) : null }, pays, policy);

  it("sets payment status Unpaid, Part-paid, Paid", () => {
    expect(feesFor(input, [], settings.policy).paymentStatus).toBe("Unpaid");
    expect(feesFor(input, [payment(ack, 100_000)], settings.policy).paymentStatus).toBe(
      "Part-paid",
    );
    expect(feesFor(input, [payment(ack, 250_000)], settings.policy).paymentStatus).toBe("Paid");
    expect(feesFor(input, [payment(ack, 300_000)], settings.policy).balance).toBe(naira(-50_000));
  });

  it("is Nil when the waiver covers the fee", () => {
    expect(
      feesFor({ ...input, approvedWaiver: naira(300_000) }, [], settings.policy),
    ).toMatchObject({
      netFee: 0,
      totalDue: 0,
      paymentStatus: "Nil",
    });
  });

  it("matches payments on the reference only and finds the last payment date", () => {
    const s = feesFor(
      input,
      [
        payment(ack, 100_000, "2026-11-01"),
        payment(ack, 50_000, "2026-11-20"),
        payment("OTHER", 999, "2026-12-01"),
      ],
      settings.policy,
    );
    expect(s.amountPaid).toBe(naira(150_000));
    expect(s.lastPaymentDate).toBe("2026-11-20");
    expect(feesFor(input, [], settings.policy).lastPaymentDate).toBeNull();
  });

  it("never applies the waiver to the late charge by default", () => {
    const s = feesFor(
      { category: "D", daysLate: 20, approvedWaiver: naira(400_000), reference: ack },
      [],
      settings.policy,
    );
    expect(s.totalDue).toBe(naira(2_500_000));
  });

  it("applies the waiver to the late charge when the policy says so", () => {
    const policy = { ...settings.policy, waiverAppliesToLateCharge: true };
    const s = feesFor(
      { category: "D", daysLate: 20, approvedWaiver: naira(400_000), reference: ack },
      [],
      policy,
    );
    expect(s.totalDue).toBe(naira(2_400_000));
  });

  it("has no late charge for Category I", () => {
    expect(feesFor({ ...input, category: "I", daysLate: 30 }, [], settings.policy).lateCharge).toBe(
      0,
    );
  });

  it("is zero with no category", () => {
    expect(feesFor({ ...input, category: null }, [], settings.policy).totalDue).toBe(0);
  });
});

describe("documents and completeness", () => {
  const e = findForm("REG-01E", ref.forms)!;
  const list = e.documents.map((d) => ({ ...d, form: e.form }));

  it("counts outstanding and pending, and lists items by their text", () => {
    const docs = {
      ...allDocs("Y"),
      incorporation: "N",
      constitution: null,
      community_consent: "N/A",
    } as const;
    const s = summariseDocuments(effectiveDocuments(list, docs, NO_CONDITIONS, "Y"));
    expect(s).toMatchObject({ outstanding: 1, pending: 1, documentsComplete: false });
    expect(s.outstandingList).toEqual([e.documents[0]!.text, e.documents[1]!.text]);
    // 13 items: 1 N, 1 blank, 1 N/A, 10 received (evidence of payment included).
    expect(s.receivedList).toHaveLength(10);
  });

  it("treats N/A as complete", () => {
    const s = summariseDocuments(effectiveDocuments(list, allDocs("N/A"), NO_CONDITIONS, "N/A"));
    expect(s.documentsComplete).toBe(true);
  });

  it("does not let an unpaid late charge block completeness by default (§2.7)", () => {
    const sub = makeSubmission({ dateSubmitted: addDays(DEADLINE, 3), documents: allDocs("Y") });
    const pays = [payment(sub.ackNo!, 250_000)];
    expect(assessSubmission(sub, pays, ctx()).submissionComplete).toBe(true);
    const strict = {
      ...settings,
      policy: { ...settings.policy, lateChargeBlocksCompleteness: true },
    };
    expect(assessSubmission(sub, pays, ctx(ED, strict)).submissionComplete).toBe(false);
  });
});

describe("days in queue and SLA", () => {
  const sla = (overrides: Parameters<typeof makeSubmission>[0], today: string) =>
    assessSubmission(makeSubmission(overrides), [], ctx(today));

  it("is null when closed or provisional", () => {
    expect(sla({ status: STATUS.REGISTERED }, ED).daysInQueue).toBeNull();
    expect(sla({ status: STATUS.REGISTERED }, ED).sla).toBeNull();
    expect(sla({ status: STATUS.PROVISIONAL }, ED).sla).toBeNull();
    expect(sla({ status: STATUS.PROVISIONAL }, addDays(ED, 5)).daysInQueue).toBe(5);
  });

  it("is Green, Amber at 7 days before due, Red after due", () => {
    const sub = { dateSubmissionComplete: ED };
    expect(sla(sub, addDays(ED, 22)).sla).toBe("Green");
    expect(sla(sub, addDays(ED, 23)).sla).toBe("Amber");
    expect(sla(sub, addDays(ED, 30)).sla).toBe("Amber");
    expect(sla(sub, addDays(ED, 31)).sla).toBe("Red");
  });

  it("is Amber when incomplete and in the queue longer than the determination period", () => {
    expect(sla({}, addDays(ED, 30)).sla).toBe("Green");
    expect(sla({}, addDays(ED, 31)).sla).toBe("Amber");
  });

  it("is Red when the deficiency response is overdue", () => {
    const sub = { status: STATUS.DEFICIENCY, deficiencyNoticeDate: ED };
    expect(sla(sub, addDays(ED, 14)).sla).toBe("Green");
    expect(sla(sub, addDays(ED, 15)).sla).toBe("Red");
  });

  it("never counts negative days", () => {
    expect(sla({ dateSubmitted: addDays(ED, 3) }, ED).daysInQueue).toBe(0);
  });
});

describe("next action", () => {
  const act = (overrides: Parameters<typeof makeSubmission>[0], today = ED, pays = 0) => {
    const sub = makeSubmission(overrides);
    const p = pays ? [payment(sub.ackNo!, pays)] : [];
    return nextAction(sub, assessSubmission(sub, p, ctx(today)), today);
  };

  it("covers closed statuses", () => {
    expect(act({ status: STATUS.REGISTERED, registrationNo: "X" })).toBe("Complete");
    expect(act({ status: STATUS.REGISTERED })).toBe("Lock the registration number");
    expect(act({ status: STATUS.REFUSED })).toBe("Closed – Refused");
    expect(act({ status: STATUS.CANCELLED })).toBe("Closed – Cancelled");
    expect(act({ status: STATUS.LAPSED })).toBe("Closed – Lapsed; fresh application needed");
  });

  it("covers the deficiency period", () => {
    const sub = { status: STATUS.DEFICIENCY, deficiencyNoticeDate: ED };
    expect(act(sub, addDays(ED, 14))).toBe("Await response by 5 November 2026");
    expect(act(sub, addDays(ED, 15))).toBe("Response overdue – lapse the submission (para 13(2))");
  });

  it("lists what is outstanding (REG-01E: 13 items, evidence of payment among them)", () => {
    expect(act({})).toBe(
      "Obtain 13 outstanding document(s) and collect ₦250,000 – or issue a deficiency notice",
    );
    // Evidence of payment stays outstanding until Finance confirms the fee.
    expect(act({ documents: allDocs("Y") })).toBe(
      "Obtain 1 outstanding document(s) and collect ₦250,000 – or issue a deficiency notice",
    );
    expect(act({}, ED, 250_000)).toBe(
      "Obtain 12 outstanding document(s) – or issue a deficiency notice",
    );
  });

  it("asks for the completion date, then the determination date", () => {
    expect(act({ documents: allDocs("Y") }, ED, 250_000)).toBe(
      "Enter the Date Submission Complete",
    );
    const done = { documents: allDocs("Y"), dateSubmissionComplete: ED };
    expect(act(done, ED, 250_000)).toBe("Determine by 21 November 2026");
    expect(act(done, addDays(ED, 31), 250_000)).toBe(
      "Overdue – provisional registration applies (para 13(4))",
    );
  });
});

describe("number formats (§3)", () => {
  it("formats generated numbers", () => {
    expect(formatAckNo("OGSERC/ACK", "2026-10-22", 2)).toBe("OGSERC/ACK/2026/00002");
    expect(formatPaymentNo("OGSERC/PAY", "2027-01-05", 17)).toBe("OGSERC/PAY/2027/00017");
    expect(formatOunNo("OGSERC/OUN", "2026-11-01", 3)).toBe("OGSERC/OUN/2026/0003");
    expect(deficiencyNoticeRef("OGSERC/ACK/2026/00002", "2026-11-01")).toBe(
      "OGSERC/DEF/2026/00002",
    );
    expect(certificateSerial("OGSERC/REG/2026/F-MSL/0001")).toBe("0001");
  });

  it("continues the yearly registration serial from the highest issued", () => {
    const existing = [
      "OGSERC/REG/2026/F-MSL/0001",
      "OGSERC/REG/2026/E-MGD/0002",
      "OGSERC/REG/2025/A-SDC/0009",
    ];
    expect(nextRegistrationSerial("OGSERC/REG", "2026-12-31", existing)).toBe(3);
    expect(nextRegistrationSerial("OGSERC/REG", "2027-01-01", existing)).toBe(1);
  });
});

describe("format validation (§8.5)", () => {
  it.each(["RC123456", "BN 998877", "IT12", "rc1"])("accepts CAC %s", (cac) =>
    expect(isValidCac(cac)).toBe(true),
  );
  it.each(["123456", "RC", "AB123", "RC12A"])("rejects CAC %s", (cac) =>
    expect(isValidCac(cac)).toBe(false),
  );

  it.each(["08012345678", "+2348012345678", "0801 234 5678"])("accepts phone %s", (p) =>
    expect(isValidPhone(p)).toBe(true),
  );
  it.each(["8012345678", "080123456789", "+44801234567", "2348012345678"])(
    "rejects phone %s",
    (p) => expect(isValidPhone(p)).toBe(false),
  );

  it("validates email", () => {
    expect(isValidEmail("a@b.ng")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
  });

  it("accepts any TIN until a pattern is configured", () => {
    expect(isValidTin("anything", null)).toBe(true);
    expect(isValidTin("12345678-0001", "^\\d{8}-\\d{4}$")).toBe(true);
    expect(isValidTin("123", "^\\d{8}-\\d{4}$")).toBe(false);
  });
});
