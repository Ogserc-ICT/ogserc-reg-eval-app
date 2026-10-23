import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { CredentialsSignin } from "next-auth";
import { encode as encodeJwt } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import type { Role } from "@/domain/roles";
import { loginSchema } from "@/lib/schemas";
import { db } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { attemptLogin, clientIp } from "@/server/login-throttle";
import { SESSION_MAX_AGE_SECONDS, newSessionToken, sessionStore } from "@/server/session-store";

// Session rows store a hash of the token; these methods replace the Prisma adapter's own.
const adapter = { ...PrismaAdapter(db), ...sessionStore(db) };

declare module "next-auth" {
  interface Session {
    user: { id: string; name: string; email: string; roles: Role[]; active: boolean };
  }
}

/** Distinguishable sign-in refusals (`code` reaches the login action). */
export class AccountLockedError extends CredentialsSignin {
  code = "locked";
}
export class IpBlockedError extends CredentialsSignin {
  code = "ip-blocked";
}

// Sessions live in the DB (Session table). Auth.js only issues JWTs for credentials sign-in, so the
// credentials flow is routed through `jwt.encode`, which creates a Session row and returns its token
// as the cookie value. With an adapter and no explicit strategy, Auth.js then reads sessions from the DB.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  trustHost: true,
  // Secure cookies in production regardless of how the proxy reports the protocol. Auth.js already
  // sets httpOnly and SameSite=Lax on the session cookie.
  useSecureCookies: process.env.NODE_ENV === "production",
  session: { maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 15 * 60 },
  pages: { signIn: "/login" },
  logger: {
    // Refused sign-ins are expected outcomes, not server errors.
    error(error) {
      if (!(error instanceof CredentialsSignin) && error.name !== "CredentialsSignin") {
        console.error(error);
      }
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const result = await attemptLogin(
          db,
          parsed.data.email,
          parsed.data.password,
          clientIp(request.headers),
        );
        if (result.ok)
          return { id: result.user.id, name: result.user.name, email: result.user.email };
        if (result.reason === "locked") throw new AccountLockedError();
        if (result.reason === "ip-blocked") throw new IpBlockedError();
        return null;
      },
    }),
  ],
  callbacks: {
    jwt({ token, account }) {
      if (account?.provider === "credentials") token.credentialsSignIn = true;
      return token;
    },
    session({ session, user }) {
      // `user` is the full User row from the session store; expose only what the app needs.
      const row = user as unknown as {
        id: string;
        name: string;
        email: string;
        roles: Role[];
        active: boolean;
      };
      return {
        ...session,
        user: {
          id: row.id,
          name: row.name,
          email: row.email,
          roles: row.roles,
          active: row.active,
        },
      };
    },
  },
  jwt: {
    async encode(params) {
      if (params.token?.credentialsSignIn && params.token.sub) {
        const sessionToken = newSessionToken();
        await adapter.createSession({
          sessionToken,
          userId: params.token.sub,
          expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
        });
        return sessionToken;
      }
      return encodeJwt(params);
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      await db.$transaction((tx) =>
        writeAudit(tx, { userId: user.id!, action: "Signed in", reference: user.email ?? null }),
      );
    },
    async signOut(message) {
      const userId = "session" in message ? message.session?.userId : undefined;
      if (!userId) return;
      await db.$transaction((tx) => writeAudit(tx, { userId, action: "Signed out" }));
    },
  },
});
