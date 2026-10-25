import { createHash } from "node:crypto";
import type { DocumentKind } from "@prisma/client";
import { certificateBlockers, certificateFields } from "@/domain/certificate";
import { addDays, formatDate } from "@/domain/dates";
import { can } from "@/domain/roles";
import type { DomainContext } from "@/domain/submission";
import {
  OWN_USE_CATEGORY,
  ownUseCertificateFields,
  type OwnUseAssessment,
  type OwnUseInput,
} from "@/domain/own-use";
import { FILING_LABELS, LICENCE, isClosed, isLinkedFiling, type IsoDate } from "@/domain/types";
import { reasonSchema } from "@/lib/schemas";
import { writeAudit } from "./audit";
import { appToday } from "./clock";
import { loadContext } from "./context";
import { BlockedError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { loadEvaluationState, type EvaluationState } from "./evaluation-state";
import { acknowledgementPdf } from "./pdf/acknowledgement";
import { ownUseVerificationUrl, verificationUrl } from "./app-url";
import { certificatePdf } from "./pdf/certificate";
import { deficiencyPdf } from "./pdf/deficiency";
import { evaluationFormPdf } from "./pdf/evaluation-form";
import { requireFinanceGate } from "./finance";
import type { Actor, Db, Tx } from "./types";

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  ACKNOWLEDGEMENT: "Acknowledgement letter",
  EVALUATION_FORM: "Evaluation form (EVAL-01)",
  DEFICIENCY_NOTICE: "Notice of deficiency",
  CERTIFICATE: "Certificate of registration (CERT-01)",
};

const FILE_SLUG: Record<DocumentKind, string> = {
  ACKNOWLEDGEMENT: "acknowledgement",
  EVALUATION_FORM: "eval-01",
  DEFICIENCY_NOTICE: "deficiency-notice",
  CERTIFICATE: "certificate",
};

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The record a document belongs to: a submission, or an own-use notification (its certificate). */
type Owner = { submissionId: string } | { ownUseNotificationId: string };

/**
 * Store a generated PDF: next version for the record and kind, SHA-256, and an audit entry.
 * A new acknowledgement, evaluation form or certificate supersedes the previous one; each deficiency
 * notice is its own document and supersedes nothing. `ackNo` is the Ack No. or OUN No.
 */
async function storeDocument(
  tx: Tx,
  actor: Actor,
  args: {
    owner: Owner;
    ackNo: string;
    kind: DocumentKind;
    bytes: Uint8Array;
    note?: string | null;
    deficiencyNoticeId?: string | null;
  },
) {
  const last = await tx.generatedDocument.findFirst({
    where: { ...args.owner, kind: args.kind },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;
  const hash = sha256(args.bytes);
  if (args.kind !== "DEFICIENCY_NOTICE") {
    await tx.generatedDocument.updateMany({
      where: { ...args.owner, kind: args.kind, supersededAt: null },
      data: { supersededAt: new Date() },
    });
  }
  const doc = await tx.generatedDocument.create({
    data: {
      ...args.owner,
      kind: args.kind,
      version,
      deficiencyNoticeId: args.deficiencyNoticeId ?? null,
      fileName: `${args.ackNo.replaceAll("/", "-")}-${FILE_SLUG[args.kind]}-v${version}.pdf`,
      sha256: hash,
      sizeBytes: args.bytes.length,
      content: Buffer.from(args.bytes),
      note: args.note ?? null,
      generatedById: actor.id,
    },
    select: { id: true, version: true, sha256: true, fileName: true },
  });
  await writeAudit(tx, {
    userId: actor.id,
    action: "Document generated",
    reference: args.ackNo,
    detail:
      `${DOCUMENT_LABELS[args.kind]} v${version}, SHA-256 ${hash}` +
      (args.note ? `. ${args.note}` : ""),
  });
  return doc;
}

// --- Content from the evaluation state ------------------------------------------------

function acknowledgementContent(state: EvaluationState, ctx: DomainContext, signatoryName: string) {
  const { sub, assessment: a } = state;
  return {
    ackNo: sub.ackNo!,
    dateSubmitted: sub.dateSubmitted!,
    registeredName: sub.registeredName!,
    address: sub.address,
    complianceOfficer: sub.complianceOfficer,
    submissionChannel: sub.submissionChannel,
    formFiled: sub.formFiled ?? "—",
    filing: {
      label: FILING_LABELS[sub.filingType],
      linked: isLinkedFiling(sub.filingType),
      linkedRegistrationNo: state.linked?.registrationNo ?? null,
    },
    primaryActivity: sub.primaryActivity!,
    otherActivities: sub.otherActivities,
    installedCapacityMw: sub.installedCapacityMw,
    categoryApplied: a.categoryApplied!,
    categoryDescription: a.categoryDescription ?? "",
    fee: a.fees.fee,
    amountPaid: a.fees.amountPaid,
    balance: a.fees.balance,
    daysLate: a.daysLate,
    lateCharge: a.fees.lateCharge,
    receivedList: a.documents.receivedList,
    outstandingList: a.documents.outstandingList,
    unlicensed: sub.licenceStatus === LICENCE.UNLICENSED,
    licenceApplicationDue: a.licenceApplicationDue,
    determinationDays: ctx.settings.determinationDays,
    deficiencyDays: ctx.settings.deficiencyDays,
    signatoryName,
  };
}

function deficiencyContent(
  state: EvaluationState,
  notice: { noticeRef: string; noticeDate: IsoDate; responseDue: IsoDate; draft: boolean },
) {
  const { sub, assessment: a } = state;
  return {
    ...notice,
    ackNo: sub.ackNo!,
    dateSubmitted: sub.dateSubmitted!,
    registeredName: sub.registeredName!,
    address: sub.address,
    complianceOfficer: sub.complianceOfficer,
    categoryApplied: a.categoryApplied!,
    outstandingList: a.documents.outstandingList,
    failedChecks: state.checks
      .filter((c) => !c.postApproval && c.value === "N")
      .map((c) => ({ id: c.id, text: c.text })),
    evaluatorRemarks: state.evaluation.evaluationRemarks,
    totalDue: a.fees.totalDue,
    amountPaid: a.fees.amountPaid,
    balance: a.fees.balance,
  };
}

function evaluationFormContent(state: EvaluationState, today: IsoDate) {
  const { sub, assessment: a, evaluation: ev, evaluationRow } = state;
  return {
    ackNo: sub.ackNo!,
    registeredName: sub.registeredName!,
    categoryActivity:
      `${a.categoryApplied ?? "—"} — ${sub.primaryActivity ?? "—"}; Form ${sub.formFiled ?? "—"}` +
      (sub.confirmedCategory ? `; category confirmed ${sub.confirmedCategory}` : ""),
    evaluatingOfficer: evaluationRow.evaluatingOfficer?.name ?? null,
    reviewingSupervisor: evaluationRow.reviewingSupervisor?.name ?? null,
    approvingOfficer: evaluationRow.approvingOfficer?.name ?? null,
    dateEvaluationStarted: ev.dateEvaluationStarted,
    checks: state.checks.map((c) => ({
      id: c.id,
      stage: c.stage,
      text: c.text,
      value: c.value,
      automatic: c.mode !== "manual",
      postApproval: c.postApproval,
    })),
    counts: state.counts,
    recommended: state.recommended,
    finalDecision: ev.finalDecision,
    reasons: ev.reasons,
    remarks: ev.evaluationRemarks,
    registrationNo: a.registrationNoInUse,
    printedOn: today,
  };
}

// --- Generation called from workflow transactions --------------------------------------------

/** Deficiency notice PDF for a notice just created in `issueDeficiency`, stored with it. */
export async function storeDeficiencyNotice(
  tx: Tx,
  actor: Actor,
  state: EvaluationState,
  notice: { id: string; noticeRef: string; noticeDate: IsoDate; responseDue: IsoDate },
) {
  const bytes = await deficiencyPdf(deficiencyContent(state, { ...notice, draft: false }));
  return storeDocument(tx, actor, {
    owner: { submissionId: state.row.id },
    ackNo: state.row.ackNo,
    kind: "DEFICIENCY_NOTICE",
    bytes,
    deficiencyNoticeId: notice.id,
    note: notice.noticeRef,
  });
}

/** Certificate PDF for a Registered submission (approval, issue or reissue). */
export async function storeCertificate(
  tx: Tx,
  actor: Actor,
  submissionId: string,
  ctx: DomainContext,
  opts: { reissue: boolean; note?: string | null },
) {
  const state = await loadEvaluationState(tx, submissionId, ctx);
  if (!state) throw new NotFoundError("Submission not found.");
  const blockers = certificateBlockers(state.sub, state.assessment, ctx.settings);
  if (blockers.length) throw new BlockedError("The certificate cannot be produced.", blockers);
  const bytes = await certificatePdf({
    ...certificateFields(state.sub, state.assessment, ctx.settings),
    reissuedOn: opts.reissue ? ctx.today : null,
    verifyUrl: verificationUrl(submissionId),
  });
  return storeDocument(tx, actor, {
    owner: { submissionId },
    ackNo: state.row.ackNo,
    kind: "CERTIFICATE",
    bytes,
    note: opts.note,
  });
}

/**
 * Certificate PDF for a registered own-use notification (setting "own-use certificate"). Call inside
 * the registration transaction, after the number and date are set.
 */
export async function storeOwnUseCertificate(
  tx: Tx,
  actor: Actor,
  oun: OwnUseInput,
  assessment: OwnUseAssessment,
  ctx: DomainContext,
  note?: string | null,
) {
  if (!oun.registrationNo || !oun.certificateIssueDate) {
    throw new BlockedError("The certificate cannot be produced.", [
      "No locked registration number",
    ]);
  }
  const bytes = await certificatePdf({
    ...ownUseCertificateFields(oun, assessment, ctx.ref, ctx.settings),
    reissuedOn: null,
    verifyUrl: ownUseVerificationUrl(oun.id),
  });
  return storeDocument(tx, actor, {
    owner: { ownUseNotificationId: oun.id },
    ackNo: oun.ounNo!,
    kind: "CERTIFICATE",
    bytes,
    note: note ?? `Category ${OWN_USE_CATEGORY} own-use registration`,
  });
}

// --- On-demand documents -------------------------------------------------------------------------

async function stateOrThrow(tx: Tx | Db, id: string, ctx: DomainContext) {
  const state = await loadEvaluationState(tx, id, ctx);
  if (!state) throw new NotFoundError("Submission not found.");
  return state;
}

/** Acknowledgement letter (para 10(3)), signed by the evaluating officer if assigned, else the user. */
export async function generateAcknowledgement(
  db: Db,
  actor: Actor,
  id: string,
  today = appToday(),
) {
  if (!can(actor.roles, "letter.acknowledgement")) throw new ForbiddenError();
  return db.$transaction(
    async (tx) => {
      const ctx = await loadContext(tx, today);
      const state = await stateOrThrow(tx, id, ctx);
      const signatory = state.evaluationRow.evaluatingOfficer?.name ?? actor.name;
      const bytes = await acknowledgementPdf(acknowledgementContent(state, ctx, signatory));
      return storeDocument(tx, actor, {
        owner: { submissionId: id },
        ackNo: state.row.ackNo,
        kind: "ACKNOWLEDGEMENT",
        bytes,
      });
    },
    { timeout: 30_000 },
  );
}

/** Internal evaluation form EVAL-01, as it stands now. */
export async function generateEvaluationForm(db: Db, actor: Actor, id: string, today = appToday()) {
  if (!can(actor.roles, "records.read")) throw new ForbiddenError();
  await requireFinanceGate(db, actor, id, "Evaluation form", today);
  return db.$transaction(
    async (tx) => {
      const ctx = await loadContext(tx, today);
      const state = await stateOrThrow(tx, id, ctx);
      const bytes = await evaluationFormPdf(evaluationFormContent(state, today));
      return storeDocument(tx, actor, {
        owner: { submissionId: id },
        ackNo: state.row.ackNo,
        kind: "EVALUATION_FORM",
        bytes,
      });
    },
    { timeout: 30_000 },
  );
}

/**
 * Watermarked preview of the deficiency notice that issuing would produce now (SPEC §8.10: a notice is
 * only issued by the Issue action; before that it is clearly a draft). Not stored.
 */
export async function previewDeficiencyNotice(
  db: Db,
  actor: Actor,
  id: string,
  today = appToday(),
) {
  if (!can(actor.roles, "deficiency.draft") && !can(actor.roles, "deficiency.issue")) {
    throw new ForbiddenError();
  }
  await requireFinanceGate(db, actor, id, "Deficiency notice draft", today);
  const ctx = await loadContext(db, today);
  const state = await stateOrThrow(db, id, ctx);
  if (isClosed(state.sub.status))
    throw new ValidationError(`The submission is ${state.sub.status}.`);
  return deficiencyPdf(
    deficiencyContent(state, {
      noticeRef: `DRAFT – ${state.row.ackNo}`,
      noticeDate: today,
      responseDue: addDays(today, ctx.settings.deficiencyDays),
      draft: true,
    }),
  );
}

/**
 * Admin: issue the certificate again (after a correction marked it "needs reissue", or if none exists).
 * The new version supersedes the previous one; the issue date stays the registration date.
 */
export async function reissueCertificate(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  today = appToday(),
) {
  if (!can(actor.roles, "certificate.reissue")) throw new ForbiddenError();
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  await requireFinanceGate(db, actor, id, "Certificate", today);
  return db.$transaction(
    async (tx) => {
      const ctx = await loadContext(tx, today);
      const existing = await tx.generatedDocument.count({
        where: { submissionId: id, kind: "CERTIFICATE" },
      });
      const doc = await storeCertificate(tx, actor, id, ctx, {
        reissue: existing > 0,
        note: `${existing > 0 ? "Reissued" : "Issued"} ${formatDate(today)}: ${parsed.data.reason}`,
      });
      await tx.submission.update({ where: { id }, data: { certificateNeedsReissue: false } });
      return doc;
    },
    { timeout: 30_000 },
  );
}

/** A stored document for download, after checking its bytes still match the recorded hash. */
export async function getDocumentForDownload(db: Db, actor: Actor, documentId: string) {
  if (!can(actor.roles, "records.read")) throw new ForbiddenError();
  const doc = await db.generatedDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new NotFoundError("Document not found.");
  const bytes = new Uint8Array(doc.content);
  if (sha256(bytes) !== doc.sha256) {
    throw new Error(`Stored document ${doc.id} does not match its SHA-256; refusing to serve it.`);
  }
  return { fileName: doc.fileName, bytes };
}

/** Documents for a submission or own-use notification, newest first, without their content. */
export function listDocuments(db: Db, owner: string | Owner) {
  return db.generatedDocument.findMany({
    where: typeof owner === "string" ? { submissionId: owner } : owner,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      kind: true,
      version: true,
      fileName: true,
      sha256: true,
      sizeBytes: true,
      note: true,
      createdAt: true,
      supersededAt: true,
      generatedBy: { select: { name: true } },
    },
  });
}
