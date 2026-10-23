"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import type { FeeRow } from "@/domain/reference";
import { FEE_FIELDS } from "@/domain/reference-admin";
import type { ActionState } from "@/lib/action";

const naira = (kobo: number) => (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });

function CellErrors({ messages }: { messages?: string[] }) {
  return messages?.map((m) => (
    <p key={m} className="mt-0.5 text-xs text-red-700">
      {m}
    </p>
  ));
}

export function FeeTableForm({
  fees,
  action,
}: {
  fees: FeeRow[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, {});
  const errors = state.fieldErrors;
  const values = state.values as Record<string, string> | undefined;
  const value = (key: string, initial: string) => values?.[key] ?? initial;

  return (
    <form key={formKey(state)} action={formAction} className="space-y-4">
      <FormMessage state={state} />
      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <th className="px-2 py-2 font-medium">Category</th>
              <th className="px-2 py-2 font-medium">Description</th>
              {FEE_FIELDS.map(([field, label]) => (
                <th key={field} className="w-32 px-2 py-2 font-medium capitalize">
                  {label} (₦)
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {fees.map((f) => (
              <tr key={f.category} className="align-top">
                <td className="px-2 py-2 font-semibold">
                  <input type="hidden" name="category" value={f.category} />
                  {f.category}
                  {f.category === "I" && (
                    <span className="block text-xs font-normal text-gray-500">Own-use</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <textarea
                    name={`${f.category}.description`}
                    aria-label={`Category ${f.category} description`}
                    defaultValue={value(`${f.category}.description`, f.description)}
                    rows={2}
                    className={`${inputClass} min-w-56`}
                  />
                  <CellErrors messages={errors?.[`${f.category}.description`]} />
                </td>
                {FEE_FIELDS.map(([field, label]) => (
                  <td key={field} className="px-2 py-2">
                    <input
                      name={`${f.category}.${field}`}
                      aria-label={`Category ${f.category} ${label}`}
                      inputMode="decimal"
                      defaultValue={value(`${f.category}.${field}`, naira(f[field]))}
                      className={`${inputClass} text-right tabular-nums`}
                    />
                    <CellErrors messages={errors?.[`${f.category}.${field}`]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="max-w-2xl">
        <label htmlFor="reason" className="mb-1 block text-sm font-medium text-gray-800">
          Reason for the change
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={2}
          required
          defaultValue={value("reason", "")}
          placeholder="e.g. Schedule 3 revised by Commission resolution of 1 March 2027"
          className={inputClass}
        />
        <CellErrors messages={errors?.reason} />
      </div>
      <SubmitButton>Save fee table</SubmitButton>
    </form>
  );
}
