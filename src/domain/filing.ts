// Updates (material change, para 16(1)) and annual confirmations (para 16(2)) are new records that
// link to a registered submission. Once approved, their changes are applied to that record; the
// registered record is never edited directly by the filing.

/** A field an approved filing can change on its registered record. */
export interface FilingField {
  key: string;
  label: string;
  /** Printed on the certificate: changing it marks the certificate "needs reissue". */
  certificate: boolean;
}

export const FILING_FIELDS: readonly FilingField[] = [
  { key: "registeredName", label: "registered name", certificate: true },
  { key: "tradingName", label: "trading name", certificate: false },
  { key: "registrantType", label: "registrant type", certificate: false },
  { key: "cacNo", label: "CAC no.", certificate: true },
  { key: "incorporationDate", label: "date of incorporation", certificate: false },
  { key: "tin", label: "TIN", certificate: false },
  { key: "address", label: "registered address", certificate: true },
  { key: "operationalAddress", label: "operational address", certificate: false },
  { key: "website", label: "website", certificate: false },
  { key: "principalLga", label: "principal LGA", certificate: true },
  { key: "lgasServed", label: "LGAs served", certificate: true },
  { key: "otherAreasServed", label: "towns / estates served", certificate: true },
  { key: "primaryActivityCode", label: "primary activity", certificate: true },
  { key: "otherActivities", label: "other activities", certificate: true },
  { key: "installedCapacityMw", label: "capacity (MW)", certificate: false },
  { key: "customers", label: "customers", certificate: false },
  { key: "licenceStatus", label: "licence status", certificate: true },
  { key: "licences", label: "licences", certificate: true },
  { key: "shareholders", label: "shareholders", certificate: false },
  { key: "directors", label: "directors and key officers", certificate: false },
  { key: "mdName", label: "managing director", certificate: false },
  { key: "mdPhone", label: "MD phone", certificate: false },
  { key: "mdEmail", label: "MD email", certificate: false },
  { key: "complianceOfficer", label: "compliance officer", certificate: false },
  { key: "phone", label: "compliance officer phone", certificate: false },
  { key: "email", label: "compliance officer email", certificate: false },
  { key: "confidentialityClaims", label: "confidentiality claims", certificate: false },
  { key: "hseIncidents", label: "HSE incidents", certificate: false },
  { key: "signatories", label: "signatories", certificate: false },
];

/** Each field as display text (blank = null), as the server renders both records. */
export type FilingValues = Readonly<Record<string, string | null>>;

export interface FieldChange {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
  certificate: boolean;
}

const blank = (v: string | null | undefined) => (v === undefined || v === "" ? null : v);

/** What approving the filing would change on the registered record, field by field. */
export function filingChanges(registered: FilingValues, filing: FilingValues): FieldChange[] {
  return FILING_FIELDS.flatMap((f) => {
    const before = blank(registered[f.key]);
    const after = blank(filing[f.key]);
    return before === after ? [] : [{ ...f, before, after }];
  });
}

/** "registered name: Old Ltd → New Ltd; CAC no.: (blank) → RC1" for the audit log. */
export function describeChanges(changes: readonly FieldChange[]): string {
  return changes
    .map((c) => `${c.label}: ${c.before ?? "(blank)"} → ${c.after ?? "(blank)"}`)
    .join("; ");
}
