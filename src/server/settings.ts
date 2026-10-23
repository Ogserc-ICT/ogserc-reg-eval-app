import { can } from "@/domain/roles";
import { settingsSchema } from "@/lib/schemas";
import { writeAudit } from "./audit";
import { appToday } from "./clock";
import { releaseEligible } from "./finance";
import { ForbiddenError, ValidationError } from "./errors";
import { settingsFromRow, settingsToRow } from "./reference-data";
import type { Actor, Db } from "./types";

type Row = ReturnType<typeof settingsToRow>;

function show(v: Row[keyof Row]): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v === null || v === "") return "(blank)";
  return String(v);
}

export async function updateSettings(db: Db, actor: Actor, input: unknown) {
  if (!can(actor.roles, "admin.settings")) throw new ForbiddenError();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const {
    lateChargeBlocksCompleteness,
    waiverAppliesToLateCharge,
    flagsBlockApproval,
    tinPattern,
    lateChargeRequiredForRelease,
    unpaidReminderDays,
    ...rest
  } = parsed.data;

  return db.$transaction(async (tx) => {
    const currentRow = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
    const before = settingsToRow(settingsFromRow(currentRow));
    const after = settingsToRow({
      ...rest,
      policy: {
        lateChargeBlocksCompleteness,
        waiverAppliesToLateCharge,
        flagsBlockApproval,
        tinPattern,
        lateChargeRequiredForRelease,
        unpaidReminderDays,
      },
    });

    const changes = (Object.keys(after) as (keyof Row)[])
      .filter((k) => show(before[k]) !== show(after[k]))
      .map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`);
    if (!changes.length) return settingsFromRow(currentRow);

    const row = await tx.settings.update({ where: { id: 1 }, data: after });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Settings updated",
      detail: changes.join("; "),
    });
    // §4.12: the gate applies from now on; a lower requirement may release acknowledged submissions.
    if (before.lateChargeRequiredForRelease !== after.lateChargeRequiredForRelease) {
      await releaseEligible(tx, actor.id, appToday(), "Finance gate setting changed");
    }
    return settingsFromRow(row);
  });
}
