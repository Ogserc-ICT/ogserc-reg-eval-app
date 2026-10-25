import { can } from "@/domain/roles";
import { serviceAreaText } from "@/domain/certificate";
import { STATUS } from "@/domain/types";
import { loadContext } from "./context";
import { ForbiddenError } from "./errors";
import { loadEvaluationState } from "./evaluation-state";
import { OWN_USE_CATEGORY } from "@/domain/own-use";
import { toIsoDate } from "./reference-data";
import type { Actor, Db } from "./types";

export type Verdict = "current" | "provisional" | "not-valid" | "not-registered";

/**
 * What the certificate QR code leads to (internal; staff sign in): the registration as the Register
 * holds it now, and every certificate version issued, so a reissued or cancelled certificate shows.
 */
export async function getVerification(db: Db, actor: Actor, submissionId: string) {
  if (!can(actor.roles, "records.read")) throw new ForbiddenError();
  const ctx = await loadContext(db);
  const state = await loadEvaluationState(db, submissionId, ctx);
  if (!state) return null;
  const { sub, assessment: a, row } = state;
  const certificates = await db.generatedDocument.findMany({
    where: { submissionId, kind: "CERTIFICATE" },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      createdAt: true,
      supersededAt: true,
      note: true,
      sha256: true,
    },
  });
  const verdict: Verdict =
    sub.status === STATUS.REGISTERED && sub.registrationNo
      ? "current"
      : sub.status === STATUS.PROVISIONAL
        ? "provisional"
        : sub.status === STATUS.CANCELLED ||
            sub.status === STATUS.REFUSED ||
            sub.status === STATUS.LAPSED
          ? "not-valid"
          : "not-registered";
  return {
    id: submissionId,
    verdict,
    status: sub.status!,
    registrationNo: a.registrationNoInUse,
    name: sub.registeredName!,
    cacNo: sub.cacNo,
    category: a.categoryApplied ? `${a.categoryApplied} — ${a.categoryDescription ?? ""}` : null,
    primaryActivity: sub.primaryActivity,
    area: serviceAreaText(sub),
    certificateIssueDate: sub.certificateIssueDate,
    certificateNeedsReissue: row.certificateNeedsReissue,
    certificates,
  };
}

export type Verification = NonNullable<Awaited<ReturnType<typeof getVerification>>>;

/** The same for an own-use notification registered with a certificate (REG-01I). */
export async function getOwnUseVerification(
  db: Db,
  actor: Actor,
  id: string,
): Promise<Verification | null> {
  if (!can(actor.roles, "records.read")) throw new ForbiddenError();
  const row = await db.ownUseNotification.findUnique({ where: { id } });
  if (!row) return null;
  const ctx = await loadContext(db);
  const certificates = await db.generatedDocument.findMany({
    where: { ownUseNotificationId: id, kind: "CERTIFICATE" },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      createdAt: true,
      supersededAt: true,
      note: true,
      sha256: true,
    },
  });
  const category = ctx.ref.fees.find((f) => f.category === OWN_USE_CATEGORY);
  return {
    id,
    verdict: row.registrationNo ? "current" : "not-registered",
    status: row.registrationNo ? STATUS.REGISTERED : STATUS.RECEIVED,
    registrationNo: row.registrationNo,
    name: row.name,
    cacNo: row.cacNo,
    category: category ? `${category.category} — ${category.description}` : null,
    primaryActivity: "Own-use generation (Form REG-01I)",
    area: [row.lga, row.siteAddress].filter(Boolean).join("; "),
    certificateIssueDate: toIsoDate(row.certificateIssueDate),
    certificateNeedsReissue: false,
    certificates,
  };
}
