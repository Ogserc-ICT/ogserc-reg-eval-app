import { can } from "@/domain/roles";
import { STATUS } from "@/domain/types";
import { loadContext } from "./context";
import { ForbiddenError } from "./errors";
import { loadEvaluationState } from "./evaluation-state";
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
    area: [sub.principalLga, sub.otherAreasServed].filter(Boolean).join("; "),
    certificateIssueDate: sub.certificateIssueDate,
    certificateNeedsReissue: row.certificateNeedsReissue,
    certificates,
  };
}
