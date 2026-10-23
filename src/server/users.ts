import { ROLE_LABELS, can, type Role } from "@/domain/roles";
import {
  passwordChangeSchema,
  passwordResetSchema,
  userCreateSchema,
  userUpdateSchema,
} from "@/lib/schemas";
import { writeAudit } from "./audit";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import { recordAccountFailure } from "./login-throttle";
import { hashSessionToken } from "./session-store";
import type { Actor, Db, Tx } from "./types";

const roleList = (roles: readonly Role[]) => roles.map((r) => ROLE_LABELS[r]).join(", ");

function requireAdmin(actor: Actor) {
  if (!can(actor.roles, "admin.users")) throw new ForbiddenError();
}

async function assertEmailFree(db: Db | Tx, email: string, exceptUserId?: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing && existing.id !== exceptUserId) {
    throw new ValidationError("That email is already in use.", { email: ["Already in use"] });
  }
}

export async function createUser(db: Db, actor: Actor, input: unknown) {
  requireAdmin(actor);
  const parsed = userCreateSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { name, email, roles, password } = parsed.data;
  await assertEmailFree(db, email);
  const passwordHash = await hashPassword(password);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email, roles, passwordHash } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "User created",
      reference: email,
      detail: `${name} - roles ${roleList(roles)}`,
    });
    return user;
  });
}

export async function updateUser(db: Db, actor: Actor, userId: string, input: unknown) {
  requireAdmin(actor);
  const parsed = userUpdateSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const next = parsed.data;

  return db.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: userId } });
    if (!current) throw new NotFoundError("User not found.");
    await assertEmailFree(tx, next.email, userId);

    const wasAdmin = current.active && current.roles.includes("ADMIN");
    const staysAdmin = next.active && next.roles.includes("ADMIN");
    if (wasAdmin && !staysAdmin) {
      if (userId === actor.id) {
        throw new ValidationError(
          "You cannot remove your own admin access or deactivate yourself.",
        );
      }
      const otherAdmins = await tx.user.count({
        where: { id: { not: userId }, active: true, roles: { has: "ADMIN" } },
      });
      if (otherAdmins === 0) throw new ValidationError("At least one active admin must remain.");
    }

    const changes: string[] = [];
    if (current.name !== next.name) changes.push(`name "${current.name}" → "${next.name}"`);
    if (current.email !== next.email) changes.push(`email ${current.email} → ${next.email}`);
    const before = roleList(current.roles);
    const after = roleList(next.roles);
    if (before !== after) changes.push(`roles ${before} → ${after}`);
    if (current.active !== next.active) changes.push(next.active ? "reactivated" : "deactivated");
    if (!changes.length) return current;

    const user = await tx.user.update({
      where: { id: userId },
      data: { name: next.name, email: next.email, roles: next.roles, active: next.active },
    });
    // A deactivated user is signed out everywhere at once.
    if (!next.active) await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "User updated",
      reference: next.email,
      detail: changes.join("; "),
    });
    return user;
  });
}

export async function resetPassword(db: Db, actor: Actor, userId: string, input: unknown) {
  requireAdmin(actor);
  const parsed = passwordResetSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const passwordHash = await hashPassword(parsed.data.password);

  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found.");
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Password reset",
      reference: user.email,
      detail: user.name,
    });
  });
}

/** Any signed-in user may change their own password. Other sessions are signed out. */
export async function changeOwnPassword(
  db: Db,
  actor: Actor,
  currentSessionToken: string | null,
  input: unknown,
) {
  const parsed = passwordChangeSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const user = await db.user.findUnique({ where: { id: actor.id } });
  if (!user) throw new NotFoundError("User not found.");
  if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
    // Counts towards the account lockout (docs/DECISIONS.md); a lockout also ends every session,
    // so a stolen session cannot keep guessing.
    const lockedUntil = await db.$transaction(async (tx) => {
      const until = await recordAccountFailure(tx, user, "change-password form");
      if (until) await tx.session.deleteMany({ where: { userId: user.id } });
      return until;
    });
    if (lockedUntil) {
      throw new ValidationError(
        "Too many wrong passwords. The account is now locked and signed out everywhere.",
      );
    }
    throw new ValidationError("Current password is incorrect.", {
      currentPassword: ["Incorrect password"],
    });
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash } });
    await tx.session.deleteMany({
      where: {
        userId: actor.id,
        ...(currentSessionToken
          ? { tokenHash: { not: hashSessionToken(currentSessionToken) } }
          : {}),
      },
    });
    await writeAudit(tx, { userId: actor.id, action: "Password changed", reference: user.email });
  });
}
