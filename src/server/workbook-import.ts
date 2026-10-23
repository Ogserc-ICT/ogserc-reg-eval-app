import { createHash } from "node:crypto";
import type {
  CheckValue as DbCheckValue,
  FinalDecision as DbFinalDecision,
  Prisma,
} from "@prisma/client";
import ExcelJS from "exceljs";
import { addDays } from "@/domain/dates";
import { formatNaira } from "@/domain/money";
import { deficiencyNoticeRef } from "@/domain/numbers";
import { can } from "@/domain/roles";
import { STATUS, type CheckValue, type Status } from "@/domain/types";
import {
  SHEETS,
  planSummary,
  planWorkbookImport,
  type ImportContext,
  type ImportPlan,
  type WbCell,
  type WbRow,
  type WorkbookData,
} from "@/domain/workbook-import";
import { writeAudit } from "./audit";
import { appToday } from "./clock";
import { loadContext } from "./context";
import { BlockedError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { DECISION_FROM_DB } from "./evaluation-state";
import { fromIsoDate, koboToNumber, loadList } from "./reference-data";
import { STATUS_FROM_DB, pricingToColumns } from "./submissions";
import type { Actor, Db, Tx } from "./types";

// Phase 7: import existing rows from the Excel workbook. Upload (stored with its hash) → preview (the
// plan, every problem listed) → import, in one transaction, from the stored bytes. See
// src/domain/workbook-import.ts for the rules.

export const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;
const HEADER_ROW = 4;

// --- Reading ------------------------------------------------------------------

type Raw = ExcelJS.CellValue | undefined;

function plain(v: Raw): WbCell["value"] {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
  }
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("error" in v) return null;
  }
  return null;
}

function cellOf(v: Raw): WbCell {
  if (v && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) {
    return { value: plain((v as { result?: Raw }).result), formula: true };
  }
  return { value: plain(v), formula: false };
}

function readSheet(ws: ExcelJS.Worksheet): WbRow[] {
  const headers = new Map<number, string>();
  ws.getRow(HEADER_ROW).eachCell((cell, col) => {
    const h = String(plain(cell.value) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (h) headers.set(col, h);
  });
  const rows: WbRow[] = [];
  for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Record<string, WbCell> = {};
    let any = false;
    for (const [col, h] of headers) {
      const cell = cellOf(row.getCell(col).value);
      cells[h] = cell;
      if (cell.value !== null && cell.value !== "") any = true;
    }
    if (any) rows.push({ row: r, cells });
  }
  return rows;
}

/** The workbook's sheets as plain rows. Throws if it is not the OGSERC workbook. */
export async function readWorkbook(bytes: Uint8Array): Promise<WorkbookData> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new ValidationError("The file could not be read as an Excel workbook (.xlsm or .xlsx).");
  }
  const missing = Object.values(SHEETS).filter((name) => !wb.getWorksheet(name));
  if (missing.length) {
    throw new ValidationError(
      `This is not the OGSERC Registration and Evaluation workbook: missing sheet(s) ${missing.join(", ")}.`,
    );
  }
  const sheet = (name: string) => readSheet(wb.getWorksheet(name)!);
  return {
    register: sheet(SHEETS.register),
    documents: sheet(SHEETS.documents),
    evaluation: sheet(SHEETS.evaluation),
    payments: sheet(SHEETS.payments),
    ownUse: sheet(SHEETS.ownUse),
    audit: sheet(SHEETS.audit),
  };
}

// --- Upload, preview ----------------------------------------------------------------

function assertCanImport(actor: Actor) {
  if (!can(actor.roles, "register.import")) throw new ForbiddenError();
}

/** Store an uploaded workbook (after checking it is the OGSERC workbook). Audited. */
export async function uploadWorkbook(
  db: Db,
  actor: Actor,
  file: { name: string; bytes: Uint8Array },
) {
  assertCanImport(actor);
  if (!file.name) throw new ValidationError("Choose the workbook file first.");
  if (!/\.(xlsm|xlsx)$/i.test(file.name))
    throw new ValidationError("Choose the workbook (.xlsm or .xlsx).");
  if (file.bytes.length === 0) throw new ValidationError("The file is empty.");
  if (file.bytes.length > MAX_WORKBOOK_BYTES)
    throw new ValidationError("The file is larger than 25 MB.");
  await readWorkbook(file.bytes);
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const fileName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200);
  return db.$transaction(async (tx) => {
    const row = await tx.workbookImport.create({
      data: {
        fileName,
        sha256,
        size: file.bytes.length,
        bytes: Buffer.from(file.bytes),
        uploadedById: actor.id,
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Workbook uploaded",
      detail: `${fileName} (${Math.round(file.bytes.length / 1024)} KB, SHA-256 ${sha256.slice(0, 16)}…)`,
    });
    return row;
  });
}

async function importContext(db: Db | Tx): Promise<ImportContext> {
  const today = appToday();
  const [ctx, lgas, licenceStatuses, submissionChannels, registrantTypes, users, subs, ouns, pays] =
    await Promise.all([
      loadContext(db, today),
      db.lga.findMany({ select: { name: true } }),
      loadList(db, "licence_statuses"),
      loadList(db, "submission_channels"),
      loadList(db, "registrant_types"),
      db.user.findMany({ select: { id: true, name: true, roles: true, active: true } }),
      db.submission.findMany({
        select: { ackNo: true, ackSeq: true, registeredName: true, registrationNo: true },
      }),
      db.ownUseNotification.findMany({ select: { ounNo: true, ounSeq: true, name: true } }),
      db.payment.findMany({
        select: { paymentNo: true, paymentSeq: true, reference: true, amount: true },
      }),
    ]);
  return {
    ctx,
    lists: { lgas: lgas.map((l) => l.name), licenceStatuses, submissionChannels, registrantTypes },
    users,
    existing: {
      submissions: new Map(
        subs.map((s) => [s.ackNo, { name: s.registeredName, ackSeq: s.ackSeq }]),
      ),
      ackSeqs: new Set(subs.map((s) => s.ackSeq)),
      ownUse: new Map(ouns.map((o) => [o.ounNo, { name: o.name, ounSeq: o.ounSeq }])),
      ounSeqs: new Set(ouns.map((o) => o.ounSeq)),
      payments: new Map(
        pays.map((p) => [p.paymentNo, { reference: p.reference, amount: koboToNumber(p.amount) }]),
      ),
      paymentSeqs: new Set(pays.map((p) => p.paymentSeq)),
      registrationNos: new Set(subs.flatMap((s) => (s.registrationNo ? [s.registrationNo] : []))),
    },
  };
}

async function loadUpload(db: Db | Tx, id: string) {
  const upload = await db.workbookImport.findUnique({
    where: { id },
    include: {
      uploadedBy: { select: { name: true } },
      importedBy: { select: { name: true } },
    },
  });
  if (!upload) throw new NotFoundError("Upload not found.");
  return upload;
}

/** The import plan for an uploaded workbook: what would be imported and every problem found. */
export async function previewImport(db: Db, actor: Actor, id: string) {
  assertCanImport(actor);
  const upload = await loadUpload(db, id);
  const { bytes, ...info } = upload;
  const plan = planWorkbookImport(await readWorkbook(bytes), await importContext(db));
  return { upload: info, plan, summary: planSummary(plan) };
}

export function listUploads(db: Db) {
  return db.workbookImport.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 50,
    select: {
      id: true,
      fileName: true,
      size: true,
      sha256: true,
      uploadedAt: true,
      importedAt: true,
      summary: true,
      uploadedBy: { select: { name: true } },
      importedBy: { select: { name: true } },
    },
  });
}

// --- Commit ---------------------------------------------------------------------

const STATUS_TO_DB = Object.fromEntries(
  Object.entries(STATUS_FROM_DB).map(([db, label]) => [label, db]),
) as Record<Status, Prisma.SubmissionCreateInput["status"] & string>;
const DECISION_TO_DB = Object.fromEntries(
  Object.entries(DECISION_FROM_DB).map(([db, label]) => [label, db]),
) as Record<string, DbFinalDecision>;
const CHECK_TO_DB: Record<Exclude<CheckValue, null>, DbCheckValue> = {
  Y: "Y",
  N: "N",
  "N/A": "NA",
};

/** Raise a counter to at least `value` (never lowers it). */
async function raiseCounter(tx: Tx, name: string, value: number) {
  if (value <= 0) return;
  await tx.$executeRaw`
    INSERT INTO "Counter" ("name", "value") VALUES (${name}, ${value})
    ON CONFLICT ("name") DO UPDATE SET "value" = GREATEST("Counter"."value", ${value})`;
}

async function writePlan(
  tx: Tx,
  actor: Actor,
  plan: ImportPlan,
  ctx: ImportContext["ctx"],
  tag: string,
) {
  const submissionIds = new Map<string, string>();
  for (const s of plan.submissions) {
    const d = s.data;
    const sub = await tx.submission.create({
      data: {
        ackNo: s.ackNo,
        ackSeq: s.ackSeq,
        registeredName: d.registeredName,
        dateSubmitted: fromIsoDate(d.dateSubmitted),
        submissionChannel: d.submissionChannel,
        registrantType: d.registrantType,
        cacNo: d.cacNo,
        tin: d.tin,
        address: d.address,
        principalLga: d.principalLga,
        otherAreasServed: d.otherAreasServed,
        primaryActivityCode: d.primaryActivityCode,
        secondaryActivityCode: d.secondaryActivityCode,
        installedCapacityMw: d.installedCapacityMw,
        customers: d.customers,
        licenceStatus: d.licenceStatus,
        licenceNo: d.licenceNo,
        licenceExpiry: fromIsoDate(d.licenceExpiry),
        complianceOfficer: d.complianceOfficer,
        phone: d.phone,
        email: d.email,
        operatingOnEffectiveDate: d.operatingOnEffectiveDate,
        plannedStartDate: fromIsoDate(d.plannedStartDate),
        approvedWaiver: BigInt(d.approvedWaiver),
        categoryOverride: d.categoryOverride,
        overrideReason: d.overrideReason,
        status: STATUS_TO_DB[d.status],
        dateSubmissionComplete: fromIsoDate(d.dateSubmissionComplete),
        deficiencyNoticeDate: fromIsoDate(d.deficiencyNoticeDate),
        certificateIssueDate: fromIsoDate(d.certificateIssueDate),
        registrationNo: d.registrationNo,
        remarks: d.remarks,
        createdById: actor.id,
        ...pricingToColumns(s.pricing),
        documents: {
          createMany: {
            data: s.documents.flatMap((v, i) =>
              v ? [{ documentNumber: i + 1, value: CHECK_TO_DB[v] }] : [],
            ),
          },
        },
      },
      select: { id: true },
    });
    submissionIds.set(s.ackNo, sub.id);

    const e = s.evaluation;
    await tx.evaluation.create({
      data: {
        submissionId: sub.id,
        evaluatingOfficerId: e.evaluatingOfficerId,
        reviewingSupervisorId: e.reviewingSupervisorId,
        approvingOfficerId: e.approvingOfficerId,
        dateEvaluationStarted: fromIsoDate(e.dateEvaluationStarted),
        evaluationRemarks: e.evaluationRemarks,
        finalDecision: e.finalDecision ? DECISION_TO_DB[e.finalDecision] : null,
        reasons: e.reasons,
        reviewDate: fromIsoDate(e.reviewDate),
        approvalDate: fromIsoDate(e.approvalDate),
        checks: {
          createMany: {
            data: Object.entries(e.checks).flatMap(([checkId, v]) =>
              v ? [{ checkId, value: CHECK_TO_DB[v] }] : [],
            ),
          },
        },
      },
    });

    // The deficiency notice on record, as a notice. Answered if the submission later moved on.
    if (d.deficiencyNoticeDate) {
      const answered =
        d.status !== STATUS.DEFICIENCY &&
        d.dateSubmissionComplete &&
        d.dateSubmissionComplete >= d.deficiencyNoticeDate
          ? d.dateSubmissionComplete
          : null;
      await tx.deficiencyNotice.create({
        data: {
          submissionId: sub.id,
          seq: 1,
          noticeRef: deficiencyNoticeRef(s.ackNo, d.deficiencyNoticeDate),
          noticeDate: fromIsoDate(d.deficiencyNoticeDate),
          responseDue: fromIsoDate(addDays(d.deficiencyNoticeDate, ctx.settings.deficiencyDays)),
          responseReceivedDate: fromIsoDate(answered),
          issuedById: actor.id,
        },
      });
    }

    await writeAudit(tx, {
      userId: actor.id,
      action: "Imported from workbook",
      reference: s.ackNo,
      detail:
        `${d.registeredName} - Category ${s.pricing.category} - ${d.status}` +
        (d.registrationNo ? ` - ${d.registrationNo}` : "") +
        ` (Register row ${s.row}; ${tag})`,
    });
  }

  const ownUseIds = new Map<string, string>();
  for (const o of plan.ownUse) {
    const row = await tx.ownUseNotification.create({
      data: {
        ...o.data,
        dateFiled: fromIsoDate(o.data.dateFiled),
        ounNo: o.ounNo,
        ounSeq: o.ounSeq,
        pricedFee: BigInt(o.pricing.fee),
        pricedThresholdKw: o.pricing.thresholdKw,
        createdById: actor.id,
      },
      select: { id: true },
    });
    ownUseIds.set(o.ounNo, row.id);
    await writeAudit(tx, {
      userId: actor.id,
      action: "Imported from workbook",
      reference: o.ounNo,
      detail: `${o.data.name} - ${o.data.installedCapacityKw} kW - fee ${formatNaira(o.pricing.fee)} (Own-use row ${o.row}; ${tag})`,
    });
  }

  // Payments may also point at records already in the app (imported earlier).
  const refs = plan.payments.map((p) => p.reference);
  const [oldSubs, oldOuns] = await Promise.all([
    tx.submission.findMany({ where: { ackNo: { in: refs } }, select: { id: true, ackNo: true } }),
    tx.ownUseNotification.findMany({
      where: { ounNo: { in: refs } },
      select: { id: true, ounNo: true },
    }),
  ]);
  for (const s of oldSubs) if (!submissionIds.has(s.ackNo)) submissionIds.set(s.ackNo, s.id);
  for (const o of oldOuns) if (!ownUseIds.has(o.ounNo)) ownUseIds.set(o.ounNo, o.id);
  for (const p of plan.payments) {
    await tx.payment.create({
      data: {
        paymentNo: p.paymentNo,
        paymentSeq: p.paymentSeq,
        dateReceived: fromIsoDate(p.dateReceived),
        reference: p.reference,
        submissionId: submissionIds.get(p.reference) ?? null,
        ownUseNotificationId: ownUseIds.get(p.reference) ?? null,
        purpose: p.purpose,
        channel: p.channel,
        amount: BigInt(p.amount),
        rrr: p.rrr,
        verifiedWithBank: p.verifiedWithBank,
        recordedById: actor.id,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Imported from workbook",
      reference: p.reference,
      detail: `Payment ${p.paymentNo} ${formatNaira(p.amount)}${p.rrr ? ` - ref ${p.rrr}` : ""}${p.verifiedWithBank ? " - verified with bank (per workbook)" : ""} (Payments row ${p.row}; ${tag})`,
    });
  }

  for (const a of plan.audit) {
    await writeAudit(tx, {
      userId: actor.id,
      action: a.action,
      reference: a.reference,
      detail: a.detail,
    });
  }

  await raiseCounter(tx, "ACK", plan.counters.ack);
  await raiseCounter(tx, "OUN", plan.counters.oun);
  await raiseCounter(tx, "PAY", plan.counters.payment);
  for (const [year, serial] of Object.entries(plan.counters.registration)) {
    await raiseCounter(tx, `REG:${year}`, serial);
  }
}

/**
 * Import an uploaded workbook. The plan is worked out again inside the transaction (against the data
 * as it is now) and nothing is written while any error remains. All or nothing; audited.
 */
export async function commitImport(db: Db, actor: Actor, id: string) {
  assertCanImport(actor);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('ogserc.workflow', 'on', true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ogserc.workbook-import'))`;
      await tx.$queryRaw`SELECT "id" FROM "WorkbookImport" WHERE "id" = ${id} FOR UPDATE`;
      const upload = await loadUpload(tx, id);
      if (upload.importedAt) throw new BlockedError("This workbook has already been imported.", []);

      const ic = await importContext(tx);
      const plan = planWorkbookImport(await readWorkbook(upload.bytes), ic);
      const errors = plan.problems.filter((p) => p.level === "error");
      if (errors.length) {
        throw new BlockedError(
          `Nothing was imported: ${errors.length} error(s) to fix in the workbook first.`,
          errors
            .slice(0, 20)
            .map(
              (e) =>
                `${e.sheet} row ${e.row ?? "?"}${e.reference ? ` (${e.reference})` : ""}: ${e.message}`,
            ),
        );
      }
      const summary = planSummary(plan);
      if (!summary.submissions && !summary.ownUse && !summary.payments) {
        throw new BlockedError("There is nothing new to import in this workbook.", []);
      }
      const tag = `workbook ${upload.fileName}, SHA-256 ${upload.sha256.slice(0, 12)}`;
      await writePlan(tx, actor, plan, ic.ctx, tag);

      const counts =
        `${summary.submissions} submissions, ${summary.ownUse} own-use notifications, ` +
        `${summary.payments} payments, ${summary.audit} workbook audit entries; ` +
        `${summary.warnings} warnings, ${summary.pricingDifferences} pricing differences, ${summary.skipped} rows skipped`;
      await tx.workbookImport.update({
        where: { id },
        data: { importedAt: new Date(), importedById: actor.id, summary: counts },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: "Workbook imported",
        detail: `${upload.fileName}: ${counts}`,
      });
      return summary;
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
}
