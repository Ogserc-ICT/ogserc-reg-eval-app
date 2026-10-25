// Category-specific forms REG-01A to REG-01K (part 1: common core and documents).
import { describe, expect, it } from "vitest";
import { categoryAuto } from "../category";
import { recommendedOutcome } from "../evaluation";
import { addDays } from "../dates";
import { describeChanges, filingChanges } from "../filing";
import { annualConfirmationOverdue, dataFlags, duplicateIndex } from "../flags";
import {
  NO_CONDITIONS,
  OWN_USE_FORM,
  PAYMENT_EVIDENCE_KEY,
  findForm,
  formsFromSeed,
} from "../forms";
import { LEGACY_DOCUMENT_KEYS, mapLegacyDocuments } from "../legacy-documents";
import {
  assessOwnUse,
  ownUseCertificateFields,
  ownUseRegistrationBlockers,
  ownUseRegistrationNo,
  totalCapacityKw,
  type OwnUseInput,
} from "../own-use";
import { priceSubmission } from "../pricing";
import type { Settings } from "../reference";
import { assessSubmission } from "../submission";
import { FILING, FINAL_DECISION, STATUS, type PaymentInput, type SubmissionInput } from "../types";
import { approvalBlockers, approvalChanges, dailyReview } from "../workflow";
import {
  DEADLINE,
  ED,
  activity,
  allDocs,
  ctx,
  evaluate,
  makeSubmission,
  naira,
  other,
  payment,
  readySettings,
  ref,
  settings,
} from "./helpers";

const withPolicy = (
  policy: Partial<Settings["policy"]>,
  s: Settings = readySettings,
): Settings => ({
  ...s,
  policy: { ...s.policy, ...policy },
});
const keysOf = (sub: SubmissionInput, pays: PaymentInput[] = [], s: Settings = settings) =>
  assessSubmission(sub, pays, ctx(ED, s)).documents.items.map((d) => d.key);
const itemOf = (sub: SubmissionInput, key: string, pays: PaymentInput[] = [], s = settings) =>
  assessSubmission(sub, pays, ctx(ED, s)).documents.items.find((d) => d.key === key);
const flagCodes = (
  sub: SubmissionInput,
  s: Settings = settings,
  others = [] as Parameters<typeof dataFlags>[2],
) => {
  const c = ctx(ED, s);
  return dataFlags(sub, assessSubmission(sub, [], c), others, c).map((f) => f.code);
};
const value = (checks: { id: string; value: unknown }[], id: string) =>
  checks.find((c) => c.id === id)?.value;

// Generation for sale, 5 MW: Category D, Form REG-01D.
const gen5 = (o: Partial<SubmissionInput> = {}) =>
  makeSubmission({ primaryActivity: activity("GEN"), installedCapacityMw: 5, ...o });

describe("registration forms (registration-forms.json)", () => {
  it("has one form per Schedule 3 category, each ending with evidence of payment", () => {
    for (const f of ref.forms) {
      expect(f.form).toBe(`REG-01${f.category}`);
      expect(ref.fees.some((fee) => fee.category === f.category)).toBe(true);
      expect(f.documents.at(-1)?.key).toBe(PAYMENT_EVIDENCE_KEY);
      expect(new Set(f.documents.map((d) => d.key)).size).toBe(f.documents.length);
    }
  });

  it("REG-01I is the own-use notification, with three documents", () => {
    expect(findForm(OWN_USE_FORM, ref.forms)?.documents.map((d) => d.key)).toEqual([
      "incorporation",
      "nameplate_photos",
      PAYMENT_EVIDENCE_KEY,
    ]);
  });

  it("refuses a document condition it does not know", () => {
    expect(() =>
      formsFromSeed({
        forms: [
          {
            form: "REG-01X",
            category: "X",
            title: "",
            para: "",
            documents: [{ key: "a", text: "A", required_when: "moon_phase" }],
          },
        ],
      }),
    ).toThrow(/unknown condition "moon_phase"/);
  });
});

describe("document list of the form filed", () => {
  it("is the form's own list, in its order (REG-01D)", () => {
    expect(keysOf(gen5())).toEqual(findForm("REG-01D", ref.forms)!.documents.map((d) => d.key));
  });

  it("makes a conditional item N/A automatically when its condition is N", () => {
    // Stored yes/no answers apply while the technical sections do not decide them.
    const answered = (c: Partial<typeof NO_CONDITIONS>) =>
      gen5({
        conditions: { ...NO_CONDITIONS, ...c },
        documents: { ppa_offtake: "Y" },
        technicalData: {},
      });
    expect(itemOf(answered({ generation_for_sale: "N" }), "ppa_offtake")).toMatchObject({
      value: "N/A",
      mode: "auto-na",
    });
    // Y or not answered: the item applies and staff record it.
    expect(itemOf(answered({ generation_for_sale: "Y" }), "ppa_offtake")).toMatchObject({
      value: "Y",
      mode: "manual",
    });
    expect(itemOf(answered({}), "ppa_offtake")).toMatchObject({ value: "Y", mode: "manual" });
    expect(itemOf(answered({ grid_connected: "N" }), "connection_agreement")?.value).toBe("N/A");
  });

  it("ticks evidence of payment once Finance confirms fee − waiver", () => {
    const sub = gen5();
    const evidence = (pays: PaymentInput[], s = sub) => itemOf(s, PAYMENT_EVIDENCE_KEY, pays);
    expect(evidence([])).toMatchObject({ value: null, mode: "auto" });
    expect(evidence([payment(sub.ackNo!, 300_000, ED, "PENDING")])?.value).toBeNull();
    expect(evidence([payment(sub.ackNo!, 200_000)])?.value).toBeNull();
    expect(evidence([payment(sub.ackNo!, 300_000)])?.value).toBe("Y");
    // A reversal un-ticks it.
    expect(evidence([{ ...payment(sub.ackNo!, 300_000), status: "REVERSED" }])?.value).toBeNull();
    // Nothing due (waived in full): not applicable.
    expect(evidence([], gen5({ approvedWaiver: naira(300_000) }))?.value).toBe("N/A");
  });

  it("ignores a stored value for evidence of payment", () => {
    expect(
      itemOf(gen5({ documents: { payment_evidence: "Y" } }), PAYMENT_EVIDENCE_KEY)?.value,
    ).toBeNull();
  });

  it("adds other activities' documents only when the setting is on, once per shared key", () => {
    // GEN 5 MW (D) with metering (H) as another activity.
    const sub = gen5({ otherActivities: [activity("MET")] });
    const off = keysOf(sub);
    expect(off).not.toContain("nemsa_accreditation");
    const on = keysOf(sub, [], withPolicy({ otherActivitiesRequireDocuments: true }, settings));
    const metering = findForm("REG-01H", ref.forms)!.documents.map((d) => d.key);
    expect(on).toEqual(expect.arrayContaining(metering));
    expect(on.filter((k) => k === "incorporation")).toHaveLength(1);
    expect(on.at(-1)).toBe(PAYMENT_EVIDENCE_KEY);
    expect(on).toHaveLength(new Set([...off, ...metering]).size);
  });

  it("follows the confirmed category's form once wrong forms are accepted and re-categorised", () => {
    // Filed on REG-01K, confirmed as D: REG-01D's list applies; shared keys carry over.
    const sub = gen5({
      formFiled: "REG-01K",
      confirmedCategory: "D",
      categoryConfirmedReason: "5 MW plant: Category D",
      documents: { incorporation: "Y", supply_sale_agreements: "Y" },
    });
    const a = assessSubmission(sub, [], ctx());
    expect(a.documentsForm).toBe("REG-01D");
    expect(itemOf(sub, "incorporation")?.value).toBe("Y");
    expect(keysOf(sub)).not.toContain("supply_sale_agreements");
    // Requiring the correct form keeps the list of the form filed.
    const strict = withPolicy({ wrongFormHandling: "REQUIRE_CORRECT_FORM" }, settings);
    expect(assessSubmission(sub, [], ctx(ED, strict)).documentsForm).toBe("REG-01K");
  });

  it("drives completeness, the deficiency list and the acknowledgement's received list", () => {
    const docs = { ...allDocs("Y", "REG-01D"), asset_register: "N" as const };
    const pays = [payment("OGSERC/ACK/2026/00001", 300_000)];
    const a = assessSubmission(gen5({ documents: docs }), pays, ctx());
    expect(a.submissionComplete).toBe(false);
    expect(a.documents.outstandingList).toEqual([
      "Asset register with GPS coordinates of each plant",
    ]);
    expect(a.documents.receivedList).toContain("Evidence of payment of the registration fee");
    const done = assessSubmission(gen5({ documents: allDocs("Y", "REG-01D") }), pays, ctx());
    expect(done.submissionComplete).toBe(true);
  });
});

describe("old 13-item checklist → per-form keys", () => {
  const all = Object.fromEntries(
    Object.keys(LEGACY_DOCUMENT_KEYS).map((n) => [Number(n), "Y" as const]),
  );

  it("maps matching documents and leaves the rest pending, with the reason", () => {
    const m = mapLegacyDocuments(all, findForm("REG-01A", ref.forms));
    expect(m.mapped).toEqual({
      incorporation: "Y",
      constitution: "Y",
      licences: "Y",
      single_line_diagram: "Y",
      asset_register: "Y",
      financials: "Y",
      tariff_order: "Y",
      customer_enumeration: "Y",
      env_safety_permits: "Y",
      board_resolution: "Y",
    });
    expect(m.dropped.map((d) => d.item)).toEqual([7, 12, 13]);
  });

  it("puts item 10 under whichever environmental key the form has", () => {
    expect(mapLegacyDocuments({ 10: "N" }, findForm("REG-01B", ref.forms)).mapped).toEqual({
      env_permits_eia: "N",
    });
    expect(mapLegacyDocuments({ 10: "N/A" }, findForm("REG-01D", ref.forms)).mapped).toEqual({
      env_permits: "N/A",
    });
    // REG-01H has no environmental item at all.
    expect(mapLegacyDocuments({ 10: "Y" }, findForm("REG-01H", ref.forms)).dropped).toEqual([
      { item: 10, value: "Y", why: "not on REG-01H" },
    ]);
  });

  it("skips blank values", () => {
    expect(mapLegacyDocuments({ 1: null, 2: "Y" }, findForm("REG-01E", ref.forms))).toEqual({
      mapped: { constitution: "Y" },
      dropped: [],
    });
  });
});

describe("category: highest applies across every activity ticked (para 17(1))", () => {
  const cat = (primary: string, others: string[], mw: number, s: Settings = settings) =>
    categoryAuto(
      {
        primaryActivity: activity(primary),
        otherActivities: others.map(activity),
        installedCapacityMw: mw,
      },
      ref,
      s.policy,
    );

  it("takes the highest fee among several other activities", () => {
    // GEN 5 MW (D ₦300k) + MET (H ₦250k) + EST (G ₦500k) → G.
    expect(cat("GEN", ["MET", "EST"], 5)).toBe("G");
    expect(cat("GEN", ["MET"], 5)).toBe("D");
  });

  it("A and B dominate wherever they are ticked", () => {
    expect(cat("MET", ["EST", "SDC"], 0)).toBe("A");
    expect(cat("MET", ["INT", "EST"], 0)).toBe("B");
  });

  it("breaks ties for the primary activity, then the earlier activity ticked", () => {
    // MGD (E ₦250k) primary, MET (H ₦250k): E.
    expect(cat("MGD", ["MET"], 2)).toBe("E");
    // MET primary, ₦500k F and G both ticked: the first one ticked.
    expect(cat("MET", ["DIS", "EST"], 2)).toBe("F");
    expect(cat("MET", ["EST", "DIS"], 2)).toBe("G");
  });

  it("puts Supply / retail at 1 MW or more in the policy's category (K unless changed)", () => {
    expect(cat("SUP", [], 2)).toBe("K");
    const f = withPolicy({ supplyRetailCategory1MwPlus: "F" }, settings);
    expect(cat("SUP", [], 2, f)).toBe("F");
    expect(cat("SUP", [], 0.5, f)).toBe("K");
    expect(cat("MET", ["SUP"], 12, f)).toBe("F");
  });
});

describe("form filed and category confirmed (check 1.10)", () => {
  it("is pending until the evaluator confirms the category, then Y when the form matches", () => {
    expect(
      value(evaluate({ sub: makeSubmission({ confirmedCategory: null }) }).checks, "1.10"),
    ).toBeNull();
    expect(value(evaluate().checks, "1.10")).toBe("Y");
  });

  it("fails with no form filed", () => {
    const sub = makeSubmission({ formFiled: null });
    expect(value(evaluate({ sub }).checks, "1.10")).toBe("N");
    expect(flagCodes(sub)).toContain("MISSING_REQUIRED");
  });

  it("accepts a wrong form re-categorised with a reason, by default", () => {
    const sub = gen5({
      formFiled: "REG-01K",
      confirmedCategory: "D",
      categoryConfirmedReason: "5 MW plant",
      documents: allDocs("Y"),
      dateSubmissionComplete: ED,
    });
    const r = evaluate({ sub, payments: [payment(sub.ackNo!, 300_000)] });
    expect(value(r.checks, "1.10")).toBe("Y");
    expect(r.flags.map((f) => f.code)).not.toContain("FORM_CATEGORY_MISMATCH");
    expect(value(evaluate({ sub: { ...sub, categoryConfirmedReason: null } }).checks, "1.10")).toBe(
      "N",
    );
  });

  it("fails a wrong form when the correct form is required, so a deficiency notice follows", () => {
    const strict = withPolicy({ wrongFormHandling: "REQUIRE_CORRECT_FORM" });
    const sub = gen5({
      formFiled: "REG-01K",
      confirmedCategory: "D",
      categoryConfirmedReason: "5 MW plant",
      documents: allDocs("Y"),
      dateSubmissionComplete: ED,
    });
    const r = evaluate({ sub, settings: strict, payments: [payment(sub.ackNo!, 300_000)] });
    expect(value(r.checks, "1.10")).toBe("N");
    expect(r.flags.find((f) => f.code === "FORM_CATEGORY_MISMATCH")?.message).toBe(
      "Filed on REG-01K but the category is confirmed as D – the applicant must file on REG-01D",
    );
    expect(recommendedOutcome(r.checks, r.counts, sub, r.assessment, r.evaluation, ED)).toBe(
      FINAL_DECISION.DEFICIENCY,
    );
  });

  it("flags a form that does not match the calculated category until confirmed", () => {
    const sub = gen5({ formFiled: "REG-01K", confirmedCategory: null });
    const c = ctx();
    const flag = dataFlags(sub, assessSubmission(sub, [], c), [], c).find(
      (f) => f.code === "FORM_CATEGORY_MISMATCH",
    );
    expect(flag?.message).toBe(
      "Form filed (REG-01K) does not match the calculated category (D) – confirm the category",
    );
    expect(flagCodes(gen5())).not.toContain("FORM_CATEGORY_MISMATCH");
  });

  it("flags a confirmed category that is not the one charged (an admin recalculates)", () => {
    const sub = gen5({
      formFiled: "REG-01C",
      confirmedCategory: "C",
      categoryConfirmedReason: "12 MW",
    });
    expect(flagCodes(sub)).toContain("CONFIRMED_CATEGORY_NOT_CHARGED");
    expect(flagCodes(gen5())).not.toContain("CONFIRMED_CATEGORY_NOT_CHARGED");
  });
});

describe("updates and annual confirmations (para 16)", () => {
  const registered = makeSubmission({
    id: "reg-1",
    status: STATUS.REGISTERED,
    registrationNo: "OGSERC/REG/2026/E-MGD/0001",
    certificateIssueDate: ED,
  });
  const update = (o: Partial<SubmissionInput> = {}) =>
    makeSubmission({
      id: "upd-1",
      ackNo: "OGSERC/ACK/2026/00009",
      filingType: FILING.UPDATE,
      linkedSubmissionId: "reg-1",
      ...o,
    });
  const registeredRow = other({
    id: "reg-1",
    cacNo: "RC123456",
    registeredName: "Example Mini-Grid Ltd",
    registrationNo: registered.registrationNo,
    status: STATUS.REGISTERED,
    certificateIssueDate: ED,
  });

  it("pay no fee and no late charge, unless the fee setting is on", () => {
    const p = priceSubmission(update(), ref, settings)!;
    expect(p).toMatchObject({ category: "E", registrationFee: 0, lateDailyCap: 0, deadline: null });
    const late = assessSubmission(
      update({ dateSubmitted: addDays(DEADLINE, 40) }),
      [],
      ctx(addDays(DEADLINE, 40)),
    );
    expect(late.daysLate).toBe(0);
    expect(late.fees.totalDue).toBe(0);
    // Nothing to pay: the Finance gate is clear and evidence of payment is N/A.
    expect(late.financeGate.cleared).toBe(true);
    expect(itemOf(update(), PAYMENT_EVIDENCE_KEY)?.value).toBe("N/A");
    const charged = withPolicy({ filingFeeOnUpdates: true }, settings);
    expect(priceSubmission(update(), ref, charged)?.registrationFee).toBe(naira(250_000));
  });

  it("share their registration's CAC number and name without a duplicate flag", () => {
    expect(flagCodes(update(), settings, [registeredRow])).not.toContain("DUPLICATE_CAC");
    expect(flagCodes(update(), settings, [registeredRow])).not.toContain("DUPLICATE_NAME");
    // Two filings for the same registration are not duplicates of each other either.
    const sibling = other({
      id: "upd-0",
      cacNo: "RC123456",
      linkedSubmissionId: "reg-1",
      filingType: FILING.ANNUAL,
    });
    expect(flagCodes(update(), settings, [registeredRow, sibling])).not.toContain("DUPLICATE_CAC");
    // The registered record does not flag its own filings.
    const self = { ...registered, documents: allDocs("Y") };
    expect(flagCodes(self, settings, [{ ...sibling, id: "upd-1" }])).not.toContain("DUPLICATE_CAC");
    // Another registration with the same CAC number still does.
    expect(
      flagCodes(update(), settings, [registeredRow, other({ id: "x", cacNo: "RC123456" })]),
    ).toContain("DUPLICATE_CAC");
  });

  it("flag a missing link, or a linked registration that is no longer Registered", () => {
    expect(flagCodes(update({ linkedSubmissionId: null }))).toContain("LINKED_REGISTRATION");
    expect(flagCodes(update(), settings, [registeredRow])).not.toContain("LINKED_REGISTRATION");
    const cancelled = { ...registeredRow, status: STATUS.CANCELLED };
    const c = ctx();
    const sub = update();
    expect(
      dataFlags(sub, assessSubmission(sub, [], c), [cancelled], c).find(
        (f) => f.code === "LINKED_REGISTRATION",
      )?.message,
    ).toBe("The linked registration OGSERC/REG/2026/E-MGD/0001 is Cancelled, not Registered");
  });

  it("flag an annual confirmation filed after the due date (31 January by default)", () => {
    const annual = (d: string, s = settings) =>
      flagCodes(update({ filingType: FILING.ANNUAL, dateSubmitted: d }), s, [registeredRow]);
    expect(annual("2027-01-31")).not.toContain("ANNUAL_LATE");
    expect(annual("2027-02-01")).toContain("ANNUAL_LATE");
    expect(annual("2027-02-01", { ...settings, annualConfirmationDue: "02-28" })).not.toContain(
      "ANNUAL_LATE",
    );
    // None was due in the year of registration, so filing then is not late.
    expect(annual("2026-11-30")).not.toContain("ANNUAL_LATE");
  });

  it("flag a registration whose annual confirmation for this year is overdue", () => {
    const today = "2027-02-01";
    const c = { settings, today };
    const index = (rows: Parameters<typeof duplicateIndex>[0]) => duplicateIndex(rows);
    expect(annualConfirmationOverdue(registered, index([]), c)).toBe(true);
    // Not before the due date, and not in the year of registration.
    expect(
      annualConfirmationOverdue(registered, index([]), { settings, today: "2027-01-31" }),
    ).toBe(false);
    expect(
      annualConfirmationOverdue(registered, index([]), { settings, today: "2026-12-31" }),
    ).toBe(false);
    const filed = (status: (typeof STATUS)[keyof typeof STATUS], date = "2027-01-20") =>
      other({
        id: "a1",
        filingType: FILING.ANNUAL,
        linkedSubmissionId: "reg-1",
        status,
        dateSubmitted: date,
      });
    expect(annualConfirmationOverdue(registered, index([filed(STATUS.RECEIVED)]), c)).toBe(false);
    expect(annualConfirmationOverdue(registered, index([filed(STATUS.APPLIED)]), c)).toBe(false);
    // A refused one, or one filed last year, does not count.
    expect(annualConfirmationOverdue(registered, index([filed(STATUS.REFUSED)]), c)).toBe(true);
    expect(
      annualConfirmationOverdue(registered, index([filed(STATUS.APPLIED, "2026-12-20")]), c),
    ).toBe(true);
    expect(
      annualConfirmationOverdue({ ...registered, status: STATUS.RECEIVED }, index([]), c),
    ).toBe(false);
  });

  it("are approved by applying their changes: no registration number or certificate", () => {
    const sub = update({ documents: allDocs("Y"), dateSubmissionComplete: ED });
    const r = evaluate({ sub, payments: [], others: [registeredRow] });
    expect(r.flags).toEqual([]);
    expect(r.counts.pending).toBe(0);
    expect(value(r.checks, "9.1")).toBe("N/A");
    expect(value(r.checks, "9.3")).toBe("N/A");
    const approval = {
      ...r.approval,
      linked: { status: STATUS.REGISTERED, registrationNo: registered.registrationNo },
    };
    // No certificate, so unset signatory names do not block it.
    expect(approvalBlockers({ ...approval, settings: withPolicy({}, settings) })).toEqual([]);
    const changes = approvalChanges(approval, "A. Approver", 0, ED);
    expect(changes.submission).toMatchObject({
      status: STATUS.APPLIED,
      registrationNo: null,
      certificateIssueDate: null,
    });
    expect(changes.evaluation.finalDecision).toBe(FINAL_DECISION.APPLY);
  });

  it("recommend applying the changes, and are blocked while the registration is not Registered", () => {
    const sub = update({ documents: allDocs("Y"), dateSubmissionComplete: ED });
    const r = evaluate({ sub, payments: [], others: [registeredRow] });
    expect(recommendedOutcome(r.checks, r.counts, sub, r.assessment, r.evaluation, ED)).toBe(
      FINAL_DECISION.APPLY,
    );
    const blockers = approvalBlockers({
      ...r.approval,
      linked: { status: STATUS.CANCELLED, registrationNo: registered.registrationNo },
    });
    expect(blockers).toContain(
      "The linked registration OGSERC/REG/2026/E-MGD/0001 is Cancelled, not Registered",
    );
    expect(approvalBlockers({ ...r.approval, linked: null })).toContain(
      "Not linked to a registered submission",
    );
  });

  it("are never provisionally registered by the daily review", () => {
    const due = { dateSubmissionComplete: ED, status: STATUS.RECEIVED };
    const items = [makeSubmission({ id: "n", ...due }), update({ ...due })].map((sub) => ({
      sub,
      assessment: assessSubmission(sub, [], ctx(addDays(ED, 31))),
    }));
    expect(dailyReview(items, addDays(ED, 31)).toProvisional).toEqual(["n"]);
  });

  it("describe each change field by field, marking certificate fields", () => {
    const changes = filingChanges(
      { registeredName: "Old Ltd", phone: "080", website: null },
      { registeredName: "New Ltd", phone: "080", website: "https://new.ng" },
    );
    expect(changes).toEqual([
      {
        key: "registeredName",
        label: "registered name",
        before: "Old Ltd",
        after: "New Ltd",
        certificate: true,
      },
      {
        key: "website",
        label: "website",
        before: null,
        after: "https://new.ng",
        certificate: false,
      },
    ]);
    expect(describeChanges(changes)).toBe(
      "registered name: Old Ltd → New Ltd; website: (blank) → https://new.ng",
    );
    expect(filingChanges({ cacNo: "" }, { cacNo: null })).toEqual([]);
  });
});

describe("own-use notification, Form REG-01I", () => {
  const unit = (capacityKw: number) => ({
    makeModel: "Gen",
    capacityKw,
    fuel: "Diesel",
    avgMonthlyMwh: 10,
  });
  const oun: OwnUseInput = {
    id: "o1",
    ounNo: "OGSERC/OUN/2026/0001",
    name: "Factory Ltd",
    dateFiled: ED,
    cacNo: "RC1",
    siteAddress: "Plot 1",
    lga: "Ifo",
    units: [unit(300), unit(350)],
    documents: { incorporation: "Y", nameplate_photos: "Y" },
    pricing: null,
    registrationNo: null,
    certificateIssueDate: null,
  };
  const flagCtx = (payments: PaymentInput[] = [], s = readySettings) => ({
    otherNotifications: [],
    registerCacNos: [],
    payments,
    ref,
    settings: s,
  });
  const paid = [payment(oun.ounNo!, 100_000)];

  it("sums the generator units for its capacity and eligibility", () => {
    expect(totalCapacityKw([unit(0.1), unit(0.2)])).toBe(0.3);
    expect(totalCapacityKw([])).toBeNull();
    expect(assessOwnUse(oun, flagCtx())).toMatchObject({
      installedCapacityKw: 650,
      eligibility: "Notification required",
      feeDue: naira(100_000),
    });
    expect(assessOwnUse({ ...oun, units: [unit(120), unit(60)] }, flagCtx()).eligibility).toBe(
      "Not required",
    );
    expect(assessOwnUse({ ...oun, units: [unit(600), unit(400)] }, flagCtx()).eligibility).toBe(
      "Register as operator",
    );
  });

  it("uses the REG-01I checklist, with evidence of payment ticked by Finance confirmation", () => {
    const pending = assessOwnUse(oun, flagCtx([payment(oun.ounNo!, 100_000, ED, "PENDING")]));
    expect(pending.documents.items.map((d) => [d.key, d.value])).toEqual([
      ["incorporation", "Y"],
      ["nameplate_photos", "Y"],
      [PAYMENT_EVIDENCE_KEY, null],
    ]);
    expect(assessOwnUse(oun, flagCtx(paid)).documents.documentsComplete).toBe(true);
  });

  it("can be registered only when the setting is on, paid, complete and approved by someone else", () => {
    const blockers = (
      o: Partial<Parameters<typeof ownUseRegistrationBlockers>[0]> = {},
      s = readySettings,
      pays = paid,
    ) =>
      ownUseRegistrationBlockers({
        oun,
        assessment: assessOwnUse(oun, flagCtx(pays, s)),
        settings: s,
        createdById: "registry",
        actorId: "approver",
        flagOverrideReason: null,
        ...o,
      });
    expect(blockers()).toEqual(["Own-use certificates are switched off in Settings"]);
    const on = withPolicy({ ownUseCertificate: true });
    expect(blockers({}, on)).toEqual([]);
    expect(blockers({}, on, [])).toEqual([
      "Fee not confirmed by Finance: ₦0 of ₦100,000",
      "Documents outstanding: Evidence of payment of the notification fee",
    ]);
    expect(blockers({ actorId: "registry" }, on)).toContain(
      "The approving officer cannot be the user who created the submission",
    );
    expect(blockers({}, { ...on, chairmanName: "[Name]" })).toContain(
      "Certificate signatory names are not set in Settings",
    );
    const incomplete = { ...oun, documents: {} };
    expect(
      ownUseRegistrationBlockers({
        oun: incomplete,
        assessment: assessOwnUse(incomplete, flagCtx(paid, on)),
        settings: on,
        createdById: "registry",
        actorId: "approver",
        flagOverrideReason: null,
      }),
    ).toEqual([
      "Documents outstanding: Certificate of incorporation / business registration; Photographs of generator nameplates",
    ]);
  });

  it("is numbered I-CPT in the year's registration series, and fills the certificate", () => {
    expect(ownUseRegistrationNo(readySettings, "2026-11-02", 4)).toBe("OGSERC/REG/2026/I-CPT/0004");
    const registered = {
      ...oun,
      registrationNo: "OGSERC/REG/2026/I-CPT/0004",
      certificateIssueDate: "2026-11-02",
    };
    const f = ownUseCertificateFields(
      registered,
      assessOwnUse(registered, flagCtx(paid)),
      ref,
      readySettings,
    );
    expect(f).toMatchObject({
      SERIAL: "0004",
      NAME: "FACTORY LTD",
      ADDRESS: "Plot 1",
      CATEGORY: "I — Own-use generation notification under paragraph 3(4) (200 kW to below 1 MW)",
      ACTIVITY: "Own-use generation, 650 kW (para 3(4))",
      AREA: "Ifo",
      LICENCE: "Not applicable (own-use notification)",
      DAY: "2nd",
    });
  });
});

describe("Finance gate with the per-form document lists (SPEC §11)", () => {
  // Mini-grid, REG-01E, fee ₦250,000.
  const sub = makeSubmission({
    status: STATUS.AWAITING,
    releasedForEvaluationDate: null,
    documents: allDocs("Y"),
  });
  const a = (pays: PaymentInput[]) => assessSubmission(sub, pays, ctx());

  it("a recorded payment awaiting Finance ticks nothing and keeps the gate closed", () => {
    const r = a([payment(sub.ackNo!, 250_000, ED, "PENDING")]);
    expect(r.financeGate).toMatchObject({ cleared: false, pending: naira(250_000) });
    expect(r.documents.outstandingList).toEqual(["Evidence of payment of the registration fee"]);
    expect(r.submissionComplete).toBe(false);
  });

  it("confirmation clears the gate and ticks evidence of payment, completing the checklist", () => {
    const r = a([payment(sub.ackNo!, 250_000)]);
    expect(r.financeGate.cleared).toBe(true);
    expect(r.documents.documentsComplete).toBe(true);
    expect(r.submissionComplete).toBe(true);
  });

  it("the gate does not wait for documents; completeness does", () => {
    const missing = makeSubmission({ status: STATUS.AWAITING, documents: {} });
    const r = assessSubmission(missing, [payment(missing.ackNo!, 250_000)], ctx());
    expect(r.financeGate.cleared).toBe(true);
    expect(r.submissionComplete).toBe(false);
  });

  it("a reversal closes the gate and un-ticks evidence of payment", () => {
    const r = a([{ ...payment(sub.ackNo!, 250_000), status: "REVERSED" }]);
    expect(r.financeGate.cleared).toBe(false);
    expect(r.documents.documentsComplete).toBe(false);
  });
});
