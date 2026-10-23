"use client";

import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";

export const inputClass =
  "block w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-xs focus:border-brand-600 focus:outline-2 focus:outline-brand-600/30 aria-invalid:border-red-600";

export function Field({
  label,
  name,
  errors,
  hint,
  children,
}: {
  label: string;
  name: string;
  errors?: Record<string, string[]>;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const messages = errors?.[name];
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-gray-800">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {messages?.map((m) => (
        <p key={m} id={`${name}-error`} className="mt-1 text-xs text-red-700">
          {m}
        </p>
      ))}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingText,
}: {
  children: React.ReactNode;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-brand-700 hover:bg-brand-800 focus-visible:outline-gold-500 rounded px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
    >
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <div
        role="alert"
        className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        <p>{state.error}</p>
        {state.reasons && state.reasons.length > 0 && (
          <ul className="mt-1 ml-5 list-disc">
            {state.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (state.ok && state.message) {
    return (
      <p
        role="status"
        className="border-brand-100 bg-brand-50 text-brand-800 rounded border px-3 py-2 text-sm"
      >
        {state.message}
      </p>
    );
  }
  return null;
}

const formKeys = new WeakMap<object, number>();
let lastFormKey = 0;

/**
 * A key that changes with each action result. React resets a form after its action runs, and a
 * <select> then returns to the option it had when first rendered, ignoring echoed values. Keying the
 * form on the result remounts it, so every field (selects included) shows `state.values`.
 */
export function formKey(state: object): number {
  let key = formKeys.get(state);
  if (key === undefined) {
    key = ++lastFormKey;
    formKeys.set(state, key);
  }
  return key;
}
