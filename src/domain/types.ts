import type { Conditions } from "./forms";
import type { PricingSnapshot } from "./pricing";

/** Calendar date without time, "YYYY-MM-DD". Legal dates are stored and compared this way. */
export type IsoDate = string;

/** Money as integer kobo (₦1 = 100 kobo). Never use floats for money. */
export type Kobo = number;

export type YesNo = "Y" | "N";

/** Value of a document-checklist item or an evaluation check. `null` = blank (pending). */
export type CheckValue = "Y" | "N" | "N/A" | null;

export const STATUS = {
  /** First status: acknowledged, waiting for Finance to confirm payment (the Finance gate). */
  AWAITING: "Acknowledged - Awaiting Payment",
  RECEIVED: "Received - Under Review",
  DEFICIENCY: "Deficiency Notice Issued",
  PROVISIONAL: "Provisionally Registered",
  REGISTERED: "Registered",
  LAPSED: "Lapsed",
  REFUSED: "Refused",
  CANCELLED: "Cancelled",
  /** An update or annual confirmation approved and applied to its registered record (para 16). */
  APPLIED: "Changes Applied",
} as const;

export type Status = (typeof STATUS)[keyof typeof STATUS];

export const STATUSES: readonly Status[] = Object.values(STATUS);

export const CLOSED_STATUSES: readonly Status[] = [
  STATUS.REGISTERED,
  STATUS.REFUSED,
  STATUS.LAPSED,
  STATUS.CANCELLED,
  STATUS.APPLIED,
];

export function isClosed(status: Status | null): boolean {
  return status !== null && CLOSED_STATUSES.includes(status);
}

/** Licence statuses that domain rules test for (full list is in seed `licence_statuses`). */
export const LICENCE = {
  UNLICENSED: "Unlicensed",
  PENDING: "Licence application pending",
  MULTI_STATE: "NERC licence (multi-State)",
} as const;

export const FINAL_DECISION = {
  REGISTER: "Register (13(1)(a))",
  DEFICIENCY: "Issue deficiency notice (13(1)(b))",
  REFUSE: "Refuse (13(3)) - after show-cause",
  LAPSE: "Treat as lapsed (13(2))",
  PROVISIONAL: "Provisional registration (13(4))",
  REDIRECT: "Redirect to REG-01I / outside scope",
  /** Updates and annual confirmations: approved, and their changes applied to the registered record. */
  APPLY: "Accept filing and apply changes (para 16)",
} as const;

export type FinalDecision = (typeof FINAL_DECISION)[keyof typeof FINAL_DECISION];

/** A payment ledger row (SPEC §1.4), reduced to what domain rules need. */
export interface PaymentInput {
  reference: string;
  amount: Kobo;
  dateReceived: IsoDate;
  rrr?: string | null;
  verifiedWithBank?: YesNo | null;
  /** Reversed payments stay on record but are excluded from every total. */
  status?: "ACTIVE" | "REVERSED";
  /** Finance decision. Only CONFIRMED payments count towards amounts paid (the Finance gate). */
  financeStatus: FinanceStatus;
}

export type FinanceStatus = "PENDING" | "CONFIRMED" | "REJECTED";

/** What a submission is (registration-forms.json `filing_types`). */
export const FILING = {
  NEW: "NEW",
  /** Material change, para 16(1). */
  UPDATE: "UPDATE",
  /** Para 16(2): due by 31 January each year (Settings). */
  ANNUAL: "ANNUAL",
} as const;

export type FilingType = (typeof FILING)[keyof typeof FILING];

export const FILING_LABELS: Record<FilingType, string> = {
  NEW: "New registration",
  UPDATE: "Update: material change (para 16(1))",
  ANNUAL: "Annual confirmation (para 16(2))",
};

/** Updates and annual confirmations link to an existing registered submission. */
export const isLinkedFiling = (t: FilingType | null | undefined) => !!t && t !== FILING.NEW;

/** A row of the licences table (Schedule 1 C). */
export interface LicenceInput {
  type: string | null;
  issuingAuthority: string | null;
  number: string | null;
  issueDate: IsoDate | null;
  expiryDate: IsoDate | null;
  activityCovered: string | null;
}

/** A Register row (SPEC §1.1) plus its document checklist (§1.2). */
export interface SubmissionInput {
  id: string;
  ackNo: string | null;
  filingType: FilingType;
  /** Form the applicant used, "REG-01A" … "REG-01K" (not REG-01I, which is own-use). */
  formFiled: string | null;
  /** Updates and annual confirmations: the registered submission they refer to. */
  linkedSubmissionId: string | null;
  registeredName: string | null;
  dateSubmitted: IsoDate | null;
  submissionChannel: string | null;
  registrantType: string | null;
  cacNo: string | null;
  tin: string | null;
  address: string | null;
  principalLga: string | null;
  /** Every LGA served (multi-select); the principal LGA counts as served whether ticked or not. */
  lgasServed: string[];
  /** Towns, communities, estates or industrial clusters served (free text). */
  otherAreasServed: string | null;
  primaryActivity: string | null;
  /** Every other activity ticked (names); "highest category applies" across all of them. */
  otherActivities: string[];
  installedCapacityMw: number | null;
  customers: number | null;
  licenceStatus: string | null;
  licences: LicenceInput[];
  complianceOfficer: string | null;
  phone: string | null;
  email: string | null;
  operatingOnEffectiveDate: YesNo | null;
  plannedStartDate: IsoDate | null;
  approvedWaiver: Kobo;
  categoryOverride: string | null;
  overrideReason: string | null;
  /** Category the evaluator confirmed ("Category confirmed" action), with a reason if it differs from the form. */
  confirmedCategory: string | null;
  categoryConfirmedReason: string | null;
  status: Status | null;
  dateSubmissionComplete: IsoDate | null;
  deficiencyNoticeDate: IsoDate | null;
  certificateIssueDate: IsoDate | null;
  /** Locked registration number; set only by the approval action. */
  registrationNo: string | null;
  remarks: string | null;
  /** Stored checklist values by shared document key (absent = blank). */
  documents: Record<string, CheckValue>;
  /** Yes/no answers that make conditional documents N/A (registration-forms.json `required_when`). */
  conditions: Conditions;
  /** Pricing frozen when the submission was saved; null for one not yet saved (priced live). */
  pricing: PricingSnapshot | null;
  /** When confirmed payments first cleared the Finance gate (set by the release; locked). */
  releasedForEvaluationDate: IsoDate | null;
  /** From the evaluation (§1.3): when the evaluating officer started. */
  dateEvaluationStarted: IsoDate | null;
}

/** Form OGSERC/EVAL-01 (SPEC §1.3). `checks` holds manually entered values keyed by check id. */
export interface EvaluationInput {
  evaluatingOfficerId: string | null;
  reviewingSupervisorId: string | null;
  approvingOfficerId: string | null;
  dateEvaluationStarted: IsoDate | null;
  checks: Record<string, CheckValue>;
  evaluationRemarks: string | null;
  finalDecision: FinalDecision | null;
  reasons: string | null;
  reviewDate: IsoDate | null;
  approvalDate: IsoDate | null;
  /** Written reason from an approver for approving despite unresolved data flags (SPEC §4.6). */
  flagOverrideReason: string | null;
}
