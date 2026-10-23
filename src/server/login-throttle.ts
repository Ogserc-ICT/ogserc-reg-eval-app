import type { User } from "@prisma/client";
import { writeAudit } from "./audit";
import { dummyPasswordHash, verifyPassword } from "./password";
import type { Actor, Db, Tx } from "./types";
import { can } from "@/domain/roles";
import { ForbiddenError, NotFoundError } from "./errors";

export const LOGIN_LIMITS = {
  /** Failed attempts on one account before it locks. */
  accountMaxFailures: 5,
  /** Lockout length; failures older than this also stop counting. */
  accountLockMinutes: 15,
  /** Failed attempts from one IP address in the window before that address is refused. */
  ipMaxFailures: 20,
  ipWindowMinutes: 15,
  /** LoginAttempt rows older than this are pruned. */
  retainDays: 7,
} as const;

export type LoginOutcome =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "locked" | "ip-blocked"; lockedUntil?: Date };

const minutes = (n: number) => n * 60_000;

/**
 * Check credentials with throttling. Every refusal looks the same to the caller except a lockout,
 * which the user needs to know about. No lockout is permanent: both limits expire on their own.
 */
export async function attemptLogin(
  db: Db,
  rawEmail: string,
  password: string,
  ip: string,
  now: Date = new Date(),
): Promise<LoginOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const windowStart = new Date(now.getTime() - minutes(LOGIN_LIMITS.ipWindowMinutes));

  const ipFailures = await db.loginAttempt.count({
    where: { ip, success: false, createdAt: { gt: windowStart } },
  });
  if (ipFailures >= LOGIN_LIMITS.ipMaxFailures) return { ok: false, reason: "ip-blocked" };

  const user = await db.user.findUnique({ where: { email } });
  if (user?.lockedUntil && user.lockedUntil > now) {
    await db.loginAttempt.create({ data: { ip, email, success: false, createdAt: now } });
    return { ok: false, reason: "locked", lockedUntil: user.lockedUntil };
  }

  const passwordOk = await verifyPassword(
    user?.passwordHash ?? (await dummyPasswordHash()),
    password,
  );

  if (user && passwordOk && user.active) {
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
      }),
      db.loginAttempt.create({ data: { ip, email, success: true, createdAt: now } }),
      db.loginAttempt.deleteMany({
        where: {
          createdAt: { lt: new Date(now.getTime() - LOGIN_LIMITS.retainDays * 86_400_000) },
        },
      }),
    ]);
    return { ok: true, user };
  }

  const lockedUntil = await db.$transaction(async (tx) => {
    await tx.loginAttempt.create({ data: { ip, email, success: false, createdAt: now } });

    if (ipFailures + 1 === LOGIN_LIMITS.ipMaxFailures) {
      await writeAudit(tx, {
        userId: null,
        action: "Sign-in blocked for IP address",
        reference: ip,
        detail: `${LOGIN_LIMITS.ipMaxFailures} failed sign-ins in ${LOGIN_LIMITS.ipWindowMinutes} minutes`,
      });
    }
    if (!user) return null;
    return recordAccountFailure(tx, user, `sign-in from IP ${ip}`, now);
  });

  return lockedUntil
    ? { ok: false, reason: "locked", lockedUntil }
    : { ok: false, reason: "invalid" };
}

/**
 * Count one failed password check against an account; lock it when the limit is reached (audited).
 * Shared by sign-in and the change-password form. Returns the lock expiry, or null.
 */
export async function recordAccountFailure(
  tx: Tx,
  user: Pick<User, "id" | "email">,
  source: string,
  now: Date = new Date(),
): Promise<Date | null> {
  // Row lock so concurrent failures count correctly.
  const [row] = await tx.$queryRaw<{ failedLoginCount: number; lastFailedLoginAt: Date | null }[]>`
    SELECT "failedLoginCount", "lastFailedLoginAt" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
  const recent =
    row?.lastFailedLoginAt &&
    row.lastFailedLoginAt.getTime() > now.getTime() - minutes(LOGIN_LIMITS.accountLockMinutes);
  const count = (recent ? row.failedLoginCount : 0) + 1;

  if (count >= LOGIN_LIMITS.accountMaxFailures) {
    const until = new Date(now.getTime() + minutes(LOGIN_LIMITS.accountLockMinutes));
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lastFailedLoginAt: now, lockedUntil: until },
    });
    await writeAudit(tx, {
      userId: null,
      action: "Account locked",
      reference: user.email,
      detail: `${count} failed password checks; locked until ${until.toISOString()} (${source})`,
    });
    return until;
  }
  await tx.user.update({
    where: { id: user.id },
    data: { failedLoginCount: count, lastFailedLoginAt: now },
  });
  return null;
}

/** Admin: lift a lockout early. */
export async function unlockUser(db: Db, actor: Actor, userId: string): Promise<void> {
  if (!can(actor.roles, "admin.users")) throw new ForbiddenError();
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found.");
    await tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
    });
    await writeAudit(tx, { userId: actor.id, action: "Account unlocked", reference: user.email });
  });
}

/**
 * Client IP for the per-IP limit. Behind the production reverse proxy, the right-most
 * X-Forwarded-For entry is the address the proxy saw (clients can only prepend to it).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last || headers.get("x-real-ip")?.trim() || "unknown";
}
