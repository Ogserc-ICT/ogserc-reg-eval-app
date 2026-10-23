"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import { changePasswordAction } from "./actions";

export function PasswordForm() {
  const [state, action] = useActionState(changePasswordAction, {});
  const errors = state.fieldErrors;
  return (
    <form action={action} className="max-w-sm space-y-4">
      <FormMessage state={state} />
      <Field label="Current password" name="currentPassword" errors={errors}>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </Field>
      <Field label="New password" name="newPassword" errors={errors} hint="At least 10 characters.">
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className={inputClass}
        />
      </Field>
      <Field label="Confirm new password" name="confirmPassword" errors={errors}>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass}
        />
      </Field>
      <SubmitButton>Change password</SubmitButton>
    </form>
  );
}
