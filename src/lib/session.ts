import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { can, type Permission } from "@/domain/roles";
import type { Actor } from "@/server/types";
import { auth } from "./auth";

/** The signed-in, active user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, roles: u.roles };
});

export async function requireUser(): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: send users without the permission to the "not allowed" page. */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const user = await requireUser();
  if (!can(user.roles, permission)) redirect("/forbidden");
  return user;
}

export async function currentSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return (
    jar.get("__Secure-authjs.session-token")?.value ??
    jar.get("authjs.session-token")?.value ??
    null
  );
}
