"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/action";

export function CommitForm({
  action,
  label,
}: {
  action: () => Promise<ActionState>;
  label: string;
}) {
  const [state, formAction] = useActionState(action, {});
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={formAction} className="space-y-3 rounded border border-gray-200 bg-white p-4">
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" name="confirm" required className="mt-1" />I have checked the
        warnings and pricing differences. Import these records; they cannot be deleted afterwards.
      </label>
      <FormMessage state={state} />
      <SubmitButton pendingText="Importing…">{label}</SubmitButton>
    </form>
  );
}
