import type { Prisma, Submission } from "@prisma/client";
import { categoryAuto, overrideNeedsReason } from "@/domain/category";
import { daysLate } from "@/domain/deadlines";
import { lateChargeFor } from "@/domain/fees";
import { CONDITION_KEYS, type Conditions } from "@/domain/forms";
import { formatDate } from "@/domain/dates";
import { formatNaira } from "@/domain/money";
import { formatAckNo } from "@/domain/numbers";
import { can } from "@/domain/roles";
import { assessSubmission } from "@/domain/submission";
import { parseTechnical, technicalChanges, type TechnicalData } from "@/domain/technical";
import { FILING_LABELS, STATUS, isClosed, isLinkedFiling } from "@/domain/types";
import { isValidTin } from "@/domain/validation";
import {
  CONDITION_FIELDS,
  documentsSchema,
  intakeSchema,
  submissionSchema,
  waiverSchema,
  type SubmissionFields,
} from "@/lib/schemas";
import { writeAudit } from "./audit";
import { notify, subjectOf } from "./notifications";
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
import {
  CHECK_TO_DB,
  STATUS_FROM_DB,
  conditionsToColumns,
  loadSubmission,
  pricingFromColumns,
} from "./submissions";
import {
  childrenInclude,
  claimsText,
  columnText,
  directorsText,
  incidentsText,
  licencesText,
  shareholdersText,
} from "./submission-text";
import type { Actor, Db, Tx } from "./types";

export const CONFIRM_DUPLICATE_CAC = "confirmDuplicateCac";

type FieldErrors = Record<string, string[]>;

/**
 * Checks that need the database or today's date: list values, activities, LGAs, form filed, TIN
 * format, category override and its reason, and the registration an update links to. Returns the
 * activity names for domain calculations and the linked registration.
 */
async function checkAgainstReferenceData(tx: Tx, v: SubmissionFields, today?: string) {
  const ctx = await loadContext(tx, today);
  const errors: FieldErrors = {};
  const fail = (field: string, message: string) => (errors[field] ??= []).push(message);

  const codes = [v.primaryActivityCode, ...v.otherActivityCodes];
  const [lgas, activities, form, licences, channels, types] = await Promise.all([
    tx.lga.findMany({ select: { name: true } }),
    tx.activity.findMany({ where: { code: { in: codes } } }),
    tx.registrationForm.findUnique({ where: { form: v.formFiled } }),
    loadList(tx, "licence_statuses"),
    loadList(tx, "submission_channels"),
    loadList(tx, "registrant_types"),
  ]);
  const lgaNames = new Set(lgas.map((l) => l.name));
  const activityByCode = new Map(activities.map((a) => [a.code, a]));
  const primary = activityByCode.get(v.primaryActivityCode);
  if (!lgaNames.has(v.principalLga)) fail("principalLga", "Choose an LGA from the list");
  const unknownLgas = v.lgasServed.filter((l) => !lgaNames.has(l));
  if (unknownLgas.length) fail("lgasServed", `Not in the LGA list: ${unknownLgas.join(", ")}`);
  if (!primary) fail("primaryActivityCode", "Choose an activity from the list");
  const unknown = v.otherActivityCodes.filter((c) => !activityByCode.has(c));
  if (unknown.length)
    fail("otherActivityCodes", `Not in the activities list: ${unknown.join(", ")}`);
  if (!form) fail("formFiled", "Choose a form from the list");
  if (!licences.includes(v.licenceStatus))
    fail("licenceStatus", "Choose a licence status from the list");
  if (v.submissionChannel && !channels.includes(v.submissionChannel))
    fail("submissionChannel", "Choose from the list");
  if (v.registrantType && !types.includes(v.registrantType))
    fail("registrantType", "Choose from the list");
  if (v.dateSubmitted > ctx.today) fail("dateSubmitted", "Cannot be in the future");
  if (v.incorporationDate && v.incorporationDate > ctx.today)
    fail("incorporationDate", "Cannot be in the future");
  if (v.tin && !isValidTin(v.tin, ctx.settings.policy.tinPattern))
    fail("tin", "TIN format is not valid");
  const technical = parseTechnical(ctx.ref.technical, v.technicalData);
  for (const e of technical.errors) fail("technicalData", e);

  // Updates and annual confirmations quote the registration number of a Registered record.
  let linked: Submission | null = null;
  if (isLinkedFiling(v.filingType) && v.linkedRegistrationNo) {
    linked = await tx.submission.findFirst({
      where: { registrationNo: v.linkedRegistrationNo, filingType: "NEW" },
    });
    if (!linked) {
      fail("linkedRegistrationNo", "No registered submission has this registration number");
    } else if (linked.status !== "REGISTERED") {
      fail(
        "linkedRegistrationNo",
        `${linked.registrationNo} is ${STATUS_FROM_DB[linked.status]}; only a Registered record can be updated or confirmed`,
      );
    }
  }

  const names = {
    primaryActivity: primary?.name ?? null,
    otherActivities: v.otherActivityCodes
      .map((c) => activityByCode.get(c)?.name)
      .filter((n): n is string => !!n),
  };
  if (v.categoryOverride) {
    const row = ctx.ref.fees.find((f) => f.category === v.categoryOverride);
    if (!row || row.category === "I") {
      fail(
        "categoryOverride",
        "Choose a Schedule 3 category (Category I is for own-use notifications only)",
      );
    } else {
      const auto = categoryAuto(
        { ...names, installedCapacityMw: v.installedCapacityMw },
        ctx.ref,
        ctx.settings.policy,
      );
      if (overrideNeedsReason(v.categoryOverride, auto, v.overrideReason)) {
        fail("overrideReason", `Give a reason for overriding Category ${auto ?? "(none)"}`);
      }
    }
  }

  if (Object.keys(errors).length)
    throw new ValidationError("Please correct the highlighted fields.", errors);
  return { ctx, names, linked, technicalData: technical.data };
}

/**
 * One registration per person (para 11(4)): warn on a CAC number already on the Register. A
 * registration's own updates and annual confirmations (its "family") share its CAC number by design.
 */
async function checkDuplicateCac(
  tx: Tx,
  cacNo: string | null,
  family: string | null,
  exceptId: string | null,
  confirmed: boolean,
) {
  if (!cacNo) return false;
  const familyFilter: Prisma.SubmissionWhereInput[] = family
    ? [
        { id: { not: family } },
        { OR: [{ linkedSubmissionId: null }, { linkedSubmissionId: { not: family } }] },
      ]
    : [];
  const other = await tx.submission.findFirst({
    where: {
      cacNo,
      AND: [...familyFilter, ...(exceptId ? [{ id: { not: exceptId } }] : [])],
    },
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

function conditionsOf(v: SubmissionFields): Conditions {
  const values = v as unknown as Record<string, "Y" | "N" | null>;
  return Object.fromEntries(
    CONDITION_KEYS.map((k) => [k, values[CONDITION_FIELDS[k]] ?? null]),
  ) as Conditions;
}

/** Scalar columns entered at intake (not the filing type or link, which never change). */
function submissionData(v: SubmissionFields) {
  return {
    formFiled: v.formFiled,
    registeredName: v.registeredName,
    tradingName: v.tradingName,
    dateSubmitted: fromIsoDate(v.dateSubmitted),
    submissionChannel: v.submissionChannel,
    registrantType: v.registrantType,
    cacNo: v.cacNo,
    incorporationDate: fromIsoDate(v.incorporationDate),
    tin: v.tin,
    address: v.address,
    operationalAddress: v.operationalAddress,
    website: v.website,
    principalLga: v.principalLga,
    lgasServed: v.lgasServed,
    otherAreasServed: v.otherAreasServed,
    primaryActivityCode: v.primaryActivityCode,
    installedCapacityMw: v.installedCapacityMw,
    customers: v.customers,
    licenceStatus: v.licenceStatus,
    mdName: v.mdName,
    mdPhone: v.mdPhone,
    mdEmail: v.mdEmail,
    complianceOfficer: v.complianceOfficer,
    phone: v.phone,
    email: v.email,
    signatory1Name: v.signatory1Name,
    signatory1Designation: v.signatory1Designation,
    signatory1Date: fromIsoDate(v.signatory1Date),
    signatory2Name: v.signatory2Name,
    signatory2Designation: v.signatory2Designation,
    signatory2Date: fromIsoDate(v.signatory2Date),
    ...conditionsToColumns(conditionsOf(v)),
    operatingOnEffectiveDate: v.operatingOnEffectiveDate === "Y",
    plannedStartDate: fromIsoDate(v.plannedStartDate),
    categoryOverride: v.categoryOverride,
    overrideReason: v.overrideReason,
    remarks: v.remarks,
  } satisfies Partial<Prisma.SubmissionUncheckedCreateInput>;
}

/** The child tables as they will be stored (sortOrder = position on the form). */
function childRows(v: SubmissionFields) {
  return {
    otherActivities: v.otherActivityCodes.map((activityCode, i) => ({
      activityCode,
      sortOrder: i + 1,
    })),
    licences: v.licences.map((l, i) => ({
      sortOrder: i + 1,
      type: l.type,
      issuingAuthority: l.issuingAuthority,
      number: l.number,
      issueDate: fromIsoDate(l.issueDate),
      expiryDate: fromIsoDate(l.expiryDate),
      activityCovered: l.activityCovered,
    })),
    shareholders: v.shareholders.map((h, i) => ({
      sortOrder: i + 1,
      name: h.name,
      nationality: h.nationality,
      percentHolding: h.percentHolding,
      beneficialOwner: h.beneficialOwner === null ? null : h.beneficialOwner === "Y",
    })),
    directors: v.directors.map((d, i) => ({ sortOrder: i + 1, ...d })),
    confidentialityClaims: v.confidentialityClaims.map((c, i) => ({ sortOrder: i + 1, ...c })),
    hseIncidents: v.hseIncidents.map((h, i) => ({
      sortOrder: i + 1,
      date: fromIsoDate(h.date),
      location: h.location,
      type: h.type,
      description: h.description,
    })),
  };
}

type Children = ReturnType<typeof childRows>;

/** Replace a submission's child tables (rows are re-created in form order). */
export async function writeChildren(tx: Tx, submissionId: string, c: Children) {
  const owned = { where: { submissionId } };
  await Promise.all([
    tx.submissionActivity.deleteMany(owned),
    tx.submissionLicence.deleteMany(owned),
    tx.submissionShareholder.deleteMany(owned),
    tx.submissionDirector.deleteMany(owned),
    tx.submissionConfidentiality.deleteMany(owned),
    tx.submissionHseIncident.deleteMany(owned),
  ]);
  const withOwner = <T extends object>(rows: T[]) => rows.map((r) => ({ ...r, submissionId }));
  await Promise.all([
    tx.submissionActivity.createMany({ data: withOwner(c.otherActivities) }),
    tx.submissionLicence.createMany({ data: withOwner(c.licences) }),
    tx.submissionShareholder.createMany({
      data: withOwner(c.shareholders).map((h) => ({
        ...h,
        percentHolding: h.percentHolding === null ? null : h.percentHolding.toString(),
      })),
    }),
    tx.submissionDirector.createMany({ data: withOwner(c.directors) }),
    tx.submissionConfidentiality.createMany({ data: withOwner(c.confidentialityClaims) }),
    tx.submissionHseIncident.createMany({ data: withOwner(c.hseIncidents) }),
  ]);
}

/** The child tables as text, for the audit entry (old → new). */
function childrenText(c: {
  otherActivities: { activityCode: string }[];
  licences: Parameters<typeof licencesText>[0];
  shareholders: Parameters<typeof shareholdersText>[0];
  directors: Parameters<typeof directorsText>[0];
  confidentialityClaims: Parameters<typeof claimsText>[0];
  hseIncidents: Parameters<typeof incidentsText>[0];
}) {
  return {
    otherActivities: columnText(c.otherActivities.map((a) => a.activityCode)),
    licences: licencesText(c.licences),
    shareholders: shareholdersText(c.shareholders),
    directors: directorsText(c.directors),
    confidentialityClaims: claimsText(c.confidentialityClaims),
    hseIncidents: incidentsText(c.hseIncidents),
  };
}

/** §4.1 Save submission (intake): a new registration, an update or an annual confirmation. */
export async function createSubmission(
  db: Db,
  actor: Actor,
  input: unknown,
  /** `today` (Lagos) is for tests; it defaults to the app's clock. */
  opts: { confirmDuplicateCac?: boolean; today?: string } = {},
) {
  if (!can(actor.roles, "submission.create")) throw new ForbiddenError();
  const parsed = intakeSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const v = parsed.data;

  return db.$transaction(async (tx) => {
    const { ctx, names, linked, technicalData } = await checkAgainstReferenceData(
      tx,
      v,
      opts.today,
    );

    if (v.evaluatingOfficerId) {
      const officer = await tx.user.findUnique({ where: { id: v.evaluatingOfficerId } });
      if (!officer?.active || !officer.roles.includes("EVALUATING_OFFICER")) {
        throw new ValidationError("Please correct the highlighted fields.", {
          evaluatingOfficerId: ["Choose an active evaluating officer"],
        });
      }
    }
    const duplicate = await checkDuplicateCac(
      tx,
      v.cacNo,
      linked?.id ?? null,
      null,
      !!opts.confirmDuplicateCac,
    );

    const pricing = await priceNewSubmission(tx, {
      filingType: v.filingType,
      ...names,
      installedCapacityMw: v.installedCapacityMw,
      categoryOverride: v.categoryOverride,
      operatingOnEffectiveDate: v.operatingOnEffectiveDate,
      plannedStartDate: v.plannedStartDate,
    });
    const seq = await nextCounter(tx, COUNTER.ACK);
    const ackNo = formatAckNo(ctx.settings.ackPrefix, v.dateSubmitted, seq);

    const submission = await tx.submission.create({
      data: {
        ...submissionData(v),
        filingType: v.filingType,
        linkedSubmissionId: linked?.id ?? null,
        technicalData: technicalData as object,
        ackSeq: seq,
        ackNo,
        createdById: actor.id,
        ...pricing,
      },
    });
    await writeChildren(tx, submission.id, childRows(v));
    await tx.evaluation.create({
      data: {
        submissionId: submission.id,
        evaluatingOfficerId: v.evaluatingOfficerId,
        // Evaluation starts once Finance has confirmed payment (§4.12), not at intake.
        dateEvaluationStarted: null,
      },
    });

    const extras = [
      isLinkedFiling(v.filingType) &&
        `${FILING_LABELS[v.filingType]} of ${linked!.registrationNo} (${linked!.ackNo})`,
      duplicate && "duplicate CAC confirmed",
      v.evaluatingOfficerId && "evaluating officer assigned",
    ];
    await writeAudit(tx, {
      userId: actor.id,
      action: "New submission",
      reference: ackNo,
      detail: [
        `${v.registeredName} - Category ${pricing.pricedCategory} - Form ${v.formFiled}`,
        ...extras.filter(Boolean),
      ].join("; "),
    });
    if (isLinkedFiling(v.filingType)) {
      await writeAudit(tx, {
        userId: actor.id,
        action: `${FILING_LABELS[v.filingType]} filed`,
        reference: linked!.ackNo,
        detail: `${ackNo}, received ${formatDate(v.dateSubmitted)}`,
      });
    }
    // Nothing to pay (an update or annual confirmation without a fee): released straight away, and
    // the release notifies the evaluator; otherwise Finance is told a payment is awaited.
    const released = await releaseIfCleared(
      tx,
      actor.id,
      submission.id,
      ctx.today,
      "nothing to pay",
    );
    if (!released) {
      await notify(tx, actor.id, {
        kind: "submissionCreated",
        sub: subjectOf({
          row: submission,
          evaluation: {
            evaluatingOfficerId: v.evaluatingOfficerId,
            reviewingSupervisorId: null,
            approvingOfficerId: null,
          },
        }),
      });
    }
    return submission;
  });
}

// --- Editing -----------------------------------------------------------------

const FIELD_LABELS: Record<keyof ReturnType<typeof submissionData>, string> = {
  formFiled: "form filed",
  registeredName: "registered name",
  tradingName: "trading name",
  dateSubmitted: "date submitted",
  submissionChannel: "channel",
  registrantType: "registrant type",
  cacNo: "CAC no.",
  incorporationDate: "date of incorporation",
  tin: "TIN",
  address: "address",
  operationalAddress: "operational address",
  website: "website",
  principalLga: "principal LGA",
  lgasServed: "LGAs served",
  otherAreasServed: "towns / estates served",
  primaryActivityCode: "primary activity",
  installedCapacityMw: "capacity (MW)",
  customers: "customers",
  licenceStatus: "licence status",
  mdName: "managing director",
  mdPhone: "MD phone",
  mdEmail: "MD email",
  complianceOfficer: "compliance officer",
  phone: "phone",
  email: "email",
  signatory1Name: "signatory 1",
  signatory1Designation: "signatory 1 designation",
  signatory1Date: "signatory 1 date",
  signatory2Name: "signatory 2",
  signatory2Designation: "signatory 2 designation",
  signatory2Date: "signatory 2 date",
  holdsAnyLicence: "holds any licence",
  multiStateLicensee: "multi-State licensee",
  generationForSale: "generation for sale",
  gridConnected: "grid connected",
  interconnectedMinigrid: "interconnected mini-grid",
  fDistribution: "Part 1 distribution",
  fTrading: "Part 2 trading",
  gDiscoBulkSupply: "DisCo bulk supply",
  subFranchise: "sub-franchisee",
  operatingOnEffectiveDate: "operating on Effective Date",
  plannedStartDate: "planned start",
  categoryOverride: "category override",
  overrideReason: "override reason",
  remarks: "remarks",
};

const CHILD_LABELS: Record<keyof ReturnType<typeof childrenText>, string> = {
  otherActivities: "other activities",
  licences: "licences",
  shareholders: "shareholders",
  directors: "directors",
  confidentialityClaims: "confidentiality claims",
  hseIncidents: "HSE incidents",
};

async function findSubmission(tx: Tx, id: string) {
  const row = await tx.submission.findUnique({ where: { id }, include: childrenInclude });
  if (!row) throw new NotFoundError("Submission not found.");
  return row;
}

/** Fields printed on the certificate (SPEC §7). Changing one on a Registered record needs a reissue. */
const CERTIFICATE_FIELDS = new Set<string>([
  "registeredName",
  "cacNo",
  "address",
  "primaryActivityCode",
  "otherActivities",
  "principalLga",
  "lgasServed",
  "otherAreasServed",
  "licenceStatus",
  "licences",
]);

/**
 * Who may change a submission (docs/DECISIONS.md): while open, the role's `permission`; once closed
 * (Registered, Refused, Lapsed, Cancelled, Changes Applied), only Admin, with a written reason.
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
 * "pricing out of date" until an admin recalculates (docs/DECISIONS.md). The filing type and the
 * registration an update links to never change.
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
    if (v.filingType !== current.filingType) {
      throw new ValidationError("Please correct the highlighted fields.", {
        filingType: ["The filing type cannot change once saved; file a new submission instead"],
      });
    }
    // The link is fixed (DB trigger); the form only shows it, so it is not looked up again.
    const { ctx, technicalData } = await checkAgainstReferenceData(tx, {
      ...v,
      linkedRegistrationNo: null,
    });
    const duplicate =
      v.cacNo !== current.cacNo &&
      (await checkDuplicateCac(
        tx,
        v.cacNo,
        current.linkedSubmissionId ?? current.id,
        id,
        !!opts.confirmDuplicateCac,
      ));

    const next = submissionData(v);
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (k) => columnText(current[k]) !== columnText(next[k]),
    );
    const changes = changed.map(
      (k) =>
        `${FIELD_LABELS[k]}: ${columnText(current[k]) ?? "(blank)"} → ${columnText(next[k]) ?? "(blank)"}`,
    );
    const children = childRows(v);
    const before = childrenText(current);
    const after = childrenText(children);
    const changedChildren = (Object.keys(after) as (keyof typeof after)[]).filter(
      (k) => before[k] !== after[k],
    );
    for (const k of changedChildren) {
      changes.push(`${CHILD_LABELS[k]}: ${before[k] ?? "(none)"} → ${after[k] ?? "(none)"}`);
    }
    const technical = technicalChanges(
      ctx.ref.technical,
      current.technicalData as unknown as TechnicalData,
      technicalData,
    );
    for (const c of technical) {
      changes.push(`${c.label}: ${c.before ?? "(blank)"} → ${c.after ?? "(blank)"}`);
    }
    if (!changes.length) return current;

    // A Registered record's certificate shows these fields; changing one means the certificate must be reissued.
    const reissue =
      status === STATUS.REGISTERED &&
      [...changed, ...changedChildren].some((k) => CERTIFICATE_FIELDS.has(k));
    const updated = await tx.submission.update({
      where: { id },
      data: {
        ...next,
        ...(technical.length ? { technicalData: technicalData as object } : {}),
        ...(reissue ? { certificateNeedsReissue: true } : {}),
      },
    });
    if (changedChildren.length) await writeChildren(tx, id, children);
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

/**
 * Document checklist (SPEC §1.2) for the submission's form. `input` maps document key → "Y" | "N" |
 * "N/A" | "" (blank). Items that are automatic (evidence of payment) or N/A by their condition
 * cannot be set; keys not on the submission's list are refused.
 */
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
    const ctx = await loadContext(tx);
    const loaded = await loadSubmission(tx, id);
    const a = assessSubmission(loaded!.sub, loaded!.payments, ctx);
    const items = new Map(a.documents.items.map((d) => [d.key, d]));

    const changes: string[] = [];
    const locked: string[] = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      const item = items.get(key);
      if (!item) throw new ValidationError(`"${key}" is not on this submission's checklist.`);
      const old = loaded!.sub.documents[key] ?? "";
      if (item.mode !== "manual") {
        if ((item.value ?? "") !== value) locked.push(item.text);
        continue;
      }
      if (old === value) continue;
      changes.push(`${item.text}: ${old || "blank"} → ${value || "blank"}`);
      const where = { submissionId_documentKey: { submissionId: id, documentKey: key } };
      if (value === "")
        await tx.documentChecklistItem.deleteMany({ where: where.submissionId_documentKey });
      else {
        await tx.documentChecklistItem.upsert({
          where,
          create: { submissionId: id, documentKey: key, value: CHECK_TO_DB[value] },
          update: { value: CHECK_TO_DB[value] },
        });
      }
    }
    if (locked.length) {
      throw new ValidationError(
        `These items are set automatically and cannot be changed: ${locked.join("; ")}.`,
      );
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
