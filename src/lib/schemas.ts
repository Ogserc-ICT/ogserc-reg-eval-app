// Zod schemas shared by forms (client) and server actions.
import { z } from "zod";
import { isIsoDate } from "@/domain/dates";
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

/** Fields a registry officer enters for a submission (SPEC §1.1). Workflow fields are not here. */
export const submissionSchema = z
  .object({
    registeredName: requiredText("Registered name"),
    dateSubmitted: isoDate,
    submissionChannel: optionalText(50),
    registrantType: optionalText(50),
    cacNo: cac,
    tin: optionalText(30),
    address: optionalText(500),
    principalLga: requiredText("Principal LGA", 100),
    otherAreasServed: optionalText(1000),
    primaryActivityCode: requiredText("Primary activity", 10),
    secondaryActivityCode: optionalText(10),
    installedCapacityMw: optionalDecimal("Installed capacity", 100_000),
    customers: optionalInt("Customers"),
    licenceStatus: requiredText("Licence status", 100),
    licenceNo: optionalText(100),
    licenceExpiry: optionalIsoDate,
    complianceOfficer: optionalText(200),
    phone,
    email,
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
    if (v.secondaryActivityCode && v.secondaryActivityCode === v.primaryActivityCode) {
      ctx.addIssue({
        code: "custom",
        path: ["secondaryActivityCode"],
        message: "Must differ from the primary activity",
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
/** Document checklist: value per Schedule 2 item number ("" = blank/pending). */
export const documentsSchema = z.record(z.string().regex(/^\d+$/), checkValueSchema);

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

export const ownUseSchema = z.object({
  name: requiredText("Name"),
  dateFiled: isoDate,
  cacNo: cac,
  siteAddress: optionalText(500),
  lga: requiredText("LGA", 100),
  natureOfBusiness: optionalText(500),
  gridConnected: z.enum(["Y", "N", ""]).transform((s) => (s === "" ? null : s === "Y")),
  distributionLicensee: optionalText(200),
  units: optionalInt("Number of units"),
  installedCapacityKw: optionalDecimal("Installed capacity", 1_000_000).refine(
    (n): n is number => n !== null && n > 0,
    "Installed capacity (kW) is required",
  ),
  fuel: optionalText(50),
  avgMonthlyOutputMwh: optionalDecimal("Average monthly output", 1_000_000),
  contactPerson: optionalText(200),
  phone,
  email,
});
export type OwnUseFields = z.output<typeof ownUseSchema>;
