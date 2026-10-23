"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import { ROLES, ROLE_LABELS, type Role } from "@/domain/roles";
import type { ActionState } from "@/lib/action";

const ROLE_HELP: Record<Role, string> = {
  REGISTRY_OFFICER: "Intake, documents, payments, own-use notifications, acknowledgement letters",
  FINANCE_OFFICER: "Record payments, mark payments verified with bank",
  EVALUATING_OFFICER:
    "Evaluation checks on assigned submissions, mark complete, draft deficiency notices",
  REVIEWING_SUPERVISOR: "Review evaluations, issue deficiency notices, lapse",
  APPROVING_OFFICER: "Approve and register, refuse",
  ADMIN: "Users, roles, settings, fee table, activity map, cancel",
  VIEWER: "Read-only, dashboard",
};

export interface UserFormValues {
  name: string;
  email: string;
  roles: Role[];
  active: boolean;
}

export function UserForm({
  action,
  initial,
  mode,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial?: UserFormValues;
  mode: "create" | "edit";
}) {
  const [state, formAction] = useActionState(action, {});
  const errors = state.fieldErrors;
  // After an error, show what was submitted; after a successful create, an empty form.
  const v =
    (state.values as UserFormValues | undefined) ??
    (mode === "create" && state.ok ? undefined : initial);

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" name="name" errors={errors}>
          <input id="name" name="name" defaultValue={v?.name} required className={inputClass} />
        </Field>
        <Field label="Email" name="email" errors={errors}>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={v?.email}
            required
            className={inputClass}
          />
        </Field>
      </div>
      {mode === "create" && (
        <Field
          label="Temporary password"
          name="password"
          errors={errors}
          hint="At least 10 characters. Give it to the user privately; they can change it under My account."
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
      )}
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-gray-800">Roles</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {ROLES.map((role) => (
            <label
              key={role}
              className="flex gap-2 rounded border border-gray-200 bg-white p-2 text-sm"
            >
              <input
                type="checkbox"
                name="roles"
                value={role}
                defaultChecked={v?.roles.includes(role)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{ROLE_LABELS[role]}</span>
                <span className="block text-xs text-gray-500">{ROLE_HELP[role]}</span>
              </span>
            </label>
          ))}
        </div>
        {errors?.roles?.map((m) => (
          <p key={m} className="mt-1 text-xs text-red-700">
            {m}
          </p>
        ))}
      </fieldset>
      {mode === "edit" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={v?.active} />
          Active (unticking signs the user out and blocks sign-in)
        </label>
      )}
      <SubmitButton>{mode === "create" ? "Create user" : "Save changes"}</SubmitButton>
    </form>
  );
}
