import type { Prisma, Submission } from "@prisma/client";
import { categoryAuto, overrideNeedsReason } from "@/domain/category";
import { daysLate } from "@/domain/deadlines";
import { lateChargeFor } from "@/domain/fees";
import { formatDate } from "@/domain/dates";
import { formatNaira } from "@/domain/money";
import { formatAckNo } from "@/domain/numbers";
import { can } from "@/domain/roles";
import { STATUS, isClosed } from "@/domain/types";
import { isValidTin } from "@/domain/validation";
import {
  documentsSchema,
  intakeSchema,
  submissionSchema,
  waiverSchema,
  type SubmissionFields,
} from "@/lib/schemas";
import { writeAudit } from "./audit";
import { loadContext } from "./context";
import { COUNTER, nextCounter } from "./counters";
import {
  ConfirmationRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { releaseIfCleared } from "./finance";
import { priceNewSubmission } from "./pricing";
import { fromIsoDate, koboToNumber, loadList, toIsoDate } from "./reference-data";
import { STATUS_FROM_DB, pricingFromColumns } from "./submissions";
import type { Actor, Db, Tx } from "./types";

export const CONFIRM_DUPLICATE_CAC = "confirmDuplicateCac";

type FieldErrors = Record<string, string[]>;

/**
 * Checks that need the database or today's date: list values, activities, LGA, TIN format,
 * category override and its reason. Returns the activity names for domain calculations.
 */
async function checkAgainstReferenceData(tx: Tx, v: SubmissionFields) {
  const ctx = await loadContext(tx);
  const errors: FieldErrors = {};
  const fail = (field: string, message: string) => (errors[field] ??= []).push(message);

  const [lga, primary, secondary, licences, channels, types] = await Promise.all([
    tx.lga.findUnique({ where: { name: v.principalLga } }),
    tx.activity.findUnique({ where: { code: v.primaryActivityCode } }),
    v.secondaryActivityCode
      ? tx.activity.findUnique({ where: { code: v.secondaryActivityCode } })
      : null,
    loadList(tx, "licence_statuses"),
    loadList(tx, "submission_channels"),
    loadList(tx, "registrant_types"),
  ]);
  if (!lga) fail("principalLga", "Choose an LGA from the list");
  if (!primary) fail("primaryActivityCode", "Choose an activity from the list");
  if (v.secondaryActivityCode && !secondary)
    fail("secondaryActivityCode", "Choose an activity from the list");
  if (!licences.includes(v.licenceStatus))
    fail("licenceStatus", "Choose a licence status from the list");
  if (v.submissionChannel && !channels.includes(v.submissionChannel))
    fail("submissionChannel", "Choose from the list");
  if (v.registrantType && !types.includes(v.registrantType))
    fail("registrantType", "Choose from the list");
  if (v.dateSubmitted > ctx.today) fail("dateSubmitted", "Cannot be in the future");
  if (v.tin && !isValidTin(v.tin, ctx.settings.policy.tinPattern))
    fail("tin", "TIN format is not valid");

  const names = {
    primaryActivity: primary?.name ?? null,
    secondaryActivity: secondary?.name ?? null,
  };
  if (v.categoryOverride) {
    const row = ctx.ref.fees.find((f) => f.category === v.categoryOverride);
    if (!row || row.category === "I") {
      fail(
        "categoryOverride",
        "Choose a Schedule 3 category (Category I is for own-use notifications only)",
      );
    } else {
      const auto = categoryAuto({ ...names, installedCapacityMw: v.installedCapacityMw }, ctx.ref);
      if (overrideNeedsReason(v.categoryOverride, auto, v.overrideReason)) {
        fail("overrideReason", `Give a reason for overriding Category ${auto ?? "(none)"}`);
      }
    }
  }

  if (Object.keys(errors).length)
    throw new ValidationError("Please correct the highlighted fields.", errors);
  return { ctx, names };
}

/** One registration per person (para 11(4)): warn on a CAC number already on the Register. */
async function checkDuplicateCac(
  tx: Tx,
  cacNo: string | null,
  exceptId: string | null,
  confirmed: boolean,
) {
  if (!cacNo) return false;
  const other = await tx.submission.findFirst({
    where: { cacNo, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { ackNo: true, registeredName: true },
  });
  if (!other) return false;
  if (!confirmed) {
    throw new ConfirmationRequiredError(
      CONFIRM_DUPLICATE_CAC,
      `CAC number ${cacNo} is already on the Register (${other.ackNo}, ${other.registeredName}). ` +
        "One registration per person (para 11(4)). Save anyway?",
    );
  }
  return true;
}

function submissionData(v: SubmissionFields) {
  return {
    registeredName: v.registeredName,
    dateSubmitted: fromIsoDate(v.dateSubmitted),
    submissionChannel: v.submissionChannel,
    registrantType: v.registrantType,
    cacNo: v.cacNo,
    tin: v.tin,
    address: v.address,
    principalLga: v.principalLga,
    otherAreasServed: v.otherAreasServed,
    primaryActivityCode: v.primaryActivityCode,
    secondaryActivityCode: v.secondaryActivityCode,
    installedCapacityMw: v.installedCapacityMw,
    customers: v.customers,
    licenceStatus: v.licenceStatus,
    licenceNo: v.licenceNo,
    licenceExpiry: fromIsoDate(v.licenceExpiry),
    complianceOfficer: v.complianceOfficer,
    phone: v.phone,
    email: v.email,
    operatingOnEffectiveDate: v.operatingOnEffectiveDate === "Y",
    plannedStartDate: fromIsoDate(v.plannedStartDate),
    categoryOverride: v.categoryOverride,
    overrideReason: v.overrideReason,
    remarks: v.remarks,
  } satisfies Partial<Prisma.SubmissionUncheckedCreateInput>;
}

/** §4.1 Save submission (intake). */
export async function createSubmission(
  db: Db,
  actor: Actor,
  input: unknown,
  opts: { confirmDuplicateCac?: boolean } = {},
) {
  if (!can(actor.roles, "submission.create")) throw new ForbiddenError();
  const parsed = intakeSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const v = parsed.data;

  return db.$transaction(async (tx) => {
    const { ctx, names } = await checkAgainstReferenceData(tx, v);

    if (v.evaluatingOfficerId) {
      const officer = await tx.user.findUnique({ where: { id: v.evaluatingOfficerId } });
      if (!officer?.active || !officer.roles.includes("EVALUATING_OFFICER")) {
        throw new ValidationError("Please correct the highlighted fields.", {
          evaluatingOfficerId: ["Choose an active evaluating officer"],
        });
      }
    }
    const duplicate = await checkDuplicateCac(tx, v.cacNo, null, !!opts.confirmDuplicateCac);

    const pricing = await priceNewSubmission(tx, {
      ...names,
      installedCapacityMw: v.installedCapacityMw,
      categoryOverride: v.categoryOverride,
      operatingOnEffectiveDate: v.operatingOnEffectiveDate,
      plannedStartDate: v.plannedStartDate,
    });
    const seq = await nextCounter(tx, COUNTER.ACK);
    const ackNo = formatAckNo(ctx.settings.ackPrefix, v.dateSubmitted, seq);

    const submission = await tx.submission.create({
      data: { ...submissionData(v), ackSeq: seq, ackNo, createdById: actor.id, ...pricing },
    });
    await tx.evaluation.create({
      data: {
        submissionId: submission.id,
        evaluatingOfficerId: v.evaluatingOfficerId,
        // Evaluation starts once Finance has confirmed payment (§4.12), not at intake.
        dateEvaluationStarted: null,
      },
    });

    const extras = [
      duplicate && "duplicate CAC confirmed",
      v.evaluatingOfficerId && "evaluating officer assigned",
    ];
    await writeAudit(tx, {
      userId: actor.id,
      action: "New submission",
      reference: ackNo,
      detail: [
        `${v.registeredName} - Category ${pricing.pricedCategory}`,
        ...extras.filter(Boolean),
      ].join("; "),
    });
    return submission;
  });
}

// --- Editing -----------------------------------------------------------------

type Shown = string | null;
const show = (v: unknown): Shown => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return formatDate(toIsoDate(v));
  if (typeof v === "boolean") return v ? "Y" : "N";
  if (typeof v === "object" && "toNumber" in (v as object))
    return String((v as { toNumber(): number }).toNumber());
  return String(v);
};

const FIELD_LABELS: Record<keyof ReturnType<typeof submissionData>, string> = {
  registeredName: "registered name",
  dateSubmitted: "date submitted",
  submissionChannel: "channel",
  registrantType: "registrant type",
  cacNo: "CAC no.",
  tin: "TIN",
  address: "address",
  principalLga: "principal LGA",
  otherAreasServed: "other areas",
  primaryActivityCode: "primary activity",
  secondaryActivityCode: "secondary activity",
  installedCapacityMw: "capacity (MW)",
  customers: "customers",
  licenceStatus: "licence status",
  licenceNo: "licence no.",
  licenceExpiry: "licence expiry",
  complianceOfficer: "compliance officer",
  phone: "phone",
  email: "email",
  operatingOnEffectiveDate: "operating on Effective Date",
  plannedStartDate: "planned start",
  categoryOverride: "category override",
  overrideReason: "override reason",
  remarks: "remarks",
};

async function findSubmission(tx: Tx, id: string): Promise<Submission> {
  const row = await tx.submission.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("Submission not found.");
  return row;
}

/** Fields printed on the certificate (SPEC §7). Changing one on a Registered record needs a reissue. */
const CERTIFICATE_FIELDS = new Set<string>([
  "registeredName",
  "cacNo",
  "address",
  "primaryActivityCode",
  "secondaryActivityCode",
  "principalLga",
  "otherAreasServed",
  "licenceStatus",
  "licenceNo",
]);

/**
 * Who may change a submission (docs/DECISIONS.md): while open, the role's `permission`; once closed
 * (Registered, Refused, Lapsed, Cancelled), only Admin, with a written reason.
 */
function authorizeEdit(
  actor: Actor,
  row: Submission,
  permission: Parameters<typeof can>[1],
  changeReason: string | null | undefined,
) {
  const status = STATUS_FROM_DB[row.status];
  const reason = changeReason?.trim() || null;
  if (!isClosed(status)) {
    if (!can(actor.roles, permission)) throw new ForbiddenError();
    return { closed: false, status, reason };
  }
  if (!can(actor.roles, "submission.editClosed")) {
    throw new ForbiddenError(`This submission is ${status}. Only an administrator can change it.`);
  }
  if (!reason || reason.length < 5) {
    throw new ValidationError("Give a reason for changing a closed submission.", {
      changeReason: ["Required for a closed submission (at least 5 characters)"],
    });
  }
  return { closed: true, status, reason };
}

const withReason = (detail: string, reason: string | null) =>
  reason ? `${detail}. Reason: ${reason}` : detail;

/**
 * Edit intake fields. Pricing is not re-taken: if a change affects it, the record shows
 * "pricing out of date" until an admin recalculates (docs/DECISIONS.md).
 */
export async function updateSubmission(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: { confirmDuplicateCac?: boolean; changeReason?: string | null } = {},
) {
  if (!can(actor.roles, "submission.edit") && !can(actor.roles, "submission.editClosed")) {
    throw new ForbiddenError();
  }
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const v = parsed.data;

  return db.$transaction(async (tx) => {
    const current = await findSubmission(tx, id);
    const { status, reason } = authorizeEdit(actor, current, "submission.edit", opts.changeReason);
    await checkAgainstReferenceData(tx, v);
    const duplicate =
      v.cacNo !== current.cacNo &&
      (await checkDuplicateCac(tx, v.cacNo, id, !!opts.confirmDuplicateCac));

    const next = submissionData(v);
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (k) => show(current[k]) !== show(next[k]),
    );
    const changes = changed.map(
      (k) => `${FIELD_LABELS[k]}: ${show(current[k]) ?? "(blank)"} → ${show(next[k]) ?? "(blank)"}`,
    );
    if (!changes.length) return current;

    // A Registered record's certificate shows these fields; changing one means the certificate must be reissued.
    const reissue = status === STATUS.REGISTERED && changed.some((k) => CERTIFICATE_FIELDS.has(k));
    const updated = await tx.submission.update({
      where: { id },
      data: { ...next, ...(reissue ? { certificateNeedsReissue: true } : {}) },
    });
    const notes = [
      ...(duplicate ? ["duplicate CAC confirmed"] : []),
      ...(reissue ? ["certificate needs reissue"] : []),
    ];
    await writeAudit(tx, {
      userId: actor.id,
      action: "Submission updated",
      reference: current.ackNo,
      detail: withReason([...changes, ...notes].join("; "), reason),
    });
    return updated;
  });
}

const CHECK_TO_DB = { Y: "Y", N: "N", "N/A": "NA" } as const;

/** Schedule 2 checklist (SPEC §1.2). `input` maps item number → "Y" | "N" | "N/A" | "" (blank). */
export async function updateDocuments(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: { changeReason?: string | null } = {},
) {
  const parsed = documentsSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);

  return db.$transaction(async (tx) => {
    const current = await findSubmission(tx, id);
    const { reason } = authorizeEdit(actor, current, "documents.edit", opts.changeReason);
    const docs = await tx.schedule2Document.findMany({ orderBy: { number: "asc" } });
    const existing = await tx.documentChecklistItem.findMany({ where: { submissionId: id } });
    const before = new Map(
      existing.map((d) => [d.documentNumber, d.value === "NA" ? "N/A" : d.value]),
    );

    const changes: string[] = [];
    for (const doc of docs) {
      const value = parsed.data[String(doc.number)];
      if (value === undefined) continue;
      const old = before.get(doc.number) ?? "";
      if (old === value) continue;
      changes.push(`${doc.name}: ${old || "blank"} → ${value || "blank"}`);
      const key = { submissionId_documentNumber: { submissionId: id, documentNumber: doc.number } };
      if (value === "") await tx.documentChecklistItem.delete({ where: key });
      else {
        await tx.documentChecklistItem.upsert({
          where: key,
          create: { submissionId: id, documentNumber: doc.number, value: CHECK_TO_DB[value] },
          update: { value: CHECK_TO_DB[value] },
        });
      }
    }
    if (changes.length) {
      await writeAudit(tx, {
        userId: actor.id,
        action: "Documents updated",
        reference: current.ackNo,
        detail: withReason(changes.join("; "), reason),
      });
    }
    return changes.length;
  });
}

/** Approved waiver or reduction (para 17(3)): Finance or Admin, with the written approval as reason. */
export async function setWaiver(db: Db, actor: Actor, id: string, input: unknown) {
  const parsed = waiverSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { amount, reason } = parsed.data;

  return db.$transaction(async (tx) => {
    const current = await findSubmission(tx, id);
    // The waiver's own reason (the written approval) also serves as the closed-record reason.
    authorizeEdit(actor, current, "fees.waiver", reason);
    const ctx = await loadContext(tx);
    const pricing = pricingFromColumns(current);
    const late = lateChargeFor(
      pricing,
      daysLate(toIsoDate(current.dateSubmitted), pricing.deadline),
    );
    const max = ctx.settings.policy.waiverAppliesToLateCharge
      ? pricing.registrationFee + late
      : pricing.registrationFee;
    if (amount > max) {
      throw new ValidationError("Please correct the highlighted fields.", {
        amount: [`Cannot exceed ${formatNaira(max)}`],
      });
    }
    const old = koboToNumber(current.approvedWaiver);
    if (old === amount) return current;
    const updated = await tx.submission.update({
      where: { id },
      data: { approvedWaiver: BigInt(amount) },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Waiver set",
      reference: current.ackNo,
      detail: `${formatNaira(old)} → ${formatNaira(amount)}. Reason: ${reason}`,
    });
    // §4.12: a waiver lowers what release requires; confirmed payments may now clear the gate.
    await releaseIfCleared(tx, actor.id, id, ctx.today, "waiver set");
    return updated;
  });
}
