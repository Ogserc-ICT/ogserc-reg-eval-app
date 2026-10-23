import { nairaToKobo } from "./money";
import type { IsoDate, Kobo } from "./types";

/** Schedule 3 fee row. */
export interface FeeRow {
  category: string;
  registrationFee: Kobo;
  lateInitial: Kobo;
  lateDaily: Kobo;
  lateDailyCap: Kobo;
  lateTier: string | null;
  description: string;
}

/** Activity → category map. */
export interface Activity {
  name: string;
  code: string;
  cat10MwPlus: string;
  cat1To10Mw: string;
  catBelow1Mw: string;
  capacityBased: boolean;
}

export interface EvaluationCheckDef {
  id: string;
  stage: string;
  text: string;
}

/** Reference data the rules depend on. Loaded from the DB at runtime, from seed-data.json in tests. */
export interface ReferenceData {
  fees: FeeRow[];
  activities: Activity[];
  schedule2Documents: string[];
  evaluationChecks: EvaluationCheckDef[];
}

/**
 * Commission policy choices on SPEC §9 open questions. Defaults follow the Excel
 * until the Commission decides.
 */
export interface Policy {
  /** §9.2: unpaid late charge blocks "submission complete". Excel: false. */
  lateChargeBlocksCompleteness: boolean;
  /** §9.3: waiver also reduces the late charge. Excel: false. */
  waiverAppliesToLateCharge: boolean;
  /** §9.5: true = unresolved data flags block approval outright; false = approver may override with a written reason. */
  flagsBlockApproval: boolean;
  /** §9.7: regular expression for TIN; null = not validated until Finance confirms the format. */
  tinPattern: string | null;
  /**
   * Finance gate (undecided policy; default off): confirmed payments must cover the total due,
   * late charge included, instead of fee − waiver before release for evaluation.
   */
  lateChargeRequiredForRelease: boolean;
  /**
   * Days after acknowledgement before an unpaid submission shows "reminder due" on the dashboard
   * queue (undecided policy; default null = no reminder, no automatic action).
   */
  unpaidReminderDays: number | null;
}

export interface Settings {
  effectiveDate: IsoDate;
  registrationPeriodDays: number;
  extensionDays: number;
  newOperatorLeadDays: number;
  determinationDays: number;
  deficiencyDays: number;
  licenceApplicationDays: number;
  licenceExpiryWindowDays: number;
  amberWarningDays: number;
  ownUseThresholdKw: number;
  /** Para 20: show-cause period before refusal. */
  showCauseDays: number;
  registrationPrefix: string;
  ackPrefix: string;
  ounPrefix: string;
  paymentPrefix: string;
  chairmanName: string;
  commissionerName: string;
  feesRevisedOn: IsoDate | null;
  policy: Policy;
}

export const DEFAULT_POLICY: Policy = {
  lateChargeBlocksCompleteness: false,
  waiverAppliesToLateCharge: false,
  flagsBlockApproval: false,
  tinPattern: null,
  lateChargeRequiredForRelease: false,
  unpaidReminderDays: null,
};

// Shape of seed-data.json (only the parts read here).
interface SeedFile {
  settings: Record<string, { value: string | number }>;
  schedule3_fees: {
    category: string;
    registration_fee: number;
    late_initial: number;
    late_daily: number;
    late_daily_cap: number;
    late_tier: string | null;
    description: string;
  }[];
  activities: {
    name: string;
    code: string;
    cat_10mw_plus: string;
    cat_1_to_10mw: string;
    cat_below_1mw: string;
    capacity_based: boolean;
  }[];
  schedule2_documents: string[];
  evaluation_checks: EvaluationCheckDef[];
}

export function referenceDataFromSeed(seed: SeedFile): ReferenceData {
  return {
    fees: seed.schedule3_fees.map((f) => ({
      category: f.category,
      registrationFee: nairaToKobo(f.registration_fee),
      lateInitial: nairaToKobo(f.late_initial),
      lateDaily: nairaToKobo(f.late_daily),
      lateDailyCap: nairaToKobo(f.late_daily_cap),
      lateTier: f.late_tier,
      description: f.description,
    })),
    activities: seed.activities.map((a) => ({
      name: a.name,
      code: a.code,
      cat10MwPlus: a.cat_10mw_plus,
      cat1To10Mw: a.cat_1_to_10mw,
      catBelow1Mw: a.cat_below_1mw,
      capacityBased: a.capacity_based,
    })),
    schedule2Documents: seed.schedule2_documents,
    evaluationChecks: seed.evaluation_checks,
  };
}

export function settingsFromSeed(seed: SeedFile): Settings {
  const s = seed.settings;
  const num = (key: string): number => {
    const v = s[key]?.value;
    if (typeof v !== "number") throw new Error(`Seed setting "${key}" must be a number`);
    return v;
  };
  const str = (key: string): string => {
    const v = s[key]?.value;
    if (typeof v !== "string") throw new Error(`Seed setting "${key}" must be a string`);
    return v;
  };
  return {
    effectiveDate: str("Effective Date of the Order").slice(0, 10),
    registrationPeriodDays: num("Registration Period (days)"),
    extensionDays: num("Extension of Registration Period (days)"),
    newOperatorLeadDays: num("New operators: register at least (days) before start"),
    determinationDays: num("Commission determination period (days)"),
    deficiencyDays: num("Deficiency response period (days)"),
    licenceApplicationDays: num("Unlicensed operators: licence application within (days)"),
    licenceExpiryWindowDays: num("Licence expiry window for renewal flag (days)"),
    amberWarningDays: num("Amber warning: days before determination due"),
    ownUseThresholdKw: num("Own-use notification threshold (kW)"),
    showCauseDays: 14,
    registrationPrefix: str("Registration number prefix"),
    ackPrefix: str("Acknowledgement number prefix"),
    ounPrefix: str("Own-use notification number prefix"),
    paymentPrefix: str("Payment record prefix"),
    chairmanName: str("Signatory: Chairman / Chief Executive Officer"),
    commissionerName: str("Signatory: Commissioner"),
    // §8.9: the workbook disagrees with itself (20 vs 21 Oct); left for an admin to set once.
    feesRevisedOn: null,
    policy: { ...DEFAULT_POLICY },
  };
}

export function findActivity(name: string | null, ref: ReferenceData): Activity | null {
  if (!name) return null;
  return ref.activities.find((a) => a.name === name) ?? null;
}

export function findFeeRow(category: string | null, ref: ReferenceData): FeeRow | null {
  if (!category) return null;
  return ref.fees.find((f) => f.category === category) ?? null;
}
