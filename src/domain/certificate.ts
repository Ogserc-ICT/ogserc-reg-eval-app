import { certificateDateParts } from "./dates";
import { certificateSerial } from "./numbers";
import type { Settings } from "./reference";
import type { Assessment } from "./submission";
import { LICENCE, STATUS, type SubmissionInput } from "./types";
import { signatoriesMissing } from "./workflow";

/** CERT-01 merge fields (SPEC §7). */
export interface CertificateFields {
  SERIAL: string;
  REG_NO: string;
  NAME: string;
  CAC: string;
  ADDRESS: string;
  CATEGORY: string;
  ACTIVITY: string;
  OTHER: string;
  AREA: string;
  LICENCE: string;
  DAY: string;
  MONTH: string;
  YEAR: string;
  CHAIR_NAME: string;
  COMM_NAME: string;
}

/** Every reason a certificate cannot be produced now. */
export function certificateBlockers(
  sub: SubmissionInput,
  a: Assessment,
  settings: Settings,
): string[] {
  const reasons: string[] = [];
  if (sub.status !== STATUS.REGISTERED) reasons.push(`Status is ${sub.status}, not Registered`);
  if (!sub.registrationNo) reasons.push("No locked registration number");
  if (!sub.certificateIssueDate) reasons.push("No certificate issue date");
  if (!a.categoryApplied) reasons.push("No registration category");
  if (signatoriesMissing(settings))
    reasons.push("Certificate signatory names are not set in Settings");
  return reasons;
}

/** Licence line: none held → "None — application pending"; else the status and number if any. */
export function licenceText(licenceStatus: string | null, licenceNo: string | null): string {
  if (!licenceStatus || licenceStatus === LICENCE.UNLICENSED) return "None — application pending";
  return licenceNo?.trim() ? `${licenceStatus}, No. ${licenceNo.trim()}` : licenceStatus;
}

/** SPEC §7 field mapping. Call only when `certificateBlockers` is empty. */
export function certificateFields(
  sub: SubmissionInput,
  a: Assessment,
  settings: Settings,
): CertificateFields {
  const regNo = sub.registrationNo!;
  const date = certificateDateParts(sub.certificateIssueDate!);
  const other = sub.otherAreasServed?.trim();
  return {
    SERIAL: certificateSerial(regNo),
    REG_NO: regNo,
    NAME: (sub.registeredName ?? "").toUpperCase(),
    CAC: sub.cacNo?.trim() || "N/A",
    ADDRESS: sub.address?.trim() || "—",
    CATEGORY: `${a.categoryApplied} — ${a.categoryDescription ?? ""}`.trim(),
    ACTIVITY: sub.primaryActivity ?? "—",
    OTHER: sub.secondaryActivity?.trim() || "None",
    AREA: other ? `${sub.principalLga}; ${other}` : (sub.principalLga ?? "—"),
    LICENCE: licenceText(sub.licenceStatus, sub.licenceNo),
    DAY: date.day,
    MONTH: date.month,
    YEAR: date.year,
    CHAIR_NAME: settings.chairmanName.trim(),
    COMM_NAME: settings.commissionerName.trim(),
  };
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0–999 in words: 14 → "fourteen", 30 → "thirty", 183 → "one hundred and eighty-three". */
export function numberInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "");
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` and ${numberInWords(rest)}` : ""}`;
}

/** Legal style used in the letters: "thirty (30)". */
export function countInWords(n: number): string {
  return `${numberInWords(n)} (${n})`;
}
