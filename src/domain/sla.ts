import { daysBetween } from "./dates";
import type { Settings } from "./reference";
import { STATUS, isClosed, type IsoDate, type Status } from "./types";

export type SlaLight = "Red" | "Amber" | "Green";

/** §2.9: whole days since submission while the record is open; null once closed. */
export function daysInQueue(
  status: Status | null,
  dateSubmitted: IsoDate | null,
  today: IsoDate,
): number | null {
  if (isClosed(status) || !dateSubmitted) return null;
  return Math.max(0, daysBetween(dateSubmitted, today));
}

export interface SlaInput {
  status: Status | null;
  daysInQueue: number | null;
  determinationDue: IsoDate | null;
  deficiencyResponseDue: IsoDate | null;
}

/**
 * §2.9 traffic light. None while acknowledged and awaiting payment: the determination clock has not
 * started until Finance confirms payment (§4.12).
 */
export function slaLight(input: SlaInput, today: IsoDate, settings: Settings): SlaLight | null {
  const { status, determinationDue, deficiencyResponseDue } = input;
  if (input.daysInQueue === null || status === STATUS.PROVISIONAL || status === STATUS.AWAITING)
    return null;
  if (
    (determinationDue && today > determinationDue) ||
    (status === STATUS.DEFICIENCY && deficiencyResponseDue && today > deficiencyResponseDue)
  ) {
    return "Red";
  }
  if (
    (determinationDue && daysBetween(today, determinationDue) <= settings.amberWarningDays) ||
    (!determinationDue && input.daysInQueue > settings.determinationDays)
  ) {
    return "Amber";
  }
  return "Green";
}
