"use server";

import { revalidatePath } from "next/cache";
import { formAll, formBool, formText, runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { updateSettings } from "@/server/settings";
import { unlockUser } from "@/server/login-throttle";
import { createUser, resetPassword, updateUser } from "@/server/users";
import { commitImport, uploadWorkbook } from "@/server/workbook-import";
import { updateActivityMap, updateFeeTable } from "@/server/reference-admin";

// Thin wrappers: the services check permissions, validate, run the transaction and write the audit log.

export async function createUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = {
    name: formText(fd, "name"),
    email: formText(fd, "email"),
    roles: formAll(fd, "roles"),
  };
  return runAction(async (actor) => {
    const user = await createUser(db, actor, { ...values, password: formText(fd, "password") });
    revalidatePath("/admin/users");
    return `User ${user.email} created.`;
  }, values);
}

export async function updateUserAction(
  userId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const values = {
    name: formText(fd, "name"),
    email: formText(fd, "email"),
    roles: formAll(fd, "roles"),
    active: formBool(fd, "active"),
  };
  return runAction(async (actor) => {
    await updateUser(db, actor, userId, values);
    revalidatePath("/admin/users");
    return "Changes saved.";
  }, values);
}

export async function unlockUserAction(userId: string): Promise<ActionState> {
  return runAction(async (actor) => {
    await unlockUser(db, actor, userId);
    revalidatePath("/admin/users");
    return "Account unlocked.";
  });
}

export async function resetPasswordAction(
  userId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  return runAction(async (actor) => {
    await resetPassword(db, actor, userId, { password: formText(fd, "password") });
    return "Password reset. The user has been signed out everywhere.";
  });
}

const SETTINGS_TEXT = [
  "effectiveDate",
  "registrationPeriodDays",
  "extensionDays",
  "newOperatorLeadDays",
  "determinationDays",
  "deficiencyDays",
  "licenceApplicationDays",
  "licenceExpiryWindowDays",
  "amberWarningDays",
  "showCauseDays",
  "ownUseThresholdKw",
  "registrationPrefix",
  "ackPrefix",
  "ounPrefix",
  "paymentPrefix",
  "chairmanName",
  "commissionerName",
  "feesRevisedOn",
  "tinPattern",
  "unpaidReminderDays",
  "supplyRetailCategory1MwPlus",
  "wrongFormHandling",
  "annualConfirmationDue",
] as const;
const SETTINGS_BOOL = [
  "lateChargeBlocksCompleteness",
  "waiverAppliesToLateCharge",
  "flagsBlockApproval",
  "lateChargeRequiredForRelease",
  "otherActivitiesRequireDocuments",
  "ownUseCertificate",
  "filingFeeOnUpdates",
] as const;

export async function updateSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values: Record<string, unknown> = {};
  for (const k of SETTINGS_TEXT) values[k] = formText(fd, k);
  for (const k of SETTINGS_BOOL) values[k] = formBool(fd, k);
  return runAction(async (actor) => {
    await updateSettings(db, actor, values);
    revalidatePath("/", "layout");
    return "Settings saved.";
  }, values);
}

export async function uploadWorkbookAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const file = fd.get("workbook");
  return runAction(async (actor) => {
    const isFile = file instanceof File;
    const { id } = await uploadWorkbook(db, actor, {
      name: isFile ? file.name : "",
      bytes: isFile ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(),
    });
    return { redirectTo: `/admin/import/${id}` };
  });
}

export async function commitImportAction(id: string): Promise<ActionState> {
  return runAction(async (actor) => {
    const s = await commitImport(db, actor, id);
    revalidatePath(`/admin/import/${id}`);
    return (
      `Imported ${s.submissions} submissions, ${s.ownUse} own-use notifications and ` +
      `${s.payments} payments.`
    );
  });
}

/** "{n} submissions and {m} own-use notifications now show pricing out of date …" */
function staleMessage(stale: { submissions: number; ownUse: number } | null) {
  if (!stale || (!stale.submissions && !stale.ownUse)) return "";
  return (
    ` ${stale.submissions} submission(s) and ${stale.ownUse} own-use notification(s) now show ` +
    "“pricing out of date”; their saved pricing has not changed. Recalculate them from the " +
    "Register or own-use list if the new terms should apply."
  );
}

export async function updateFeeTableAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const categories = formAll(fd, "category");
  const field = (c: string, f: string) => formText(fd, `${c}.${f}`);
  const rows = categories.map((category) => ({
    category,
    registrationFee: field(category, "registrationFee"),
    lateInitial: field(category, "lateInitial"),
    lateDaily: field(category, "lateDaily"),
    lateDailyCap: field(category, "lateDailyCap"),
    description: field(category, "description"),
  }));
  const reason = formText(fd, "reason");
  const values = {
    reason,
    ...Object.fromEntries(
      rows.flatMap((r) =>
        Object.entries(r).flatMap(([k, v]) =>
          k === "category" ? [] : [[`${r.category}.${k}`, v]],
        ),
      ),
    ),
  };
  return runAction(async (actor) => {
    const { changed, stale } = await updateFeeTable(db, actor, { rows, reason });
    revalidatePath("/", "layout");
    return changed
      ? `Fee table saved: ${changed} categor${changed === 1 ? "y" : "ies"} changed.${staleMessage(stale)}`
      : "No changes to save.";
  }, values);
}

export async function updateActivityMapAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const codes = formAll(fd, "code");
  const rows = codes.map((code) => ({
    code,
    cat10MwPlus: formText(fd, `${code}.cat10MwPlus`),
    cat1To10Mw: formText(fd, `${code}.cat1To10Mw`),
    catBelow1Mw: formText(fd, `${code}.catBelow1Mw`),
    capacityBased: formBool(fd, `${code}.capacityBased`),
  }));
  const reason = formText(fd, "reason");
  const values = {
    reason,
    ...Object.fromEntries(
      rows.flatMap((r) =>
        Object.entries(r).flatMap(([k, v]) => (k === "code" ? [] : [[`${r.code}.${k}`, v]])),
      ),
    ),
  };
  return runAction(async (actor) => {
    const { changed, stale } = await updateActivityMap(db, actor, { rows, reason });
    revalidatePath("/", "layout");
    return changed
      ? `Activity map saved: ${changed} activit${changed === 1 ? "y" : "ies"} changed.${staleMessage(stale)}`
      : "No changes to save.";
  }, values);
}
