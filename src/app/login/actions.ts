"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import type { ActionState } from "@/lib/action";
import { signIn } from "@/lib/auth";
import { LOGIN_LIMITS } from "@/server/login-throttle";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
    return {};
  } catch (e) {
    // Success throws a redirect, which must propagate.
    if (e instanceof CredentialsSignin && e.code === "locked") {
      return {
        error: `Too many failed attempts. This account is locked for up to ${LOGIN_LIMITS.accountLockMinutes} minutes; an administrator can unlock it sooner.`,
      };
    }
    if (e instanceof CredentialsSignin && e.code === "ip-blocked") {
      return { error: "Too many failed sign-ins from this network. Try again in a few minutes." };
    }
    if (e instanceof AuthError) {
      return { error: "Invalid email or password, or the account is inactive." };
    }
    throw e;
  }
}
