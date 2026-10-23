import { z } from "zod";
import { priceSubmission, pricingDifferences, type PricingInput } from "@/domain/pricing";
import { can } from "@/domain/roles";
import { writeAudit } from "./audit";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { loadReferenceData, loadSettings } from "./reference-data";
import { loadSubmission, pricingToColumns, type PricingColumns } from "./submissions";
import type { Actor, Db, Tx } from "./types";

/**
 * Pricing columns for a submission being saved, from the fee table and Settings in force now.
 * Call inside the saving transaction; the columns are required, so a submission cannot be saved
 * without its snapshot.
 */
export async function priceNewSubmission(tx: Tx, input: PricingInput): Promise<PricingColumns> {
  const [ref, settings] = await Promise.all([loadReferenceData(tx), loadSettings(tx)]);
  const snapshot = priceSubmission(input, ref, settings);
  if (!snapshot) {
    throw new ValidationError("The Schedule 3 category cannot be determined from the activity.", {
      primaryActivity: ["Choose an activity from the list"],
    });
  }
  return pricingToColumns(snapshot);
}

const recalcSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(1000),
});

type RecalcResult =
  | { changed: true; changes: string[] }
  | { changed: false; changes: string[] }
  | { changed: false; skipped: string };

/** Re-price one submission inside `tx`. Returns `skipped` instead of throwing for records it must not touch. */
async function recalcOne(
  tx: Tx,
  actor: Actor,
  submissionId: string,
  reason: string,
): Promise<RecalcResult & { ackNo: string }> {
  const loaded = await loadSubmission(tx, submissionId);
  if (!loaded) throw new NotFoundError("Submission not found.");
  const { sub } = loaded;
  const ackNo = sub.ackNo!;
  if (sub.registrationNo) {
    return {
      ackNo,
      changed: false,
      skipped: `Registered as ${sub.registrationNo}; the category in a locked registration number cannot change.`,
    };
  }
  const [ref, settings] = await Promise.all([loadReferenceData(tx), loadSettings(tx)]);
  const next = priceSubmission(sub, ref, settings);
  if (!next)
    return {
      ackNo,
      changed: false,
      skipped: "The category cannot be determined from the activity.",
    };
  const changes = pricingDifferences(sub.pricing!, next);
  if (!changes.length) return { ackNo, changed: false, changes };

  // Transaction-local permission for the snapshot trigger.
  await tx.$queryRaw`SELECT set_config('ogserc.reprice', 'on', true)`;
  await tx.submission.update({
    where: { id: submissionId },
    data: { ...pricingToColumns(next), pricedAt: new Date() },
  });
  await writeAudit(tx, {
    userId: actor.id,
    action: "Pricing recalculated",
    reference: ackNo,
    detail: `${changes.join("; ")}. Reason: ${reason}`,
  });
  return { ackNo, changed: true, changes };
}

/**
 * Admin: re-price a submission under the current fee table and Settings. The only way a saved
 * snapshot changes (the DB trigger refuses any other update to the priced columns).
 */
export async function recalculatePricing(
  db: Db,
  actor: Actor,
  submissionId: string,
  input: unknown,
) {
  if (!can(actor.roles, "pricing.recalculate")) throw new ForbiddenError();
  const parsed = recalcSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return db.$transaction(async (tx) => {
    const result = await recalcOne(tx, actor, submissionId, parsed.data.reason);
    if ("skipped" in result) throw new ValidationError(result.skipped);
    return result;
  });
}

/**
 * Admin: re-price several submissions with one reason (docs/DECISIONS.md). Each changed submission
 * gets its own audit entry; registered ones are skipped and reported.
 */
export async function recalculatePricingBulk(
  db: Db,
  actor: Actor,
  submissionIds: string[],
  input: unknown,
) {
  if (!can(actor.roles, "pricing.recalculate")) throw new ForbiddenError();
  const parsed = recalcSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const ids = [...new Set(submissionIds)];
  if (!ids.length) throw new ValidationError("Tick at least one submission.");
  if (ids.length > 500) throw new ValidationError("Recalculate at most 500 submissions at a time.");

  return db.$transaction(
    async (tx) => {
      const results = [];
      for (const id of ids) results.push(await recalcOne(tx, actor, id, parsed.data.reason));
      return {
        changed: results.filter((r) => r.changed).map((r) => r.ackNo),
        unchanged: results.filter((r) => !r.changed && !("skipped" in r)).map((r) => r.ackNo),
        skipped: results.flatMap((r) =>
          "skipped" in r ? [{ ackNo: r.ackNo, reason: r.skipped }] : [],
        ),
      };
    },
    { timeout: 60_000 },
  );
}
