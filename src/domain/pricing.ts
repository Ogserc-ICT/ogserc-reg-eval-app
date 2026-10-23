import { categoryApplied, categoryAuto } from "./category";
import { registrationDeadline } from "./deadlines";
import { formatDate } from "./dates";
import { formatNaira } from "./money";
import { findFeeRow, type ReferenceData, type Settings } from "./reference";
import type { IsoDate, Kobo, SubmissionInput } from "./types";

/** The Schedule 3 amounts a submission is charged under. */
export interface FeeTerms {
  registrationFee: Kobo;
  lateInitial: Kobo;
  lateDaily: Kobo;
  lateDailyCap: Kobo;
}

/**
 * Pricing frozen on the submission when it is saved, so later edits to the fee table or Settings
 * never change what an existing submission owes. Only an admin recalculation replaces it.
 */
export interface PricingSnapshot extends FeeTerms {
  category: string;
  /** Registration deadline used for days late. */
  deadline: IsoDate | null;
  /** Effective Date in force when priced (also drives licence dates for this submission). */
  effectiveDate: IsoDate;
}

export const NO_FEE_TERMS: FeeTerms = {
  registrationFee: 0,
  lateInitial: 0,
  lateDaily: 0,
  lateDailyCap: 0,
};

export function feeTermsFor(category: string | null, ref: ReferenceData): FeeTerms {
  const row = findFeeRow(category, ref);
  if (!row) return NO_FEE_TERMS;
  return {
    registrationFee: row.registrationFee,
    lateInitial: row.lateInitial,
    lateDaily: row.lateDaily,
    lateDailyCap: row.lateDailyCap,
  };
}

export type PricingInput = Pick<
  SubmissionInput,
  | "primaryActivity"
  | "secondaryActivity"
  | "installedCapacityMw"
  | "categoryOverride"
  | "operatingOnEffectiveDate"
  | "plannedStartDate"
>;

/** Price a submission under the current fee table and Settings. Null if no category can be determined. */
export function priceSubmission(
  input: PricingInput,
  ref: ReferenceData,
  settings: Settings,
): PricingSnapshot | null {
  const category = categoryApplied(input.categoryOverride, categoryAuto(input, ref));
  if (!category || !findFeeRow(category, ref)) return null;
  return {
    category,
    ...feeTermsFor(category, ref),
    deadline: registrationDeadline(
      input.operatingOnEffectiveDate,
      input.plannedStartDate,
      settings,
    ),
    effectiveDate: settings.effectiveDate,
  };
}

/** Human-readable differences between two snapshots, e.g. for the recalculation audit entry. */
export function pricingDifferences(
  before: PricingSnapshot,
  after: PricingSnapshot | null,
): string[] {
  if (!after) return ["category can no longer be determined"];
  const date = (d: IsoDate | null) => (d ? formatDate(d) : "none");
  const out: string[] = [];
  const diff = (label: string, a: string, b: string) => {
    if (a !== b) out.push(`${label} ${a} → ${b}`);
  };
  diff("category", before.category, after.category);
  diff("fee", formatNaira(before.registrationFee), formatNaira(after.registrationFee));
  diff("late initial", formatNaira(before.lateInitial), formatNaira(after.lateInitial));
  diff("late daily", formatNaira(before.lateDaily), formatNaira(after.lateDaily));
  diff("late cap", formatNaira(before.lateDailyCap), formatNaira(after.lateDailyCap));
  diff("deadline", date(before.deadline), date(after.deadline));
  diff("Effective Date", date(before.effectiveDate), date(after.effectiveDate));
  return out;
}
