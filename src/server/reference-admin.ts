import { parseNairaToKobo } from "@/domain/money";
import {
  activityMapChanges,
  activityMapErrors,
  feeTableChanges,
  feeTableErrors,
  type ActivityEdit,
  type FeeEdit,
} from "@/domain/reference-admin";
import { can } from "@/domain/roles";
import { reasonSchema } from "@/lib/schemas";
import { writeAudit } from "./audit";
import { ForbiddenError, ValidationError } from "./errors";
import { listOwnUse } from "./own-use";
import { loadReferenceData } from "./reference-data";
import { assessRegister } from "./register";
import type { Actor, Db } from "./types";

// Fee table and activity map admin pages (deferred from Phase 2, built in Phase 8). Every edit needs a
// reason and writes one audit entry per changed row. Existing submissions and own-use notifications keep
// their pricing snapshot; afterwards the ones whose snapshot no longer matches show "pricing out of date"
// and an admin may recalculate them from the Register (with its own reason and audit).

function assertCan(actor: Actor) {
  if (!can(actor.roles, "admin.referenceData")) throw new ForbiddenError();
}

function reasonOrThrow(reason: unknown) {
  const parsed = reasonSchema.safeParse({ reason });
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data.reason;
}

/** How many records now have pricing that differs from current rules (after an edit). */
async function stalePricing(db: Db) {
  const [subs, ouns] = await Promise.all([
    assessRegister(db, { stalePricing: true }),
    listOwnUse(db),
  ]);
  return {
    submissions: subs.length,
    ownUse: ouns.filter((o) => o.assessment.pricingChanges.length > 0).length,
  };
}

export interface FeeEditInput {
  category: string;
  registrationFee: string;
  lateInitial: string;
  lateDaily: string;
  lateDailyCap: string;
  description: string;
}

export async function updateFeeTable(
  db: Db,
  actor: Actor,
  input: { rows: FeeEditInput[]; reason: string },
) {
  assertCan(actor);
  const reason = reasonOrThrow(input.reason);
  const edits: FeeEdit[] = input.rows.map((r) => ({
    category: r.category,
    registrationFee: parseNairaToKobo(r.registrationFee),
    lateInitial: parseNairaToKobo(r.lateInitial),
    lateDaily: parseNairaToKobo(r.lateDaily),
    lateDailyCap: parseNairaToKobo(r.lateDailyCap),
    description: r.description,
  }));

  const changed = await db.$transaction(async (tx) => {
    const { fees } = await loadReferenceData(tx);
    const errors = feeTableErrors(fees, edits);
    if (Object.keys(errors).length)
      throw new ValidationError("Please correct the highlighted fields.", errors);
    const changes = feeTableChanges(fees, edits);
    for (const c of changes) {
      const e = edits.find((x) => x.category === c.category)!;
      await tx.feeCategory.update({
        where: { category: c.category },
        data: {
          registrationFee: BigInt(e.registrationFee!),
          lateInitial: BigInt(e.lateInitial!),
          lateDaily: BigInt(e.lateDaily!),
          lateDailyCap: BigInt(e.lateDailyCap!),
          description: e.description.trim(),
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: "Fee table changed",
        reference: `Category ${c.category}`,
        detail: `${c.detail}. Reason: ${reason}`,
      });
    }
    return changes.length;
  });
  return { changed, stale: changed ? await stalePricing(db) : null };
}

export async function updateActivityMap(
  db: Db,
  actor: Actor,
  input: { rows: ActivityEdit[]; reason: string },
) {
  assertCan(actor);
  const reason = reasonOrThrow(input.reason);
  const changed = await db.$transaction(async (tx) => {
    const { activities, fees } = await loadReferenceData(tx);
    const errors = activityMapErrors(
      activities,
      fees.map((f) => f.category),
      input.rows,
    );
    if (Object.keys(errors).length)
      throw new ValidationError("Please correct the highlighted fields.", errors);
    const changes = activityMapChanges(activities, input.rows);
    for (const c of changes) {
      const e = input.rows.find((x) => x.code === c.code)!;
      await tx.activity.update({
        where: { code: c.code },
        data: {
          cat10MwPlus: e.cat10MwPlus,
          cat1To10Mw: e.cat1To10Mw,
          catBelow1Mw: e.catBelow1Mw,
          capacityBased: e.capacityBased,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: "Activity map changed",
        reference: `Activity ${c.code}`,
        detail: `${c.detail}. Reason: ${reason}`,
      });
    }
    return changes.length;
  });
  return { changed, stale: changed ? await stalePricing(db) : null };
}
