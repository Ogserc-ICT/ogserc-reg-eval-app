import ExcelJS from "exceljs";
import { formatDate } from "@/domain/dates";
import type { DataFlag } from "@/domain/flags";
import { can } from "@/domain/roles";
import type { Assessment } from "@/domain/submission";
import { FILING_LABELS, type SubmissionInput } from "@/domain/types";
import { toCsv, type Cell } from "@/lib/csv";
import { writeAudit } from "./audit";
import { describeFilters } from "./audit-log";
import { appToday } from "./clock";
import { ForbiddenError } from "./errors";
import { assessRegister, type RegisterFilters, type RegisterRow } from "./register";
import type { Actor, Db } from "./types";

// Register export (Phase 7): the filtered Register with every input and calculated column, in the
// workbook's Register column order, as CSV or Excel. Money is in naira; dates are real dates in Excel.

type Kind = "text" | "date" | "money" | "number";
interface Entry {
  sub: SubmissionInput;
  assessment: Assessment;
  row: RegisterRow;
}
interface Column {
  header: string;
  kind: Kind;
  width: number;
  value: (e: Entry) => string | number | null;
}

const yn = (b: boolean) => (b ? "Yes" : "No");
const naira = (kobo: number) => kobo / 100;
const flagsText = (flags: DataFlag[]) => flags.map((f) => f.message).join("; ");

export const REGISTER_COLUMNS: Column[] = [
  { header: "Acknowledgement No.", kind: "text", width: 24, value: (e) => e.sub.ackNo },
  { header: "Registered Name", kind: "text", width: 36, value: (e) => e.sub.registeredName },
  { header: "Date Submitted", kind: "date", width: 12, value: (e) => e.sub.dateSubmitted },
  { header: "Submission Channel", kind: "text", width: 14, value: (e) => e.sub.submissionChannel },
  {
    header: "Filing Type",
    kind: "text",
    width: 18,
    value: (e) => FILING_LABELS[e.sub.filingType],
  },
  { header: "Form Filed", kind: "text", width: 10, value: (e) => e.sub.formFiled },
  {
    header: "Linked Registration No.",
    kind: "text",
    width: 26,
    value: (e) => e.row.linkedRegistrationNo,
  },
  { header: "Registrant Type", kind: "text", width: 14, value: (e) => e.sub.registrantType },
  { header: "CAC / Registration No.", kind: "text", width: 16, value: (e) => e.sub.cacNo },
  { header: "TIN", kind: "text", width: 16, value: (e) => e.sub.tin },
  {
    header: "Registered / Operational Address",
    kind: "text",
    width: 36,
    value: (e) => e.sub.address,
  },
  { header: "Principal LGA", kind: "text", width: 16, value: (e) => e.sub.principalLga },
  {
    header: "LGAs Served",
    kind: "text",
    width: 30,
    value: (e) => e.sub.lgasServed.join(", ") || null,
  },
  {
    header: "Towns / Communities / Estates Served",
    kind: "text",
    width: 30,
    value: (e) => e.sub.otherAreasServed,
  },
  { header: "Primary Activity", kind: "text", width: 36, value: (e) => e.sub.primaryActivity },
  {
    header: "Other Activities",
    kind: "text",
    width: 30,
    value: (e) => e.sub.otherActivities.join("; ") || null,
  },
  { header: "Activity Code", kind: "text", width: 9, value: (e) => e.assessment.primaryCode },
  {
    header: "Installed Capacity (MW)",
    kind: "number",
    width: 11,
    value: (e) => e.sub.installedCapacityMw,
  },
  { header: "Customers (No.)", kind: "number", width: 11, value: (e) => e.sub.customers },
  { header: "Licence Status", kind: "text", width: 30, value: (e) => e.sub.licenceStatus },
  {
    header: "Licence / Permit Nos.",
    kind: "text",
    width: 20,
    value: (e) =>
      e.sub.licences
        .map((l) => l.number)
        .filter(Boolean)
        .join("; ") || null,
  },
  {
    header: "Nearest Licence Expiry",
    kind: "date",
    width: 12,
    value: (e) => e.assessment.nearestLicenceExpiry,
  },
  { header: "Compliance Officer", kind: "text", width: 20, value: (e) => e.sub.complianceOfficer },
  { header: "Phone", kind: "text", width: 15, value: (e) => e.sub.phone },
  { header: "Email", kind: "text", width: 26, value: (e) => e.sub.email },
  { header: "Category (Auto)", kind: "text", width: 9, value: (e) => e.assessment.categoryAuto },
  { header: "Category Override", kind: "text", width: 9, value: (e) => e.sub.categoryOverride },
  { header: "Override Reason", kind: "text", width: 24, value: (e) => e.sub.overrideReason },
  {
    header: "Category Confirmed",
    kind: "text",
    width: 9,
    value: (e) => e.sub.confirmedCategory,
  },
  {
    header: "Category Applied",
    kind: "text",
    width: 9,
    value: (e) => e.assessment.categoryApplied,
  },
  {
    header: "Category Description",
    kind: "text",
    width: 36,
    value: (e) => e.assessment.categoryDescription,
  },
  {
    header: "Operating on Effective Date? (Y/N)",
    kind: "text",
    width: 10,
    value: (e) => e.sub.operatingOnEffectiveDate,
  },
  {
    header: "Planned Start / Energization Date",
    kind: "date",
    width: 12,
    value: (e) => e.sub.plannedStartDate,
  },
  {
    header: "Registration Deadline",
    kind: "date",
    width: 12,
    value: (e) => e.assessment.registrationDeadline,
  },
  { header: "Days Late", kind: "number", width: 8, value: (e) => e.assessment.daysLate },
  {
    header: "Registration Fee (₦)",
    kind: "money",
    width: 14,
    value: (e) => naira(e.assessment.fees.fee),
  },
  {
    header: "Approved Waiver / Reduction (₦)",
    kind: "money",
    width: 14,
    value: (e) => naira(e.sub.approvedWaiver),
  },
  {
    header: "Late Registration Charge (₦)",
    kind: "money",
    width: 14,
    value: (e) => naira(e.assessment.fees.lateCharge),
  },
  {
    header: "Total Due (₦)",
    kind: "money",
    width: 14,
    value: (e) => naira(e.assessment.fees.totalDue),
  },
  {
    header: "Amount Paid (₦)",
    kind: "money",
    width: 14,
    value: (e) => naira(e.assessment.fees.amountPaid),
  },
  {
    header: "Last Payment Date",
    kind: "date",
    width: 12,
    value: (e) => e.assessment.fees.lastPaymentDate,
  },
  {
    header: "Balance (₦)",
    kind: "money",
    width: 14,
    value: (e) => naira(e.assessment.fees.balance),
  },
  {
    header: "Payment Status",
    kind: "text",
    width: 10,
    value: (e) => e.assessment.fees.paymentStatus,
  },
  {
    header: "Documents Complete (Sch. 2)",
    kind: "text",
    width: 10,
    value: (e) => yn(e.assessment.documents.documentsComplete),
  },
  {
    header: "Documents Outstanding (No.)",
    kind: "number",
    width: 10,
    value: (e) => e.assessment.documents.outstanding + e.assessment.documents.pending,
  },
  {
    header: "Submission Complete?",
    kind: "text",
    width: 10,
    value: (e) => yn(e.assessment.submissionComplete),
  },
  {
    header: "Date Submission Complete",
    kind: "date",
    width: 12,
    value: (e) => e.sub.dateSubmissionComplete,
  },
  {
    header: "Determination Due",
    kind: "date",
    width: 12,
    value: (e) => e.assessment.determinationDue,
  },
  { header: "Status", kind: "text", width: 22, value: (e) => e.sub.status },
  { header: "Process Stage", kind: "text", width: 26, value: (e) => e.row.stage },
  {
    header: "Released for Evaluation",
    kind: "date",
    width: 12,
    value: (e) => e.sub.releasedForEvaluationDate,
  },
  {
    header: "Deficiency Notice Date",
    kind: "date",
    width: 12,
    value: (e) => e.sub.deficiencyNoticeDate,
  },
  {
    header: "Deficiency Response Due",
    kind: "date",
    width: 12,
    value: (e) => e.assessment.deficiencyResponseDue,
  },
  {
    header: "Licence Application Due (unlicensed)",
    kind: "date",
    width: 12,
    value: (e) => e.assessment.licenceApplicationDue,
  },
  {
    header: "Certificate Issue Date",
    kind: "date",
    width: 12,
    value: (e) => e.sub.certificateIssueDate,
  },
  {
    header: "Registration No. in Use",
    kind: "text",
    width: 28,
    value: (e) => e.assessment.registrationNoInUse,
  },
  { header: "Days in Queue", kind: "number", width: 8, value: (e) => e.assessment.daysInQueue },
  { header: "SLA", kind: "text", width: 7, value: (e) => e.assessment.sla },
  { header: "Next Action", kind: "text", width: 40, value: (e) => e.row.nextAction },
  { header: "Data Checks / Flags", kind: "text", width: 40, value: (e) => flagsText(e.row.flags) },
  { header: "Remarks", kind: "text", width: 30, value: (e) => e.sub.remarks },
];

export type ExportFormat = "csv" | "xlsx";

/** "As at" line and file name stem. */
const stem = (today: string) => `ogserc-register-${today}`;

function csvFor(entries: Entry[]): string {
  return toCsv(
    REGISTER_COLUMNS.map((c) => c.header),
    entries.map((e) => REGISTER_COLUMNS.map((c): Cell => c.value(e))),
  );
}

async function xlsxFor(entries: Entry[], today: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "OGSERC Registration & Evaluation System";
  wb.created = new Date();
  const ws = wb.addWorksheet("Register", { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
  ws.getCell("A1").value =
    `Register of Licensees and Electricity Operators — as at ${formatDate(today)}`;
  ws.getCell("A1").font = { bold: true, size: 12 };
  ws.columns = REGISTER_COLUMNS.map((c) => ({ width: c.width }));
  const header = ws.getRow(2);
  REGISTER_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F6B35" } };
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
  header.height = 45;
  for (const e of entries) {
    const row = ws.addRow(
      REGISTER_COLUMNS.map((c) => {
        const v = c.value(e);
        if (v === null || v === "") return null;
        // Dates as real Excel dates (midnight UTC, shown without a time).
        return c.kind === "date" ? new Date(`${v}T00:00:00Z`) : v;
      }),
    );
    REGISTER_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.kind === "money") cell.numFmt = "#,##0.00";
      if (c.kind === "date") cell.numFmt = "dd-mmm-yyyy";
    });
  }
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: REGISTER_COLUMNS.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * The Register, filtered as on screen, as a file. Any signed-in staff member may export what they can
 * read; each export is audited (format, row count, filters).
 */
export async function exportRegister(
  db: Db,
  actor: Actor,
  format: ExportFormat,
  filters: RegisterFilters,
  today = appToday(),
) {
  if (!can(actor.roles, "records.read")) throw new ForbiddenError();
  const entries = await assessRegister(db, filters, today);
  const body = format === "csv" ? csvFor(entries) : await xlsxFor(entries, today);
  await db.$transaction((tx) =>
    writeAudit(tx, {
      userId: actor.id,
      action: "Register exported",
      detail: `${format.toUpperCase()}, ${entries.length} submissions${describeFilters(filters)}`,
    }),
  );
  return {
    body,
    rows: entries.length,
    fileName: `${stem(today)}.${format}`,
    contentType:
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
