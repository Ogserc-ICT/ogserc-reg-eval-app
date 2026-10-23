"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import type { CheckValue } from "@/domain/types";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const CHOICES: { value: Exclude<CheckValue, null> | ""; label: string }[] = [
  { value: "Y", label: "Received" },
  { value: "N", label: "Outstanding" },
  { value: "N/A", label: "N/A" },
  { value: "", label: "Pending" },
];

/** Schedule 2 checklist: one radio group per document. */
export function DocumentsForm({
  action,
  documents,
  closedStatus,
}: {
  action: Action;
  documents: { number: number; name: string; value: CheckValue }[];
  /** Set for a closed submission: Admin only, with a reason. */
  closedStatus?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr>
            <th className="py-1 pr-2 font-normal">Document (Schedule 2)</th>
            {CHOICES.map((c) => (
              <th key={c.label} className="px-1 py-1 text-center font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {documents.map((d) => (
            <tr key={d.number}>
              <td className="py-1.5 pr-2">{d.name}</td>
              {CHOICES.map((c) => (
                <td key={c.label} className="px-1 text-center">
                  <input
                    type="radio"
                    name={`doc-${d.number}`}
                    value={c.value}
                    defaultChecked={(d.value ?? "") === c.value}
                    aria-label={`${d.name}: ${c.label}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {closedStatus && (
        <Field
          label={`Reason for changing a ${closedStatus} submission *`}
          name="changeReason"
          errors={state.fieldErrors}
        >
          <input id="changeReason" name="changeReason" className={inputClass} />
        </Field>
      )}
      <SubmitButton>Save checklist</SubmitButton>
    </form>
  );
}

/** Approved waiver (para 17(3)). */
export function WaiverForm({ action, current }: { action: Action; current: string }) {
  const [state, formAction] = useActionState(action, {});
  const v = (state.values as Record<string, string> | undefined) ?? { amount: current, reason: "" };
  return (
    <form action={formAction} className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Waiver (₦)" name="amount" errors={state.fieldErrors}>
          <input
            id="amount"
            name="amount"
            defaultValue={v.amount}
            inputMode="decimal"
            className={inputClass}
          />
        </Field>
        <Field label="Written approval / reason" name="reason" errors={state.fieldErrors}>
          <input id="reason" name="reason" defaultValue={v.reason} className={inputClass} />
        </Field>
      </div>
      <SubmitButton>Save waiver</SubmitButton>
    </form>
  );
}

/** Admin: re-price this record with a reason. */
export function RecalculateForm({
  action,
  label = "Recalculate pricing",
}: {
  action: Action;
  label?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      <FormMessage state={state} />
      <Field label="Reason for recalculating" name="reason" errors={state.fieldErrors}>
        <input
          id="reason"
          name="reason"
          defaultValue={String(state.values?.reason ?? "")}
          className={inputClass}
        />
      </Field>
      <SubmitButton pendingText="Recalculating…">{label}</SubmitButton>
    </form>
  );
}
