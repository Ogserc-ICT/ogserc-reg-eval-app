// Own-use form field names (a "use server" file may only export async functions).
export const OWN_USE_FIELDS = [
  "name",
  "dateFiled",
  "cacNo",
  "siteAddress",
  "lga",
  "natureOfBusiness",
  "gridConnected",
  "distributionLicensee",
  /** Generator units, as a JSON table. */
  "units",
  "contactPerson",
  "phone",
  "email",
] as const;
