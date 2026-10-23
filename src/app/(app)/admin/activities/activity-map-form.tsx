"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import type { Activity } from "@/domain/reference";
import { BANDS } from "@/domain/reference-admin";
import type { ActionState } from "@/lib/action";

function CellErrors({ messages }: { messages?: string[] }) {
  return messages?.map((m) => (
    <p key={m} className="mt-0.5 text-xs text-red-700">
      {m}
    </p>
  ));
}

export function ActivityMapForm({
  activities,
  categories,
  action,
}: {
  activities: Activity[];
  /** Categories an activity may map to (Category I is own-use only). */
  categories: string[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, {});
  const errors = state.fieldErrors;
  const values = state.values as Record<string, string | boolean> | undefined;

  return (
    <form key={formKey(state)} action={formAction} className="space-y-4">
      <FormMessage state={state} />
      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <th className="px-2 py-2 font-medium">Code</th>
              <th className="px-2 py-2 font-medium">Activity</th>
              {BANDS.map(([band, label]) => (
                <th key={band} className="px-2 py-2 font-medium">
                  {label}
                </th>
              ))}
              <th className="px-2 py-2 font-medium">Depends on capacity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {activities.map((a) => {
              const key = (f: string) => `${a.code}.${f}`;
              const capacity = values ? values[key("capacityBased")] === true : a.capacityBased;
              return (
                <tr key={a.code} className="align-top">
                  <td className="px-2 py-2 font-semibold">
                    <input type="hidden" name="code" value={a.code} />
                    {a.code}
                  </td>
                  <td className="px-2 py-2">{a.name}</td>
                  {BANDS.map(([band, label]) => (
                    <td key={band} className="px-2 py-2">
                      <select
                        name={key(band)}
                        aria-label={`${a.code} ${label}`}
                        defaultValue={String(values?.[key(band)] ?? a[band])}
                        className={`${inputClass} w-20`}
                      >
                        {categories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <CellErrors messages={errors?.[key(band)]} />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      name={key("capacityBased")}
                      aria-label={`${a.code} depends on capacity`}
                      defaultChecked={capacity}
                    />
                    <CellErrors messages={errors?.[key("capacityBased")]} />
                  </td>
                </tr>
              );
            })}
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
          defaultValue={String(values?.reason ?? "")}
          placeholder="e.g. Commission decided supply/retail is Category F (SPEC §9.6)"
          className={inputClass}
        />
        <CellErrors messages={errors?.reason} />
      </div>
      <SubmitButton>Save activity map</SubmitButton>
    </form>
  );
}
