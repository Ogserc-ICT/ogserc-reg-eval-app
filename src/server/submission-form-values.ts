import type { Submission } from "@prisma/client";
import { CONDITION_KEYS } from "@/domain/forms";
import { CONDITION_FIELDS } from "@/lib/schemas";
import { toIsoDate } from "./reference-data";
import { CONDITION_COLUMNS } from "./submissions";
import type { SubmissionWithChildren } from "./submission-text";

const s = (v: string | null | undefined) => v ?? "";
const d = (v: Date | null) => s(toIsoDate(v));
const yn = (v: boolean | null) => (v === null ? "" : v ? "Y" : "N");

/**
 * A stored submission as the intake form's values: text per field, tables and multi-selects as
 * JSON (as the form posts them).
 */
export function submissionFormValues(
  row: SubmissionWithChildren,
  linkedRegistrationNo: string | null,
): Record<string, string> {
  const r = row as Submission & SubmissionWithChildren;
  return {
    filingType: r.filingType,
    formFiled: r.formFiled,
    linkedRegistrationNo: s(linkedRegistrationNo),
    registeredName: r.registeredName,
    tradingName: s(r.tradingName),
    dateSubmitted: d(r.dateSubmitted),
    submissionChannel: s(r.submissionChannel),
    registrantType: s(r.registrantType),
    cacNo: s(r.cacNo),
    incorporationDate: d(r.incorporationDate),
    tin: s(r.tin),
    address: s(r.address),
    operationalAddress: s(r.operationalAddress),
    website: s(r.website),
    principalLga: r.principalLga,
    lgasServed: JSON.stringify(r.lgasServed),
    otherAreasServed: s(r.otherAreasServed),
    primaryActivityCode: r.primaryActivityCode,
    otherActivityCodes: JSON.stringify(r.otherActivities.map((a) => a.activityCode)),
    installedCapacityMw: r.installedCapacityMw?.toString() ?? "",
    customers: r.customers?.toString() ?? "",
    licenceStatus: r.licenceStatus,
    licences: JSON.stringify(
      r.licences.map((l) => ({
        type: s(l.type),
        issuingAuthority: s(l.issuingAuthority),
        number: s(l.number),
        issueDate: d(l.issueDate),
        expiryDate: d(l.expiryDate),
        activityCovered: s(l.activityCovered),
      })),
    ),
    shareholders: JSON.stringify(
      r.shareholders.map((h) => ({
        name: h.name,
        nationality: s(h.nationality),
        percentHolding: h.percentHolding?.toString() ?? "",
        beneficialOwner: yn(h.beneficialOwner),
      })),
    ),
    directors: JSON.stringify(
      r.directors.map((x) => ({
        name: x.name,
        position: s(x.position),
        phone: s(x.phone),
        email: s(x.email),
      })),
    ),
    mdName: s(r.mdName),
    mdPhone: s(r.mdPhone),
    mdEmail: s(r.mdEmail),
    complianceOfficer: s(r.complianceOfficer),
    phone: s(r.phone),
    email: s(r.email),
    confidentialityClaims: JSON.stringify(
      r.confidentialityClaims.map((c) => ({ item: c.item, reasons: s(c.reasons) })),
    ),
    hseIncidents: JSON.stringify(
      r.hseIncidents.map((h) => ({
        date: d(h.date),
        location: s(h.location),
        type: s(h.type),
        description: s(h.description),
      })),
    ),
    signatory1Name: s(r.signatory1Name),
    signatory1Designation: s(r.signatory1Designation),
    signatory1Date: d(r.signatory1Date),
    signatory2Name: s(r.signatory2Name),
    signatory2Designation: s(r.signatory2Designation),
    signatory2Date: d(r.signatory2Date),
    ...Object.fromEntries(
      CONDITION_KEYS.map((k) => [CONDITION_FIELDS[k], yn(r[CONDITION_COLUMNS[k]])]),
    ),
    operatingOnEffectiveDate: r.operatingOnEffectiveDate ? "Y" : "N",
    plannedStartDate: d(r.plannedStartDate),
    categoryOverride: s(r.categoryOverride),
    overrideReason: s(r.overrideReason),
    remarks: s(r.remarks),
  };
}

/**
 * An update or annual confirmation starts as a copy of its registered record, so only what really
 * changed differs (and is applied on approval). Receipt details start fresh.
 */
export function filingFormValues(
  registered: SubmissionWithChildren,
  filingType: "UPDATE" | "ANNUAL",
  today: string,
): Record<string, string> {
  return {
    ...submissionFormValues(registered, registered.registrationNo),
    filingType,
    dateSubmitted: today,
    submissionChannel: "",
    categoryOverride: "",
    overrideReason: "",
    remarks: "",
  };
}
