import { yearOf } from "./dates";
import { STATUS, type IsoDate, type Status } from "./types";

// §3 number formats. Sequences themselves come from the DB inside the saving transaction.

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** OGSERC/ACK/{yyyy of dateSubmitted}/{00000} */
export function formatAckNo(prefix: string, dateSubmitted: IsoDate, sequence: number): string {
  return `${prefix}/${yearOf(dateSubmitted)}/${pad(sequence, 5)}`;
}

/** OGSERC/PAY/{yyyy of dateReceived}/{00000} */
export function formatPaymentNo(prefix: string, dateReceived: IsoDate, sequence: number): string {
  return `${prefix}/${yearOf(dateReceived)}/${pad(sequence, 5)}`;
}

/** OGSERC/OUN/{yyyy of dateFiled}/{0000} */
export function formatOunNo(prefix: string, dateFiled: IsoDate, sequence: number): string {
  return `${prefix}/${yearOf(dateFiled)}/${pad(sequence, 4)}`;
}

/** OGSERC/REG/{yyyy of certificateIssueDate}/{category}-{activityCode}/{0000} */
export function formatRegistrationNo(
  prefix: string,
  certificateIssueDate: IsoDate,
  category: string,
  activityCode: string,
  serial: number,
): string {
  return `${prefix}/${yearOf(certificateIssueDate)}/${category}-${activityCode}/${pad(serial, 4)}`;
}

/**
 * Next registration serial for the year of `issueDate`: certificates issued that calendar year, in issue
 * order, across all categories. `existing` is every locked registration number.
 */
export function nextRegistrationSerial(
  prefix: string,
  issueDate: IsoDate,
  existing: readonly string[],
): number {
  const yearPrefix = `${prefix}/${yearOf(issueDate)}/`;
  let max = 0;
  for (const regNo of existing) {
    if (!regNo.startsWith(yearPrefix)) continue;
    const serial = Number(regNo.slice(regNo.lastIndexOf("/") + 1));
    if (Number.isInteger(serial) && serial > max) max = serial;
  }
  return max + 1;
}

/** OGSERC/DEF/{yyyy of notice}/{serial from ack}, e.g. ack .../00002 → OGSERC/DEF/2026/00002. */
export function deficiencyNoticeRef(
  ackNo: string,
  noticeDate: IsoDate,
  prefix = "OGSERC/DEF",
): string {
  return `${prefix}/${yearOf(noticeDate)}/${ackNo.slice(ackNo.lastIndexOf("/") + 1)}`;
}

/** Last 4 characters of the registration number. */
export function certificateSerial(registrationNo: string): string {
  return registrationNo.slice(-4);
}

/** §2.10: registration number in use. During provisional registration the ack number serves (para 13(4)). */
export function registrationNoInUse(
  registrationNo: string | null,
  status: Status | null,
  ackNo: string | null,
): string | null {
  if (registrationNo) return registrationNo;
  if (status === STATUS.PROVISIONAL) return ackNo;
  return null;
}
