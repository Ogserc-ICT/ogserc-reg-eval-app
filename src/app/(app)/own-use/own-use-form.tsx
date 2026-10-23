"use client";

import { useActionState } from "react";
import { ConfirmBox } from "@/components/confirm-box";
import { Field, FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import type { ActionState } from "@/lib/action";
import type { FormOptions } from "@/server/options";

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

  return (
    <form key={formKey(state)} action={formAction} className="max-w-4xl space-y-4" noValidate>
      <FormMessage state={state} />
      <ConfirmBox state={state} />
      <div className="grid gap-4 rounded border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        {text("name", "Name *")}
        {text("dateFiled", "Date filed *", { type: "date" })}
        {text("cacNo", "CAC number", { placeholder: "RC123456" })}
        <div className="sm:col-span-2 lg:col-span-3">{text("siteAddress", "Site address")}</div>
        {select("lga", "LGA *", list(options.lgas), true)}
        {text("natureOfBusiness", "Nature of business")}
        {select("gridConnected", "Grid connected?", [
          { value: "Y", label: "Yes" },
          { value: "N", label: "No" },
        ])}
        {text("distributionLicensee", "Distribution licensee")}
        {text("units", "Number of units", { inputMode: "numeric" })}
        {text(
          "installedCapacityKw",
          "Installed capacity (kW) *",
          { inputMode: "decimal" },
          `${thresholdKw} kW to below 1,000 kW must notify (para 3(4)); 1,000 kW or more registers as captive generation`,
        )}
        {select("fuel", "Fuel / technology", list(options.fuels))}
        {text("avgMonthlyOutputMwh", "Average monthly output (MWh)", { inputMode: "decimal" })}
        {text("contactPerson", "Contact person")}
        {text("phone", "Phone", { type: "tel" })}
        {text("email", "Email", { type: "email" })}
      </div>
      <SubmitButton>{mode === "create" ? "Save notification" : "Save changes"}</SubmitButton>
    </form>
  );
}
