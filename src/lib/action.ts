import {
  BlockedError,
  ConfirmationRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import type { Actor } from "@/server/types";
import { redirect } from "next/navigation";
import { requireUser } from "./session";

/** Result returned by every server action to its form (used with React's useActionState). */
export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Submitted values, echoed back on error so the form can redisplay them (React resets forms after an action). */
  values?: Record<string, unknown>;
  /** A warning the user must confirm (checkbox `field`) before resubmitting. */
  confirm?: { field: string; message: string };
  /** Every reason a workflow action is blocked. */
  reasons?: string[];
}

/** A successful action either reports a message on the form or redirects (e.g. to a new record). */
export type ActionOutcome = string | { redirectTo: string };

/**
 * Run a server action as the signed-in user. The service called by `fn` does the permission check,
 * validation, transaction and audit entry; this turns its errors into form state.
 */
export async function runAction(
  fn: (actor: Actor) => Promise<ActionOutcome>,
  values?: Record<string, unknown>,
): Promise<ActionState> {
  const actor = await requireUser();
  let outcome: ActionOutcome;
  try {
    outcome = await fn(actor);
  } catch (e) {
    if (e instanceof BlockedError) return { error: e.message, reasons: e.reasons, values };
    if (e instanceof ConfirmationRequiredError)
      return { confirm: { field: e.field, message: e.message }, values };
    if (e instanceof ValidationError)
      return { error: e.message, fieldErrors: e.fieldErrors, values };
    if (e instanceof ForbiddenError || e instanceof NotFoundError)
      return { error: e.message, values };
    throw e;
  }
  // Outside the try: redirect() works by throwing.
  if (typeof outcome === "object") redirect(outcome.redirectTo);
  return { ok: true, message: outcome };
}

/** Every field of a form as text (for echoing values back after an error). */
export function formValues(fd: FormData, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? "")]));
}

export const formText = (fd: FormData, key: string) => String(fd.get(key) ?? "");
export const formBool = (fd: FormData, key: string) => fd.get(key) === "on";
export const formAll = (fd: FormData, key: string) => fd.getAll(key).map(String);
