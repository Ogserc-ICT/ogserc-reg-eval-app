"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/action";

export function DailyReviewForm({ action }: { action: () => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <SubmitButton pendingText="Running…">Run now</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
