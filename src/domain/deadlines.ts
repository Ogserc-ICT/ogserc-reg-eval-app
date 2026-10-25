import { addDays, daysBetween } from "./dates";
import type { Settings } from "./reference";
import { LICENCE, type IsoDate, type LicenceInput, type YesNo } from "./types";

/** Deadline for operators already operating on the Effective Date (para 11(1), 25). */
export function existingOperatorDeadline(settings: Settings): IsoDate {
  return addDays(settings.effectiveDate, settings.registrationPeriodDays + settings.extensionDays);
}

/** §2.4: registration deadline. New operators: start date minus lead days (para 11(2)); null if no start date. */
export function registrationDeadline(
  operatingOnEffectiveDate: YesNo | null,
  plannedStartDate: IsoDate | null,
  settings: Settings,
): IsoDate | null {
  if (operatingOnEffectiveDate === "Y") return existingOperatorDeadline(settings);
  if (!plannedStartDate) return null;
  return addDays(plannedStartDate, -settings.newOperatorLeadDays);
}

export function daysLate(dateSubmitted: IsoDate | null, deadline: IsoDate | null): number {
  if (!dateSubmitted || !deadline) return 0;
  return Math.max(0, daysBetween(deadline, dateSubmitted));
}

/** §2.8, para 13(1). */
export function determinationDue(
  dateSubmissionComplete: IsoDate | null,
  settings: Settings,
): IsoDate | null {
  return dateSubmissionComplete
    ? addDays(dateSubmissionComplete, settings.determinationDays)
    : null;
}

/** §2.8, para 13(1)(b). */
export function deficiencyResponseDue(
  deficiencyNoticeDate: IsoDate | null,
  settings: Settings,
): IsoDate | null {
  return deficiencyNoticeDate ? addDays(deficiencyNoticeDate, settings.deficiencyDays) : null;
}

/** §2.8, para 18(1). */
export function licenceApplicationDue(
  licenceStatus: string | null,
  settings: Settings,
): IsoDate | null {
  return licenceStatus === LICENCE.UNLICENSED
    ? addDays(settings.effectiveDate, settings.licenceApplicationDays)
    : null;
}

/** Licence expires within the window after the Effective Date (para 8(5)); used by a flag and check 4.3. */
export function licenceNeedsRenewal(
  licenceExpiry: IsoDate | null,
  effectiveDate: IsoDate,
  windowDays: number,
): boolean {
  if (!licenceExpiry) return false;
  return daysBetween(effectiveDate, licenceExpiry) <= windowDays;
}

/** The earliest expiry date in the licences table: licence flags and check 4.3 use it. */
export function nearestLicenceExpiry(licences: readonly LicenceInput[]): IsoDate | null {
  const dates = licences.map((l) => l.expiryDate).filter((d): d is IsoDate => !!d);
  return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null;
}

/** Para 16(2): the annual confirmation for `year` is due on Settings' "MM-DD" (31 January). */
export function annualConfirmationDue(
  year: number,
  settings: Pick<Settings, "annualConfirmationDue">,
): IsoDate {
  return `${year}-${settings.annualConfirmationDue}`;
}
