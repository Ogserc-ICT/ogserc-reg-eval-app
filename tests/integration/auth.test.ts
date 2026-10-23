// Session storage and sign-in throttling against a real Postgres.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/errors";
import { LOGIN_LIMITS, attemptLogin, clientIp, unlockUser } from "@/server/login-throttle";
import {
  SESSION_ABSOLUTE_MAX_SECONDS,
  hashSessionToken,
  newSessionToken,
  sessionStore,
} from "@/server/session-store";
import type { Actor } from "@/server/types";
import { makeUser, resetDb, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const HOUR = 3_600_000;
const MIN = 60_000;

describe("session tokens", () => {
  it("are 256-bit random hex and unique", () => {
    const tokens = new Set(Array.from({ length: 1000 }, newSessionToken));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("are stored only as a SHA-256 hash", async () => {
    const user = await makeUser(db, ["VIEWER"]);
    const store = sessionStore(db);
    const token = newSessionToken();
    await store.createSession({
      sessionToken: token,
      userId: user.id,
      expires: new Date(Date.now() + HOUR),
    });

    const rows = await db.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);

    expect((await store.getSessionAndUser(token))?.user.id).toBe(user.id);
    // A leaked database row is not a usable cookie.
    expect(await store.getSessionAndUser(rows[0]!.tokenHash)).toBeNull();
  });

  it("expire on the server: idle expiry, absolute cap, deactivated user", async () => {
    const user = await makeUser(db, ["VIEWER"]);
    const store = sessionStore(db);
    const create = async (expiresInMs: number, createdAgoMs = 0) => {
      const token = newSessionToken();
      await db.session.create({
        data: {
          tokenHash: hashSessionToken(token),
          userId: user.id,
          expires: new Date(Date.now() + expiresInMs),
          createdAt: new Date(Date.now() - createdAgoMs),
        },
      });
      return token;
    };

    const idle = await create(-MIN);
    expect(await store.getSessionAndUser(idle)).toBeNull();
    expect(await db.session.count({ where: { tokenHash: hashSessionToken(idle) } })).toBe(0);

    const tooOld = await create(HOUR, SESSION_ABSOLUTE_MAX_SECONDS * 1000 + MIN);
    expect(await store.getSessionAndUser(tooOld)).toBeNull();

    const live = await create(HOUR);
    expect(await store.getSessionAndUser(live)).not.toBeNull();
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await store.getSessionAndUser(live)).toBeNull();
  });

  it("are never extended past the absolute cap", async () => {
    const user = await makeUser(db, ["VIEWER"]);
    const store = sessionStore(db);
    const token = newSessionToken();
    const createdAt = new Date(Date.now() - 11 * HOUR);
    await db.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expires: new Date(Date.now() + HOUR),
        createdAt,
      },
    });
    const updated = await store.updateSession({
      sessionToken: token,
      expires: new Date(Date.now() + 8 * HOUR),
    });
    expect(updated?.expires.getTime()).toBe(
      createdAt.getTime() + SESSION_ABSOLUTE_MAX_SECONDS * 1000,
    );
  });

  it("delete by token and report whose session it was", async () => {
    const user = await makeUser(db, ["VIEWER"]);
    const store = sessionStore(db);
    const token = newSessionToken();
    await store.createSession({
      sessionToken: token,
      userId: user.id,
      expires: new Date(Date.now() + HOUR),
    });
    expect((await store.deleteSession(token))?.userId).toBe(user.id);
    expect(await db.session.count()).toBe(0);
  });
});

describe("account lockout", () => {
  const PASSWORD = "the right password";
  const IP = "203.0.113.5";
  let user: Actor;
  const t0 = new Date("2026-11-02T09:00:00Z");
  const at = (minutes: number) => new Date(t0.getTime() + minutes * MIN);
  const fail = (when: Date, ip = IP) => attemptLogin(db, user.email, "wrong password", ip, when);

  beforeEach(async () => {
    user = await makeUser(db, ["REGISTRY_OFFICER"], { password: PASSWORD });
  });

  it(`locks after ${LOGIN_LIMITS.accountMaxFailures} failures for ${LOGIN_LIMITS.accountLockMinutes} minutes, then recovers`, async () => {
    for (let i = 0; i < 4; i++) expect(await fail(at(i))).toEqual({ ok: false, reason: "invalid" });
    expect(await db.auditLog.count({ where: { action: "Account locked" } })).toBe(0);

    const fifth = await fail(at(4));
    expect(fifth).toMatchObject({ ok: false, reason: "locked", lockedUntil: at(19) });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "Account locked" } });
    expect(audit).toMatchObject({ reference: user.email });
    expect(audit.detail).toContain(IP);

    // The right password is refused while locked…
    expect(await attemptLogin(db, user.email, PASSWORD, IP, at(18))).toMatchObject({
      reason: "locked",
    });
    // …and accepted once the lock has expired. No lockout is permanent.
    expect(await attemptLogin(db, user.email, PASSWORD, IP, at(20))).toMatchObject({ ok: true });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      failedLoginCount: 0,
      lockedUntil: null,
    });
  });

  it("only counts failures within the lockout window", async () => {
    for (let i = 0; i < 4; i++) await fail(at(i));
    expect(await fail(at(3 + LOGIN_LIMITS.accountLockMinutes + 1))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("resets the count after a successful sign-in", async () => {
    for (let i = 0; i < 4; i++) await fail(at(i));
    expect(await attemptLogin(db, user.email, PASSWORD, IP, at(5))).toMatchObject({ ok: true });
    for (let i = 0; i < 4; i++)
      expect(await fail(at(6 + i))).toEqual({ ok: false, reason: "invalid" });
  });

  it("an admin can unlock early, with an audit entry; others cannot", async () => {
    for (let i = 0; i < 5; i++) await fail(at(i));
    const admin = await makeUser(db, ["ADMIN"]);
    const finance = await makeUser(db, ["FINANCE_OFFICER", "APPROVING_OFFICER"]);
    await expect(unlockUser(db, finance, user.id)).rejects.toBeInstanceOf(ForbiddenError);
    await unlockUser(db, admin, user.id);
    expect(
      await db.auditLog.findFirstOrThrow({ where: { action: "Account unlocked" } }),
    ).toMatchObject({ userId: admin.id, reference: user.email });
    expect(await attemptLogin(db, user.email, PASSWORD, IP, at(6))).toMatchObject({ ok: true });
  });

  it("refuses a deactivated user's correct password like any other failure", async () => {
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await attemptLogin(db, user.email, PASSWORD, IP, t0)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("per-IP limit", () => {
  const t0 = new Date("2026-11-02T09:00:00Z");
  const at = (minutes: number) => new Date(t0.getTime() + minutes * MIN);

  it(`refuses an address after ${LOGIN_LIMITS.ipMaxFailures} failures in ${LOGIN_LIMITS.ipWindowMinutes} minutes, then recovers`, async () => {
    const victim = await makeUser(db, ["VIEWER"], { password: "the right password" });
    const bad = "198.51.100.7";
    // Spread across many (mostly unknown) accounts, so no single account locks.
    for (let i = 0; i < LOGIN_LIMITS.ipMaxFailures; i++) {
      await attemptLogin(db, `nobody${i}@ogserc.test`, "guess", bad, at(i * 0.5));
    }
    expect(
      await db.auditLog.count({
        where: { action: "Sign-in blocked for IP address", reference: bad },
      }),
    ).toBe(1);

    expect(await attemptLogin(db, victim.email, "the right password", bad, at(11))).toEqual({
      ok: false,
      reason: "ip-blocked",
    });
    // Another address is unaffected.
    expect(
      await attemptLogin(db, victim.email, "the right password", "192.0.2.1", at(11)),
    ).toMatchObject({ ok: true });
    // Once old failures leave the window, the address works again.
    expect(await attemptLogin(db, victim.email, "the right password", bad, at(30))).toMatchObject({
      ok: true,
    });
    expect(await db.loginAttempt.count({ where: { ip: bad, success: false } })).toBe(
      LOGIN_LIMITS.ipMaxFailures,
    );
  });

  it("reads the client address from the proxy headers", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.2" }))).toBe("10.0.0.2");
    expect(clientIp(new Headers({ "x-real-ip": "10.0.0.3" }))).toBe("10.0.0.3");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
