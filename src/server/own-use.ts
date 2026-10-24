import type { OwnUseNotification, Prisma } from "@prisma/client";
import { formatDate } from "@/domain/dates";
import { formatNaira } from "@/domain/money";
import { formatOunNo } from "@/domain/numbers";
import {
  OWN_USE_MAX_KW,
  assessOwnUse,
  checkOwnUseCapacity,
  ownUseEligibility,
  priceOwnUse,
  type OwnUseInput,
} from "@/domain/own-use";
import { can } from "@/domain/roles";
import { ownUseSchema, reasonSchema, type OwnUseFields } from "@/lib/schemas";
import { writeAudit } from "./audit";
import { notify } from "./notifications";
import { loadContext } from "./context";
import { COUNTER, nextCounter } from "./counters";
import {
  ConfirmationRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { fromIsoDate, koboToNumber, loadList, toIsoDate } from "./reference-data";
import { paymentFromRow } from "./submissions";
import type { Actor, Db, Tx } from "./types";

export const CONFIRM_BELOW_THRESHOLD = "confirmBelowThreshold";

export function ownUseFromRow(row: OwnUseNotification): OwnUseInput {
  return {
    id: row.id,
    ounNo: row.ounNo,
    name: row.name,
    dateFiled: toIsoDate(row.dateFiled),
    cacNo: row.cacNo,
    lga: row.lga,
    installedCapacityKw: row.installedCapacityKw.toNumber(),
    pricing: { fee: koboToNumber(row.pricedFee), thresholdKw: row.pricedThresholdKw },
  };
}

/** Validation that needs the DB, Settings or today; the capacity rules of §4.3. */
async function checkOwnUse(tx: Tx, v: OwnUseFields, confirmed: boolean) {
  const ctx = await loadContext(tx);
  const errors: Record<string, string[]> = {};
  const [lga, fuels] = await Promise.all([
    tx.lga.findUnique({ where: { name: v.lga } }),
    loadList(tx, "fuel_technologies"),
  ]);
  if (!lga) errors.lga = ["Choose an LGA from the list"];
  if (v.fuel && !fuels.includes(v.fuel)) errors.fuel = ["Choose from the list"];
  if (v.dateFiled > ctx.today) errors.dateFiled = ["Cannot be in the future"];

  const capacity = checkOwnUseCapacity(v.installedCapacityKw, ctx.settings);
  if (capacity.outcome === "reject") {
    errors.installedCapacityKw = [`${OWN_USE_MAX_KW} kW or more: ${capacity.message}`];
  }
  if (Object.keys(errors).length) {
    throw new ValidationError("Please correct the highlighted fields.", errors);
  }
  if (capacity.outcome === "confirm" && !confirmed) {
    throw new ConfirmationRequiredError(
      CONFIRM_BELOW_THRESHOLD,
      `${capacity.message}. Record it anyway?`,
    );
  }
  return { ctx, belowThreshold: capacity.outcome === "confirm" };
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
    units: v.units,
    installedCapacityKw: v.installedCapacityKw,
    fuel: v.fuel,
    avgMonthlyOutputMwh: v.avgMonthlyOutputMwh,
    contactPerson: v.contactPerson,
    phone: v.phone,
    email: v.email,
  } satisfies Partial<Prisma.OwnUseNotificationUncheckedCreateInput>;
}

/** §4.3 Save own-use notification (form OUN-01). */
export async function createOwnUse(
  db: Db,
  actor: Actor,
  input: unknown,
  opts: { confirmBelowThreshold?: boolean } = {},
) {
  if (!can(actor.roles, "ownUse.create")) throw new ForbiddenError();
  const parsed = ownUseSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const v = parsed.data;

  return db.$transaction(async (tx) => {
    const { ctx, belowThreshold } = await checkOwnUse(tx, v, !!opts.confirmBelowThreshold);
    const pricing = priceOwnUse(v.installedCapacityKw, ctx.ref, ctx.settings);
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
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Own-use notification",
      reference: ounNo,
      detail:
        `${v.name} - ${v.installedCapacityKw} kW - ${ownUseEligibility(v.installedCapacityKw, ctx.settings)}` +
        ` - fee ${formatNaira(pricing.fee)}` +
        (belowThreshold ? "; below threshold confirmed" : ""),
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
  if (typeof v === "object" && "toNumber" in (v as object)) {
    return String((v as { toNumber(): number }).toNumber());
  }
  return String(v);
};

/** Edit an own-use notification. The fee is not re-taken; an admin recalculates if needed. */
export async function updateOwnUse(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  opts: { confirmBelowThreshold?: boolean } = {},
) {
  if (!can(actor.roles, "ownUse.create")) throw new ForbiddenError();
  const parsed = ownUseSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const v = parsed.data;

  return db.$transaction(async (tx) => {
    const current = await tx.ownUseNotification.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("Own-use notification not found.");
    await checkOwnUse(tx, v, !!opts.confirmBelowThreshold);
    const next = ownUseData(v);
    const changes = (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => show(current[k]) !== show(next[k]))
      .map((k) => `${k}: ${show(current[k])} → ${show(next[k])}`);
    if (!changes.length) return current;
    const updated = await tx.ownUseNotification.update({ where: { id }, data: next });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Own-use notification updated",
      reference: current.ounNo,
      detail: changes.join("; "),
    });
    return updated;
  });
}

/** Admin: re-price an own-use notification under the current fee table and threshold. */
export async function recalculateOwnUsePricing(db: Db, actor: Actor, id: string, input: unknown) {
  if (!can(actor.roles, "pricing.recalculate")) throw new ForbiddenError();
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);

  return db.$transaction(async (tx) => {
    const row = await tx.ownUseNotification.findUnique({ where: { id } });
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

/** Load notifications with everything §4.3 shows (fee, payments, flags). */
export async function listOwnUse(db: Db, today?: string) {
  const ctx = await loadContext(db, today);
  const [rows, registerCacs, payments] = await Promise.all([
    db.ownUseNotification.findMany({ orderBy: { ounSeq: "desc" } }),
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
  const ctx = await loadContext(db, today);
  const row = await db.ownUseNotification.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
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
  });
  if (!row) return null;
  const [others, registerCacs, audit] = await Promise.all([
    db.ownUseNotification.findMany({ where: { id: { not: id } } }),
    db.submission.findMany({ select: { cacNo: true } }),
    db.auditLog.findMany({
      where: { reference: row.ounNo },
      orderBy: { id: "desc" },
      take: 100,
      include: { user: { select: { name: true } } },
    }),
  ]);
  const input = ownUseFromRow(row);
  const assessment = assessOwnUse(input, {
    otherNotifications: others.map(ownUseFromRow),
    registerCacNos: registerCacs.map((r) => r.cacNo),
    payments: row.payments.map(paymentFromRow),
    ref: ctx.ref,
    settings: ctx.settings,
  });
  return {
    row,
    input,
    assessment,
    payments: row.payments.map((p) => ({ ...p, amountKobo: koboToNumber(p.amount) })),
    audit,
  };
}
