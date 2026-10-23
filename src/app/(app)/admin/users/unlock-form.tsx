"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/action";

export function UnlockForm({
  action,
  lockedUntil,
}: {
  action: (prev: ActionState) => Promise<ActionState>;
  lockedUntil: string;
}) {
  const [state, formAction] = useActionState(action, {});
  if (state.ok) return <FormMessage state={state} />;
  const until = new Date(lockedUntil).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
  return (
    <form
      action={formAction}
      className="border-gold-400 bg-gold-300/30 mb-5 flex max-w-2xl items-center justify-between gap-4 rounded border px-3 py-2"
    >
      <p className="text-sm">Locked after too many failed sign-ins, until {until} (Lagos time).</p>
      <FormMessage state={state} />
      <SubmitButton pendingText="Unlocking…">Unlock now</SubmitButton>
    </form>
  );
}
