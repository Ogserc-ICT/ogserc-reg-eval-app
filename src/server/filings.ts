import type { Prisma } from "@prisma/client";
import { formatDate, yearOf } from "@/domain/dates";
import { describeChanges, filingChanges, type FieldChange } from "@/domain/filing";
import { FILING_LABELS } from "@/domain/types";
import { writeAudit } from "./audit";
import { NotFoundError } from "./errors";
import { toIsoDate } from "./reference-data";
import { childrenInclude, filingValues } from "./submission-text";
import type { Actor, Tx, Db } from "./types";

// Updates and annual confirmations (para 16): what an approved filing changes on its registered
// record, and applying it. The registered record is changed only here, inside the approval.

/** Columns copied as they are when the field of the same key changed. */
const SCALAR_FIELDS = [
  "registeredName",
  "tradingName",
  "registrantType",
  "cacNo",
  "incorporationDate",
  "tin",
  "address",
  "operationalAddress",
  "website",
  "principalLga",
  "lgasServed",
  "otherAreasServed",
  "primaryActivityCode",
  "installedCapacityMw",
  "customers",
  "licenceStatus",
  "mdName",
  "mdPhone",
  "mdEmail",
  "complianceOfficer",
  "phone",
  "email",
] as const;

const SIGNATORY_COLUMNS = [
  "signatory1Name",
  "signatory1Designation",
  "signatory1Date",
  "signatory2Name",
  "signatory2Designation",
  "signatory2Date",
] as const;

const filingInclude = {
  ...childrenInclude,
  linkedSubmission: { include: childrenInclude },
} as const;

/** The filing, its registered record and the changes approving it would make. */
export async function pendingFilingChanges(db: Db | Tx, filingId: string) {
  const filing = await db.submission.findUnique({
    where: { id: filingId },
    include: filingInclude,
  });
  if (!filing) throw new NotFoundError("Submission not found.");
  const registered = filing.linkedSubmission;
  if (!registered) return { filing, registered: null, changes: [] as FieldChange[] };
  return {
    filing,
    registered,
    changes: filingChanges(filingValues(registered), filingValues(filing)),
  };
}

/**
 * Apply an approved update or annual confirmation to its registered record: changed fields are
 * copied, changed tables replaced, and a changed certificate field marks the certificate "needs
 * reissue". Audited on the registered record with every old and new value. Call inside the approval
 * transaction.
 */
export async function applyFiling(tx: Tx, actor: Actor, filingId: string, today: string) {
  const { filing, registered, changes } = await pendingFilingChanges(tx, filingId);
  if (!registered) throw new NotFoundError("The linked registration was not found.");
  const changed = new Set(changes.map((c) => c.key));
  const id = registered.id;

  const data: Prisma.SubmissionUncheckedUpdateInput = {};
  const copy = data as Record<string, unknown>;
  for (const key of SCALAR_FIELDS) if (changed.has(key)) copy[key] = filing[key];
  if (changed.has("signatories")) for (const key of SIGNATORY_COLUMNS) copy[key] = filing[key];
  const reissue = changes.some((c) => c.certificate);
  if (reissue) data.certificateNeedsReissue = true;
  if (Object.keys(data).length) await tx.submission.update({ where: { id }, data });

  const owned = { where: { submissionId: id } };
  // The filing's rows, re-created on the registration (new ids).
  const rows = <T extends { id: string; submissionId: string }>(list: T[]) =>
    list.map((r) => ({ ...r, id: undefined, submissionId: id }));
  if (changed.has("otherActivities")) {
    await tx.submissionActivity.deleteMany(owned);
    await tx.submissionActivity.createMany({
      data: filing.otherActivities.map((a) => ({ ...a, submissionId: id })),
    });
  }
  if (changed.has("licences")) {
    await tx.submissionLicence.deleteMany(owned);
    await tx.submissionLicence.createMany({ data: rows(filing.licences) });
  }
  if (changed.has("shareholders")) {
    await tx.submissionShareholder.deleteMany(owned);
    await tx.submissionShareholder.createMany({ data: rows(filing.shareholders) });
  }
  if (changed.has("directors")) {
    await tx.submissionDirector.deleteMany(owned);
    await tx.submissionDirector.createMany({ data: rows(filing.directors) });
  }
  if (changed.has("confidentialityClaims")) {
    await tx.submissionConfidentiality.deleteMany(owned);
    await tx.submissionConfidentiality.createMany({ data: rows(filing.confidentialityClaims) });
  }
  if (changed.has("hseIncidents")) {
    await tx.submissionHseIncident.deleteMany(owned);
    await tx.submissionHseIncident.createMany({ data: rows(filing.hseIncidents) });
  }

  const what =
    filing.filingType === "ANNUAL"
      ? `Annual confirmation ${yearOf(toIsoDate(filing.dateSubmitted))} accepted`
      : `${FILING_LABELS[filing.filingType]} approved`;
  await writeAudit(tx, {
    userId: actor.id,
    action: filing.filingType === "ANNUAL" ? "Annual confirmation accepted" : "Changes applied",
    reference: registered.ackNo,
    detail:
      `${what} (${filing.ackNo}) on ${formatDate(today)}: ` +
      (changes.length ? describeChanges(changes) : "no changes") +
      (reissue ? "; certificate needs reissue" : ""),
  });
  return { registered, changes, reissue };
}
