// User and Settings services: permission, validation, transaction and audit (CLAUDE.md definition of done).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { loadSettings } from "@/server/reference-data";
import { updateSettings } from "@/server/settings";
import type { Actor } from "@/server/types";
import { changeOwnPassword, createUser, resetPassword, updateUser } from "@/server/users";
import { hashSessionToken } from "@/server/session-store";
import { canSignInWith, makeUser, resetDb, testDb } from "./helpers";

const db = testDb();
let admin: Actor;
beforeEach(async () => {
  await resetDb(db);
  admin = await makeUser(db, ["ADMIN"]);
});
afterAll(() => db.$disconnect());

const newUser = {
  name: "Ada Evaluator",
  email: "Ada@OGSERC.gov.ng",
  password: "a long enough password",
  roles: ["EVALUATING_OFFICER", "REGISTRY_OFFICER"],
};

const lastAudit = () => db.auditLog.findFirstOrThrow({ orderBy: { id: "desc" } });
const inAnHour = () => new Date(Date.now() + 3_600_000);

describe("createUser", () => {
  it("creates a user with a hashed password and an audit entry", async () => {
    const user = await createUser(db, admin, newUser);
    expect(user.email).toBe("ada@ogserc.gov.ng");
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await canSignInWith(db, "ada@ogserc.gov.ng", newUser.password)).toBe(true);
    expect(await lastAudit()).toMatchObject({
      userId: admin.id,
      action: "User created",
      reference: "ada@ogserc.gov.ng",
      detail: "Ada Evaluator - roles Evaluating Officer, Registry Officer",
    });
  });

  it("is admin-only on the server", async () => {
    const other = await makeUser(db, ["REGISTRY_OFFICER", "APPROVING_OFFICER"]);
    await expect(createUser(db, other, newUser)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.user.count({ where: { email: "ada@ogserc.gov.ng" } })).toBe(0);
  });

  it("validates every field and rejects a duplicate email", async () => {
    const error = await createUser(db, admin, {
      ...newUser,
      email: "nope",
      password: "short",
      roles: [],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors).sort()).toEqual([
      "email",
      "password",
      "roles",
    ]);

    await createUser(db, admin, newUser);
    await expect(createUser(db, admin, newUser)).rejects.toMatchObject({
      fieldErrors: { email: ["Already in use"] },
    });
  });

  it("rejects unknown roles", async () => {
    await expect(
      createUser(db, admin, { ...newUser, roles: ["SUPERUSER"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("updateUser", () => {
  it("records what changed, and deactivation ends the user's sessions", async () => {
    const user = await createUser(db, admin, newUser);
    await db.session.create({
      data: { tokenHash: hashSessionToken("t1"), userId: user.id, expires: inAnHour() },
    });
    await updateUser(db, admin, user.id, {
      name: "Ada E.",
      email: user.email,
      roles: ["VIEWER"],
      active: false,
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await lastAudit()).detail).toBe(
      'name "Ada Evaluator" → "Ada E."; roles Evaluating Officer, Registry Officer → Viewer; deactivated',
    );
    expect(await canSignInWith(db, user.email, newUser.password)).toBe(false);
  });

  it("writes no audit entry when nothing changed", async () => {
    const user = await createUser(db, admin, newUser);
    const before = await db.auditLog.count();
    await updateUser(db, admin, user.id, {
      name: user.name,
      email: user.email,
      roles: user.roles,
      active: true,
    });
    expect(await db.auditLog.count()).toBe(before);
  });

  it("stops admins locking themselves or everyone out", async () => {
    const self = { name: admin.name, email: admin.email };
    await expect(
      updateUser(db, admin, admin.id, { ...self, roles: ["VIEWER"], active: true }),
    ).rejects.toThrow(/your own admin access/);
    await expect(
      updateUser(db, admin, admin.id, { ...self, roles: ["ADMIN"], active: false }),
    ).rejects.toThrow(ValidationError);
    const other = await makeUser(db, ["ADMIN"]);
    await updateUser(db, admin, other.id, {
      name: other.name,
      email: other.email,
      roles: ["VIEWER"],
      active: true,
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).roles).toEqual([
      "VIEWER",
    ]);
  });

  it("refuses to demote the last active admin even when the actor's own access has lapsed", async () => {
    // The actor's row was deactivated after their roles were read (e.g. a stale session).
    const target = await makeUser(db, ["ADMIN"]);
    await db.user.update({ where: { id: admin.id }, data: { active: false } });
    await expect(
      updateUser(db, admin, target.id, {
        name: target.name,
        email: target.email,
        roles: ["VIEWER"],
        active: true,
      }),
    ).rejects.toThrow("At least one active admin must remain.");
  });
});

describe("passwords", () => {
  it("admin reset replaces the password and signs the user out", async () => {
    const user = await createUser(db, admin, newUser);
    await db.session.create({
      data: { tokenHash: hashSessionToken("t2"), userId: user.id, expires: inAnHour() },
    });
    await resetPassword(db, admin, user.id, { password: "brand new password" });
    expect(await canSignInWith(db, user.email, "brand new password")).toBe(true);
    expect(await canSignInWith(db, user.email, newUser.password)).toBe(false);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await lastAudit()).action).toBe("Password reset");
  });

  it("users change their own password, keeping only the current session", async () => {
    const me = await makeUser(db, ["VIEWER"], { password: "my old password" });
    await db.session.createMany({
      data: [
        { tokenHash: hashSessionToken("here"), userId: me.id, expires: inAnHour() },
        { tokenHash: hashSessionToken("elsewhere"), userId: me.id, expires: inAnHour() },
      ],
    });
    const change = (currentPassword: string, confirmPassword = "my new password") =>
      changeOwnPassword(db, me, "here", {
        currentPassword,
        newPassword: "my new password",
        confirmPassword,
      });

    await expect(change("wrong")).rejects.toMatchObject({
      fieldErrors: { currentPassword: ["Incorrect password"] },
    });
    await expect(change("my old password", "typo")).rejects.toMatchObject({
      fieldErrors: { confirmPassword: ["Passwords do not match"] },
    });
    await change("my old password");
    const tokens = (await db.session.findMany({ where: { userId: me.id } })).map(
      (s) => s.tokenHash,
    );
    expect(tokens).toEqual([hashSessionToken("here")]);
    expect(await canSignInWith(db, me.email, "my new password")).toBe(true);
    expect((await lastAudit()).action).toBe("Password changed");
  });

  it("rejects unknown, inactive and wrong-password sign-ins", async () => {
    await makeUser(db, ["VIEWER"], {
      email: "off@ogserc.test",
      password: "right password",
      active: false,
    });
    expect(await canSignInWith(db, "off@ogserc.test", "right password")).toBe(false);
    expect(await canSignInWith(db, "nobody@ogserc.test", "whatever")).toBe(false);
    expect(await canSignInWith(db, admin.email, "wrong password")).toBe(false);
  });
});

describe("updateSettings", () => {
  const formValues = async (): Promise<Record<string, unknown>> => {
    const { policy, ...rest } = await loadSettings(db);
    return {
      ...rest,
      ...policy,
      feesRevisedOn: rest.feesRevisedOn ?? "",
      tinPattern: policy.tinPattern ?? "",
      unpaidReminderDays:
        policy.unpaidReminderDays === null ? "" : String(policy.unpaidReminderDays),
    };
  };

  it("saves changes and audits each one as old → new", async () => {
    await updateSettings(db, admin, {
      ...(await formValues()),
      effectiveDate: "2026-12-01",
      chairmanName: "Engr. Chair",
      flagsBlockApproval: true,
      tinPattern: "^\\d{8}-\\d{4}$",
    });
    const s = await loadSettings(db);
    expect(s.effectiveDate).toBe("2026-12-01");
    expect(s.chairmanName).toBe("Engr. Chair");
    expect(s.policy.flagsBlockApproval).toBe(true);
    expect(s.policy.tinPattern).toBe("^\\d{8}-\\d{4}$");
    expect((await lastAudit()).detail).toBe(
      "effectiveDate: 2026-10-22 → 2026-12-01; chairmanName: [Name] → Engr. Chair; " +
        "flagsBlockApproval: false → true; tinPattern: (blank) → ^\\d{8}-\\d{4}$",
    );
  });

  it("writes no audit entry when nothing changed", async () => {
    const before = await db.auditLog.count();
    await updateSettings(db, admin, await formValues());
    expect(await db.auditLog.count()).toBe(before);
  });

  it("is admin-only and validates", async () => {
    const viewer = await makeUser(db, ["VIEWER"]);
    await expect(updateSettings(db, viewer, await formValues())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      updateSettings(db, admin, {
        ...(await formValues()),
        effectiveDate: "2026-02-30",
        tinPattern: "([",
        ownUseThresholdKw: "1000",
      }),
    ).rejects.toMatchObject({
      fieldErrors: {
        effectiveDate: expect.any(Array),
        tinPattern: ["Not a valid regular expression"],
        ownUseThresholdKw: expect.any(Array),
      },
    });
  });
});
