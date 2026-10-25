"use client";

import { useActionState } from "react";
import { ConfirmBox } from "@/components/confirm-box";
import { Field, FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import { NairaInput } from "@/components/naira-input";
import type { FormOptions } from "@/server/options";
import { recordPaymentAction } from "../actions";

export function PaymentForm({
  options,
  initial,
  returnTo,
}: {
  options: FormOptions;
  initial: Record<string, string>;
  returnTo: string;
}) {
  const [state, action] = useActionState(recordPaymentAction, {});
  const e = state.fieldErrors;
  const v = (state.values as Record<string, string> | undefined) ?? initial;
  const select = (name: string, label: string, items: string[]) => (
    <Field label={label} name={name} errors={e}>
      <select id={name} name={name} defaultValue={v[name]} className={inputClass}>
        <option value="">(none)</option>
        {items.map((i) => (
          <option key={i}>{i}</option>
        ))}
      </select>
    </Field>
  );

  return (
    <form key={formKey(state)} action={action} className="max-w-2xl space-y-4" noValidate>
      <FormMessage state={state} />
      <ConfirmBox state={state} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Ack No. or OUN No. *"
          name="reference"
          errors={e}
          hint="The submission or own-use notification this pays for"
        >
          <input
            id="reference"
            name="reference"
            defaultValue={v.reference}
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field label="Date received *" name="dateReceived" errors={e}>
          <input
            id="dateReceived"
            name="dateReceived"
            type="date"
            defaultValue={v.dateReceived}
            className={inputClass}
          />
        </Field>
        <Field label="Amount *" name="amount" errors={e}>
          <NairaInput id="amount" name="amount" defaultValue={v.amount} placeholder="250,000" />
        </Field>
        <Field label="RRR / bank reference" name="rrr" errors={e}>
          <input id="rrr" name="rrr" defaultValue={v.rrr} className={inputClass} />
        </Field>
        {select("channel", "Channel", options.paymentChannels)}
        {select("purpose", "Purpose", options.purposes)}
      </div>
      <SubmitButton>Record payment</SubmitButton>
    </form>
  );
}
