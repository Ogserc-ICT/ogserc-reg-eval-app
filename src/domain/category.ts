import { findActivity, findFeeRow, type Activity, type ReferenceData } from "./reference";

/** §2.1: activity code, or null if the activity is missing or not in the list. */
export function activityCode(activityName: string | null, ref: ReferenceData): string | null {
  return findActivity(activityName, ref)?.code ?? null;
}

/** §2.2: category for one activity at the given installed capacity. */
export function categoryForActivity(
  activity: Activity | null,
  capacityMw: number | null,
): string | null {
  if (!activity) return null;
  const cap = capacityMw ?? 0;
  if (cap >= 10) return activity.cat10MwPlus;
  if (cap >= 1) return activity.cat1To10Mw;
  return activity.catBelow1Mw;
}

export interface CategoryInput {
  primaryActivity: string | null;
  secondaryActivity: string | null;
  installedCapacityMw: number | null;
}

/** §2.3: "highest applies" (para 17(1)). */
export function categoryAuto(input: CategoryInput, ref: ReferenceData): string | null {
  const primaryCat = categoryForActivity(
    findActivity(input.primaryActivity, ref),
    input.installedCapacityMw,
  );
  const secondaryCat = categoryForActivity(
    findActivity(input.secondaryActivity, ref),
    input.installedCapacityMw,
  );
  if (!primaryCat) return null;
  if (primaryCat === "A" || secondaryCat === "A") return "A";
  if (primaryCat === "B" || secondaryCat === "B") return "B";
  if (!secondaryCat) return primaryCat;
  const primaryFee = findFeeRow(primaryCat, ref)?.registrationFee ?? 0;
  const secondaryFee = findFeeRow(secondaryCat, ref)?.registrationFee ?? 0;
  return secondaryFee > primaryFee ? secondaryCat : primaryCat;
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
