import type {
  Submission,
  SubmissionConfidentiality,
  SubmissionDirector,
  SubmissionHseIncident,
  SubmissionLicence,
  SubmissionShareholder,
} from "@prisma/client";
import { formatDate } from "@/domain/dates";
import type { FilingValues } from "@/domain/filing";
import { toIsoDate } from "./reference-data";

// A submission's fields and child tables as one-line text: for audit entries (old → new) and for
// the changes an approved update applies to its registered record.

type Dated = Date | null;
const day = (d: Dated) => (d ? formatDate(toIsoDate(d)) : null);
const parts = (...xs: (string | null | undefined)[]) => xs.filter((x) => x && x.trim()).join(", ");
const joined = (rows: string[]) => (rows.length ? rows.join("; ") : null);

export type LicenceText = Pick<
  SubmissionLicence,
  "type" | "issuingAuthority" | "number" | "issueDate" | "expiryDate" | "activityCovered"
>;
export type ShareholderText = Pick<
  SubmissionShareholder,
  "name" | "nationality" | "beneficialOwner"
> & {
  /** A Decimal from the DB, or a number about to be stored. */
  percentHolding: { toString(): string } | null;
};
export type DirectorText = Pick<SubmissionDirector, "name" | "position" | "phone" | "email">;
export type ClaimText = Pick<SubmissionConfidentiality, "item" | "reasons">;
export type IncidentText = Pick<
  SubmissionHseIncident,
  "date" | "location" | "type" | "description"
>;

export const licencesText = (rows: readonly LicenceText[]) =>
  joined(
    rows.map((l) =>
      parts(
        l.type,
        l.issuingAuthority,
        l.number && `No. ${l.number}`,
        l.issueDate && `issued ${day(l.issueDate)}`,
        l.expiryDate && `expires ${day(l.expiryDate)}`,
        l.activityCovered,
      ),
    ),
  );

export const shareholdersText = (rows: readonly ShareholderText[]) =>
  joined(
    rows.map((h) => {
      const detail = parts(
        h.nationality,
        h.percentHolding !== null ? `${h.percentHolding.toString()}%` : null,
        h.beneficialOwner === null
          ? null
          : h.beneficialOwner
            ? "beneficial owner"
            : "not beneficial owner",
      );
      return detail ? `${h.name} (${detail})` : h.name;
    }),
  );

export const directorsText = (rows: readonly DirectorText[]) =>
  joined(
    rows.map((d) => {
      const detail = parts(d.position, d.phone, d.email);
      return detail ? `${d.name} (${detail})` : d.name;
    }),
  );

export const claimsText = (rows: readonly ClaimText[]) =>
  joined(rows.map((c) => (c.reasons ? `${c.item}: ${c.reasons}` : c.item)));

export const incidentsText = (rows: readonly IncidentText[]) =>
  joined(
    rows.map((i) => {
      const head = parts(day(i.date), i.location, i.type);
      return i.description ? `${head}${head ? ": " : ""}${i.description}` : head;
    }),
  );

export const signatoriesText = (
  s: Pick<
    Submission,
    | "signatory1Name"
    | "signatory1Designation"
    | "signatory1Date"
    | "signatory2Name"
    | "signatory2Designation"
    | "signatory2Date"
  >,
) =>
  joined(
    [
      parts(s.signatory1Name, s.signatory1Designation, day(s.signatory1Date)),
      parts(s.signatory2Name, s.signatory2Designation, day(s.signatory2Date)),
    ].filter(Boolean),
  );

/** One scalar column as text (dates as "22 October 2026", booleans Y/N, decimals as numbers). */
export function columnText(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return formatDate(toIsoDate(v));
  if (typeof v === "boolean") return v ? "Y" : "N";
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  if (typeof v === "object" && "toNumber" in (v as object))
    return String((v as { toNumber(): number }).toNumber());
  return String(v);
}

/** A submission with the children that updates can change. */
export type SubmissionWithChildren = Submission & {
  otherActivities: { activityCode: string }[];
  licences: LicenceText[];
  shareholders: ShareholderText[];
  directors: DirectorText[];
  confidentialityClaims: ClaimText[];
  hseIncidents: IncidentText[];
};

export const childrenInclude = {
  otherActivities: { orderBy: { sortOrder: "asc" } },
  licences: { orderBy: { sortOrder: "asc" } },
  shareholders: { orderBy: { sortOrder: "asc" } },
  directors: { orderBy: { sortOrder: "asc" } },
  confidentialityClaims: { orderBy: { sortOrder: "asc" } },
  hseIncidents: { orderBy: { sortOrder: "asc" } },
} as const;

/** Every field an approved update can change (FILING_FIELDS), as text. */
export function filingValues(s: SubmissionWithChildren): FilingValues {
  return {
    registeredName: s.registeredName,
    tradingName: s.tradingName,
    registrantType: s.registrantType,
    cacNo: s.cacNo,
    incorporationDate: day(s.incorporationDate),
    tin: s.tin,
    address: s.address,
    operationalAddress: s.operationalAddress,
    website: s.website,
    principalLga: s.principalLga,
    lgasServed: columnText(s.lgasServed),
    otherAreasServed: s.otherAreasServed,
    primaryActivityCode: s.primaryActivityCode,
    otherActivities: columnText(s.otherActivities.map((a) => a.activityCode)),
    installedCapacityMw: columnText(s.installedCapacityMw),
    customers: columnText(s.customers),
    licenceStatus: s.licenceStatus,
    licences: licencesText(s.licences),
    shareholders: shareholdersText(s.shareholders),
    directors: directorsText(s.directors),
    mdName: s.mdName,
    mdPhone: s.mdPhone,
    mdEmail: s.mdEmail,
    complianceOfficer: s.complianceOfficer,
    phone: s.phone,
    email: s.email,
    confidentialityClaims: claimsText(s.confidentialityClaims),
    hseIncidents: incidentsText(s.hseIncidents),
    signatories: signatoriesText(s),
  };
}
