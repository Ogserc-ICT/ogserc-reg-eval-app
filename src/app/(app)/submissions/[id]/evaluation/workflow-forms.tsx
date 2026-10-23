"use client";

import { useActionState } from "react";
import { ConfirmBox } from "@/components/confirm-box";
import { Field, FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * One workflow action: what it does, every reason it is currently blocked (worked out on the server
 * with the same rules the action enforces), and its form. The server re-checks everything on submit.
 */
export function WorkflowAction({
  title,
  description,
  blockers,
  action,
  submitLabel,
  tone = "primary",
  children,
}: {
  title: string;
  description: string;
  blockers: string[];
  action: Action;
  submitLabel: string;
  tone?: "primary" | "danger";
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  const blocked = blockers.length > 0;
  return (
    <form
      key={formKey(state)}
      action={formAction}
      className="space-y-2 border-t border-gray-100 py-3 first:border-t-0"
    >
      <h3 className="text-brand-900 text-sm font-semibold">{title}</h3>
      <p className="text-xs text-gray-600">{description}</p>
      {blocked && (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
          <p className="font-medium">Not yet possible:</p>
          <ul className="ml-4 list-disc">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      <FormMessage state={state} />
      <ConfirmBox state={state} />
      {children}
      <button
        type="submit"
        disabled={blocked}
        className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
          tone === "danger" ? "bg-red-700 hover:bg-red-800" : "bg-brand-700 hover:bg-brand-800"
        }`}
      >
        {submitLabel}
      </button>
    </form>
  );
}

/** Assign evaluating officer, reviewing supervisor and approving officer (filtered by role). */
export function AssignOfficersForm({
  action,
  current,
  options,
}: {
  action: Action;
  current: Record<"evaluatingOfficerId" | "reviewingSupervisorId" | "approvingOfficerId", string>;
  options: Record<keyof typeof current, { id: string; name: string }[]>;
}) {
  const [state, formAction] = useActionState(action, {});
  const v = (state.values as typeof current | undefined) ?? current;
  const select = (name: keyof typeof current, label: string) => (
    <Field label={label} name={name} errors={state.fieldErrors}>
      <select id={name} name={name} defaultValue={v[name]} className={inputClass}>
        <option value="">(none)</option>
        {options[name].map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <form key={formKey(state)} action={formAction} className="space-y-3">
      <FormMessage state={state} />
      {select("evaluatingOfficerId", "Evaluating officer")}
      {select("reviewingSupervisorId", "Reviewing supervisor")}
      {select("approvingOfficerId", "Approving officer")}
      <SubmitButton>Save officers</SubmitButton>
    </form>
  );
}

export function ApproveFields({
  needsOverride,
  current,
}: {
  needsOverride: boolean;
  current: string;
}) {
  if (!needsOverride) return null;
  return (
    <Field
      label="Written reason for approving despite the data flags"
      name="flagOverrideReason"
      hint="Recorded on the evaluation and in the audit log (SPEC §4.6)."
    >
      <textarea
        id="flagOverrideReason"
        name="flagOverrideReason"
        rows={2}
        defaultValue={current}
        className={inputClass}
      />
    </Field>
  );
}

export function RefuseFields({ grounds }: { grounds: readonly string[] }) {
  return (
    <>
      <Field label="Ground (paras 13(3), 20)" name="ground">
        <select id="ground" name="ground" defaultValue={grounds[0]} className={inputClass}>
          {grounds.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </Field>
      <Field label="Details" name="details">
        <textarea id="details" name="details" rows={2} className={inputClass} />
      </Field>
    </>
  );
}

export function ShowCauseFields({ today, current }: { today: string; current: string }) {
  return (
    <Field label="Date the show-cause notice was served" name="showCauseDate">
      <input
        id="showCauseDate"
        name="showCauseDate"
        type="date"
        max={today}
        defaultValue={current || today}
        className={inputClass}
      />
    </Field>
  );
}

export function ReasonField({ label }: { label: string }) {
  return (
    <Field label={label} name="reason">
      <input id="reason" name="reason" className={inputClass} />
    </Field>
  );
}
