import type { OwnUseDocumentItem, OwnUseNotification, OwnUseUnit, Prisma } from "@prisma/client";
import { z } from "zod";
import { formatDate, yearOf } from "@/domain/dates";
import { formatNaira } from "@/domain/money";
import { formatOunNo } from "@/domain/numbers";
import {
  OWN_USE_MAX_KW,
  assessOwnUse,
  checkOwnUseCapacity,
  ownUseEligibility,
  ownUseRegistrationBlockers,
  ownUseRegistrationNo,
  priceOwnUse,
  sameSite,
  totalCapacityKw,
  type OwnUseInput,
  type OwnUseUnitInput,
} from "@/domain/own-use";
import { can } from "@/domain/roles";
import { documentsSchema, ownUseSchema, reasonSchema, type OwnUseFields } from "@/lib/schemas";
import { writeAudit } from "./audit";
import { notify } from "./notifications";
import { appToday } from "./clock";
import { loadContext } from "./context";
import { COUNTER, nextCounter } from "./counters";
import {
  BlockedError,
  ConfirmationRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { storeOwnUseCertificate } from "./documents";
import { fromIsoDate, koboToNumber, loadList, toIsoDate } from "./reference-data";
import { CHECK_FROM_DB, CHECK_TO_DB, paymentFromRow } from "./submissions";
import type { Actor, Db, Tx } from "./types";

export const CONFIRM_BELOW_THRESHOLD = "confirmBelowThreshold";
export const CONFIRM_SAME_SITE = "confirmSameSite";

type OwnUseRow = OwnUseNotification & {
  units: OwnUseUnit[];
  documents: Pick<OwnUseDocumentItem, "documentKey" | "value">[];
};

const ownUseInclude = {
  units: { orderBy: { sortOrder: "asc" } },
  documents: true,
} as const satisfies Prisma.OwnUseNotificationInclude;

export function unitFromRow(u: OwnUseUnit): OwnUseUnitInput {
  return {
    makeModel: u.makeModel,
    capacityKw: u.capacityKw.toNumber(),
    fuel: u.fuel,
    avgMonthlyMwh: u.avgMonthlyMwh === null ? null : u.avgMonthlyMwh.toNumber(),
  };
}

export function ownUseFromRow(row: OwnUseRow): OwnUseInput {
  return {
    id: row.id,
    ounNo: row.ounNo,
    name: row.name,
    dateFiled: toIsoDate(row.dateFiled),
    cacNo: row.cacNo,
    siteAddress: row.siteAddress,
    lga: row.lga,
    units: row.units.map(unitFromRow),
    documents: Object.fromEntries(
      row.documents.map((d) => [d.documentKey, CHECK_FROM_DB[d.value]]),
    ),
    pricing: { fee: koboToNumber(row.pricedFee), thresholdKw: row.pricedThresholdKw },
    registrationNo: row.registrationNo,
    certificateIssueDate: toIsoDate(row.certificateIssueDate),
  };
}

/** Validation that needs the DB, Settings or today; the capacity rules of §4.3 on the units' total. */
async function checkOwnUse(
  tx: Tx,
  v: OwnUseFields,
  exceptId: string | null,
  opts: { confirmBelowThreshold?: boolean; confirmSameSite?: boolean },
) {
  const ctx = await loadContext(tx);
  const errors: Record<string, string[]> = {};
  const [lga, fuels] = await Promise.all([
    tx.lga.findUnique({ where: { name: v.lga } }),
    loadList(tx, "fuel_technologies"),
  ]);
  if (!lga) errors.lga = ["Choose an LGA from the list"];
  const badFuel = v.units.findIndex((u) => u.fuel && !fuels.includes(u.fuel));
  if (badFuel >= 0) errors.units = [`Row ${badFuel + 1}: choose a fuel / technology from the list`];
  if (v.dateFiled > ctx.today) errors.dateFiled = ["Cannot be in the future"];

  const totalKw = totalCapacityKw(v.units) ?? 0;
  const capacity = checkOwnUseCapacity(totalKw, ctx.settings);
  if (capacity.outcome === "reject") {
    (errors.units ??= []).push(
      `Total ${totalKw} kW: ${OWN_USE_MAX_KW} kW or more – ${capacity.message}`,
    );
  }
  if (Object.keys(errors).length) {
    throw new ValidationError("Please correct the highlighted fields.", errors);
  }
  if (capacity.outcome === "confirm" && !opts.confirmBelowThreshold) {
    throw new ConfirmationRequiredError(
      CONFIRM_BELOW_THRESHOLD,
      `Total ${totalKw} kW. ${capacity.message}. Record it anyway?`,
    );
  }
  // One notification per site: warn on the same CAC number at the same site address.
  const candidates = v.cacNo
    ? await tx.ownUseNotification.findMany({
        where: { cacNo: v.cacNo, ...(exceptId ? { id: { not: exceptId } } : {}) },
        select: { id: true, ounNo: true, cacNo: true, siteAddress: true },
      })
    : [];
  const same = candidates.find((o) => sameSite(o, v));
  if (same && !opts.confirmSameSite) {
    throw new ConfirmationRequiredError(
      CONFIRM_SAME_SITE,
      `${same.ounNo} already notifies this CAC number at this site address (one notification per site). Record it anyway?`,
    );
  }
  return { ctx, belowThreshold: capacity.outcome === "confirm", totalKw, sameSite: !!same };
}

function ownUseData(v: OwnUseFields) {
  return {
    name: v.name,
    dateFiled: fromIsoDate(v.dateFiled),
    cacNo: v.cacNo,
    siteAddress: v.siteAddress,
    lga: v.lga,
    natureOfBusiness: v.natureOfBusiness,
    gridConnected: v.gridConnected,
    distributionLicensee: v.distributionLicensee,
    contactPerson: v.contactPerson,
    phone: v.phone,
    email: v.email,
  } satisfies Partial<Prisma.OwnUseNotificationUncheckedCreateInput>;
}

const unitRows = (v: OwnUseFields) =>
  v.units.map((u, i) => ({
    sortOrder: i + 1,
    makeModel: u.makeModel,
    capacityKw: String(u.capacityKw),
    fuel: u.fuel,
    avgMonthlyMwh: u.avgMonthlyMwh === null ? null : String(u.avgMonthlyMwh),
  }));

/** "Cummins C500, 400 kW, Diesel, 120 MWh/month; …" for audit entries. */
function unitsText(units: readonly OwnUseUnitInput[]): string {
  return (
    units
      .map((u) =>
        [
          u.makeModel,
          `${u.capacityKw} kW`,
          u.fuel,
          u.avgMonthlyMwh !== null ? `${u.avgMonthlyMwh} MWh/month` : null,
        ]
          .filter(Boolean)
          .join(", "),
      )
      .join("; ") || "(none)"
  );
}

/** §4.3 Save own-use notification (Form REG-01I, one per site). */
export async function createOwnUse(
  db: Db,
  actor: Actor,
  input: unknown,
  opts: { confirmBelowThreshold?: boolean; confirmSameSite?: boolean } = {},
) {
  if (!can(actor.roles, "ownUse.create")) throw new ForbiddenError();
  const parsed = ownUseSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const v = parsed.data;

  return db.$transaction(async (tx) => {
    const { ctx, belowThreshold, totalKw, sameSite } = await checkOwnUse(tx, v, null, opts);
    const pricing = priceOwnUse(totalKw, ctx.ref, ctx.settings);
    const seq = await nextCounter(tx, COUNTER.OUN);
    const ounNo = formatOunNo(ctx.settings.ounPrefix, v.dateFiled, seq);
    const row = await tx.ownUseNotification.create({
      data: {
        ...ownUseData(v),
        ounSeq: seq,
        ounNo,
        pricedFee: BigInt(pricing.fee),
        pricedThresholdKw: pricing.thresholdKw,
        createdById: actor.id,
        units: { create: unitRows(v) },
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Own-use notification",
      reference: ounNo,
      detail:
        `${v.name} - Form REG-01I - ${totalKw} kW (${v.units.length} unit(s)) - ${ownUseEligibility(totalKw, ctx.settings)}` +
        ` - fee ${formatNaira(pricing.fee)}` +
        (belowThreshold ? "; below threshold confirmed" : "") +
        (sameSite ? "; same CAC and site address as another notification confirmed" : ""),
    });
    await notify(tx, actor.id, {
      kind: "ownUseCreated",
      id: row.id,
      ounNo,
      name: v.name,
      fee: pricing.fee,
    });
    return row;
  });
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "(blank)";
  if (v instanceof Date) return formatDate(toIsoDate(v));
  if (typeof v === "boolean") return v ? "Y" : "N";
  return String(v);
};

/** Edit an own-use notification. The fee is not re-taken; an admin recalculates if needed. */
export async function updateOwnUse(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: { confirmBelowThreshold?: boolean; confirmSameSite?: boolean } = {},
) {
  if (!can(actor.roles, "ownUse.create")) throw new ForbiddenError();
  const parsed = ownUseSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const v = parsed.data;

  return db.$transaction(async (tx) => {
    const current = await tx.ownUseNotification.findUnique({
      where: { id },
      include: ownUseInclude,
    });
    if (!current) throw new NotFoundError("Own-use notification not found.");
    if (current.registrationNo) {
      throw new ValidationError(
        `Registered as ${current.registrationNo}; its details are printed on the certificate and cannot change.`,
      );
    }
    await checkOwnUse(tx, v, id, opts);
    const next = ownUseData(v);
    const changes = (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => show(current[k]) !== show(next[k]))
      .map((k) => `${k}: ${show(current[k])} → ${show(next[k])}`);
    const before = unitsText(current.units.map(unitFromRow));
    const after = unitsText(v.units);
    if (before !== after) changes.push(`generator units: ${before} → ${after}`);
    if (!changes.length) return current;
    const updated = await tx.ownUseNotification.update({ where: { id }, data: next });
    if (before !== after) {
      await tx.ownUseUnit.deleteMany({ where: { ownUseNotificationId: id } });
      await tx.ownUseUnit.createMany({
        data: unitRows(v).map((u) => ({ ...u, ownUseNotificationId: id })),
      });
    }
    await writeAudit(tx, {
      userId: actor.id,
      action: "Own-use notification updated",
      reference: current.ounNo,
      detail: changes.join("; "),
    });
    return updated;
  });
}

/** Load one notification with what its assessment needs (other notifications, Register CACs). */
async function assessOne(db: Db | Tx, id: string, today?: string) {
  const ctx = await loadContext(db, today);
  const row = await db.ownUseNotification.findUnique({ where: { id }, include: ownUseInclude });
  if (!row) throw new NotFoundError("Own-use notification not found.");
  const [others, registerCacs, payments] = await Promise.all([
    db.ownUseNotification.findMany({ where: { id: { not: id } }, include: ownUseInclude }),
    db.submission.findMany({ select: { cacNo: true } }),
    db.payment.findMany({ where: { ownUseNotificationId: id } }),
  ]);
  const input = ownUseFromRow(row);
  const assessment = assessOwnUse(input, {
    otherNotifications: others.map(ownUseFromRow),
    registerCacNos: registerCacs.map((r) => r.cacNo),
    payments: payments.map(paymentFromRow),
    ref: ctx.ref,
    settings: ctx.settings,
  });
  return { ctx, row, input, assessment };
}

/**
 * REG-01I checklist. `input` maps document key → "Y" | "N" | "N/A" | "". Evidence of payment is set
 * automatically from Finance-confirmed payments and cannot be changed.
 */
export async function updateOwnUseDocuments(db: Db, actor: Actor, id: string, input: unknown) {
  if (!can(actor.roles, "documents.edit")) throw new ForbiddenError();
  const parsed = documentsSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);

  return db.$transaction(async (tx) => {
    const { row, input: oun, assessment } = await assessOne(tx, id);
    const items = new Map(assessment.documents.items.map((d) => [d.key, d]));
    const changes: string[] = [];
    const locked: string[] = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      const item = items.get(key);
      if (!item) throw new ValidationError(`"${key}" is not on the REG-01I checklist.`);
      if (item.mode !== "manual") {
        if ((item.value ?? "") !== value) locked.push(item.text);
        continue;
      }
      const old = oun.documents[key] ?? "";
      if (old === value) continue;
      changes.push(`${item.text}: ${old || "blank"} → ${value || "blank"}`);
      const where = { ownUseNotificationId: id, documentKey: key };
      if (value === "") await tx.ownUseDocumentItem.deleteMany({ where });
      else {
        await tx.ownUseDocumentItem.upsert({
          where: { ownUseNotificationId_documentKey: where },
          create: { ...where, value: CHECK_TO_DB[value] },
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
        reference: row.ounNo,
        detail: changes.join("; "),
      });
    }
    return changes.length;
  });
}

const registerSchema = z.object({
  flagOverrideReason: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null),
});

/**
 * Register an own-use notification with a certificate (only while the "own-use certificate" setting
 * is on): an approving officer, not the one who recorded it; fee confirmed by Finance; documents
 * complete. The number (OGSERC/REG/{yyyy}/I-CPT/{serial}) comes from the same yearly counter as
 * other registrations, so serials never collide; the certificate is produced in the same transaction.
 */
export async function registerOwnUse(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: { today?: string } = {},
) {
  if (!can(actor.roles, "submission.approve")) throw new ForbiddenError();
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const today = opts.today ?? appToday();

  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "OwnUseNotification" WHERE "id" = ${id} FOR UPDATE`;
      const { ctx, row, input: oun, assessment } = await assessOne(tx, id, today);
      const override = parsed.data.flagOverrideReason ?? row.flagOverrideReason;
      const blockers = ownUseRegistrationBlockers({
        oun,
        assessment,
        settings: ctx.settings,
        createdById: row.createdById,
        actorId: actor.id,
        flagOverrideReason: override,
      });
      if (blockers.length) throw new BlockedError("Registration is blocked.", blockers);

      const serial = await nextCounter(tx, COUNTER.registration(yearOf(today)));
      const registrationNo = ownUseRegistrationNo(ctx.settings, today, serial);
      await tx.ownUseNotification.update({
        where: { id },
        data: {
          registrationNo,
          certificateIssueDate: fromIsoDate(today),
          registeredById: actor.id,
          flagOverrideReason: override,
        },
      });
      await storeOwnUseCertificate(
        tx,
        actor,
        { ...oun, registrationNo, certificateIssueDate: today },
        assessment,
        ctx,
      );
      const overridden =
        assessment.flags.length && override ? `; flags overridden: ${override}` : "";
      await writeAudit(tx, {
        userId: actor.id,
        action: "Registered",
        reference: row.ounNo,
        detail: `${registrationNo} - own-use (REG-01I) - approved by ${actor.name}${overridden}`,
      });
      return { registrationNo };
    },
    { timeout: 30_000 },
  );
}

/** Admin: re-price an own-use notification under the current fee table and threshold. */
export async function recalculateOwnUsePricing(db: Db, actor: Actor, id: string, input: unknown) {
  if (!can(actor.roles, "pricing.recalculate")) throw new ForbiddenError();
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);

  return db.$transaction(async (tx) => {
    const row = await tx.ownUseNotification.findUnique({ where: { id }, include: ownUseInclude });
    if (!row) throw new NotFoundError("Own-use notification not found.");
    const ctx = await loadContext(tx);
    const a = assessOwnUse(ownUseFromRow(row), {
      otherNotifications: [],
      registerCacNos: [],
      payments: [],
      ref: ctx.ref,
      settings: ctx.settings,
    });
    if (!a.pricingChanges.length || !a.pricingCurrent)
      return { changed: false as const, changes: [] };

    await tx.$queryRaw`SELECT set_config('ogserc.reprice', 'on', true)`;
    await tx.ownUseNotification.update({
      where: { id },
      data: {
        pricedFee: BigInt(a.pricingCurrent.fee),
        pricedThresholdKw: a.pricingCurrent.thresholdKw,
        pricedAt: new Date(),
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Pricing recalculated",
      reference: row.ounNo,
      detail: `${a.pricingChanges.join("; ")}. Reason: ${parsed.data.reason}`,
    });
    return { changed: true as const, changes: a.pricingChanges };
  });
}

/** Load notifications with everything §4.3 shows (fee, payments, documents, flags). */
export async function listOwnUse(db: Db, today?: string) {
  const ctx = await loadContext(db, today);
  const [rows, registerCacs, payments] = await Promise.all([
    db.ownUseNotification.findMany({ orderBy: { ounSeq: "desc" }, include: ownUseInclude }),
    db.submission.findMany({ select: { cacNo: true } }),
    db.payment.findMany({ where: { ownUseNotificationId: { not: null } } }),
  ]);
  const inputs = rows.map(ownUseFromRow);
  const flagCtx = {
    otherNotifications: inputs,
    registerCacNos: registerCacs.map((r) => r.cacNo),
    payments: payments.map(paymentFromRow),
    ref: ctx.ref,
    settings: ctx.settings,
  };
  return rows.map((row, i) => ({
    row,
    input: inputs[i]!,
    assessment: assessOwnUse(inputs[i]!, flagCtx),
  }));
}

/** Everything the own-use page shows. */
export async function getOwnUseDetail(db: Db, id: string, today?: string) {
  const exists = await db.ownUseNotification.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  const { ctx, row, input, assessment } = await assessOne(db, id, today);
  const [extra, audit, documents] = await Promise.all([
    db.ownUseNotification.findUniqueOrThrow({
      where: { id },
      include: {
        createdBy: { select: { name: true } },
        registeredBy: { select: { name: true } },
        payments: {
          orderBy: { paymentSeq: "asc" },
          include: {
            recordedBy: { select: { name: true } },
            verifiedBy: { select: { name: true } },
            financeDecidedBy: { select: { name: true } },
            reversedBy: { select: { name: true } },
          },
        },
      },
    }),
    db.auditLog.findMany({
      where: { reference: row.ounNo },
      orderBy: { id: "desc" },
      take: 100,
      include: { user: { select: { name: true } } },
    }),
    db.generatedDocument.findMany({
      where: { ownUseNotificationId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        version: true,
        fileName: true,
        sha256: true,
        createdAt: true,
        supersededAt: true,
        note: true,
      },
    }),
  ]);
  return {
    row: { ...row, ...extra },
    input,
    assessment,
    payments: extra.payments.map((p) => ({ ...p, amountKobo: koboToNumber(p.amount) })),
    audit,
    documents,
    policy: ctx.settings.policy,
  };
}
