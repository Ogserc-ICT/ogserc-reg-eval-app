"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton, inputClass } from "@/components/form";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Confirm (verified tick required) or reject (reason required) one pending payment. */
export function DecisionForms({
  paymentNo,
  confirm,
  reject,
  recordedByMe,
}: {
  paymentNo: string;
  confirm: Action;
  reject: Action;
  recordedByMe: boolean;
}) {
  const [confirmState, confirmAction] = useActionState(confirm, {});
  const [rejectState, rejectAction] = useActionState(reject, {});
  const [mode, setMode] = useState<"none" | "confirm" | "reject">("none");

  return (
    <div className="space-y-2 text-sm">
      {mode === "none" && (
        <div className="flex flex-wrap gap-3">
          {recordedByMe ? (
            <span className="text-xs text-gray-600">
              You recorded this payment; another Finance officer must confirm it.
            </span>
          ) : (
            <button
              type="button"
              className="text-brand-700 font-medium hover:underline"
              onClick={() => setMode("confirm")}
            >
              Confirm…
            </button>
          )}
          <button
            type="button"
            className="text-red-700 hover:underline"
            onClick={() => setMode("reject")}
          >
            Reject…
          </button>
        </div>
      )}

      {mode === "confirm" && (
        <form action={confirmAction} className="space-y-2 rounded border border-gray-200 p-2">
          <FormMessage state={confirmState} />
          <label className="flex items-start gap-2">
            <input type="checkbox" name="verified" required className="mt-1" />
            <span>
              I have verified {paymentNo} against the bank statement / Remita
              {confirmState.fieldErrors?.verified?.map((m) => (
                <span key={m} className="block text-xs text-red-700">
                  {m}
                </span>
              ))}
            </span>
          </label>
          <label className="block text-xs text-gray-600">
            Remarks (optional)
            <input name="remarks" maxLength={1000} className={inputClass} />
          </label>
          <div className="flex gap-3">
            <SubmitButton pendingText="Confirming…">Confirm payment</SubmitButton>
            <button
              type="button"
              className="text-gray-600 hover:underline"
              onClick={() => setMode("none")}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "reject" && (
        <form action={rejectAction} className="space-y-2 rounded border border-gray-200 p-2">
          <FormMessage state={rejectState} />
          <label className="block text-xs text-gray-600">
            Reason for rejecting {paymentNo}
            <input name="reason" required minLength={5} maxLength={1000} className={inputClass} />
          </label>
          {rejectState.fieldErrors?.reason?.map((m) => (
            <p key={m} className="text-xs text-red-700">
              {m}
            </p>
          ))}
          <div className="flex gap-3">
            <SubmitButton pendingText="Rejecting…">Reject payment</SubmitButton>
            <button
              type="button"
              className="text-gray-600 hover:underline"
              onClick={() => setMode("none")}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
