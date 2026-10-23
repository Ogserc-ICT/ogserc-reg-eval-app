"use client";

import { useActionState } from "react";
import { ConfirmBox } from "@/components/confirm-box";
import { Field, FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import type { ActionState } from "@/lib/action";
import type { FormOptions } from "@/server/options";

export type SubmissionFormValues = Record<string, string>;

type Choice = { value: string; label: string };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded border border-gray-200 bg-white p-4">
      <legend className="text-brand-800 px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export function SubmissionForm({
  mode,
  action,
  initial,
  options,
  closedStatus,
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial: SubmissionFormValues;
  options: FormOptions;
  /** Set when editing a closed submission: Admin only, and a reason is required. */
  closedStatus?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const e = state.fieldErrors;
  const v = (state.values as SubmissionFormValues | undefined) ?? initial;

  const text = (
    name: string,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) => (
    <Field label={label} name={name} errors={e} hint={hint}>
      <input
        id={name}
        name={name}
        defaultValue={v[name] ?? ""}
        className={inputClass}
        aria-invalid={!!e?.[name]}
        {...props}
      />
    </Field>
  );
  const select = (
    name: string,
    label: string,
    choices: Choice[],
    required = false,
    hint?: string,
  ) => (
    <Field label={label} name={name} errors={e} hint={hint}>
      <select
        id={name}
        name={name}
        defaultValue={v[name] ?? ""}
        className={inputClass}
        aria-invalid={!!e?.[name]}
      >
        <option value="">{required ? "Choose…" : "(none)"}</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </Field>
  );
  const list = (items: string[]): Choice[] => items.map((s) => ({ value: s, label: s }));
  const activities = options.activities.map((a) => ({
    value: a.code,
    label: `${a.name} (${a.code})`,
  }));

  return (
    <form key={formKey(state)} action={formAction} className="max-w-5xl space-y-5" noValidate>
      <FormMessage state={state} />
      <ConfirmBox state={state} />

      <Section title="Identity (Schedule 1 A)">
        {text("registeredName", "Registered name *")}
        {text("dateSubmitted", "Date submitted *", { type: "date" })}
        {select("submissionChannel", "Submission channel", list(options.channels))}
        {select("registrantType", "Registrant type", list(options.registrantTypes))}
        {text(
          "cacNo",
          "CAC number",
          { placeholder: "RC123456" },
          "RC, BN or IT followed by digits",
        )}
        {text("tin", "TIN")}
        <div className="sm:col-span-2 lg:col-span-3">{text("address", "Address")}</div>
      </Section>

      <Section title="Service area (Schedule 1 F)">
        {select("principalLga", "Principal LGA *", list(options.lgas), true)}
        <div className="lg:col-span-2">
          {text("otherAreasServed", "Other areas served", {}, "Other LGAs, feeders, estates")}
        </div>
      </Section>

      <Section title="Activity and assets (Schedule 1 E, G)">
        {select("primaryActivityCode", "Primary activity *", activities, true)}
        {select("secondaryActivityCode", "Secondary activity", activities)}
        {text(
          "installedCapacityMw",
          "Installed capacity (MW)",
          { inputMode: "decimal" },
          "Sets the category for generation, captive, mini-grid and other activities",
        )}
        {text("customers", "Customers", { inputMode: "numeric" })}
      </Section>

      <Section title="Licences (Schedule 1 D)">
        {select("licenceStatus", "Licence status *", list(options.licenceStatuses), true)}
        {text("licenceNo", "Licence number")}
        {text("licenceExpiry", "Licence expiry", { type: "date" })}
      </Section>

      <Section title="Contact (Schedule 1 C)">
        {text("complianceOfficer", "Compliance officer")}
        {text("phone", "Phone", { type: "tel", placeholder: "080…" })}
        {text("email", "Email", { type: "email" })}
      </Section>

      <Section title="Timeline (para 11)">
        {select(
          "operatingOnEffectiveDate",
          "Operating on the Effective Date? *",
          [
            { value: "Y", label: "Yes – existing operator" },
            { value: "N", label: "No – new operator" },
          ],
          true,
        )}
        {text(
          "plannedStartDate",
          "Planned start date",
          { type: "date" },
          "Required for a new operator",
        )}
      </Section>

      <Section title="Category (Schedule 3)">
        {select(
          "categoryOverride",
          "Category override",
          options.categories.map((c) => ({
            value: c.category,
            label: `${c.category} – ${c.description}`,
          })),
          false,
          "Leave as (none) to use the category worked out from the activities and capacity",
        )}
        <div className="lg:col-span-2">{text("overrideReason", "Reason for override")}</div>
      </Section>

      {mode === "create" && (
        <Section title="Evaluation">
          {select(
            "evaluatingOfficerId",
            "Evaluating officer",
            options.evaluators.map((u) => ({ value: u.id, label: u.name })),
            false,
            "Optional. Assigning one now records the evaluation start date.",
          )}
        </Section>
      )}

      <Field label="Remarks" name="remarks" errors={e}>
        <textarea
          id="remarks"
          name="remarks"
          rows={3}
          defaultValue={v.remarks ?? ""}
          className={inputClass}
        />
      </Field>

      {closedStatus && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3">
          <Field
            label={`Reason for changing a ${closedStatus} submission *`}
            name="changeReason"
            errors={e}
            hint="Recorded in the audit log with the old and new values."
          >
            <input
              id="changeReason"
              name="changeReason"
              defaultValue={v.changeReason ?? ""}
              className={inputClass}
            />
          </Field>
        </div>
      )}

      <SubmitButton>{mode === "create" ? "Save submission" : "Save changes"}</SubmitButton>
    </form>
  );
}
