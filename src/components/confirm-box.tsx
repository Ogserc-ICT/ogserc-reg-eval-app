"use client";

import type { ActionState } from "@/lib/action";

/** Shown when the server asks the user to confirm a warning before saving (e.g. duplicate CAC). */
export function ConfirmBox({ state }: { state: ActionState }) {
  if (!state.confirm) return null;
  return (
    <div
      role="alert"
      className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950"
    >
      <p className="font-medium">{state.confirm.message}</p>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" name={state.confirm.field} required />
        Yes, I have checked and want to save anyway
      </label>
    </div>
  );
}
