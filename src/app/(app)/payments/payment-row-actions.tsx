"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton, inputClass } from "@/components/form";
import type { ActionState } from "@/lib/action";

/** Reverse button for one payment row (Finance or Admin, with a reason). The server checks the role. */
export function PaymentRowActions({
  reverse,
}: {
  reverse: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [reverseState, reverseAction] = useActionState(reverse, {});
  const [reversing, setReversing] = useState(false);

  return (
    <div className="space-y-1 text-xs">
      <div className="flex gap-2">
        {!reversing && (
          <button
            type="button"
            className="text-red-700 hover:underline"
            onClick={() => setReversing(true)}
          >
            Reverse…
          </button>
        )}
      </div>
      {reversing && (
        <form action={reverseAction} className="space-y-1">
          <FormMessage state={reverseState} />
          <label className="block">
            Reason for reversal
            <input name="reason" required minLength={5} className={inputClass} />
          </label>
          {reverseState.fieldErrors?.reason?.map((m) => (
            <p key={m} className="text-red-700">
              {m}
            </p>
          ))}
          <div className="flex gap-2">
            <SubmitButton pendingText="Reversing…">Reverse payment</SubmitButton>
            <button
              type="button"
              className="text-gray-600 hover:underline"
              onClick={() => setReversing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
