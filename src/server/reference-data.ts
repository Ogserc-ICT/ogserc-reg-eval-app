import type { Settings as SettingsRow } from "@prisma/client";
import type { ConditionKey, RegistrationFormDef } from "@/domain/forms";
import type { ReferenceData, Settings } from "@/domain/reference";
import type { IsoDate } from "@/domain/types";
import type { Db, Tx } from "./types";

/** Drop-down lists stored in LookupValue, keyed by their seed-data.json name. */
export const LISTS = [
  "registrant_types",
  "licence_statuses",
  "fuel_technologies",
  "submission_channels",
  "payment_channels",
  "payment_purposes",
] as const;
export type ListName = (typeof LISTS)[number];

/** @db.Date columns come back as UTC midnight. */
export function toIsoDate(d: Date): IsoDate;
export function toIsoDate(d: Date | null): IsoDate | null;
export function toIsoDate(d: Date | null): IsoDate | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function fromIsoDate(s: IsoDate): Date;
export function fromIsoDate(s: IsoDate | null): Date | null;
export function fromIsoDate(s: IsoDate | null): Date | null {
  return s ? new Date(`${s}T00:00:00.000Z`) : null;
}

/** Kobo is BigInt in the DB and a safe integer in domain code (< ₦90 trillion). */
export function koboToNumber(kobo: bigint): number {
  const n = Number(kobo);
  if (!Number.isSafeInteger(n)) throw new Error(`Amount out of range: ${kobo}`);
  return n;
}

export function settingsFromRow(row: SettingsRow): Settings {
  return {
    effectiveDate: toIsoDate(row.effectiveDate),
    registrationPeriodDays: row.registrationPeriodDays,
    extensionDays: row.extensionDays,
    newOperatorLeadDays: row.newOperatorLeadDays,
    determinationDays: row.determinationDays,
    deficiencyDays: row.deficiencyDays,
    licenceApplicationDays: row.licenceApplicationDays,
    licenceExpiryWindowDays: row.licenceExpiryWindowDays,
    amberWarningDays: row.amberWarningDays,
    ownUseThresholdKw: row.ownUseThresholdKw,
    showCauseDays: row.showCauseDays,
    registrationPrefix: row.registrationPrefix,
    ackPrefix: row.ackPrefix,
    ounPrefix: row.ounPrefix,
    paymentPrefix: row.paymentPrefix,
    chairmanName: row.chairmanName,
    commissionerName: row.commissionerName,
    feesRevisedOn: toIsoDate(row.feesRevisedOn),
    annualConfirmationDue: row.annualConfirmationDue,
    policy: {
      lateChargeBlocksCompleteness: row.lateChargeBlocksCompleteness,
      waiverAppliesToLateCharge: row.waiverAppliesToLateCharge,
      flagsBlockApproval: row.flagsBlockApproval,
      tinPattern: row.tinPattern,
      lateChargeRequiredForRelease: row.lateChargeRequiredForRelease,
      unpaidReminderDays: row.unpaidReminderDays,
      supplyRetailCategory1MwPlus: row.supplyRetailCategory1MwPlus,
      wrongFormHandling: row.wrongFormHandling,
      otherActivitiesRequireDocuments: row.otherActivitiesRequireDocs,
      ownUseCertificate: row.ownUseCertificate,
      filingFeeOnUpdates: row.filingFeeOnUpdates,
    },
  };
}

export function settingsToRow(s: Settings): Omit<SettingsRow, "id" | "updatedAt"> {
  return {
    effectiveDate: fromIsoDate(s.effectiveDate),
    registrationPeriodDays: s.registrationPeriodDays,
    extensionDays: s.extensionDays,
    newOperatorLeadDays: s.newOperatorLeadDays,
    determinationDays: s.determinationDays,
    deficiencyDays: s.deficiencyDays,
    licenceApplicationDays: s.licenceApplicationDays,
    licenceExpiryWindowDays: s.licenceExpiryWindowDays,
    amberWarningDays: s.amberWarningDays,
    ownUseThresholdKw: s.ownUseThresholdKw,
    showCauseDays: s.showCauseDays,
    registrationPrefix: s.registrationPrefix,
    ackPrefix: s.ackPrefix,
    ounPrefix: s.ounPrefix,
    paymentPrefix: s.paymentPrefix,
    chairmanName: s.chairmanName,
    commissionerName: s.commissionerName,
    feesRevisedOn: fromIsoDate(s.feesRevisedOn),
    annualConfirmationDue: s.annualConfirmationDue,
    lateChargeBlocksCompleteness: s.policy.lateChargeBlocksCompleteness,
    waiverAppliesToLateCharge: s.policy.waiverAppliesToLateCharge,
    flagsBlockApproval: s.policy.flagsBlockApproval,
    tinPattern: s.policy.tinPattern,
    lateChargeRequiredForRelease: s.policy.lateChargeRequiredForRelease,
    unpaidReminderDays: s.policy.unpaidReminderDays,
    supplyRetailCategory1MwPlus: s.policy.supplyRetailCategory1MwPlus,
    wrongFormHandling: s.policy.wrongFormHandling,
    otherActivitiesRequireDocs: s.policy.otherActivitiesRequireDocuments,
    ownUseCertificate: s.policy.ownUseCertificate,
    filingFeeOnUpdates: s.policy.filingFeeOnUpdates,
  };
}

export async function loadSettings(db: Db | Tx): Promise<Settings> {
  const row = await db.settings.findUnique({ where: { id: 1 } });
  if (!row) throw new Error("Settings row missing: run the seed (npm run db:seed)");
  return settingsFromRow(row);
}

export async function loadReferenceData(db: Db | Tx): Promise<ReferenceData> {
  const [fees, activities, forms, checks] = await Promise.all([
    db.feeCategory.findMany({ orderBy: { category: "asc" } }),
    db.activity.findMany({ orderBy: { sortOrder: "asc" } }),
    db.registrationForm.findMany({
      orderBy: { sortOrder: "asc" },
      include: { documents: { orderBy: { sortOrder: "asc" } } },
    }),
    db.evaluationCheck.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return {
    fees: fees.map((f) => ({
      category: f.category,
      registrationFee: koboToNumber(f.registrationFee),
      lateInitial: koboToNumber(f.lateInitial),
      lateDaily: koboToNumber(f.lateDaily),
      lateDailyCap: koboToNumber(f.lateDailyCap),
      lateTier: f.lateTier,
      description: f.description,
    })),
    activities: activities.map((a) => ({
      name: a.name,
      code: a.code,
      cat10MwPlus: a.cat10MwPlus,
      cat1To10Mw: a.cat1To10Mw,
      catBelow1Mw: a.catBelow1Mw,
      capacityBased: a.capacityBased,
    })),
    forms: forms.map((f): RegistrationFormDef => ({
      form: f.form,
      category: f.category,
      title: f.title,
      para: f.para,
      documents: f.documents.map((d) => ({
        key: d.key,
        text: d.text,
        requiredWhen: d.requiredWhen as ConditionKey | null,
      })),
    })),
    evaluationChecks: checks.map((c) => ({ id: c.id, stage: c.stage, text: c.text })),
  };
}

export async function loadList(db: Db | Tx, list: ListName): Promise<string[]> {
  const rows = await db.lookupValue.findMany({ where: { list }, orderBy: { sortOrder: "asc" } });
  return rows.map((r) => r.value);
}
