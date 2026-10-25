"use client";

import { useActionState } from "react";
import { ConfirmBox } from "@/components/confirm-box";
import { Field, FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import { RowsField } from "@/components/rows-field";
import type { ActionState } from "@/lib/action";
import type { FormOptions } from "@/server/options";

/** Form REG-01I: own-use generation notification, one per site. */
export function OwnUseForm({
  mode,
  action,
  initial,
  options,
  thresholdKw,
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial: Record<string, string>;
  options: FormOptions;
  thresholdKw: number;
}) {
  const [state, formAction] = useActionState(action, {});
  const e = state.fieldErrors;
  const v = (state.values as Record<string, string> | undefined) ?? initial;
  const text = (
    name: string,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) => (
    <Field label={label} name={name} errors={e} hint={hint}>
      <input id={name} name={name} defaultValue={v[name] ?? ""} className={inputClass} {...props} />
    </Field>
  );
  const select = (
    name: string,
    label: string,
    items: { value: string; label: string }[],
    required = false,
  ) => (
    <Field label={label} name={name} errors={e}>
      <select id={name} name={name} defaultValue={v[name] ?? ""} className={inputClass}>
        <option value="">{required ? "Choose…" : "(none)"}</option>
        {items.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
      </select>
    </Field>
  );
  const list = (items: string[]) => items.map((s) => ({ value: s, label: s }));
  const section = (title: string, children: React.ReactNode) => (
    <fieldset className="rounded border border-gray-200 bg-white p-4">
      <legend className="text-brand-800 px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );

  return (
    <form key={formKey(state)} action={formAction} className="max-w-4xl space-y-4" noValidate>
      <FormMessage state={state} />
      <ConfirmBox state={state} />
      {section(
        "A. Identity",
        <>
          {text("name", "Name *")}
          {text("dateFiled", "Date filed *", { type: "date" })}
          {text("cacNo", "CAC / registration number", { placeholder: "RC123456" })}
          <div className="sm:col-span-2 lg:col-span-3">
            {text(
              "siteAddress",
              "Site address",
              {},
              "One notification per site: the same registrant files one for each site.",
            )}
          </div>
          {text("contactPerson", "Contact person")}
          {text("phone", "Phone", { type: "tel" })}
          {text("email", "Email", { type: "email" })}
        </>,
      )}
      {section(
        "B. Site and use",
        <>
          {text("natureOfBusiness", "Nature of premises / business")}
          {select("lga", "Local government area *", list(options.lgas), true)}
          {select("gridConnected", "Also connected to a distribution licensee?", [
            { value: "Y", label: "Yes" },
            { value: "N", label: "No" },
          ])}
          {text("distributionLicensee", "Which licensee")}
        </>,
      )}
      {section(
        "C. Generation assets",
        <RowsField
          name="units"
          label="Generator units *"
          initial={v.units}
          errors={e}
          addLabel="Add unit"
          hint={`Installed capacity is the sum of the units. ${thresholdKw} kW to below 1,000 kW must notify (para 3(4)); 1,000 kW or more registers as captive generation on REG-01D or REG-01C.`}
          columns={[
            { key: "makeModel", label: "Make / model", span: 3 },
            { key: "capacityKw", label: "Installed kW", type: "number", span: 2 },
            {
              key: "fuel",
              label: "Fuel / technology",
              type: "select",
              options: list(options.fuels),
              span: 2,
            },
            { key: "avgMonthlyMwh", label: "Avg monthly MWh", type: "number", span: 2 },
          ]}
        />,
      )}
      <SubmitButton>{mode === "create" ? "Save notification" : "Save changes"}</SubmitButton>
    </form>
  );
}
