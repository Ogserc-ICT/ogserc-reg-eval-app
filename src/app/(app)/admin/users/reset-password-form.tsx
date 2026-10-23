"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import type { ActionState } from "@/lib/action";

export function ResetPasswordForm({
  action,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      key={state.ok ? state.message : "form"}
      action={formAction}
      className="max-w-sm space-y-4"
    >
      <FormMessage state={state} />
      <Field
        label="New temporary password"
        name="password"
        errors={state.fieldErrors}
        hint="At least 10 characters."
      >
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className={inputClass}
        />
      </Field>
      <SubmitButton>Reset password</SubmitButton>
    </form>
  );
}
