// Phase 7: import existing rows from the Excel workbook (reference/*.xlsm). Pure: the server reads the
// file into plain rows (see src/server/workbook-import.ts) and writes the plan in one transaction.
//
// Decisions (docs/DECISIONS.md): workbook numbers are kept; pricing is taken with the app's rules and
// every difference from the workbook's figures is reported; nothing is imported while any error remains.

import { categoryAuto, overrideNeedsReason } from "./category";
import { isIsoDate } from "./dates";
import { AUTOMATIC_CHECK_IDS } from "./evaluation";
import { formatNaira } from "./money";
import { priceOwnUse, type OwnUsePricing } from "./own-use";
import { priceSubmission, type PricingSnapshot } from "./pricing";
import type { Role } from "./roles";
import { assessSubmission, type DomainContext } from "./submission";
import {
  FINAL_DECISION,
  STATUS,
  STATUSES,
  type CheckValue,
  type FinalDecision,
  type IsoDate,
  type Kobo,
  type PaymentInput,
  type Status,
  type SubmissionInput,
} from "./types";
import { isValidCac, isValidEmail, isValidPhone, isValidTin } from "./validation";

// --- Input --------------------------------------------------------------------

/** A cell as read from the workbook: dates already as YYYY-MM-DD, formulas as their cached result. */
export interface WbCell {
  value: string | number | boolean | null;
  /** The cell holds a formula (the workbook calculated it rather than staff typing it). */
  formula: boolean;
}

/** One data row: cells keyed by the sheet's header text (row 4 in every sheet). */
export interface WbRow {
  row: number;
  cells: Readonly<Record<string, WbCell>>;
}

export interface WorkbookData {
  register: readonly WbRow[];
  documents: readonly WbRow[];
  evaluation: readonly WbRow[];
  payments: readonly WbRow[];
  ownUse: readonly WbRow[];
  audit: readonly WbRow[];
}

export const SHEETS = {
  register: "Register",
  documents: "Document Checklist",
  evaluation: "Evaluation",
  payments: "Payments",
  ownUse: "Own-Use Notifications",
  audit: "Audit Log",
} as const satisfies Record<keyof WorkbookData, string>;

export interface ImportUser {
  id: string;
  name: string;
  roles: readonly Role[];
  active: boolean;
}

export interface ImportContext {
  ctx: DomainContext;
  lists: {
    lgas: readonly string[];
    licenceStatuses: readonly string[];
    submissionChannels: readonly string[];
    registrantTypes: readonly string[];
  };
  users: readonly ImportUser[];
  /** What the app already holds, so a second import skips rows already brought in. */
  existing: {
    submissions: ReadonlyMap<string, { name: string; ackSeq: number }>;
    ackSeqs: ReadonlySet<number>;
    ownUse: ReadonlyMap<string, { name: string; ounSeq: number }>;
    ounSeqs: ReadonlySet<number>;
    payments: ReadonlyMap<string, { reference: string; amount: Kobo }>;
    paymentSeqs: ReadonlySet<number>;
    registrationNos: ReadonlySet<string>;
  };
}

// --- Output -------------------------------------------------------------------

export type ProblemLevel = "error" | "warning" | "skipped";

export interface ImportProblem {
  level: ProblemLevel;
  sheet: string;
  row: number | null;
  reference: string | null;
  message: string;
}

export interface PlannedSubmission {
  row: number;
  ackNo: string;
  ackSeq: number;
  data: {
    registeredName: string;
    dateSubmitted: IsoDate;
    submissionChannel: string | null;
    registrantType: string | null;
    cacNo: string | null;
    tin: string | null;
    address: string | null;
    principalLga: string;
    otherAreasServed: string | null;
    primaryActivityCode: string;
    secondaryActivityCode: string | null;
    installedCapacityMw: number | null;
    customers: number | null;
    licenceStatus: string;
    licenceNo: string | null;
    licenceExpiry: IsoDate | null;
    complianceOfficer: string | null;
    phone: string | null;
    email: string | null;
    operatingOnEffectiveDate: boolean;
    plannedStartDate: IsoDate | null;
    approvedWaiver: Kobo;
    categoryOverride: string | null;
    overrideReason: string | null;
    status: Status;
    dateSubmissionComplete: IsoDate | null;
    deficiencyNoticeDate: IsoDate | null;
    certificateIssueDate: IsoDate | null;
    registrationNo: string | null;
    remarks: string | null;
  };
  pricing: PricingSnapshot;
  /** Schedule 2 items in order; null = blank (pending). */
  documents: (CheckValue | null)[];
  evaluation: {
    evaluatingOfficerId: string | null;
    reviewingSupervisorId: string | null;
    approvingOfficerId: string | null;
    dateEvaluationStarted: IsoDate | null;
    evaluationRemarks: string | null;
    finalDecision: FinalDecision | null;
    reasons: string | null;
    reviewDate: IsoDate | null;
    approvalDate: IsoDate | null;
    /** Values staff entered for checks that are not automatic. */
    checks: Record<string, CheckValue>;
  };
}

export interface PlannedOwnUse {
  row: number;
  ounNo: string;
  ounSeq: number;
  data: {
    name: string;
    dateFiled: IsoDate;
    cacNo: string | null;
    siteAddress: string | null;
    lga: string;
    natureOfBusiness: string | null;
    gridConnected: boolean | null;
    distributionLicensee: string | null;
    units: number | null;
    installedCapacityKw: number;
    fuel: string | null;
    avgMonthlyOutputMwh: number | null;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
  };
  pricing: OwnUsePricing;
}

export interface PlannedPayment {
  row: number;
  paymentNo: string;
  paymentSeq: number;
  dateReceived: IsoDate;
  reference: string;
  purpose: string | null;
  channel: string | null;
  amount: Kobo;
  rrr: string | null;
  verifiedWithBank: boolean;
}

export interface PlannedAuditEntry {
  row: number;
  action: string;
  reference: string | null;
  detail: string;
}

export interface PricingDifference {
  ackNo: string;
  name: string;
  item: string;
  workbook: Kobo;
  app: Kobo;
}

export interface ImportPlan {
  submissions: PlannedSubmission[];
  ownUse: PlannedOwnUse[];
  payments: PlannedPayment[];
  audit: PlannedAuditEntry[];
  problems: ImportProblem[];
  pricingDifferences: PricingDifference[];
  /** Highest serial imported per counter; the app's counters are raised to at least these. */
  counters: { ack: number; oun: number; payment: number; registration: Record<number, number> };
}

// --- Cell readers -----------------------------------------------------------------

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function cellText(c: WbCell | undefined): string | null {
  if (!c || c.value === null) return null;
  const s = String(c.value).trim();
  return s === "" ? null : s;
}

/** A date cell: YYYY-MM-DD text, or an Excel serial number. Returns undefined when not a date. */
function cellDate(c: WbCell | undefined): IsoDate | null | undefined {
  if (!c || c.value === null || c.value === "") return null;
  if (typeof c.value === "number") {
    const d = new Date(EXCEL_EPOCH + Math.round(c.value) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(c.value).trim().slice(0, 10);
  return isIsoDate(s) ? s : undefined;
}

function cellNumber(c: WbCell | undefined): number | null | undefined {
  if (!c || c.value === null || c.value === "") return null;
  if (typeof c.value === "number") return c.value;
  const s = String(c.value).replace(/[₦,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const nairaToKobo = (n: number): Kobo => Math.round(n * 100);

/** Check / document value typed by staff: Y, N, N/A, or blank. Undefined when something else. */
function cellCheck(c: WbCell | undefined): CheckValue | null | undefined {
  const s = cellText(c)?.toUpperCase();
  if (!s) return null;
  if (s === "Y" || s === "N") return s;
  if (s === "N/A" || s === "NA") return "N/A";
  return undefined;
}

/** Serial at the end of a generated number, e.g. OGSERC/ACK/2026/00012 → 12. */
function serialOf(no: string): number | null {
  const m = /\/(\d+)$/.exec(no);
  return m ? Number(m[1]) : null;
}

const REG_NO_RE = /^(.+)\/(\d{4})\/([A-Z])-([A-Z]{3})\/(\d{4})$/;
const EXAMPLE_RE = /^EXAMPLE\b/i;
const OVERRIDE_REASON = "Carried over from the workbook (no reason was recorded there)";
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// --- Planner ------------------------------------------------------------------

export function planWorkbookImport(wb: WorkbookData, ic: ImportContext): ImportPlan {
  const { ctx, lists, users, existing } = ic;
  const { ref, settings, today } = ctx;
  const problems: ImportProblem[] = [];
  const add =
    (level: ProblemLevel, sheet: string) =>
    (row: number | null, reference: string | null, message: string) =>
      problems.push({ level, sheet, row, reference, message });

  const plan: ImportPlan = {
    submissions: [],
    ownUse: [],
    payments: [],
    audit: [],
    problems,
    pricingDifferences: [],
    counters: { ack: 0, oun: 0, payment: 0, registration: {} },
  };

  const activityByName = new Map(ref.activities.map((a) => [norm(a.name), a]));
  const lgas = new Map(lists.lgas.map((l) => [norm(l), l]));
  const licences = new Map(lists.licenceStatuses.map((l) => [norm(l), l]));
  const channels = new Map(lists.submissionChannels.map((l) => [norm(l), l]));
  const types = new Map(lists.registrantTypes.map((l) => [norm(l), l]));
  const statuses = new Map(STATUSES.map((s) => [norm(s), s]));
  const decisions = new Map(Object.values(FINAL_DECISION).map((d) => [norm(d), d]));
  const usersByName = new Map<string, ImportUser[]>();
  for (const u of users)
    usersByName.set(norm(u.name), [...(usersByName.get(norm(u.name)) ?? []), u]);

  // References a payment may point at: rows imported now, or already in the app.
  const references = new Set<string>([...existing.submissions.keys(), ...existing.ownUse.keys()]);
  const exampleRefs = new Set<string>();
  /** Rows that have errors themselves: their payments are not reported again. */
  const failedRefs = new Map<string, string>();
  const seenAck = new Set<string>();
  const seenReg = new Set<string>();

  // --- Register (+ its Document Checklist and Evaluation rows, aligned by row number) ---
  const docsByRow = new Map(wb.documents.map((r) => [r.row, r]));
  const evalByRow = new Map(wb.evaluation.map((r) => [r.row, r]));
  const docHeaders = (r: WbRow | undefined) =>
    Object.keys(r?.cells ?? {}).filter((h) => /^\d+\.\s/.test(h));

  for (const r of wb.register) {
    const S = SHEETS.register;
    const error = add("error", S);
    const warn = add("warning", S);
    const c = (h: string) => r.cells[h];
    const name = cellText(c("Registered Name *"));
    if (!name) continue;
    const ackNo = cellText(c("Acknowledgement No."));
    if (EXAMPLE_RE.test(name)) {
      if (ackNo) exampleRefs.add(ackNo);
      add("skipped", S)(r.row, ackNo, `Example row "${name}" is not imported (SPEC §8.8)`);
      continue;
    }
    if (!ackNo) {
      error(r.row, null, `${name}: no Acknowledgement No. (enter the Date Submitted)`);
      continue;
    }
    const ackSeq = serialOf(ackNo);
    if (ackSeq === null) {
      error(r.row, ackNo, "Acknowledgement No. is not in the OGSERC/ACK/yyyy/00000 format");
      continue;
    }
    if (seenAck.has(ackNo)) {
      error(r.row, ackNo, "Acknowledgement No. appears twice in the workbook");
      continue;
    }
    seenAck.add(ackNo);
    const already = existing.submissions.get(ackNo);
    if (already) {
      if (norm(already.name) === norm(name)) {
        add("skipped", S)(r.row, ackNo, `${name} is already in the app; not changed`);
        references.add(ackNo);
      } else {
        error(r.row, ackNo, `This number is already used in the app by "${already.name}"`);
      }
      continue;
    }
    if (existing.ackSeqs.has(ackSeq)) {
      error(r.row, ackNo, `Serial ${ackSeq} is already used by another acknowledgement in the app`);
      continue;
    }
    if (!ackNo.startsWith(`${settings.ackPrefix}/`)) {
      warn(r.row, ackNo, `Prefix differs from Settings (${settings.ackPrefix}); kept as it is`);
    }

    const errorsBefore = problems.filter((p) => p.level === "error").length;
    const date = (h: string, label: string) => {
      const d = cellDate(c(h));
      if (d === undefined) error(r.row, ackNo, `${label} is not a valid date`);
      return d ?? null;
    };
    const fromList = (h: string, label: string, list: Map<string, string>, required: boolean) => {
      const v = cellText(c(h));
      if (!v) {
        if (required) error(r.row, ackNo, `${label} is required`);
        return null;
      }
      const match = list.get(norm(v));
      if (!match) error(r.row, ackNo, `${label} "${v}" is not in the app's list`);
      return match ?? null;
    };
    const activity = (h: string, label: string, required: boolean) => {
      const v = cellText(c(h));
      if (!v) {
        if (required) error(r.row, ackNo, `${label} is required`);
        return null;
      }
      const a = activityByName.get(norm(v));
      if (!a) error(r.row, ackNo, `${label} "${v}" is not in the activity list`);
      return a ?? null;
    };
    const number = (h: string, label: string) => {
      const n = cellNumber(c(h));
      if (n === undefined || (n !== null && n < 0)) {
        error(r.row, ackNo, `${label} must be a number`);
        return null;
      }
      return n;
    };

    const dateSubmitted = date("Date Submitted *", "Date Submitted");
    if (!dateSubmitted) error(r.row, ackNo, "Date Submitted is required");
    else if (dateSubmitted > today) error(r.row, ackNo, "Date Submitted is in the future");
    const principalLga = fromList("Principal LGA *", "Principal LGA", lgas, true);
    const primary = activity("Primary Activity *", "Primary Activity", true);
    const secondary = activity("Secondary Activity", "Secondary Activity", false);
    const licenceStatus = fromList("Licence Status *", "Licence Status", licences, true);
    const submissionChannel = fromList("Submission Channel", "Submission Channel", channels, false);
    const registrantType = fromList("Registrant Type", "Registrant Type", types, false);
    const installedCapacityMw = number("Installed Capacity (MW)", "Installed Capacity");
    const customers = number("Customers (No.)", "Customers");
    if (customers !== null && !Number.isInteger(customers))
      error(r.row, ackNo, "Customers must be a whole number");
    const operating = cellText(c("Operating on Effective Date? (Y/N) *"))?.toUpperCase();
    if (operating !== "Y" && operating !== "N")
      error(r.row, ackNo, "Operating on Effective Date? must be Y or N");
    const plannedStartDate = date("Planned Start / Energization Date", "Planned Start Date");
    if (operating === "N" && !plannedStartDate)
      error(
        r.row,
        ackNo,
        "Planned Start Date is required when not operating on the Effective Date",
      );

    const statusText = cellText(c("Status *"));
    const status = statusText ? statuses.get(norm(statusText)) : undefined;
    if (!status) error(r.row, ackNo, `Status "${statusText ?? ""}" is not a status the app knows`);
    const dateSubmissionComplete = date("Date Submission Complete", "Date Submission Complete");
    const deficiencyNoticeDate = date("Deficiency Notice Date", "Deficiency Notice Date");
    const certificateIssueDate = date("Certificate Issue Date", "Certificate Issue Date");
    for (const [d, label] of [
      [dateSubmissionComplete, "Date Submission Complete"],
      [deficiencyNoticeDate, "Deficiency Notice Date"],
      [certificateIssueDate, "Certificate Issue Date"],
    ] as const) {
      if (d && d > today) error(r.row, ackNo, `${label} is in the future`);
    }

    // Registration number: the issued (locked) one, else the one the workbook generated.
    let registrationNo =
      cellText(c("Issued Registration No. (paste value to lock)")) ??
      (status === STATUS.REGISTERED ? cellText(c("Generated OGSERC Registration No.")) : null);
    if (status === STATUS.REGISTERED) {
      if (!certificateIssueDate) error(r.row, ackNo, "Registered but no Certificate Issue Date");
      if (!registrationNo) error(r.row, ackNo, "Registered but no registration number");
    } else if (registrationNo && status !== STATUS.CANCELLED) {
      warn(
        r.row,
        ackNo,
        `Registration number ${registrationNo} ignored: status is ${status ?? "?"}`,
      );
      registrationNo = null;
    }
    if (status === STATUS.DEFICIENCY && !deficiencyNoticeDate)
      error(r.row, ackNo, "Deficiency Notice Issued but no Deficiency Notice Date");
    if (registrationNo) {
      const m = REG_NO_RE.exec(registrationNo);
      if (!m)
        error(r.row, ackNo, `Registration number ${registrationNo} is not in the app's format`);
      else {
        if (certificateIssueDate && Number(m[2]) !== Number(certificateIssueDate.slice(0, 4)))
          warn(r.row, ackNo, "Registration number year differs from the Certificate Issue Date");
        const year = Number(m[2]);
        plan.counters.registration[year] = Math.max(
          plan.counters.registration[year] ?? 0,
          Number(m[5]),
        );
      }
      if (seenReg.has(registrationNo) || existing.registrationNos.has(registrationNo))
        error(r.row, ackNo, `Registration number ${registrationNo} is already in use`);
      seenReg.add(registrationNo);
    }

    // Waiver and category override.
    const waiverNaira = number("Approved Waiver / Reduction (₦)", "Approved Waiver");
    const approvedWaiver = waiverNaira ? nairaToKobo(waiverNaira) : 0;
    const overrideText = cellText(c("Category Override"));
    const categoryOverride = overrideText ? overrideText.toUpperCase() : null;
    if (
      categoryOverride &&
      (categoryOverride === "I" || !ref.fees.some((f) => f.category === categoryOverride))
    )
      error(r.row, ackNo, `Category Override "${overrideText}" is not a Schedule 3 category`);

    // Text fields, imported as they are; format problems are warnings (records show them for correction).
    const cacNo = cellText(c("CAC / Registration No."));
    const tin = cellText(c("TIN"));
    const phone = cellText(c("Phone"));
    const email = cellText(c("Email"));
    if (cacNo && !isValidCac(cacNo))
      warn(r.row, ackNo, `CAC number "${cacNo}" is not RC/BN/IT + digits`);
    if (tin && !isValidTin(tin, settings.policy.tinPattern))
      warn(r.row, ackNo, `TIN "${tin}" format is not valid`);
    if (phone && !isValidPhone(phone))
      warn(r.row, ackNo, `Phone "${phone}" is not a Nigerian number`);
    if (email && !isValidEmail(email)) warn(r.row, ackNo, `Email "${email}" is not valid`);

    // Document Checklist row (same row number).
    const docRow = docsByRow.get(r.row);
    const documents: (CheckValue | null)[] = ref.schedule2Documents.map(() => null);
    if (!docRow || cellText(docRow.cells["Acknowledgement No."]) !== ackNo) {
      warn(r.row, ackNo, "No matching Document Checklist row; documents imported as pending");
    } else {
      for (const h of docHeaders(docRow)) {
        const i = Number(h.split(".")[0]) - 1;
        if (i < 0 || i >= documents.length) continue;
        const v = cellCheck(docRow.cells[h]);
        if (v === undefined) {
          add("warning", SHEETS.documents)(
            docRow.row,
            ackNo,
            `Document ${i + 1}: "${cellText(docRow.cells[h])}" is not Y, N or N/A; left pending`,
          );
        } else documents[i] = v;
      }
    }

    // Evaluation row (same row number).
    const evRow = evalByRow.get(r.row);
    const evaluation: PlannedSubmission["evaluation"] = {
      evaluatingOfficerId: null,
      reviewingSupervisorId: null,
      approvingOfficerId: null,
      dateEvaluationStarted: null,
      evaluationRemarks: null,
      finalDecision: null,
      reasons: null,
      reviewDate: null,
      approvalDate: null,
      checks: {},
    };
    if (!evRow || cellText(evRow.cells["Acknowledgement No."]) !== ackNo) {
      warn(r.row, ackNo, "No matching Evaluation row; evaluation imported empty");
    } else {
      const E = SHEETS.evaluation;
      const ev = (h: string) => evRow.cells[h];
      const officer = (h: string, label: string, role: Role) => {
        const who = cellText(ev(h));
        if (!who) return null;
        const matches = (usersByName.get(norm(who)) ?? []).filter((u) => u.roles.includes(role));
        if (matches.length !== 1) {
          add("warning", E)(
            evRow.row,
            ackNo,
            matches.length
              ? `${label} "${who}" matches more than one user; left unassigned`
              : `${label} "${who}" is not a user with that role; left unassigned`,
          );
          return null;
        }
        return matches[0]!.id;
      };
      evaluation.evaluatingOfficerId = officer(
        "Evaluating Officer",
        "Evaluating officer",
        "EVALUATING_OFFICER",
      );
      evaluation.reviewingSupervisorId = officer(
        "Reviewing Supervisor",
        "Reviewing supervisor",
        "REVIEWING_SUPERVISOR",
      );
      evaluation.approvingOfficerId = officer(
        "Approving Officer",
        "Approving officer",
        "APPROVING_OFFICER",
      );
      const evDate = (h: string, label: string) => {
        const d = cellDate(ev(h));
        if (d === undefined) add("error", E)(evRow.row, ackNo, `${label} is not a valid date`);
        return d ?? null;
      };
      evaluation.dateEvaluationStarted = evDate(
        "Date Evaluation Started",
        "Date Evaluation Started",
      );
      evaluation.reviewDate = evDate("Review Date", "Review Date");
      evaluation.approvalDate = evDate("Approval Date", "Approval Date");
      evaluation.evaluationRemarks = cellText(ev("Evaluation Remarks"));
      evaluation.reasons = cellText(ev("Reasons / Comments"));
      const decision = cellText(ev("Final Decision"));
      if (decision) {
        const d = decisions.get(norm(decision));
        if (!d)
          add("error", E)(
            evRow.row,
            ackNo,
            `Final Decision "${decision}" is not one the app knows`,
          );
        evaluation.finalDecision = d ?? null;
      }
      if (status === STATUS.REGISTERED && evaluation.finalDecision !== FINAL_DECISION.REGISTER)
        add("warning", E)(
          evRow.row,
          ackNo,
          "Registered, but the Final Decision is not Register (13(1)(a))",
        );

      for (const check of ref.evaluationChecks) {
        if (AUTOMATIC_CHECK_IDS.includes(check.id)) continue;
        const header = Object.keys(evRow.cells).find((h) => h.startsWith(`${check.id} `));
        const cell = header ? evRow.cells[header] : undefined;
        if (!cell || cell.formula) continue; // calculated in the workbook; the app works it out
        const v = cellCheck(cell);
        if (v === undefined)
          add("warning", E)(
            evRow.row,
            ackNo,
            `Check ${check.id}: "${cellText(cell)}" is not Y, N or N/A; left pending`,
          );
        else if (v) evaluation.checks[check.id] = v;
      }
    }

    if (problems.filter((p) => p.level === "error").length > errorsBefore) {
      failedRefs.set(ackNo, `Register row ${r.row}`);
      continue;
    }

    // Pricing with the app's rules (the snapshot), compared with the workbook's own figures.
    const pricingInput = {
      primaryActivity: primary!.name,
      secondaryActivity: secondary?.name ?? null,
      installedCapacityMw,
      categoryOverride,
      operatingOnEffectiveDate: operating as "Y" | "N",
      plannedStartDate,
    };
    const pricing = priceSubmission(pricingInput, ref, settings);
    if (!pricing) {
      error(r.row, ackNo, "The Schedule 3 category cannot be worked out from the activity");
      failedRefs.set(ackNo, `Register row ${r.row}`);
      continue;
    }
    if (approvedWaiver > pricing.registrationFee) {
      error(
        r.row,
        ackNo,
        `Waiver ${formatNaira(approvedWaiver)} is more than the fee ${formatNaira(pricing.registrationFee)}`,
      );
      failedRefs.set(ackNo, `Register row ${r.row}`);
      continue;
    }
    const auto = categoryAuto(pricingInput, ref);
    const overrideReason =
      categoryOverride && overrideNeedsReason(categoryOverride, auto, null)
        ? OVERRIDE_REASON
        : null;
    if (overrideReason)
      warn(
        r.row,
        ackNo,
        `Category override ${categoryOverride} (auto ${auto ?? "none"}) has no reason in the workbook`,
      );

    const planned: PlannedSubmission = {
      row: r.row,
      ackNo,
      ackSeq,
      data: {
        registeredName: name,
        dateSubmitted: dateSubmitted!,
        submissionChannel,
        registrantType,
        cacNo,
        tin,
        address: cellText(c("Registered / Operational Address")),
        principalLga: principalLga!,
        otherAreasServed: cellText(c("Other LGAs / Feeders / Estates Served")),
        primaryActivityCode: primary!.code,
        secondaryActivityCode: secondary?.code ?? null,
        installedCapacityMw,
        customers,
        licenceStatus: licenceStatus!,
        licenceNo: cellText(c("Licence / Permit No.")),
        licenceExpiry: date("Licence Expiry Date", "Licence Expiry Date"),
        complianceOfficer: cellText(c("Compliance Officer")),
        phone,
        email,
        operatingOnEffectiveDate: operating === "Y",
        plannedStartDate,
        approvedWaiver,
        categoryOverride,
        overrideReason,
        status: status!,
        dateSubmissionComplete,
        deficiencyNoticeDate,
        certificateIssueDate,
        registrationNo,
        remarks: cellText(c("Remarks")),
      },
      pricing,
      documents,
      evaluation,
    };
    plan.submissions.push(planned);
    references.add(ackNo);
    plan.counters.ack = Math.max(plan.counters.ack, ackSeq);
  }

  // --- Own-use notifications ---
  const seenOun = new Set<string>();
  for (const r of wb.ownUse) {
    const S = SHEETS.ownUse;
    const error = add("error", S);
    const warn = add("warning", S);
    const c = (h: string) => r.cells[h];
    const name = cellText(c("Name *"));
    if (!name) continue;
    const ounNo = cellText(c("Notification No."));
    if (EXAMPLE_RE.test(name)) {
      if (ounNo) exampleRefs.add(ounNo);
      add("skipped", S)(r.row, ounNo, `Example row "${name}" is not imported (SPEC §8.8)`);
      continue;
    }
    if (!ounNo) {
      error(r.row, null, `${name}: no Notification No. (enter the Date Filed)`);
      continue;
    }
    const ounSeq = serialOf(ounNo);
    if (ounSeq === null) {
      error(r.row, ounNo, "Notification No. is not in the OGSERC/OUN/yyyy/0000 format");
      continue;
    }
    if (seenOun.has(ounNo)) {
      error(r.row, ounNo, "Notification No. appears twice in the workbook");
      continue;
    }
    seenOun.add(ounNo);
    const already = existing.ownUse.get(ounNo);
    if (already) {
      if (norm(already.name) === norm(name)) {
        add("skipped", S)(r.row, ounNo, `${name} is already in the app; not changed`);
        references.add(ounNo);
      } else error(r.row, ounNo, `This number is already used in the app by "${already.name}"`);
      continue;
    }
    if (existing.ounSeqs.has(ounSeq)) {
      error(r.row, ounNo, `Serial ${ounSeq} is already used by another notification in the app`);
      continue;
    }
    const errorsBefore = problems.filter((p) => p.level === "error").length;
    const dateFiled = cellDate(c("Date Filed *"));
    if (!dateFiled) error(r.row, ounNo, "Date Filed is required and must be a date");
    else if (dateFiled > today) error(r.row, ounNo, "Date Filed is in the future");
    const lgaText = cellText(c("LGA *"));
    const lga = lgaText ? lgas.get(norm(lgaText)) : undefined;
    if (!lga) error(r.row, ounNo, `LGA "${lgaText ?? ""}" is not in the app's list`);
    const kw = cellNumber(c("Installed Capacity (kW) *"));
    if (kw === null || kw === undefined || kw <= 0)
      error(r.row, ounNo, "Installed Capacity (kW) is required and must be a number");
    else if (kw >= 1000)
      error(
        r.row,
        ounNo,
        "1,000 kW or more: register as captive generation (para 3(3)(c)), not own-use",
      );
    else if (kw < settings.ownUseThresholdKw)
      warn(
        r.row,
        ounNo,
        `Below ${settings.ownUseThresholdKw} kW: does not need to notify (para 3(4)); imported anyway`,
      );
    const units = cellNumber(c("No. of Units"));
    const output = cellNumber(c("Avg Monthly Output (MWh)"));
    if (units === undefined || output === undefined)
      error(r.row, ounNo, "No. of Units and Avg Monthly Output must be numbers");
    const grid = cellText(c("Grid-Connected? (Y/N)"))?.toUpperCase();
    const cacNo = cellText(c("CAC / Registration No."));
    const phone = cellText(c("Phone"));
    const email = cellText(c("Email"));
    if (cacNo && !isValidCac(cacNo))
      warn(r.row, ounNo, `CAC number "${cacNo}" is not RC/BN/IT + digits`);
    if (phone && !isValidPhone(phone))
      warn(r.row, ounNo, `Phone "${phone}" is not a Nigerian number`);
    if (email && !isValidEmail(email)) warn(r.row, ounNo, `Email "${email}" is not valid`);
    if (problems.filter((p) => p.level === "error").length > errorsBefore) {
      failedRefs.set(ounNo, `Own-use row ${r.row}`);
      continue;
    }

    plan.ownUse.push({
      row: r.row,
      ounNo,
      ounSeq,
      data: {
        name,
        dateFiled: dateFiled!,
        cacNo,
        siteAddress: cellText(c("Site Address")),
        lga: lga!,
        natureOfBusiness: cellText(c("Nature of Premises / Business")),
        gridConnected: grid === "Y" ? true : grid === "N" ? false : null,
        distributionLicensee: cellText(c("Distribution Licensee")),
        units: units ?? null,
        installedCapacityKw: kw!,
        fuel: cellText(c("Fuel / Technology")),
        avgMonthlyOutputMwh: output ?? null,
        contactPerson: cellText(c("Contact Person")),
        phone,
        email,
      },
      pricing: priceOwnUse(kw!, ref, settings),
    });
    references.add(ounNo);
    plan.counters.oun = Math.max(plan.counters.oun, ounSeq);
  }

  // --- Payments ---
  const seenPay = new Set<string>();
  for (const r of wb.payments) {
    const S = SHEETS.payments;
    const error = add("error", S);
    const c = (h: string) => r.cells[h];
    const reference = cellText(c("Ack. No. or Own-Use Notification No. *"));
    const amountNaira = cellNumber(c("Amount (₦) *"));
    const dateReceived = cellDate(c("Date Received *"));
    if (!reference && amountNaira === null && !dateReceived) continue;
    const paymentNo = cellText(c("Payment Record No."));
    if (reference && exampleRefs.has(reference)) {
      add("skipped", S)(
        r.row,
        paymentNo,
        `Payment against example row ${reference} is not imported`,
      );
      continue;
    }
    if (!paymentNo || !reference || !dateReceived || amountNaira === null) {
      error(r.row, paymentNo, "Date Received, reference and amount are all required");
      continue;
    }
    if (amountNaira === undefined || amountNaira <= 0) {
      error(r.row, paymentNo, "Amount must be a positive number");
      continue;
    }
    const paymentSeq = serialOf(paymentNo);
    if (paymentSeq === null) {
      error(r.row, paymentNo, "Payment Record No. is not in the OGSERC/PAY/yyyy/00000 format");
      continue;
    }
    if (seenPay.has(paymentNo)) {
      error(r.row, paymentNo, "Payment Record No. appears twice in the workbook");
      continue;
    }
    seenPay.add(paymentNo);
    const amount = nairaToKobo(amountNaira);
    const already = existing.payments.get(paymentNo);
    if (already) {
      if (already.reference === reference && already.amount === amount)
        add("skipped", S)(r.row, paymentNo, "Already in the app; not changed");
      else error(r.row, paymentNo, "This number is already used in the app by a different payment");
      continue;
    }
    if (existing.paymentSeqs.has(paymentSeq)) {
      error(r.row, paymentNo, `Serial ${paymentSeq} is already used by another payment in the app`);
      continue;
    }
    if (dateReceived > today) {
      error(r.row, paymentNo, "Date Received is in the future");
      continue;
    }
    const failed = failedRefs.get(reference);
    if (failed) {
      add("skipped", S)(r.row, paymentNo, `Not imported: ${reference} has errors (${failed})`);
      continue;
    }
    if (!references.has(reference)) {
      error(r.row, paymentNo, `Reference ${reference} is not an imported Ack No. or OUN No.`);
      continue;
    }
    const verified = cellText(c("Verified with bank? (Y/N)"))?.toUpperCase() === "Y";
    plan.payments.push({
      row: r.row,
      paymentNo,
      paymentSeq,
      dateReceived,
      reference,
      purpose: cellText(c("Purpose")),
      channel: cellText(c("Channel")),
      amount,
      rrr: cellText(c("Reference / RRR")),
      verifiedWithBank: verified,
    });
    plan.counters.payment = Math.max(plan.counters.payment, paymentSeq);
  }

  // Pricing differences: the app's figures (with the imported payments) against the workbook's.
  const paymentsByRef = new Map<string, PaymentInput[]>();
  for (const p of plan.payments) {
    const list = paymentsByRef.get(p.reference) ?? [];
    list.push({ reference: p.reference, amount: p.amount, dateReceived: p.dateReceived });
    paymentsByRef.set(p.reference, list);
  }
  const regRows = new Map(wb.register.map((r) => [r.row, r]));
  for (const s of plan.submissions) {
    const sub = toSubmissionInput(s, ref.activities);
    const a = assessSubmission(sub, paymentsByRef.get(s.ackNo) ?? [], ctx);
    const cells = regRows.get(s.row)!.cells;
    const compare = (item: string, header: string, app: Kobo) => {
      const n = cellNumber(cells[header]);
      if (n === undefined) return;
      const wbKobo = nairaToKobo(n ?? 0);
      if (wbKobo !== app)
        plan.pricingDifferences.push({
          ackNo: s.ackNo,
          name: s.data.registeredName,
          item,
          workbook: wbKobo,
          app,
        });
    };
    const wbCategory = cellText(cells["Category Applied"]);
    if (wbCategory && wbCategory !== s.pricing.category)
      problems.push({
        level: "warning",
        sheet: SHEETS.register,
        row: s.row,
        reference: s.ackNo,
        message: `Category: workbook ${wbCategory}, app ${s.pricing.category}`,
      });
    compare("Registration fee", "Registration Fee (₦)", a.fees.fee);
    compare("Late charge", "Late Registration Charge (₦)", a.fees.lateCharge);
    compare("Total due", "Total Due (₦)", a.fees.totalDue);
  }

  // --- Audit log (kept as history, marked as from the workbook) ---
  for (const r of wb.audit) {
    const c = (h: string) => r.cells[h];
    const action = cellText(c("Action"));
    if (!action) continue;
    const when = cellText(c("Date and time")) ?? "";
    const who = cellText(c("User")) ?? "unknown user";
    const reference = cellText(c("Acknowledgement No."));
    if (reference && exampleRefs.has(reference)) continue;
    plan.audit.push({
      row: r.row,
      action: `Workbook: ${action}`.slice(0, 200),
      reference,
      detail: [`${when} by ${who} (Excel)`, cellText(c("Detail"))].filter(Boolean).join(" - "),
    });
  }

  return plan;
}

/** The planned row as the domain sees a submission (for the pricing comparison). */
function toSubmissionInput(
  s: PlannedSubmission,
  activities: readonly { code: string; name: string }[],
): SubmissionInput {
  const nameOf = (code: string | null) =>
    code ? (activities.find((a) => a.code === code)?.name ?? null) : null;
  const d = s.data;
  return {
    id: s.ackNo,
    ackNo: s.ackNo,
    registeredName: d.registeredName,
    dateSubmitted: d.dateSubmitted,
    submissionChannel: d.submissionChannel,
    registrantType: d.registrantType,
    cacNo: d.cacNo,
    tin: d.tin,
    address: d.address,
    principalLga: d.principalLga,
    otherAreasServed: d.otherAreasServed,
    primaryActivity: nameOf(d.primaryActivityCode),
    secondaryActivity: nameOf(d.secondaryActivityCode),
    installedCapacityMw: d.installedCapacityMw,
    customers: d.customers,
    licenceStatus: d.licenceStatus,
    licenceNo: d.licenceNo,
    licenceExpiry: d.licenceExpiry,
    complianceOfficer: d.complianceOfficer,
    phone: d.phone,
    email: d.email,
    operatingOnEffectiveDate: d.operatingOnEffectiveDate ? "Y" : "N",
    plannedStartDate: d.plannedStartDate,
    approvedWaiver: d.approvedWaiver,
    categoryOverride: d.categoryOverride,
    overrideReason: d.overrideReason,
    status: d.status,
    dateSubmissionComplete: d.dateSubmissionComplete,
    deficiencyNoticeDate: d.deficiencyNoticeDate,
    certificateIssueDate: d.certificateIssueDate,
    registrationNo: d.registrationNo,
    remarks: d.remarks,
    documents: s.documents.map((v) => v ?? null) as CheckValue[],
    pricing: s.pricing,
  };
}

/** Counts for the preview. */
export function planSummary(plan: ImportPlan) {
  const count = (level: ProblemLevel) => plan.problems.filter((p) => p.level === level).length;
  return {
    submissions: plan.submissions.length,
    ownUse: plan.ownUse.length,
    payments: plan.payments.length,
    audit: plan.audit.length,
    errors: count("error"),
    warnings: count("warning"),
    skipped: count("skipped"),
    pricingDifferences: plan.pricingDifferences.length,
  };
}
