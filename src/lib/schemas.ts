// Zod schemas shared by forms (client) and server actions.
import { z } from "zod";
import { isIsoDate } from "@/domain/dates";
import { CONDITION_KEYS, OWN_USE_FORM, type ConditionKey } from "@/domain/forms";
import { parseNairaToKobo } from "@/domain/money";
import { ROLES } from "@/domain/roles";
import { isValidCac, isValidEmail, isValidPhone } from "@/domain/validation";

const isoDate = z.string().trim().refine(isIsoDate, "Enter a valid date (YYYY-MM-DD)");
const optionalIsoDate = z
  .string()
  .trim()
  .transform((s) => s || null)
  .refine((s) => s === null || isIsoDate(s), "Enter a valid date (YYYY-MM-DD)");
const days = z.coerce.number().int("Whole days only").min(0, "Cannot be negative").max(3650);
const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max);

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password is too long");

const userFields = {
  name: requiredText("Name", 100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  roles: z.array(z.enum(ROLES)).min(1, "Choose at least one role"),
};

export const userCreateSchema = z.object({ ...userFields, password: passwordSchema });
export type UserCreateInput = z.input<typeof userCreateSchema>;

export const userUpdateSchema = z.object({ ...userFields, active: z.boolean() });
export type UserUpdateInput = z.input<typeof userUpdateSchema>;

export const passwordResetSchema = z.object({ password: passwordSchema });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export const settingsSchema = z.object({
  effectiveDate: isoDate,
  registrationPeriodDays: days,
  extensionDays: days,
  newOperatorLeadDays: days,
  determinationDays: days,
  deficiencyDays: days,
  licenceApplicationDays: days,
  licenceExpiryWindowDays: days,
  amberWarningDays: days,
  showCauseDays: days,
  ownUseThresholdKw: z.coerce
    .number()
    .int()
    .min(1)
    .max(999, "Must be below 1,000 kW (para 3(3)(c))"),
  registrationPrefix: requiredText("Prefix", 40),
  ackPrefix: requiredText("Prefix", 40),
  ounPrefix: requiredText("Prefix", 40),
  paymentPrefix: requiredText("Prefix", 40),
  chairmanName: requiredText("Chairman / CEO name", 120),
  commissionerName: requiredText("Commissioner name", 120),
  feesRevisedOn: optionalIsoDate,
  lateChargeBlocksCompleteness: z.boolean(),
  waiverAppliesToLateCharge: z.boolean(),
  flagsBlockApproval: z.boolean(),
  lateChargeRequiredForRelease: z.boolean(),
  supplyRetailCategory1MwPlus: z
    .string()
    .trim()
    .regex(/^[A-HJK]$/, "Choose a Schedule 3 category (not I, which is own-use)"),
  wrongFormHandling: z.enum(["ACCEPT", "REQUIRE_CORRECT_FORM"]),
  otherActivitiesRequireDocuments: z.boolean(),
  ownUseCertificate: z.boolean(),
  filingFeeOnUpdates: z.boolean(),
  annualConfirmationDue: z
    .string()
    .trim()
    .refine(
      (s) => /^\d{2}-\d{2}$/.test(s) && isIsoDate(`2025-${s}`),
      "A day of the year as MM-DD, e.g. 01-31",
    ),
  unpaidReminderDays: z
    .string()
    .trim()
    .refine((s) => s === "" || /^\d+$/.test(s), "Whole days only, or leave blank")
    .transform((s) => (s === "" ? null : Number(s)))
    .refine((n) => n === null || (n >= 1 && n <= 3650), "Between 1 and 3,650 days, or blank"),
  tinPattern: z
    .string()
    .trim()
    .transform((s) => s || null)
    .refine((s) => {
      if (s === null) return true;
      try {
        new RegExp(s);
        return true;
      } catch {
        return false;
      }
    }, "Not a valid regular expression"),
});
export type SettingsInput = z.input<typeof settingsSchema>;

// ---------------------------------------------------------------------------
// Register, payments and own-use (Phase 3)
// ---------------------------------------------------------------------------

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null);

const optionalDecimal = (label: string, max: number) =>
  z
    .string()
    .trim()
    .transform((s) => s.replace(/,/g, ""))
    .refine((s) => s === "" || /^\d+(\.\d+)?$/.test(s), `${label} must be a number`)
    .transform((s) => (s === "" ? null : Number(s)))
    .refine((n) => n === null || n <= max, `${label} is too large`);

const optionalInt = (label: string) =>
  z
    .string()
    .trim()
    .transform((s) => s.replace(/,/g, ""))
    .refine((s) => s === "" || /^\d+$/.test(s), `${label} must be a whole number`)
    .transform((s) => (s === "" ? null : Number(s)));

const cac = optionalText(30)
  .transform((s) => (s ? s.replace(/\s+/g, "").toUpperCase() : null))
  .refine((s) => s === null || isValidCac(s), "CAC number must be RC, BN or IT followed by digits");
const phone = optionalText(30).refine(
  (s) => s === null || isValidPhone(s),
  "Nigerian phone: 11 digits starting with 0, or +234 and 10 digits",
);
const email = optionalText(200).refine((s) => s === null || isValidEmail(s), "Enter a valid email");

export const money = (label: string) =>
  z
    .string()
    .trim()
    .transform((s) => parseNairaToKobo(s))
    .refine((k): k is number => k !== null, `${label} must be an amount in naira, e.g. 250,000`);

/**
 * A table sent by the form as JSON (hidden input), or as an array by tests and imports. Rows that are
 * entirely blank are dropped before validation, so an empty line on the form is not an error.
 */
const table = <T extends z.ZodTypeAny>(row: T, max = 50) =>
  z.preprocess(
    (v) => {
      let rows = v;
      if (v === undefined || v === null || v === "") return [];
      if (typeof v === "string") {
        try {
          rows = JSON.parse(v);
        } catch {
          return v;
        }
      }
      if (!Array.isArray(rows)) return rows;
      return rows.filter(
        (r) =>
          typeof r !== "object" ||
          r === null ||
          Object.values(r).some((x) => x !== null && x !== undefined && String(x).trim() !== ""),
      );
    },
    z.array(row).max(max, `At most ${max} rows`),
  );

/** A multi-select sent as JSON (hidden input) or an array. */
const multi = (max: number) =>
  z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === "") return [];
      if (typeof v === "string") {
        try {
          return JSON.parse(v);
        } catch {
          return [v];
        }
      }
      return v;
    },
    z.array(z.string().trim().min(1).max(100)).max(max),
  );

const datedField = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((s) => s || null)
    .refine((s) => s === null || isIsoDate(s), `${label}: enter a valid date (YYYY-MM-DD)`);

const text = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => s || null);

/** Y / N / blank → "Y" | "N" | null. */
const yesNoBlank = z
  .enum(["Y", "N", ""])
  .optional()
  .transform((s) => (s ? s : null));

const licenceRow = z.object({
  type: text(100),
  issuingAuthority: text(100),
  number: text(100),
  issueDate: datedField("Issue date"),
  expiryDate: datedField("Expiry date"),
  activityCovered: text(200),
});
export type LicenceRow = z.output<typeof licenceRow>;

const shareholderRow = z.object({
  name: z.string().trim().min(1, "Shareholder name is required").max(200),
  nationality: text(100),
  percentHolding: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(String(v).replace("%", ""))))
    .refine(
      (n) => n === null || (Number.isFinite(n) && n >= 0 && n <= 100),
      "% holding must be 0 to 100",
    ),
  beneficialOwner: yesNoBlank,
});
export type ShareholderRow = z.output<typeof shareholderRow>;

const directorRow = z.object({
  name: z.string().trim().min(1, "Director name is required").max(200),
  position: text(100),
  phone: text(30).refine(
    (s) => s === null || isValidPhone(s),
    "Phone: 11 digits starting with 0, or +234 and 10 digits",
  ),
  email: text(200).refine((s) => s === null || isValidEmail(s), "Enter a valid email"),
});
export type DirectorRow = z.output<typeof directorRow>;

const confidentialityRow = z.object({
  item: z.string().trim().min(1, "Say which item is claimed as commercially sensitive").max(500),
  reasons: text(2000),
});
export type ConfidentialityRow = z.output<typeof confidentialityRow>;

export const HSE_TYPES = ["Incident", "Fatality", "Outage over 24 h"] as const;
const hseRow = z.object({
  date: datedField("Date"),
  location: text(200),
  type: z
    .enum([...HSE_TYPES, ""])
    .optional()
    .transform((s) => s || null),
  description: text(2000),
});
export type HseRow = z.output<typeof hseRow>;

/** Submission columns of each document condition, as the form names them. */
export const CONDITION_FIELDS: Record<ConditionKey, string> = {
  holds_any_licence: "holdsAnyLicence",
  multi_state_licensee: "multiStateLicensee",
  generation_for_sale: "generationForSale",
  grid_connected: "gridConnected",
  interconnected_minigrid: "interconnectedMinigrid",
  f_distribution: "fDistribution",
  f_trading: "fTrading",
  g_disco_bulk_supply: "gDiscoBulkSupply",
  sub_franchise: "subFranchise",
};

const conditionFields = Object.fromEntries(
  CONDITION_KEYS.map((k) => [CONDITION_FIELDS[k], yesNoBlank]),
) as Record<string, typeof yesNoBlank>;

/**
 * Fields a registry officer enters for a submission (SPEC §1.1; common sections of REG-01A to K).
 * Workflow fields are not here. Only the original intake fields, the form filed and the filing
 * type are required, so intake stays quick; the rest can be completed later.
 */
export const submissionSchema = z
  .object({
    filingType: z.enum(["NEW", "UPDATE", "ANNUAL"], {
      errorMap: () => ({ message: "Choose the filing type" }),
    }),
    formFiled: z
      .string()
      .trim()
      .refine((s) => /^REG-01[A-K]$/.test(s), "Choose the form filed (REG-01A to REG-01K)")
      .refine(
        (s) => s !== OWN_USE_FORM,
        "REG-01I is the own-use notification: record it under Own-use (REG-01I)",
      ),
    /** Updates and annual confirmations: registration number of the registered record. */
    linkedRegistrationNo: text(60).transform((s) => (s ? s.toUpperCase() : null)),
    registeredName: requiredText("Registered name"),
    tradingName: text(200),
    dateSubmitted: isoDate,
    submissionChannel: optionalText(50),
    registrantType: optionalText(50),
    cacNo: cac,
    incorporationDate: datedField("Date of incorporation"),
    tin: optionalText(30),
    address: optionalText(500),
    operationalAddress: text(500),
    website: text(200),
    principalLga: requiredText("Principal LGA", 100),
    lgasServed: multi(20),
    otherAreasServed: optionalText(1000),
    primaryActivityCode: requiredText("Primary activity", 10),
    otherActivityCodes: multi(20),
    installedCapacityMw: optionalDecimal("Installed capacity", 100_000),
    customers: optionalInt("Customers"),
    licenceStatus: requiredText("Licence status", 100),
    licences: table(licenceRow),
    shareholders: table(shareholderRow),
    directors: table(directorRow),
    mdName: text(200),
    mdPhone: phone.optional().transform((s) => s ?? null),
    mdEmail: email.optional().transform((s) => s ?? null),
    complianceOfficer: optionalText(200),
    phone,
    email,
    confidentialityClaims: table(confidentialityRow),
    hseIncidents: table(hseRow),
    signatory1Name: text(200),
    signatory1Designation: text(200),
    signatory1Date: datedField("Signature date"),
    signatory2Name: text(200),
    signatory2Designation: text(200),
    signatory2Date: datedField("Signature date"),
    ...conditionFields,
    /** Category-specific sections (JSON from the form); checked against the definitions on the server. */
    technicalData: z.preprocess(
      (v) => {
        if (v === undefined || v === null || v === "") return {};
        if (typeof v === "string") {
          try {
            return JSON.parse(v);
          } catch {
            return null;
          }
        }
        return v;
      },
      z.record(z.unknown(), { invalid_type_error: "The technical sections could not be read" }),
    ),
    operatingOnEffectiveDate: z.enum(["Y", "N"], {
      errorMap: () => ({ message: "Say whether the operator was operating on the Effective Date" }),
    }),
    plannedStartDate: optionalIsoDate,
    categoryOverride: optionalText(2),
    overrideReason: optionalText(1000),
    remarks: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.operatingOnEffectiveDate === "N" && !v.plannedStartDate) {
      ctx.addIssue({
        code: "custom",
        path: ["plannedStartDate"],
        message: "Required for a new operator (para 11(2))",
      });
    }
    if (v.otherActivityCodes.includes(v.primaryActivityCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["otherActivityCodes"],
        message: "Other activities must differ from the primary activity",
      });
    }
    if (new Set(v.otherActivityCodes).size !== v.otherActivityCodes.length) {
      ctx.addIssue({
        code: "custom",
        path: ["otherActivityCodes"],
        message: "Each activity once",
      });
    }
    if (v.filingType !== "NEW" && !v.linkedRegistrationNo) {
      ctx.addIssue({
        code: "custom",
        path: ["linkedRegistrationNo"],
        message: "Quote the OGSERC registration number of the registered record",
      });
    }
  });
export type SubmissionFormInput = z.input<typeof submissionSchema>;
export type SubmissionFields = z.output<typeof submissionSchema>;

/** Intake adds the optional evaluating officer (SPEC §4.1). */
export const intakeSchema = submissionSchema.and(
  z.object({ evaluatingOfficerId: optionalText(40) }),
);

export const checkValueSchema = z.enum(["Y", "N", "N/A", ""]);
/** Document checklist: value per document key ("" = blank/pending). */
export const documentsSchema = z.record(z.string().regex(/^[a-z_]+$/), checkValueSchema);

/** Evaluator's "Category confirmed" (official-use box). */
export const categoryConfirmSchema = z.object({
  category: z
    .string()
    .trim()
    .regex(/^[A-HJK]$/, "Choose a Schedule 3 category (not I, which is own-use)"),
  reason: z
    .string()
    .trim()
    .max(1000)
    .transform((s) => s || null),
});

export const waiverSchema = z.object({
  amount: money("Waiver"),
  reason: z.string().trim().min(5, "Give the written approval reference or reason").max(1000),
});

export const reasonSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(1000),
});

export const paymentSchema = z.object({
  dateReceived: isoDate,
  reference: z
    .string()
    .trim()
    .min(1, "Enter the Ack No. or OUN No. this payment is for")
    .transform((s) => s.toUpperCase()),
  purpose: optionalText(100),
  channel: optionalText(50),
  amount: money("Amount").refine((k) => k > 0, "Amount must be more than zero"),
  rrr: optionalText(100),
});
export type PaymentFields = z.output<typeof paymentSchema>;

const kw = (label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? "" : String(v).trim().replace(/,/g, "")))
    .refine((s) => s === "" || /^\d+(\.\d+)?$/.test(s), `${label} must be a number`)
    .transform((s) => (s === "" ? null : Number(s)));

const generatorUnitRow = z.object({
  makeModel: text(200),
  capacityKw: kw("Installed capacity (kW)").refine(
    (n): n is number => n !== null && n > 0,
    "Installed capacity (kW) is required and more than 0",
  ),
  fuel: text(50),
  avgMonthlyMwh: kw("Average monthly output (MWh)"),
});
export type GeneratorUnitRow = z.output<typeof generatorUnitRow>;

/** Form REG-01I (one per site). Installed capacity is the sum of the generator units. */
export const ownUseSchema = z.object({
  name: requiredText("Name"),
  dateFiled: isoDate,
  cacNo: cac,
  siteAddress: optionalText(500),
  lga: requiredText("LGA", 100),
  natureOfBusiness: optionalText(500),
  gridConnected: z.enum(["Y", "N", ""]).transform((s) => (s === "" ? null : s === "Y")),
  distributionLicensee: optionalText(200),
  units: table(generatorUnitRow, 50).refine((u) => u.length > 0, "Add at least one generator unit"),
  contactPerson: optionalText(200),
  phone,
  email,
});
export type OwnUseFields = z.output<typeof ownUseSchema>;
