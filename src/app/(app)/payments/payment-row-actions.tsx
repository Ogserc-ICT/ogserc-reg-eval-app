"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton, inputClass } from "@/components/form";
import type { ActionState } from "@/lib/action";

/** Verify / reverse buttons for one payment row. The server checks the role either way. */
export function PaymentRowActions({
  verify,
  reverse,
  canVerify,
  canReverse,
}: {
  verify: () => Promise<ActionState>;
  reverse: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  canVerify: boolean;
  canReverse: boolean;
}) {
  const [verifyState, verifyAction] = useActionState(verify, {});
  const [reverseState, reverseAction] = useActionState(reverse, {});
  const [reversing, setReversing] = useState(false);

  return (
    <div className="space-y-1 text-xs">
      <div className="flex gap-2">
        {canVerify && (
          <form action={verifyAction}>
            <button type="submit" className="text-brand-700 hover:underline">
              Mark verified
            </button>
          </form>
        )}
        {canReverse && !reversing && (
          <button
            type="button"
            className="text-red-700 hover:underline"
            onClick={() => setReversing(true)}
          >
            Reverse…
          </button>
        )}
      </div>
      <FormMessage state={verifyState} />
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
