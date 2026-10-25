"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import type { Settings } from "@/domain/reference";
import { updateSettingsAction } from "../actions";

type Values = Record<string, string | boolean>;

function toValues(s: Settings): Values {
  return {
    effectiveDate: s.effectiveDate,
    registrationPeriodDays: String(s.registrationPeriodDays),
    extensionDays: String(s.extensionDays),
    newOperatorLeadDays: String(s.newOperatorLeadDays),
    determinationDays: String(s.determinationDays),
    deficiencyDays: String(s.deficiencyDays),
    licenceApplicationDays: String(s.licenceApplicationDays),
    licenceExpiryWindowDays: String(s.licenceExpiryWindowDays),
    amberWarningDays: String(s.amberWarningDays),
    showCauseDays: String(s.showCauseDays),
    ownUseThresholdKw: String(s.ownUseThresholdKw),
    registrationPrefix: s.registrationPrefix,
    ackPrefix: s.ackPrefix,
    ounPrefix: s.ounPrefix,
    paymentPrefix: s.paymentPrefix,
    chairmanName: s.chairmanName,
    commissionerName: s.commissionerName,
    feesRevisedOn: s.feesRevisedOn ?? "",
    tinPattern: s.policy.tinPattern ?? "",
    lateChargeBlocksCompleteness: s.policy.lateChargeBlocksCompleteness,
    waiverAppliesToLateCharge: s.policy.waiverAppliesToLateCharge,
    flagsBlockApproval: s.policy.flagsBlockApproval,
    lateChargeRequiredForRelease: s.policy.lateChargeRequiredForRelease,
    unpaidReminderDays:
      s.policy.unpaidReminderDays === null ? "" : String(s.policy.unpaidReminderDays),
    supplyRetailCategory1MwPlus: s.policy.supplyRetailCategory1MwPlus,
    wrongFormHandling: s.policy.wrongFormHandling,
    otherActivitiesRequireDocuments: s.policy.otherActivitiesRequireDocuments,
    ownUseCertificate: s.policy.ownUseCertificate,
    filingFeeOnUpdates: s.policy.filingFeeOnUpdates,
    annualConfirmationDue: s.annualConfirmationDue,
  };
}

/** Category forms REG-01A to K: open policy points (docs/DECISIONS.md), each change audited. */
const FORM_POLICIES: { name: string; label: string; hint: string }[] = [
  {
    name: "otherActivitiesRequireDocuments",
    label: "Other activities require their form’s documents",
    hint: "Off: the checklist is the form filed's. On: the documents of each other activity's form are added (each shared document once).",
  },
  {
    name: "ownUseCertificate",
    label: "Own-use notifications (REG-01I) get a certificate",
    hint: "On: an approving officer can register a paid, complete notification, with an I-CPT registration number and CERT-01.",
  },
  {
    name: "filingFeeOnUpdates",
    label: "Charge the registration fee on updates and annual confirmations",
    hint: "Off: no fee. On: the category's registration fee (never a late charge).",
  },
];

const PERIODS: { name: string; label: string; hint: string }[] = [
  { name: "registrationPeriodDays", label: "Registration period (days)", hint: "Para 11(1)." },
  {
    name: "extensionDays",
    label: "Extension of registration period (days)",
    hint: "Para 25, by public notice.",
  },
  {
    name: "newOperatorLeadDays",
    label: "New operators: register at least (days) before start",
    hint: "Para 11(2).",
  },
  {
    name: "determinationDays",
    label: "Commission determination period (days)",
    hint: "Para 13(1); provisional registration after (13(4)).",
  },
  { name: "deficiencyDays", label: "Deficiency response period (days)", hint: "Para 13(1)(b)." },
  {
    name: "licenceApplicationDays",
    label: "Unlicensed: licence application within (days)",
    hint: "Para 18(1).",
  },
  {
    name: "licenceExpiryWindowDays",
    label: "Licence expiry window for renewal flag (days)",
    hint: "Para 8(5): six months.",
  },
  {
    name: "amberWarningDays",
    label: "Amber warning before determination due (days)",
    hint: "Workflow traffic light.",
  },
  {
    name: "showCauseDays",
    label: "Show-cause period before refusal (days)",
    hint: "Paras 13(3), 20.",
  },
  {
    name: "ownUseThresholdKw",
    label: "Own-use notification threshold (kW)",
    hint: "Para 3(4): from this to below 1 MW.",
  },
];

const PREFIXES = [
  { name: "registrationPrefix", label: "Registration number" },
  { name: "ackPrefix", label: "Acknowledgement number" },
  { name: "ounPrefix", label: "Own-use notification number" },
  { name: "paymentPrefix", label: "Payment record" },
];

const POLICIES = [
  {
    name: "lateChargeBlocksCompleteness",
    label: "An unpaid late charge blocks “submission complete”",
    hint: "SPEC §9.2. The Excel does not (only the fee less any waiver must be paid).",
  },
  {
    name: "waiverAppliesToLateCharge",
    label: "An approved waiver also reduces the late charge",
    hint: "SPEC §9.3. The Excel applies the waiver to the registration fee only.",
  },
  {
    name: "flagsBlockApproval",
    label: "Unresolved data flags block approval outright",
    hint: "SPEC §9.5. When off, an approver may approve with a written override reason.",
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded border border-gray-200 bg-white p-4">
      <legend className="text-brand-800 px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action] = useActionState(updateSettingsAction, {});
  const errors = state.fieldErrors;
  const v = (state.values as Values | undefined) ?? toValues(settings);
  const text = (name: string) => String(v[name] ?? "");
  const unsetSignatory = [settings.chairmanName, settings.commissionerName].some(
    (n) => !n.trim() || n === "[Name]",
  );

  return (
    <form action={action} className="max-w-4xl space-y-5">
      <FormMessage state={state} />

      <Section title="Effective Date">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Effective Date of the Order"
            name="effectiveDate"
            errors={errors}
            hint="Para 2. Every deadline depends on this. Set the gazetted date before go-live."
          >
            <input
              id="effectiveDate"
              name="effectiveDate"
              type="date"
              defaultValue={text("effectiveDate")}
              required
              className={inputClass}
            />
          </Field>
          <Field
            label="Fees revised on"
            name="feesRevisedOn"
            errors={errors}
            hint="Schedule 3 revision date (SPEC §8.9)."
          >
            <input
              id="feesRevisedOn"
              name="feesRevisedOn"
              type="date"
              defaultValue={text("feesRevisedOn")}
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      <Section title="Periods">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PERIODS.map((p) => (
            <Field key={p.name} label={p.label} name={p.name} errors={errors} hint={p.hint}>
              <input
                id={p.name}
                name={p.name}
                type="number"
                min={0}
                step={1}
                defaultValue={text(p.name)}
                required
                className={inputClass}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Commission policy (open questions, SPEC §9)">
        <div className="space-y-3">
          {POLICIES.map((p) => (
            <label key={p.name} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                name={p.name}
                defaultChecked={v[p.name] === true}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{p.label}</span>
                <span className="block text-xs text-gray-500">{p.hint}</span>
              </span>
            </label>
          ))}
          <Field
            label="TIN format (regular expression)"
            name="tinPattern"
            errors={errors}
            hint="SPEC §9.7. Leave blank until Finance confirms the format; TINs are not checked while blank."
          >
            <input
              id="tinPattern"
              name="tinPattern"
              defaultValue={text("tinPattern")}
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>
      </Section>

      <Section title="Category forms REG-01A to K (open policy points)">
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Supply / retail at 1 MW or more: category"
              name="supplyRetailCategory1MwPlus"
              errors={errors}
              hint="K, as the activity map has it, unless the Commission decides otherwise (e.g. F, with trading and bulk supply). Below 1 MW Supply / retail is K. Saved pricing is not changed; affected records show “pricing out of date”."
            >
              <select
                id="supplyRetailCategory1MwPlus"
                name="supplyRetailCategory1MwPlus"
                defaultValue={text("supplyRetailCategory1MwPlus")}
                className={`${inputClass} max-w-32`}
              >
                {"ABCDEFGHJK".split("").map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Submission on the wrong form"
              name="wrongFormHandling"
              errors={errors}
              hint="Accept: the evaluator confirms the right category with a reason and the matching form's documents apply. Require: check 1.10 fails, so a deficiency notice asks for the right form."
            >
              <select
                id="wrongFormHandling"
                name="wrongFormHandling"
                defaultValue={text("wrongFormHandling")}
                className={inputClass}
              >
                <option value="ACCEPT">Accept and re-categorise</option>
                <option value="REQUIRE_CORRECT_FORM">Require the correct form</option>
              </select>
            </Field>
            <Field
              label="Annual confirmation due each year (MM-DD)"
              name="annualConfirmationDue"
              errors={errors}
              hint="Para 16(2): 31 January (01-31)."
            >
              <input
                id="annualConfirmationDue"
                name="annualConfirmationDue"
                defaultValue={text("annualConfirmationDue")}
                className={`${inputClass} max-w-32 font-mono`}
              />
            </Field>
          </div>
          {FORM_POLICIES.map((p) => (
            <label key={p.name} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                name={p.name}
                defaultChecked={v[p.name] === true}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{p.label}</span>
                <span className="block text-xs text-gray-500">{p.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Finance confirmation gate (undecided policy, SPEC §4.12)">
        <div className="space-y-3">
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              name="lateChargeRequiredForRelease"
              defaultChecked={v.lateChargeRequiredForRelease === true}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Late charge required to release for evaluation</span>
              <span className="block text-xs text-gray-500">
                Off: confirmed payments must cover the fee less any waiver. On: they must cover the
                total due, late charge included. Applies to every submission from the moment it is
                saved; any that then qualify are released at once.
              </span>
            </span>
          </label>
          <Field
            label="Unpaid acknowledgement reminder after (days)"
            name="unpaidReminderDays"
            errors={errors}
            hint="Blank: no automatic action. When set, unpaid submissions older than this are marked “reminder due” on the dashboard queue and counted in the daily review. No messages are sent."
          >
            <input
              id="unpaidReminderDays"
              name="unpaidReminderDays"
              type="number"
              min={1}
              step={1}
              defaultValue={text("unpaidReminderDays")}
              className={`${inputClass} max-w-32`}
            />
          </Field>
        </div>
      </Section>

      <Section title="Number prefixes">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PREFIXES.map((p) => (
            <Field key={p.name} label={p.label} name={p.name} errors={errors}>
              <input
                id={p.name}
                name={p.name}
                defaultValue={text(p.name)}
                required
                className={`${inputClass} font-mono`}
              />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Changing a prefix affects numbers generated from now on; issued numbers never change.
        </p>
      </Section>

      <Section title="Certificate signatories">
        {unsetSignatory && (
          <p className="border-gold-400 bg-gold-300/30 mb-3 rounded border px-3 py-2 text-sm text-gray-900">
            Certificates cannot be issued until both names are set (SPEC §7).
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Chairman / Chief Executive Officer" name="chairmanName" errors={errors}>
            <input
              id="chairmanName"
              name="chairmanName"
              defaultValue={text("chairmanName")}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Commissioner" name="commissionerName" errors={errors}>
            <input
              id="commissionerName"
              name="commissionerName"
              defaultValue={text("commissionerName")}
              required
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      <SubmitButton>Save settings</SubmitButton>
    </form>
  );
}
