// SPEC §11 fixtures for the workbook. Each fixture is set up in the workbook (rows typed in, or
// macros run) and its expected results come from the app's domain functions, not from hand-typed
// numbers, so the workbook is checked against the same code the app runs.
//
//   tsx scripts/workbook/fixtures.ts <out.json>

import { writeFileSync } from "node:fs";
import {
  ED,
  DEADLINE,
  activity,
  allDocs,
  ctx,
  licence,
  makeEvaluation,
  makeSubmission,
  naira,
  payment,
  readySettings,
  ref,
  settings as seedSettings,
  allManualY,
} from "../../src/domain/__tests__/helpers";
import { addDays } from "../../src/domain/dates";
import { countDecisionChecks, effectiveChecks, evaluationStatus, fileClosed, recommendedOutcome } from "../../src/domain/evaluation";
import { dataFlags, type OtherSubmission } from "../../src/domain/flags";
import { CONDITION_KEYS } from "../../src/domain/forms";
import { nextAction } from "../../src/domain/next-action";
import { assessOwnUse, ownUseRegistrationBlockers, type OwnUseInput } from "../../src/domain/own-use";
import type { Settings } from "../../src/domain/reference";
import { assessSubmission, type Assessment } from "../../src/domain/submission";
import {
  FILING,
  FILING_LABELS,
  LICENCE,
  STATUS,
  type CheckValue,
  type EvaluationInput,
  type PaymentInput,
  type SubmissionInput,
} from "../../src/domain/types";
import { approvalBlockers, dailyReview, lapseBlockers, approvalChanges } from "../../src/domain/workflow";
import { nextRegistrationSerial } from "../../src/domain/numbers";
import { AUTO_CHECKS, CONDITION_COLUMNS, WRONG_FORM } from "./spec";

// ---------------------------------------------------------------------------------------------
// Fixture format (read by verify-workbook.ps1, compared by compare.ts)

type Val = string | number | null;
export type Step =
  | { op: "add"; table: string; alias: string; values: Record<string, Val> }
  | { op: "set"; table: string; alias: string; values: Record<string, Val> }
  | { op: "today"; date: string }
  | { op: "setting"; name: string; value: Val }
  | { op: "run"; macro: string; args: Val[]; user: string; answers?: (Val | boolean)[]; label: string }
  | { op: "expect"; table: string; alias: string; label: string; values: Record<string, Val> }
  | { op: "expectAudit"; label: string; reference: string; actions: string[] }
  | { op: "expectMessage"; label: string; contains: string[] }
  /** Mark every manual item of a saved checklist Y (as registry staff would). */
  | { op: "addDocsAllY"; table: string; alias: string; values: Record<string, Val> };

export interface Fixture {
  id: string;
  /** The SPEC §11 row this checks. */
  spec: string;
  title: string;
  /** Needs the macros (the workflow actions), not only the formulas. */
  macros: boolean;
  settings: Record<string, Val>;
  steps: Step[];
}

/** SPEC §11 rows that do not apply to the workbook, and why (reported, not hidden). */
export const NOT_APPLICABLE: { spec: string; reason: string }[] = [
  {
    spec: "Migration",
    reason:
      "Migrating old 13-item records into the app's database is an app-only operation (the workbook has no old records to migrate). It is covered by the app's own tests.",
  },
];

// ---------------------------------------------------------------------------------------------
// Settings → Settings sheet cells

function settingsCells(s: Settings, today: string): Record<string, Val> {
  const yn = (b: boolean) => (b ? "Y" : "N");
  const [m, d] = s.annualConfirmationDue.split("-").map(Number);
  return {
    cfgEffectiveDate: s.effectiveDate,
    cfgRegPeriodDays: s.registrationPeriodDays,
    cfgExtensionDays: s.extensionDays,
    cfgNewOpLeadDays: s.newOperatorLeadDays,
    cfgDeterminationDays: s.determinationDays,
    cfgDeficiencyDays: s.deficiencyDays,
    cfgLicenceAppDays: s.licenceApplicationDays,
    cfgExpiryWindowDays: s.licenceExpiryWindowDays,
    cfgAmberDays: s.amberWarningDays,
    cfgOwnUseThresholdKw: s.ownUseThresholdKw,
    cfgShowCauseDays: s.showCauseDays,
    cfgAnnualDueMonth: m!,
    cfgAnnualDueDay: d!,
    cfgRegPrefix: s.registrationPrefix,
    cfgAckPrefix: s.ackPrefix,
    cfgOunPrefix: s.ounPrefix,
    cfgPayPrefix: s.paymentPrefix,
    cfgChairName: s.chairmanName,
    cfgCommName: s.commissionerName,
    cfgLateBlocksComplete: yn(s.policy.lateChargeBlocksCompleteness),
    cfgWaiverOnLate: yn(s.policy.waiverAppliesToLateCharge),
    cfgFlagsBlockApproval: yn(s.policy.flagsBlockApproval),
    cfgLateRequiredForRelease: yn(s.policy.lateChargeRequiredForRelease),
    cfgUnpaidReminderDays: s.policy.unpaidReminderDays,
    cfgSupplyRetailCat: s.policy.supplyRetailCategory1MwPlus,
    cfgWrongForm: s.policy.wrongFormHandling === "ACCEPT" ? WRONG_FORM.ACCEPT : WRONG_FORM.REQUIRE,
    cfgOtherActivityDocs: yn(s.policy.otherActivitiesRequireDocuments),
    cfgOwnUseCertificate: yn(s.policy.ownUseCertificate),
    cfgFilingFeeOnUpdates: yn(s.policy.filingFeeOnUpdates),
    cfgTodayOverride: today,
    cfgNextAck: 1,
    cfgNextPay: 1,
    cfgNextOun: 1,
  };
}

const withPolicy = (p: Partial<Settings["policy"]>, s: Settings = readySettings): Settings => ({
  ...s,
  policy: { ...s.policy, ...p },
});

// ---------------------------------------------------------------------------------------------
// Domain inputs → workbook rows

const naira2 = (kobo: number) => kobo / 100;
const blank = (v: string | null | undefined): Val => (v === undefined || v === "" ? null : v);

function registerRow(sub: SubmissionInput, a: Assessment, linkedRegNo: string | null): Record<string, Val> {
  if (sub.otherActivities.length > 3) throw new Error("The workbook holds three other activities");
  if (sub.licences.length > 3) throw new Error("The workbook holds three licences");
  const own = a.technical.forms.find((f) => f.form === a.documentsForm);
  const differing = a.technical.capacities.find(
    (c) => sub.installedCapacityMw !== null && Math.abs(c.mw - sub.installedCapacityMw) > Math.max(0.001, 0.01 * Math.max(c.mw, sub.installedCapacityMw)),
  );
  const stated = differing ?? a.technical.capacities[0];
  const row: Record<string, Val> = {
    "Ack No.": sub.ackNo,
    "Filing Type": FILING_LABELS[sub.filingType],
    "Form Filed": sub.formFiled,
    "Linked Registration No.": linkedRegNo,
    "Registered Name": sub.registeredName,
    "Date Submitted": sub.dateSubmitted,
    "Submission Channel": sub.submissionChannel,
    "Registrant Type": sub.registrantType,
    "CAC No.": sub.cacNo,
    TIN: sub.tin,
    "Registered Address": sub.address,
    "Principal LGA": sub.principalLga,
    "Other LGAs Served": blank(sub.lgasServed.join(", ")),
    "Towns / Estates Served": sub.otherAreasServed,
    "Primary Activity": sub.primaryActivity,
    "Installed Capacity (MW)": sub.installedCapacityMw,
    Customers: sub.customers,
    "Licence Status": sub.licenceStatus,
    "Compliance Officer": sub.complianceOfficer,
    Phone: sub.phone,
    Email: sub.email,
    "Operating on Effective Date (Y/N)": sub.operatingOnEffectiveDate,
    "Planned Start Date": sub.plannedStartDate,
    "Approved Waiver": sub.approvedWaiver ? naira2(sub.approvedWaiver) : null,
    "Category Override": sub.categoryOverride,
    "Override Reason": sub.overrideReason,
    "Form Sections Not Complete": own?.outstanding.length ? own.outstanding.join("; ") : null,
    "Capacity Stated in Sections (MW)": stated ? stated.mw : null,
    "Confirmed Category": sub.confirmedCategory,
    "Category Confirmed Reason": sub.categoryConfirmedReason,
    Status: sub.status,
    "Released for Evaluation": sub.releasedForEvaluationDate,
    "Date Submission Complete": sub.dateSubmissionComplete,
    "Deficiency Notice Date": sub.deficiencyNoticeDate,
    "Certificate Issue Date": sub.certificateIssueDate,
    "Registration No.": sub.registrationNo,
    Remarks: sub.remarks,
    "Created By": "registry",
  };
  sub.otherActivities.forEach((n, i) => (row[`Other Activity ${i + 1}`] = n));
  sub.licences.forEach((l, i) => {
    row[`Licence ${i + 1} No.`] = l.number;
    row[`Licence ${i + 1} Expiry`] = l.expiryDate;
  });
  // Conditions in force (the app derives most of them from the category-specific sections).
  for (const k of CONDITION_KEYS.slice(1)) row[CONDITION_COLUMNS[k]] = a.conditions[k];
  if (sub.pricing) {
    row["Priced Category"] = sub.pricing.category;
    row["Priced Fee"] = naira2(sub.pricing.registrationFee);
    row["Priced Late Initial"] = naira2(sub.pricing.lateInitial);
    row["Priced Late Daily"] = naira2(sub.pricing.lateDaily);
    row["Priced Late Cap"] = naira2(sub.pricing.lateDailyCap);
    row["Priced Deadline"] = sub.pricing.deadline;
    row["Priced Effective Date"] = sub.pricing.effectiveDate;
  }
  return row;
}

function evaluationRow(sub: SubmissionInput, ev: EvaluationInput, manual: Record<string, CheckValue>): Record<string, Val> {
  const row: Record<string, Val> = {
    "Ack No.": sub.ackNo,
    "Evaluating Officer": ev.evaluatingOfficerId,
    "Reviewing Supervisor": ev.reviewingSupervisorId,
    "Approving Officer": ev.approvingOfficerId,
    "Date Evaluation Started": sub.dateEvaluationStarted,
    "Flag Override Reason": ev.flagOverrideReason,
    "Final Decision": ev.finalDecision,
    Reasons: ev.reasons,
    "Review Date": ev.reviewDate,
    "Approval Date": ev.approvalDate,
  };
  for (const c of ref.evaluationChecks) if (!AUTO_CHECKS[c.id]) row[c.id] = manual[c.id] ?? null;
  return row;
}

let paySeq = 0;
function paymentRow(p: PaymentInput): Record<string, Val> {
  paySeq++;
  return {
    "Payment No.": `OGSERC/PAY/${p.dateReceived.slice(0, 4)}/${String(paySeq).padStart(5, "0")}`,
    "Date Received": p.dateReceived,
    Reference: p.reference,
    Amount: naira2(p.amount),
    "RRR / Bank Reference": p.rrr ?? null,
    "Recorded By": "registry",
    "Recorded On": p.dateReceived,
    "Finance Status": { PENDING: "Pending", CONFIRMED: "Confirmed", REJECTED: "Rejected" }[p.financeStatus],
    Reversed: p.status === "REVERSED" ? "Y" : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Expected values

const fmtFlags = (sub: SubmissionInput, flags: { code: string; message: string }[], a: Assessment) =>
  flags
    .map((f) => {
      if (f.code !== "TECHNICAL_CAPACITY_MISMATCH") return f.message;
      // Documented wording difference: the workbook holds one stated capacity, not the section label.
      const c = a.technical.capacities.find((x) => Math.abs(x.mw - sub.installedCapacityMw!) > Math.max(0.001, 0.01 * Math.max(x.mw, sub.installedCapacityMw!)))!;
      return `Installed capacity is ${sub.installedCapacityMw} MW, but ${a.documentsForm} sections give ${Number(c.mw.toFixed(3))} MW`;
    })
    .join("; ");

function expectedRegister(sub: SubmissionInput, a: Assessment, flags: { code: string; message: string }[], today: string): Record<string, Val> {
  const d = (x: string | null) => x ?? "";
  return {
    "Category Auto": d(a.categoryAuto),
    "Category Applied": d(a.categoryApplied),
    "Documents Form": d(a.documentsForm),
    "Registration Deadline": d(a.registrationDeadline),
    "Days Late": a.daysLate,
    "Registration Fee": naira2(a.fees.fee),
    "Late Charge": naira2(a.fees.lateCharge),
    "Total Due": naira2(a.fees.totalDue),
    "Amount Paid": naira2(a.fees.amountPaid),
    Balance: naira2(a.fees.balance),
    "Payment Status": a.fees.paymentStatus,
    "Gate Cleared": a.financeGate.cleared ? "Yes" : "No",
    "Process Stage": a.processStage.label,
    "Document Values": a.documents.items.map((i) => `${i.key}=${i.value ?? ""}`).join("|"),
    "Documents Outstanding": a.documents.outstanding,
    "Documents Pending": a.documents.pending,
    "Documents Complete": a.documents.documentsComplete ? "Yes" : "No",
    "Outstanding Documents": a.documents.outstandingList.join("; "),
    "Documents Received": a.documents.receivedList.join("; "),
    "Submission Complete": a.submissionComplete ? "Yes" : "No",
    "Determination Due": d(a.determinationDue),
    "Deficiency Response Due": d(a.deficiencyResponseDue),
    "Licence Application Due": d(a.licenceApplicationDue),
    "Nearest Licence Expiry": d(a.nearestLicenceExpiry),
    "Days in Queue": a.daysInQueue ?? "",
    SLA: a.sla ?? "",
    "Registration No. in Use": d(a.registrationNoInUse),
    "Flag Codes": flags.map((f) => f.code).join(","),
    Flags: fmtFlags(sub, flags, a),
    "Next Action": nextAction(sub, a, today),
  };
}

// ---------------------------------------------------------------------------------------------
// Scenario: one or more Register rows typed in, then every calculated field compared

interface Row {
  alias: string;
  sub: SubmissionInput;
  evaluation?: EvaluationInput;
  manual?: Record<string, CheckValue>;
  /** Compare this row's results (default: the first row only). */
  check?: boolean;
}

const toOther = (s: SubmissionInput): OtherSubmission => ({
  id: s.id,
  cacNo: s.cacNo,
  registeredName: s.registeredName,
  registrationNo: s.registrationNo,
  filingType: s.filingType,
  linkedSubmissionId: s.linkedSubmissionId,
  status: s.status,
  dateSubmitted: s.dateSubmitted,
  certificateIssueDate: s.certificateIssueDate,
});

function scenarioSteps(rows: Row[], payments: PaymentInput[], today: string, s: Settings, label = ""): Step[] {
  const c = ctx(today, s);
  const steps: Step[] = [];
  const byId = new Map(rows.map((r) => [r.sub.id, r.sub]));
  for (const r of rows) {
    const a = assessSubmission(r.sub, payments, c);
    const linked = r.sub.linkedSubmissionId ? byId.get(r.sub.linkedSubmissionId) : null;
    steps.push({ op: "add", table: "tblRegister", alias: r.alias, values: registerRow(r.sub, a, linked?.registrationNo ?? null) });
    const ev = r.evaluation ?? makeEvaluation();
    steps.push({ op: "add", table: "tblEvaluation", alias: r.alias, values: evaluationRow(r.sub, ev, { ...allManualY, ...r.manual }) });
    for (const [key, v] of Object.entries(r.sub.documents)) {
      if (v === null) continue;
      steps.push({
        op: "add",
        table: "tblDocuments",
        alias: `${r.alias}:${key}`,
        values: { Reference: r.sub.ackNo, Form: a.documentsForm, Key: key, "Received (Y/N/N/A)": v },
      });
    }
  }
  payments.forEach((p, i) => steps.push({ op: "add", table: "tblPayments", alias: `P${i + 1}`, values: paymentRow(p) }));
  rows.forEach((r, i) => {
    if (!(r.check ?? i === 0)) return;
    steps.push(...expectSteps(r, rows, payments, today, s, label));
  });
  return steps;
}

function expectSteps(r: Row, rows: Row[], payments: PaymentInput[], today: string, s: Settings, label: string): Step[] {
  const c = ctx(today, s);
  const sub = r.sub;
  const a = assessSubmission(sub, payments, c);
  const others = rows.filter((o) => o.sub.id !== sub.id).map((o) => toOther(o.sub));
  const flags = dataFlags(sub, a, others, c);
  const ev = r.evaluation ?? makeEvaluation();
  const manual = { ...allManualY, ...r.manual };
  const checks = effectiveChecks(ref.evaluationChecks, manual, {
    sub,
    assessment: a,
    flags,
    duplicateCac: flags.some((f) => f.code === "DUPLICATE_CAC"),
    flagsExplained: !!ev.flagOverrideReason,
    ctx: c,
  });
  const counts = countDecisionChecks(checks);
  const linkedSub = sub.linkedSubmissionId ? rows.find((o) => o.sub.id === sub.linkedSubmissionId)?.sub : undefined;
  const blockers = approvalBlockers({
    sub,
    assessment: a,
    evaluation: ev,
    counts,
    flags,
    createdById: "registry",
    actorId: ev.approvingOfficerId ?? "",
    settings: s,
    linked: linkedSub ? { status: linkedSub.status, registrationNo: linkedSub.registrationNo } : null,
  })
    .filter((b) => b !== "Only the assigned approving officer can decide")
    // The capacity flag's documented wording difference also shows in the flags listed here.
    .map((b) => {
      const tech = flags.find((f) => f.code === "TECHNICAL_CAPACITY_MISMATCH");
      if (!tech) return b;
      const wb = fmtFlags(sub, [tech], a);
      return b.replace(tech.message, wb);
    });
  const autoValues: Record<string, Val> = {};
  for (const ch of checks) if (AUTO_CHECKS[ch.id]) autoValues[ch.id] = ch.value ?? "";
  const tag = label ? ` (${label})` : "";
  return [
    { op: "expect", table: "tblRegister", alias: r.alias, label: `Register ${r.alias}${tag}`, values: expectedRegister(sub, a, flags, today) },
    {
      op: "expect",
      table: "tblEvaluation",
      alias: r.alias,
      label: `Evaluation ${r.alias}${tag}`,
      values: {
        ...autoValues,
        Satisfied: counts.satisfied,
        Failed: counts.failed,
        "N/A": counts.na,
        Pending: counts.pending,
        "Evaluation Status": evaluationStatus(ev, counts),
        "Recommended Outcome": recommendedOutcome(checks, counts, sub, a, ev, today),
        "File Closed": fileClosed(checks) ? "Yes" : "No",
        "Approval Blockers": blockers.join("\n"),
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// The fixtures

const fixtures: Fixture[] = [];

function formula(
  id: string,
  specRow: string,
  title: string,
  rows: Row[],
  opts: { payments?: PaymentInput[]; today?: string; settings?: Settings } = {},
) {
  const today = opts.today ?? ED;
  const s = opts.settings ?? readySettings;
  fixtures.push({
    id,
    spec: specRow,
    title,
    macros: false,
    settings: settingsCells(s, today),
    steps: scenarioSteps(rows, opts.payments ?? [], today, s),
  });
}

const one = (sub: SubmissionInput, more: Partial<Row> = {}): Row[] => [{ alias: "R1", sub, ...more }];
const paid = (sub: SubmissionInput, n: number) => [payment(sub.ackNo!, n)];

// Example mini-grid
formula("mini-grid", "Example mini-grid", "MGD 2.5 MW on time: Category E, fee ₦250,000, no late charge", one(makeSubmission({ primaryActivity: activity("MGD"), installedCapacityMw: 2.5 })));

// Mighty Power
formula(
  "mighty-power",
  "Mighty Power",
  "MSL 60 MW Unlicensed on the Effective Date: Category F, ₦500,000, multi-State flag, licence application due ED + 90",
  one(
    makeSubmission({
      registeredName: "Mighty Power Ltd",
      primaryActivity: activity("MSL"),
      installedCapacityMw: 60,
      licenceStatus: LICENCE.UNLICENSED,
      licences: [],
    }),
  ),
);

// Late tiers
const late = (code: string, mw: number | null, days: number) => {
  const sub = makeSubmission({ primaryActivity: activity(code), installedCapacityMw: mw, dateSubmitted: addDays(DEADLINE, days) });
  return { sub, today: addDays(DEADLINE, days) };
};
{
  const t2 = late("GEN", 5, 20);
  formula("late-tier-2", "Late tier 2", "Category D 20 days late: late ₦2,500,000, total ₦2,800,000", one(t2.sub), { today: t2.today });
  const t1 = late("SDC", 2.5, 150);
  formula("late-tier-1-cap", "Late tier 1 at cap", "Category A 150 days late: late ₦21,000,000 (capped)", one(t1.sub), { today: t1.today });
  const t3 = late("SUP", 2.5, 5);
  formula("late-tier-3", "Late tier 3", "Category K 5 days late: late ₦150,000", one(t3.sub), { today: t3.today });
}

// Highest applies, A dominates, capacity tiers
formula("highest-applies", "Highest applies", "GEN 5 MW + EST: Category G", one(makeSubmission({ primaryActivity: activity("GEN"), otherActivities: [activity("EST")], installedCapacityMw: 5 })));
for (const p of ["GEN", "EST", "MGD", "INT"])
  formula(`a-dominates-${p}`, "A dominates", `Primary ${p} + secondary SDC: Category A`, one(makeSubmission({ primaryActivity: activity(p), otherActivities: [activity("SDC")], installedCapacityMw: 5 })));
for (const [mw] of [[0.5], [5], [15]] as const)
  formula(`capacity-${mw}`, "Capacity tiers", `GEN ${mw} MW`, one(makeSubmission({ primaryActivity: activity("GEN"), installedCapacityMw: mw })));

// New operator
formula("new-operator", "New operator", "Not operating, start 2027-03-01: deadline 2027-01-30", one(makeSubmission({ operatingOnEffectiveDate: "N", plannedStartDate: "2027-03-01" })));

// Waiver
{
  const base = { primaryActivity: activity("EST"), approvedWaiver: naira(100_000) };
  const s1 = makeSubmission({ ...base, documents: allDocs("Y") });
  formula("waiver-complete", "Waiver", "Fee 500k, waiver 100k, paid 400k: Paid and complete", one(s1), { payments: paid(s1, 400_000) });
  const docs = allDocs("Y");
  docs.single_line_diagram = "N";
  const s2 = makeSubmission({ ...base, documents: docs });
  formula("waiver-incomplete", "Waiver", "Same, one document outstanding: Paid, not complete", one(s2), { payments: paid(s2, 400_000) });
}

// Provisional (formula part: day 31 view after the daily review moved it)
{
  const day0 = "2026-11-02";
  const sub = makeSubmission({ documents: allDocs("Y"), dateSubmissionComplete: day0, dateSubmitted: day0 });
  formula("provisional-day30", "Provisional", "Complete on day 0, day 30: still under review, determine by day 30", one(sub), { payments: [payment(sub.ackNo!, 250_000, day0)], today: addDays(day0, 30) });
  formula("provisional-day31-recommend", "Provisional", "Day 31, no decision: recommended outcome provisional registration", one(sub), { payments: [payment(sub.ackNo!, 250_000, day0)], today: addDays(day0, 31) });
  const prov = { ...sub, status: STATUS.PROVISIONAL };
  formula("provisional-day31-number", "Provisional", "Provisionally Registered: registration number in use = ack number", one(prov), { payments: [payment(sub.ackNo!, 250_000, day0)], today: addDays(day0, 31) });
}

// Approval blockers and separation
{
  const ready = makeSubmission({ documents: allDocs("Y"), dateSubmissionComplete: ED });
  const pays = paid(ready, 250_000);
  formula("approval-ready", "Approval blockers", "Fully ready: no blockers, recommended Register", one(ready), { payments: pays });
  for (const field of ["evaluatingOfficerId", "reviewingSupervisorId", "approvingOfficerId"] as const)
    formula(`approval-missing-${field}`, "Approval blockers", `Missing ${field}`, one(ready, { evaluation: makeEvaluation({ [field]: null }) }), { payments: pays });
  formula("approval-pending-check", "Approval blockers", "A pending check", one(ready, { manual: { "2.1": null } }), { payments: pays });
  formula("approval-failed-check", "Approval blockers", "A failed check", one(ready, { manual: { "2.1": "N" } }), { payments: pays });
  const docs = allDocs("Y");
  docs.incorporation = "N";
  const incomplete = makeSubmission({ documents: docs, dateSubmissionComplete: ED });
  formula("approval-incomplete", "Approval blockers", "Incomplete submission", one(incomplete), { payments: paid(incomplete, 250_000) });
  formula(
    "approval-many",
    "Approval blockers",
    "Several at once: every reason listed",
    one(makeSubmission({ documents: allDocs(null) }), {
      manual: { "2.1": "N", "2.2": null },
      evaluation: makeEvaluation({ evaluatingOfficerId: null, reviewingSupervisorId: null }),
    }),
  );
  formula("separation-approver-evaluator", "Separation", "Approver = evaluator: refused", one(ready, { evaluation: makeEvaluation({ evaluatingOfficerId: "u1", approvingOfficerId: "u1" }) }), { payments: pays });
}

// Finance gate (formula part)
{
  const sub = makeSubmission({ status: STATUS.AWAITING, releasedForEvaluationDate: null, documents: allDocs("Y") });
  formula("gate-pending", "Finance gate", "₦250k recorded, pending: Awaiting Payment, stage 2, amount paid ₦0, approval blocked", one(sub), { payments: [payment(sub.ackNo!, 250_000, ED, "PENDING")] });
  formula("gate-first-part", "Finance gate", "₦100k confirmed of ₦250k: gate still closed", one(sub), { payments: [payment(sub.ackNo!, 100_000)] });
  formula("gate-both-parts", "Finance gate", "₦100k + ₦150k confirmed: gate cleared", one(sub), { payments: [payment(sub.ackNo!, 100_000), payment(sub.ackNo!, 150_000)] });
  const lateSub = makeSubmission({ status: STATUS.AWAITING, releasedForEvaluationDate: null, dateSubmitted: addDays(DEADLINE, 3) });
  const feeOnly = [payment(lateSub.ackNo!, 250_000, addDays(DEADLINE, 3))];
  formula("gate-late-default", "Finance gate", "Fee confirmed, late charge unpaid: cleared by default", one(lateSub), { payments: feeOnly, today: addDays(DEADLINE, 3) });
  formula("gate-late-required", "Finance gate", "Same with “late charge required to release” on: not cleared", one(lateSub), {
    payments: feeOnly,
    today: addDays(DEADLINE, 3),
    settings: withPolicy({ lateChargeRequiredForRelease: true }),
  });
  formula("gate-docs-pending", "Finance gate + documents", "All documents in, fee pending: gate closed, evidence of payment outstanding, not complete", one(sub), { payments: [payment(sub.ackNo!, 250_000, ED, "PENDING")] });
  formula("gate-docs-confirmed", "Finance gate + documents", "Confirmed: complete", one(sub), { payments: [payment(sub.ackNo!, 250_000)] });
}

// Forms
{
  const gen5 = (o: Partial<SubmissionInput> = {}) => makeSubmission({ primaryActivity: activity("GEN"), installedCapacityMw: 5, ...o });
  formula("forms-reg01d-unconfirmed", "Forms", "GEN 5 MW on REG-01D: 12-item list, 1.10 pending until confirmed", one(gen5({ confirmedCategory: null })));
  formula("forms-reg01d-confirmed", "Forms", "Confirmed D: 1.10 Y", one(gen5({ confirmedCategory: "D" })));
  formula("highest-applies-met-est", "Highest applies", "GEN 5 MW + MET + EST: Category G", one(gen5({ otherActivities: [activity("MET"), activity("EST")] })));
  const sup = (mw: number) => makeSubmission({ primaryActivity: activity("SUP"), installedCapacityMw: mw });
  formula("sup-2mw-default", "Supply / retail", "SUP 2 MW: K by default", one(sup(2)));
  formula("sup-2mw-f", "Supply / retail", "SUP 2 MW with the setting F: F", one(makeSubmission({ primaryActivity: activity("SUP"), installedCapacityMw: 2, formFiled: "REG-01F", confirmedCategory: "F" })), { settings: withPolicy({ supplyRetailCategory1MwPlus: "F" }) });
  formula("sup-0.5mw-f", "Supply / retail", "SUP 0.5 MW with the setting F: stays K", one(sup(0.5)), { settings: withPolicy({ supplyRetailCategory1MwPlus: "F" }) });
  const wrong = gen5({ formFiled: "REG-01K", confirmedCategory: "D", categoryConfirmedReason: "Plant is 5 MW", technicalData: {} });
  formula("wrong-form-accept", "Wrong form", "Filed on REG-01K, confirmed D with a reason, accept: 1.10 Y, REG-01D documents", one(wrong));
  formula("wrong-form-require", "Wrong form", "Same with “require the correct form”: 1.10 N, must file on REG-01D, deficiency notice", one(wrong), {
    settings: withPolicy({ wrongFormHandling: "REQUIRE_CORRECT_FORM" }),
  });
  formula("conditions-gen-sale-n", "Conditions", "REG-01D, generation for sale = N: PPAs N/A automatically", one(gen5({ technicalData: {}, conditions: { ...gen5().conditions, generation_for_sale: "N" } })));
}

// Evidence of payment
{
  const sub = makeSubmission({ documents: allDocs("Y") });
  formula("evidence-pending", "Evidence of payment", "Pending payment: blank", one(sub), { payments: [payment(sub.ackNo!, 250_000, ED, "PENDING")] });
  formula("evidence-confirmed", "Evidence of payment", "Confirmed: Y", one(sub), { payments: paid(sub, 250_000) });
  formula("evidence-reversed", "Evidence of payment", "Reversed: blank", one(sub), { payments: [{ ...payment(sub.ackNo!, 250_000), status: "REVERSED" }] });
  formula("evidence-waived", "Evidence of payment", "Fully waived: N/A", one(makeSubmission({ documents: allDocs("Y"), approvedWaiver: naira(250_000) })));
}

// Update and annual confirmation (formula part)
{
  const registered = makeSubmission({
    id: "reg-1",
    ackNo: "OGSERC/ACK/2026/00001",
    status: STATUS.REGISTERED,
    registrationNo: "OGSERC/REG/2026/E-MGD/0001",
    certificateIssueDate: ED,
    documents: allDocs("Y"),
    dateSubmissionComplete: ED,
  });
  const update = (o: Partial<SubmissionInput> = {}) =>
    makeSubmission({ id: "upd-1", ackNo: "OGSERC/ACK/2026/00009", filingType: FILING.UPDATE, linkedSubmissionId: "reg-1", documents: allDocs("Y"), dateSubmissionComplete: ED, ...o });
  const regPays = paid(registered, 250_000);
  formula("update-no-fee", "Update", "Update, no fee setting: fee ₦0, no late charge, gate clear, recommended apply changes", [{ alias: "U", sub: update() }, { alias: "REG", sub: registered }], { payments: regPays });
  formula("update-late-no-charge", "Update", "Update filed 40 days after the deadline: still no late charge", [{ alias: "U", sub: update({ dateSubmitted: addDays(DEADLINE, 40) }) }, { alias: "REG", sub: registered }], { payments: regPays, today: addDays(DEADLINE, 40) });
  formula("update-fee-setting", "Update", "Fee on updates setting on: the category's fee", [{ alias: "U", sub: update() }, { alias: "REG", sub: registered }], { payments: regPays, settings: withPolicy({ filingFeeOnUpdates: true }) });
  const annual = (date: string, status: SubmissionInput["status"] = STATUS.RECEIVED) =>
    makeSubmission({ id: "ann-1", ackNo: "OGSERC/ACK/2027/00010", filingType: FILING.ANNUAL, linkedSubmissionId: "reg-1", dateSubmitted: date, status });
  formula("annual-overdue", "Annual confirmation", "Registered 2026, nothing filed by 31 Jan 2027: flagged overdue on 1 Feb 2027", [{ alias: "REG", sub: registered }], { payments: regPays, today: "2027-02-01" });
  formula("annual-filed-jan20", "Annual confirmation", "One filed 20 Jan 2027 clears it", [{ alias: "REG", sub: registered }, { alias: "A", sub: annual("2027-01-20") }], { payments: regPays, today: "2027-02-01" });
  formula("annual-filed-feb1", "Annual confirmation", "Filed 1 Feb 2027: flagged late", [{ alias: "A", sub: annual("2027-02-01") }, { alias: "REG", sub: registered }], { payments: regPays, today: "2027-02-01" });
  formula("annual-refused-does-not-count", "Annual confirmation", "A refused one does not count", [{ alias: "REG", sub: registered }, { alias: "A", sub: annual("2027-01-20", STATUS.REFUSED) }], { payments: regPays, today: "2027-02-01" });
}

// Licences
formula("licences-nearest", "Licences", "Expiries 2029 and ED + 100 days: renewal flag from the nearer one", one(makeSubmission({ licences: [licence("NERC/MG/001", "2029-06-30"), licence("OGSERC/P/002", addDays(ED, 100))] })));

// Technical sections (summaries)
{
  const gen5 = (o: Partial<SubmissionInput> = {}) => makeSubmission({ primaryActivity: activity("GEN"), installedCapacityMw: 5, ...o });
  formula("technical-captive-none", "Technical sections", "REG-01D captive only, network none: offtake and connection agreements N/A", one(gen5({ technicalData: {}, conditions: { ...gen5().conditions, generation_for_sale: "N", grid_connected: "N" } })));
  // Plant table 3 + 1.5 MW at 5 MW installed.
  const answered = gen5().technicalData;
  // State the capacity directly: the workbook takes the stated total, not the table.
  formula("technical-capacity-mismatch", "Technical sections", "Plant 3 + 1.5 MW, installed 5 MW: capacity flag", one(gen5({ technicalData: withCapacity(answered, "REG-01D", 4.5) })));
  formula("technical-capacity-agrees", "Technical sections", "REG-01K 250 + 252 kW at 0.5 MW: agrees", one(makeSubmission({ primaryActivity: activity("GEN"), installedCapacityMw: 0.5, technicalData: withCapacity(makeSubmission({ primaryActivity: activity("GEN"), installedCapacityMw: 0.5 }).technicalData, "REG-01K", 0.502) })));
  formula("technical-two-empty", "Technical sections", "REG-01D with two sections empty, operations does not apply: flag lists the two", one(gen5({ technicalData: twoEmpty(answered) })));
}

// Own-use (formula part)
function ownUseFixture(id: string, specRow: string, title: string, oun: OwnUseInput, payments: PaymentInput[], s: Settings = readySettings) {
  const c = { otherNotifications: [], registerCacNos: [], payments, ref, settings: s };
  const a = assessOwnUse(oun, c);
  const values: Record<string, Val> = {
    "OUN No.": oun.ounNo,
    Name: oun.name,
    "Date Filed": oun.dateFiled,
    "CAC No.": oun.cacNo,
    "Site Address": oun.siteAddress,
    LGA: oun.lga,
    "Created By": "registry",
    "Registration No.": oun.registrationNo,
  };
  oun.units.forEach((u, i) => (values[`Unit ${i + 1} kW`] = u.capacityKw));
  const steps: Step[] = [{ op: "add", table: "tblOwnUse", alias: "O1", values }];
  for (const [key, v] of Object.entries(oun.documents))
    steps.push({ op: "add", table: "tblDocuments", alias: `O1:${key}`, values: { Reference: oun.ounNo, Form: "REG-01I", Key: key, "Received (Y/N/N/A)": v } });
  payments.forEach((p, i) => steps.push({ op: "add", table: "tblPayments", alias: `P${i + 1}`, values: paymentRow(p) }));
  const blockers = ownUseRegistrationBlockers({ oun, assessment: a, settings: s, createdById: "registry", actorId: "approver", flagOverrideReason: null });
  steps.push({
    op: "expect",
    table: "tblOwnUse",
    alias: "O1",
    label: "Own-Use O1",
    values: {
      "Installed Capacity (kW)": a.installedCapacityKw ?? "",
      Eligibility: a.eligibility ?? "",
      "Fee Due": naira2(a.feeDue),
      "Amount Paid": naira2(a.amountPaid),
      Balance: naira2(a.balance),
      "Payment Status": a.paymentStatus,
      "Filed After Deadline": a.filedLate ? "Yes" : "No",
      "Document Values": a.documents.items.map((i) => `${i.key}=${i.value ?? ""}`).join("|"),
      "Documents Complete": a.documents.documentsComplete ? "Yes" : "No",
      Flags: a.flags.map((f) => f.message).join("; "),
      "Registration Blockers": blockers.join("\n"),
    },
  });
  fixtures.push({ id, spec: specRow, title, macros: false, settings: settingsCells(s, ED), steps });
}
{
  const unit = (kw: number) => ({ makeModel: "Gen", capacityKw: kw, fuel: "Diesel", avgMonthlyMwh: 10 });
  const oun = (units: number[], docs: Record<string, CheckValue> = { incorporation: "Y", nameplate_photos: "Y" }): OwnUseInput => ({
    id: "o1",
    ounNo: "OGSERC/OUN/2026/0001",
    name: "Factory Ltd",
    dateFiled: ED,
    cacNo: "RC1",
    siteAddress: "Plot 1",
    lga: "Ifo",
    units: units.map(unit),
    documents: docs,
    pricing: null,
    registrationNo: null,
    certificateIssueDate: null,
  });
  ownUseFixture("own-use-150", "Own-use", "150 kW: not required, no fee", oun([150]), []);
  ownUseFixture("own-use-650", "Own-use", "650 kW: notification required, Category I fee ₦100,000", oun([650]), []);
  ownUseFixture("own-use-1200", "Own-use", "1200 kW: register as operator", oun([1200]), []);
  ownUseFixture("own-use-units", "Own-use units", "400 + 250 kW: 650 kW, notification required, Category I fee", oun([400, 250]), []);
  const paidOu = [payment("OGSERC/OUN/2026/0001", 100_000)];
  ownUseFixture("own-use-cert-off", "Own-use certificate", "Setting off, paid, complete: blocked", oun([400, 250]), paidOu);
  ownUseFixture("own-use-cert-on", "Own-use certificate", "Setting on, paid, complete: no blockers", oun([400, 250]), paidOu, withPolicy({ ownUseCertificate: true }));
  ownUseFixture("own-use-cert-on-unpaid", "Own-use certificate", "Setting on, unpaid: fee and evidence of payment blockers", oun([400, 250]), [], withPolicy({ ownUseCertificate: true }));
}

// ---------------------------------------------------------------------------------------------
// Technical-data helpers (the domain decides what the workbook summary should say)

function withCapacity(td: SubmissionInput["technicalData"], form: string, mw: number): SubmissionInput["technicalData"] {
  const copy = JSON.parse(JSON.stringify(td));
  const def = ref.technical[form]!;
  let done = false;
  for (const sec of def.sections)
    for (const f of sec.fields) {
      if (done) break;
      if (f.capacity && (f.type === "number" || f.type === "integer")) {
        copy[form].sections[sec.key][f.key] = f.capacity === "kW" ? mw * 1000 : mw;
        done = true;
      } else if (f.type === "table" && f.columns?.some((c) => c.capacity)) {
        const col = f.columns.find((c) => c.capacity)!;
        const row0 = copy[form].sections[sec.key][f.key][0];
        const factor = col.capacity === "kW" ? 1000 : 1;
        const half = Math.round((mw * factor * 2) / 3 * 1000) / 1000;
        copy[form].sections[sec.key][f.key] = [
          { ...row0, [col.key]: half },
          { ...row0, [col.key]: Math.round((mw * factor - half) * 1000) / 1000 },
        ];
        done = true;
      }
    }
  // Every other stated capacity of the form agrees with the first.
  for (const sec of def.sections)
    for (const f of sec.fields) {
      if (f.capacity && (f.type === "number" || f.type === "integer")) copy[form].sections[sec.key][f.key] = f.capacity === "kW" ? mw * 1000 : mw;
      if (f.type === "table" && f.columns?.some((c) => c.capacity)) {
        const col = f.columns.find((c) => c.capacity)!;
        const factor = col.capacity === "kW" ? 1000 : 1;
        const rows = copy[form].sections[sec.key][f.key] as Record<string, number>[];
        const total = rows.reduce((t, r) => t + Number(r[col.key] ?? 0), 0);
        if (Math.abs(total - mw * factor) > 1e-6) copy[form].sections[sec.key][f.key] = [{ ...rows[0], [col.key]: mw * factor }];
      }
    }
  return copy;
}

function twoEmpty(td: SubmissionInput["technicalData"]): SubmissionInput["technicalData"] {
  const copy = JSON.parse(JSON.stringify(td));
  const secs = ref.technical["REG-01D"]!.sections.map((s) => s.key);
  delete copy["REG-01D"].sections[secs[0]!];
  delete copy["REG-01D"].sections[secs[1]!];
  const ops = secs.find((k) => /operation/i.test(k)) ?? secs.at(-1)!;
  copy["REG-01D"].notApplicable = [ops];
  return copy;
}

// ---------------------------------------------------------------------------------------------
// Macro fixtures (workflow actions). They run the VBA buttons, then compare with the domain.

function macroFixture(id: string, specRow: string, title: string, s: Settings, today: string, steps: Step[]) {
  fixtures.push({ id, spec: specRow, title, macros: true, settings: settingsCells(s, today), steps });
}

/** A new submission typed into the Register as staff would, before Save submission. */
function intakeRow(sub: SubmissionInput): Record<string, Val> {
  const a = assessSubmission(sub, [], ctx(ED, readySettings));
  const row = registerRow(sub, a, null);
  for (const k of ["Ack No.", "Status", "Released for Evaluation", "Date Submission Complete", "Deficiency Notice Date", "Certificate Issue Date", "Registration No.", "Created By", "Confirmed Category", "Category Confirmed Reason"]) delete row[k];
  return row;
}

{
  // Finance gate end to end: save, record, confirm in two parts.
  const sub = makeSubmission({ ackNo: "OGSERC/ACK/2026/00001", status: STATUS.AWAITING, releasedForEvaluationDate: null, documents: {} });
  const pay = (amount: number): Record<string, Val> => ({ "Date Received": ED, Reference: "OGSERC/ACK/2026/00001", Amount: amount, Purpose: "Registration fee", Channel: "Remita", "RRR / Bank Reference": `RRR-${amount}` });
  const pendingA = assessSubmission(sub, [payment(sub.ackNo!, 250_000, ED, "PENDING")], ctx());
  macroFixture("macro-gate", "Finance gate", "Save, record ₦250k: Awaiting Payment, stage 2, paid ₦0; mark complete and approval blocked and audited", readySettings, ED, [
    { op: "add", table: "tblRegister", alias: "R1", values: intakeRow(sub) },
    { op: "run", macro: "SaveSubmissionAt", args: ["R1"], user: "registry", answers: [], label: "Save submission" },
    { op: "set", table: "tblEvaluation", alias: "R1", values: { "Evaluating Officer": "evaluator", "Reviewing Supervisor": "supervisor", "Approving Officer": "approver" } },
    { op: "add", table: "tblPayments", alias: "P1", values: pay(250_000) },
    { op: "run", macro: "RecordPaymentAt", args: ["P1"], user: "registry", answers: [], label: "Record payment" },
    {
      op: "expect",
      table: "tblRegister",
      alias: "R1",
      label: "after recording",
      values: { "Ack No.": "OGSERC/ACK/2026/00001", Status: STATUS.AWAITING, "Process Stage": pendingA.processStage.label, "Amount Paid": 0, "Gate Cleared": "No", "Next Action": nextAction(sub, pendingA, ED) },
    },
    { op: "run", macro: "MarkCompleteFor", args: ["OGSERC/ACK/2026/00001"], user: "evaluator", answers: [], label: "Mark complete (blocked)" },
    { op: "run", macro: "ApproveFor", args: ["OGSERC/ACK/2026/00001"], user: "approver", answers: [], label: "Approve (blocked)" },
    { op: "expectAudit", label: "blocked attempts audited", reference: "OGSERC/ACK/2026/00001", actions: ["New submission", "Payment recorded", "Blocked - awaiting Finance confirmation", "Blocked - awaiting Finance confirmation"] },
  ]);
  macroFixture("macro-gate-two-parts", "Finance gate", "₦100k confirmed: not released; ₦150k confirmed: released in the same action", readySettings, ED, [
    { op: "add", table: "tblRegister", alias: "R1", values: intakeRow(sub) },
    { op: "run", macro: "SaveSubmissionAt", args: ["R1"], user: "registry", answers: [], label: "Save submission" },
    { op: "add", table: "tblPayments", alias: "P1", values: pay(100_000) },
    { op: "run", macro: "RecordPaymentAt", args: ["P1"], user: "registry", answers: [], label: "Record ₦100k" },
    { op: "run", macro: "ConfirmPaymentAt", args: ["P1"], user: "finance", answers: [true, ""], label: "Confirm ₦100k" },
    { op: "expect", table: "tblRegister", alias: "R1", label: "after ₦100k", values: { Status: STATUS.AWAITING, "Amount Paid": 100_000, "Gate Cleared": "No" } },
    { op: "add", table: "tblPayments", alias: "P2", values: pay(150_000) },
    { op: "run", macro: "RecordPaymentAt", args: ["P2"], user: "registry", answers: [], label: "Record ₦150k" },
    { op: "run", macro: "ConfirmPaymentAt", args: ["P2"], user: "finance", answers: [true, ""], label: "Confirm ₦150k" },
    { op: "expect", table: "tblRegister", alias: "R1", label: "after ₦150k", values: { Status: STATUS.RECEIVED, "Released for Evaluation": ED, "Amount Paid": 250_000, "Gate Cleared": "Yes" } },
    { op: "expectAudit", label: "released in the confirming action", reference: "OGSERC/ACK/2026/00001", actions: ["New submission", "Payment recorded", "Payment confirmed", "Payment recorded", "Payment confirmed", "Released for evaluation"] },
  ]);
  const lateSub = makeSubmission({ ackNo: "OGSERC/ACK/2026/00001", dateSubmitted: addDays(DEADLINE, 3), documents: {} });
  for (const required of [false, true]) {
    const s = withPolicy({ lateChargeRequiredForRelease: required });
    macroFixture(`macro-gate-late-${required ? "required" : "default"}`, "Finance gate", `Fee confirmed, late charge unpaid: ${required ? "not released (setting on)" : "released (default)"}`, s, addDays(DEADLINE, 3), [
      { op: "add", table: "tblRegister", alias: "R1", values: intakeRow(lateSub) },
      { op: "run", macro: "SaveSubmissionAt", args: ["R1"], user: "registry", answers: [], label: "Save submission" },
      { op: "add", table: "tblPayments", alias: "P1", values: { ...pay(250_000), "Date Received": addDays(DEADLINE, 3) } },
      { op: "run", macro: "RecordPaymentAt", args: ["P1"], user: "registry", answers: [], label: "Record fee" },
      { op: "run", macro: "ConfirmPaymentAt", args: ["P1"], user: "finance", answers: [true, ""], label: "Confirm fee" },
      { op: "expect", table: "tblRegister", alias: "R1", label: "after confirming the fee", values: { Status: required ? STATUS.AWAITING : STATUS.RECEIVED } },
    ]);
  }
  macroFixture("macro-finance-own-payment", "Separation", "Finance officer confirms a payment they recorded: refused", readySettings, ED, [
    { op: "add", table: "tblRegister", alias: "R1", values: intakeRow(sub) },
    { op: "run", macro: "SaveSubmissionAt", args: ["R1"], user: "registry", answers: [], label: "Save submission" },
    { op: "add", table: "tblPayments", alias: "P1", values: pay(250_000) },
    { op: "run", macro: "RecordPaymentAt", args: ["P1"], user: "finance", answers: [], label: "Record payment (by Finance)" },
    { op: "run", macro: "ConfirmPaymentAt", args: ["P1"], user: "finance", answers: [true, ""], label: "Confirm own payment" },
    { op: "expectMessage", label: "refused", contains: ["cannot confirm a payment they recorded"] },
    { op: "expect", table: "tblPayments", alias: "P1", label: "still pending", values: { "Finance Status": "Pending" } },
  ]);
}

{
  // Provisional by the daily review.
  const day0 = "2026-11-02";
  const sub = makeSubmission({ documents: allDocs("Y"), dateSubmissionComplete: day0, dateSubmitted: day0 });
  const pays = [payment(sub.ackNo!, 250_000, day0)];
  const at = (d: number) => dailyReview([{ sub, assessment: assessSubmission(sub, pays, ctx(addDays(day0, d))) }], addDays(day0, d));
  if (at(30).toProvisional.length !== 0 || at(31).toProvisional.length !== 1) throw new Error("domain provisional fixture changed");
  const rows = scenarioSteps([{ alias: "R1", sub, check: false }], pays, day0, readySettings);
  const provA = assessSubmission({ ...sub, status: STATUS.PROVISIONAL }, pays, ctx(addDays(day0, 31)));
  macroFixture("macro-provisional", "Provisional", "Complete on day 0: day 30 review leaves it; day 31 review → Provisionally Registered, ack no. in use", readySettings, addDays(day0, 30), [
    ...rows,
    { op: "run", macro: "DailyReviewSilent", args: [], user: "supervisor", answers: [], label: "Daily review day 30" },
    { op: "expect", table: "tblRegister", alias: "R1", label: "day 30", values: { Status: STATUS.RECEIVED } },
    { op: "today", date: addDays(day0, 31) },
    { op: "run", macro: "DailyReviewSilent", args: [], user: "supervisor", answers: [], label: "Daily review day 31" },
    { op: "expect", table: "tblRegister", alias: "R1", label: "day 31", values: { Status: STATUS.PROVISIONAL, "Registration No. in Use": provA.registrationNoInUse, "Next Action": "Determine and issue the certificate" } },
    { op: "expectAudit", label: "audited", reference: sub.ackNo!, actions: ["Provisional registration"] },
  ]);
}

{
  // Lapse: deficiency on day 0; blocked on day 14, allowed on day 15.
  const day0 = "2026-11-02";
  const sub = makeSubmission({ dateSubmitted: day0, documents: {} });
  const pays = [payment(sub.ackNo!, 250_000, day0)];
  const def = { ...sub, status: STATUS.DEFICIENCY, deficiencyNoticeDate: day0 };
  const b = (d: number) => lapseBlockers(def.status, assessSubmission(def, pays, ctx(addDays(day0, d))), addDays(day0, d));
  macroFixture("macro-lapse", "Lapse", "Deficiency on day 0: lapse blocked on day 14, allowed on day 15", readySettings, day0, [
    ...scenarioSteps([{ alias: "R1", sub, check: false }], pays, day0, readySettings),
    { op: "run", macro: "IssueDeficiencyFor", args: [sub.ackNo], user: "supervisor", answers: [true], label: "Issue deficiency day 0" },
    { op: "expect", table: "tblRegister", alias: "R1", label: "notice issued", values: { Status: STATUS.DEFICIENCY, "Deficiency Notice Date": day0, "Deficiency Response Due": addDays(day0, 14) } },
    { op: "today", date: addDays(day0, 14) },
    { op: "run", macro: "LapseFor", args: [sub.ackNo], user: "supervisor", answers: [], label: "Lapse day 14" },
    { op: "expectMessage", label: "blocked on day 14", contains: b(14) },
    { op: "expect", table: "tblRegister", alias: "R1", label: "day 14", values: { Status: STATUS.DEFICIENCY } },
    { op: "today", date: addDays(day0, 15) },
    { op: "run", macro: "LapseFor", args: [sub.ackNo], user: "supervisor", answers: [], label: "Lapse day 15" },
    { op: "expect", table: "tblRegister", alias: "R1", label: "day 15", values: { Status: STATUS.LAPSED, "Next Action": "Closed – Lapsed; fresh application needed" } },
    { op: "expect", table: "tblEvaluation", alias: "R1", label: "decision", values: { "Final Decision": "Treat as lapsed (13(2))", "Approval Date": addDays(day0, 15) } },
  ]);
  if (b(15).length) throw new Error("domain lapse fixture changed");
}

{
  // Approval: blockers listed by the button; separation; registration serials across years.
  const dates = ["2026-11-01", "2026-11-15", "2026-12-30", "2027-01-04"];
  // A multi-State licensee holds a multi-State NERC licence; without one the MSL_LICENCE flag blocks approval.
  const mk = (n: number, code: string, mw: number) =>
    makeSubmission({
      id: `s${n}`, ackNo: `OGSERC/ACK/2026/0000${n}`, cacNo: `RC10000${n}`, registeredName: `Operator ${n} Ltd`, primaryActivity: activity(code), installedCapacityMw: mw, documents: allDocs("Y"), dateSubmissionComplete: ED,
      ...(code === "MSL" ? { licenceStatus: LICENCE.MULTI_STATE, licences: [licence(`NERC/MSL/00${n}`, "2030-12-31")] } : {}),
    });
  const subs = [mk(1, "MSL", 0), mk(2, "GEN", 5), mk(3, "MSL", 0), mk(4, "MGD", 2)];
  // The expected numbers below assume clean records: fail here, not in Excel, if that stops being true.
  subs.forEach((sub, i) => {
    const c = ctx(dates[i]!, readySettings);
    const a = assessSubmission(sub, [payment(sub.ackNo!, 1_000_000)], c);
    const flags = dataFlags(sub, a, subs.filter((o) => o !== sub).map(toOther), c);
    if (flags.length) throw new Error(`macro-reg-serial: ${sub.ackNo} has data flags: ${flags.map((f) => f.message).join("; ")}`);
  });
  const issued: string[] = [];
  const expectedNos = subs.map((sub, i) => {
    const a = assessSubmission(sub, [payment(sub.ackNo!, 1_000_000)], ctx(dates[i]!, readySettings));
    const serial = nextRegistrationSerial("OGSERC/REG", dates[i]!, issued);
    const no = approvalChanges({ sub, assessment: a, evaluation: makeEvaluation(), counts: { total: 56, satisfied: 56, failed: 0, na: 0, pending: 0 }, flags: [], createdById: "registry", actorId: "approver", settings: readySettings }, "approver", serial, dates[i]!).submission.registrationNo!;
    issued.push(no);
    return no;
  });
  const steps: Step[] = [...scenarioSteps(subs.map((s, i) => ({ alias: `R${i + 1}`, sub: s, check: false })), subs.map((s) => payment(s.ackNo!, 1_000_000)), ED, readySettings)];
  subs.forEach((s, i) => {
    steps.push({ op: "today", date: dates[i]! });
    steps.push({ op: "run", macro: "ApproveFor", args: [s.ackNo], user: "approver", answers: [], label: `Approve ${s.ackNo}` });
    steps.push({ op: "expectMessage", label: `approved ${i + 1}`, contains: [`Registered as ${expectedNos[i]!}`] });
    steps.push({ op: "expect", table: "tblRegister", alias: `R${i + 1}`, label: `registered ${i + 1}`, values: { Status: STATUS.REGISTERED, "Registration No.": expectedNos[i]!, "Certificate Issue Date": dates[i]! } });
  });
  steps.push({ op: "expectAudit", label: "audit detail", reference: subs[3]!.ackNo!, actions: ["Registered"] });
  macroFixture("macro-reg-serial", "Reg serial", "3 certificates in 2026, 1 in 2027: …/0001–0003 then 2027/…/0001", readySettings, ED, steps);

  // The finance gate is checked before every other reason, as in the app (requireFinanceGate in
  // src/server/workflow.ts), so the payment is confirmed here to reach the full list.
  const blocked = makeSubmission({ documents: allDocs(null) });
  macroFixture("macro-approval-blockers", "Approval blockers", "The Approve button refuses with every reason listed", readySettings, ED, [
    ...scenarioSteps([{ alias: "R1", sub: blocked, manual: { "2.1": "N", "2.2": null }, evaluation: makeEvaluation({ evaluatingOfficerId: null, reviewingSupervisorId: null }), check: false }], [payment(blocked.ackNo!, 250_000)], ED, readySettings),
    { op: "run", macro: "ApproveFor", args: [blocked.ackNo], user: "approver", answers: [], label: "Approve" },
    { op: "expectMessage", label: "every reason", contains: ["No evaluating officer assigned", "No reviewing supervisor assigned", "Submission is not complete (documents or fees outstanding)", "evaluation check(s) failed", "evaluation check(s) pending"] },
    { op: "expect", table: "tblRegister", alias: "R1", label: "unchanged", values: { Status: STATUS.RECEIVED, "Registration No.": "" } },
  ]);
  const ready = makeSubmission({ documents: allDocs("Y"), dateSubmissionComplete: ED });
  macroFixture("macro-separation", "Separation", "Approver = evaluator: the button refuses", readySettings, ED, [
    ...scenarioSteps([{ alias: "R1", sub: ready, evaluation: makeEvaluation({ evaluatingOfficerId: "u1", approvingOfficerId: "u1" }), check: false }], [payment(ready.ackNo!, 250_000)], ED, readySettings),
    { op: "run", macro: "ApproveFor", args: [ready.ackNo], user: "u1", answers: [], label: "Approve as u1" },
    { op: "expectMessage", label: "refused", contains: ["The approving officer cannot be the evaluating officer"] },
    { op: "expect", table: "tblRegister", alias: "R1", label: "unchanged", values: { Status: STATUS.RECEIVED } },
  ]);
}

{
  // Forms: 1.10 pending until the category is confirmed with the button.
  const sub = makeSubmission({ primaryActivity: activity("GEN"), installedCapacityMw: 5, confirmedCategory: null });
  macroFixture("macro-confirm-category", "Forms", "REG-01D: 1.10 pending, then Confirm category D → Y", readySettings, ED, [
    ...scenarioSteps([{ alias: "R1", sub, check: false }], [payment(sub.ackNo!, 300_000)], ED, readySettings),
    { op: "expect", table: "tblEvaluation", alias: "R1", label: "before", values: { "1.10": "" } },
    { op: "run", macro: "ConfirmCategoryFor", args: [sub.ackNo], user: "evaluator", answers: ["D"], label: "Confirm category D" },
    { op: "expect", table: "tblEvaluation", alias: "R1", label: "after", values: { "1.10": "Y" } },
    { op: "expect", table: "tblRegister", alias: "R1", label: "after", values: { "Confirmed Category": "D", "Documents Form": "REG-01D" } },
  ]);
}

{
  // Update: saved with nothing to pay (released at once), approved → Changes Applied on the registration.
  const registered = makeSubmission({ id: "reg-1", ackNo: "OGSERC/ACK/2026/00001", status: STATUS.REGISTERED, registrationNo: "OGSERC/REG/2026/E-MGD/0001", certificateIssueDate: ED, documents: allDocs("Y"), dateSubmissionComplete: ED });
  const update = makeSubmission({ ackNo: null, filingType: FILING.UPDATE, linkedSubmissionId: "reg-1", registeredName: "Example Mini-Grid Nigeria Ltd", address: "2 New Road, Abeokuta", documents: {} });
  const urow = intakeRow(update);
  urow["Linked Registration No."] = registered.registrationNo;
  const steps: Step[] = [
    ...scenarioSteps([{ alias: "REG", sub: registered, check: false }], [payment(registered.ackNo!, 250_000)], ED, readySettings),
    { op: "setting", name: "cfgNextAck", value: 2 },
    { op: "add", table: "tblRegister", alias: "U", values: urow },
    { op: "run", macro: "SaveSubmissionAt", args: ["U"], user: "registry", answers: [], label: "Save update" },
    { op: "expect", table: "tblRegister", alias: "U", label: "saved", values: { "Ack No.": "OGSERC/ACK/2026/00002", "Registration Fee": 0, "Late Charge": 0, Status: STATUS.RECEIVED, "Released for Evaluation": ED } },
    { op: "set", table: "tblEvaluation", alias: "U", values: { "Evaluating Officer": "evaluator", "Reviewing Supervisor": "supervisor", "Approving Officer": "approver", ...Object.fromEntries(ref.evaluationChecks.filter((c) => !AUTO_CHECKS[c.id]).map((c) => [c.id, "Y"])) } },
    { op: "addDocsAllY", table: "tblDocuments", alias: "U", values: {} },
    { op: "run", macro: "ConfirmCategoryFor", args: ["OGSERC/ACK/2026/00002"], user: "evaluator", answers: ["E"], label: "Confirm category E" },
    { op: "run", macro: "ApproveFor", args: ["OGSERC/ACK/2026/00002"], user: "approver", answers: [], label: "Approve update" },
    { op: "expect", table: "tblRegister", alias: "U", label: "applied", values: { Status: STATUS.APPLIED, "Registration No.": "" } },
    { op: "expect", table: "tblRegister", alias: "REG", label: "registration changed", values: { "Registered Name": "Example Mini-Grid Nigeria Ltd", "Registered Address": "2 New Road, Abeokuta", "Certificate Needs Reissue": "Y", "Registration No.": "OGSERC/REG/2026/E-MGD/0001" } },
    { op: "expectAudit", label: "old → new on the registration", reference: "OGSERC/ACK/2026/00001", actions: ["Changes applied"] },
  ];
  macroFixture("macro-update", "Update", "Update of a Registered record: fee ₦0, released at intake; approval → Changes Applied, changes copied, certificate needs reissue, no new number", readySettings, ED, steps);
}

{
  // Own-use: save rules and certificate.
  const ou = (kw: number[]): Record<string, Val> => ({ Name: "Factory Ltd", "Date Filed": ED, "CAC No.": "RC1", "Site Address": "Plot 1", LGA: "Ifo", ...Object.fromEntries(kw.map((k, i) => [`Unit ${i + 1} kW`, k])) });
  macroFixture("macro-own-use-150", "Own-use", "150 kW: warned and allowed on confirmation", readySettings, ED, [
    { op: "add", table: "tblOwnUse", alias: "O1", values: ou([150]) },
    { op: "run", macro: "SaveOwnUseAt", args: ["O1"], user: "registry", answers: [true], label: "Save 150 kW" },
    { op: "expectMessage", label: "warned", contains: ["Below 200 kW: does not need to notify (para 3(4))"] },
    { op: "expect", table: "tblOwnUse", alias: "O1", label: "saved", values: { "OUN No.": "OGSERC/OUN/2026/0001", "Fee Due": 0 } },
  ]);
  macroFixture("macro-own-use-1200", "Own-use", "1200 kW: rejected", readySettings, ED, [
    { op: "add", table: "tblOwnUse", alias: "O1", values: ou([600, 600]) },
    { op: "run", macro: "SaveOwnUseAt", args: ["O1"], user: "registry", answers: [], label: "Save 1200 kW" },
    { op: "expectMessage", label: "rejected", contains: ["Register as captive generation (para 3(3)(c))"] },
    { op: "expect", table: "tblOwnUse", alias: "O1", label: "not saved", values: { "OUN No.": "" } },
  ]);
  for (const on of [false, true]) {
    const s = withPolicy({ ownUseCertificate: on });
    macroFixture(`macro-own-use-cert-${on ? "on" : "off"}`, "Own-use certificate", `Setting ${on ? "on" : "off"}, paid, complete: ${on ? "registered OGSERC/REG/2026/I-CPT/0001" : "blocked"}`, s, ED, [
      { op: "add", table: "tblOwnUse", alias: "O1", values: ou([400, 250]) },
      { op: "run", macro: "SaveOwnUseAt", args: ["O1"], user: "registry", answers: [], label: "Save 650 kW" },
      { op: "add", table: "tblPayments", alias: "P1", values: { "Date Received": ED, Reference: "OGSERC/OUN/2026/0001", Amount: 100_000, "RRR / Bank Reference": "RRR-OU" } },
      { op: "run", macro: "RecordPaymentAt", args: ["P1"], user: "registry", answers: [], label: "Record fee" },
      { op: "run", macro: "ConfirmPaymentAt", args: ["P1"], user: "finance", answers: [true, ""], label: "Confirm fee" },
      { op: "addDocsAllY", table: "tblDocuments", alias: "O1", values: {} },
      { op: "run", macro: "RegisterOwnUseFor", args: ["OGSERC/OUN/2026/0001"], user: "approver", answers: [], label: "Register" },
      { op: "expect", table: "tblOwnUse", alias: "O1", label: "result", values: { "Registration No.": on ? "OGSERC/REG/2026/I-CPT/0001" : "" } },
      ...(on ? [] : [{ op: "expectMessage", label: "blocked", contains: ["Own-use certificates are switched off in Settings"] } as Step]),
    ]);
  }
}

// ---------------------------------------------------------------------------------------------

const out = process.argv[2];
if (!out) throw new Error("Usage: fixtures.ts <out.json>");
writeFileSync(out, JSON.stringify({ fixtures, notApplicable: NOT_APPLICABLE, seedSettings: settingsCells(seedSettings, "") }, null, 1), "utf8");
console.log(`${fixtures.length} fixtures (${fixtures.filter((f) => f.macros).length} need macros) written to ${out}`);
