import { createHash, randomBytes } from "node:crypto";
import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import type { Db } from "./types";

/** Sliding idle expiry (refreshed while in use). */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
/** Hard cap from sign-in, however active the session is. */
export const SESSION_ABSOLUTE_MAX_SECONDS = 12 * 60 * 60;

/** 256 random bits, hex encoded. The cookie carries this; the DB stores only its hash. */
export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 is enough here: the token is 256 random bits, so there is nothing to brute-force or salt. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Auth.js adapter session methods backed by the Session table, storing token hashes only.
 * Expiry is also enforced here (idle `expires` and the absolute cap), not just by Auth.js.
 */
export function sessionStore(
  db: Db,
  now: () => number = Date.now,
): Required<
  Pick<Adapter, "createSession" | "getSessionAndUser" | "updateSession" | "deleteSession">
> {
  return {
    async createSession({ sessionToken, userId, expires }): Promise<AdapterSession> {
      await db.session.create({
        data: { tokenHash: hashSessionToken(sessionToken), userId, expires },
      });
      return { sessionToken, userId, expires };
    },

    async getSessionAndUser(sessionToken) {
      const tokenHash = hashSessionToken(sessionToken);
      const row = await db.session.findUnique({ where: { tokenHash }, include: { user: true } });
      if (!row) return null;
      const absoluteEnd = row.createdAt.getTime() + SESSION_ABSOLUTE_MAX_SECONDS * 1000;
      if (row.expires.getTime() <= now() || absoluteEnd <= now() || !row.user.active) {
        await db.session.deleteMany({ where: { tokenHash } });
        return null;
      }
      const { user, expires, userId } = row;
      return {
        session: { sessionToken, userId, expires },
        user: user as unknown as AdapterUser,
      };
    },

    async updateSession({ sessionToken, expires }) {
      const tokenHash = hashSessionToken(sessionToken);
      const row = await db.session.findUnique({ where: { tokenHash } });
      if (!row) return null;
      // Never extend beyond the absolute cap.
      const cap = new Date(row.createdAt.getTime() + SESSION_ABSOLUTE_MAX_SECONDS * 1000);
      const next = expires && expires > cap ? cap : (expires ?? row.expires);
      await db.session.update({ where: { tokenHash }, data: { expires: next } });
      return { sessionToken, userId: row.userId, expires: next };
    },

    async deleteSession(sessionToken) {
      const tokenHash = hashSessionToken(sessionToken);
      const row = await db.session.findUnique({ where: { tokenHash } });
      await db.session.deleteMany({ where: { tokenHash } });
      return row ? { sessionToken, userId: row.userId, expires: row.expires } : null;
    },
  };
}
