// Format validation (SPEC §8.5). Inputs are assumed non-empty; callers decide whether the field is required.

const CAC_RE = /^(RC|BN|IT)\s?\d+$/i;
const PHONE_LOCAL_RE = /^0\d{10}$/;
const PHONE_INTL_RE = /^\+234\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** CAC number: RC, BN or IT prefix followed by digits. */
export function isValidCac(cac: string): boolean {
  return CAC_RE.test(cac.trim());
}

/** Nigerian phone: 11 digits starting with 0, or +234 followed by 10 digits. Spaces and hyphens are ignored. */
export function isValidPhone(phone: string): boolean {
  const compact = phone.replace(/[\s-]/g, "");
  return PHONE_LOCAL_RE.test(compact) || PHONE_INTL_RE.test(compact);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** TIN format is not yet confirmed by Finance (§9.7); with no pattern configured every TIN passes. */
export function isValidTin(tin: string, pattern: string | null): boolean {
  if (!pattern) return true;
  return new RegExp(pattern).test(tin.trim());
}
