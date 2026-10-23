"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import type { CheckValue } from "@/domain/types";
import type { ActionState } from "@/lib/action";

export interface CheckRow {
  id: string;
  stage: string;
  text: string;
  value: CheckValue;
  mode: "auto" | "auto-na" | "manual";
  editable: boolean;
}

const CHOICES: { value: string; label: string }[] = [
  { value: "Y", label: "Y" },
  { value: "N", label: "N" },
  { value: "N/A", label: "N/A" },
  { value: "", label: "–" },
];

const valueStyle = (v: CheckValue) =>
  v === "Y"
    ? "bg-brand-100 text-brand-900"
    : v === "N"
      ? "bg-red-100 text-red-900"
      : v === "N/A"
        ? "bg-gray-100 text-gray-700"
        : "bg-amber-50 text-amber-900";

/** EVAL-01 checks grouped by stage. Automatic checks are read-only (SPEC §6). */
export function ChecksForm({
  action,
  checks,
  remarks,
  canEdit,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  checks: CheckRow[];
  remarks: string;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const stages = [...new Set(checks.map((c) => c.stage))];

  return (
    <form key={formKey(state)} action={formAction} className="space-y-4">
      <FormMessage state={state} />
      {stages.map((stage) => (
        <fieldset key={stage} className="rounded border border-gray-200 bg-white">
          <legend className="sr-only">{stage}</legend>
          <h3 className="bg-brand-50 text-brand-900 border-b border-gray-100 px-3 py-1.5 text-xs font-semibold tracking-wide">
            {stage}
          </h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {checks
                .filter((c) => c.stage === stage)
                .map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className="w-10 py-1.5 pl-3 text-xs text-gray-500">{c.id}</td>
                    <td className="py-1.5 pr-2">{c.text}</td>
                    <td className="w-56 py-1.5 pr-3 text-right whitespace-nowrap">
                      {c.editable && canEdit ? (
                        <span className="inline-flex gap-2">
                          {CHOICES.map((o) => (
                            <label
                              key={o.label}
                              className="inline-flex items-center gap-0.5 text-xs"
                            >
                              <input
                                type="radio"
                                name={`check-${c.id}`}
                                value={o.value}
                                defaultChecked={(c.value ?? "") === o.value}
                                aria-label={`${c.id}: ${o.value || "pending"}`}
                              />
                              {o.label}
                            </label>
                          ))}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${valueStyle(c.value)}`}
                          >
                            {c.value ?? "Pending"}
                          </span>
                          <span className="text-xs text-gray-500">
                            {c.mode === "auto"
                              ? "automatic"
                              : c.mode === "auto-na"
                                ? "does not apply"
                                : "locked"}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </fieldset>
      ))}
      <label className="block text-sm font-medium text-gray-800">
        Evaluation remarks
        <textarea
          name="remarks"
          rows={3}
          defaultValue={remarks}
          readOnly={!canEdit}
          className={`${inputClass} mt-1`}
        />
      </label>
      {canEdit && <SubmitButton>Save checks</SubmitButton>}
    </form>
  );
}
