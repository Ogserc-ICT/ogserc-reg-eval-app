"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import type { ActionState } from "@/lib/action";

/** One-click generation (acknowledgement letter, EVAL-01). */
export function GenerateButton({
  action,
  label,
}: {
  action: () => Promise<ActionState>;
  label: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-1">
      <SubmitButton pendingText="Generating…">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

/** Admin: issue or reissue the certificate, with a reason. */
export function ReissueCertificateForm({
  action,
  label,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  label: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form key={formKey(state)} action={formAction} className="max-w-xl space-y-2">
      <FormMessage state={state} />
      <Field label="Reason" name="reason" errors={state.fieldErrors}>
        <input id="reason" name="reason" className={inputClass} />
      </Field>
      <SubmitButton pendingText="Generating…">{label}</SubmitButton>
    </form>
  );
}
