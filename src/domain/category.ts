import {
  findActivity,
  findFeeRow,
  type Activity,
  type Policy,
  type ReferenceData,
} from "./reference";

/** Activity code of Supply / retail, whose category at 1 MW or more is a policy setting. */
export const SUPPLY_RETAIL_CODE = "SUP";

/** §2.1: activity code, or null if the activity is missing or not in the list. */
export function activityCode(activityName: string | null, ref: ReferenceData): string | null {
  return findActivity(activityName, ref)?.code ?? null;
}

/** §2.2: category for one activity at the given installed capacity. */
export function categoryForActivity(
  activity: Activity | null,
  capacityMw: number | null,
  policy: Pick<Policy, "supplyRetailCategory1MwPlus">,
): string | null {
  if (!activity) return null;
  const cap = capacityMw ?? 0;
  if (activity.code === SUPPLY_RETAIL_CODE && cap >= 1) return policy.supplyRetailCategory1MwPlus;
  if (cap >= 10) return activity.cat10MwPlus;
  if (cap >= 1) return activity.cat1To10Mw;
  return activity.catBelow1Mw;
}

export interface CategoryInput {
  primaryActivity: string | null;
  /** Every other activity ticked. */
  otherActivities: readonly string[];
  installedCapacityMw: number | null;
}

/**
 * §2.3: "highest applies" (para 17(1)) across the primary and every other activity, all at the same
 * installed capacity. A and B always win; otherwise the highest registration fee, ties going to the
 * primary activity, then to the earlier activity ticked.
 */
export function categoryAuto(
  input: CategoryInput,
  ref: ReferenceData,
  policy: Pick<Policy, "supplyRetailCategory1MwPlus">,
): string | null {
  const at = (name: string | null) =>
    categoryForActivity(findActivity(name, ref), input.installedCapacityMw, policy);
  const primaryCat = at(input.primaryActivity);
  if (!primaryCat) return null;
  const cats = [primaryCat, ...input.otherActivities.map(at)].filter((c): c is string => !!c);
  if (cats.includes("A")) return "A";
  if (cats.includes("B")) return "B";
  const fee = (c: string) => findFeeRow(c, ref)?.registrationFee ?? 0;
  return cats.reduce((best, c) => (fee(c) > fee(best) ? c : best), primaryCat);
}

/** Categories of the other activities (not the primary's), for "other activities' documents". */
export function otherActivityCategories(
  input: CategoryInput,
  ref: ReferenceData,
  policy: Pick<Policy, "supplyRetailCategory1MwPlus">,
): string[] {
  const cats = input.otherActivities
    .map((name) => categoryForActivity(findActivity(name, ref), input.installedCapacityMw, policy))
    .filter((c): c is string => !!c);
  return [...new Set(cats)];
}

export function categoryApplied(
  categoryOverride: string | null,
  auto: string | null,
): string | null {
  return categoryOverride || auto;
}

export function categoryDescription(category: string | null, ref: ReferenceData): string | null {
  return findFeeRow(category, ref)?.description ?? null;
}

/** An override needs a reason when it differs from the auto category (§1.1). */
export function overrideNeedsReason(
  categoryOverride: string | null,
  auto: string | null,
  overrideReason: string | null,
): boolean {
  return !!categoryOverride && categoryOverride !== auto && !overrideReason?.trim();
}
