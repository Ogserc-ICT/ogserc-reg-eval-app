// The category forms data migration (prisma/migrations/20261024200200_category_forms_existing_records)
// against records in the old shape: its dry run first (which must change nothing), then the real thing.
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import seed from "../../seed-data.json";
import {
  CATEGORY_FORMS_MIGRATIONS,
  categoryFormsDryRun,
} from "../../scripts/category-forms-dry-run";

const NAME = `ogserc_forms_${Date.now()}`;
const base = new URL(inject("databaseUrl"));
const url = (() => {
  const u = new URL(base);
  u.pathname = `/${NAME}`;
  return u.toString();
})();
const pg = (database: string) => {
  const u = new URL(base);
  u.pathname = `/${database}`;
  u.searchParams.delete("schema");
  return new Client({ connectionString: u.toString() });
};

/** Apply the repository's migrations up to (not including) `stopBefore`, or all of them. */
function migrate(stopBefore?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "ogserc-migrate-"));
  cpSync("prisma/schema.prisma", path.join(dir, "schema.prisma"));
  for (const entry of readdirSync("prisma/migrations")) {
    if (stopBefore && entry >= stopBefore && entry !== "migration_lock.toml") continue;
    cpSync(path.join("prisma/migrations", entry), path.join(dir, "migrations", entry), {
      recursive: true,
    });
  }
  execSync(`npx prisma migrate deploy --schema "${path.join(dir, "schema.prisma")}"`, {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

let db: Client;

beforeAll(async () => {
  const admin = pg(base.pathname.slice(1));
  await admin.connect();
  await admin.query(`CREATE DATABASE ${NAME}`);
  await admin.end();
  migrate(CATEGORY_FORMS_MIGRATIONS[0]);
  db = pg(NAME);
  await db.connect();

  // Reference rows and records exactly as the app stored them before the category forms.
  await db.query(`
    INSERT INTO "FeeCategory" ("category", "registrationFee", "lateInitial", "lateDaily", "lateDailyCap", "description")
    VALUES ('E', 25000000, 0, 0, 0, 'Mini-grids'), ('F', 50000000, 0, 0, 0, 'Other distribution'),
           ('G', 50000000, 0, 0, 0, 'Estates');
    INSERT INTO "Activity" ("code", "name", "cat10MwPlus", "cat1To10Mw", "catBelow1Mw", "capacityBased", "sortOrder")
    VALUES ('MGD', 'Mini-grid', 'E', 'E', 'E', true, 1), ('MSL', 'Multi-State', 'F', 'F', 'F', false, 2),
           ('EST', 'Estate network', 'G', 'G', 'G', false, 3);
    INSERT INTO "User" ("id", "name", "email", "passwordHash", "roles", "updatedAt")
    VALUES ('u1', 'Registry', 'r@x.ng', 'x', '{REGISTRY_OFFICER}', now());
    INSERT INTO "EvaluationCheck" ("id", "stage", "text", "sortOrder")
    VALUES ('1.2', 'STAGE 1', 'Correct form used: REG-01 for operators; OUN-01 for own-use', 2),
           ('1.9', 'STAGE 1', 'If late', 9), ('2.1', 'STAGE 2', 'Identity', 10);
  `);
  const names = seed.schedule2_documents_legacy;
  for (const [i, n] of names.entries()) {
    await db.query(`INSERT INTO "Schedule2Document" ("number", "name") VALUES ($1, $2)`, [
      i + 1,
      n,
    ]);
  }
  const submission = (id: string, seq: number, cat: string, cols: Record<string, unknown>) =>
    db.query(
      `INSERT INTO "Submission" ("id", "ackSeq", "ackNo", "registeredName", "dateSubmitted", "principalLga",
         "primaryActivityCode", "secondaryActivityCode", "licenceStatus", "licenceNo", "licenceExpiry",
         "operatingOnEffectiveDate", "pricedCategory", "pricedRegistrationFee", "pricedLateInitial",
         "pricedLateDaily", "pricedLateDailyCap", "pricedEffectiveDate", "createdById", "updatedAt")
       VALUES ($1, $2, $3, $4, '2026-10-22', 'Ifo', $5, $6, $7, $8, $9, true, $10, 0, 0, 0, 0, '2026-10-22', 'u1', now())`,
      [
        id,
        seq,
        `OGSERC/ACK/2026/0000${seq}`,
        cols.name,
        cols.primary,
        cols.secondary ?? null,
        cols.licenceStatus,
        cols.licenceNo ?? null,
        cols.licenceExpiry ?? null,
        cat,
      ],
    );
  await submission("s1", 1, "E", {
    name: "Sunrise Mini-Grid Ltd",
    primary: "MGD",
    secondary: "EST",
    licenceStatus: "NERC registration/permit (mini-grid/captive)",
    licenceNo: "NERC/MG/1",
    licenceExpiry: "2027-05-01",
  });
  await submission("s2", 2, "F", {
    name: "Mighty Power Ltd",
    primary: "MSL",
    licenceStatus: "Unlicensed",
  });
  const item = (sid: string, n: number, v: string) =>
    db.query(
      `INSERT INTO "DocumentChecklistItem" ("submissionId", "documentNumber", "value") VALUES ($1, $2, $3)`,
      [sid, n, v],
    );
  for (let n = 1; n <= 13; n++) await item("s1", n, "Y");
  await item("s2", 1, "N");
  await item("s2", 10, "N/A");
  await item("s2", 13, "Y");
  await db.query(`
    INSERT INTO "OwnUseNotification" ("id", "ounSeq", "ounNo", "name", "dateFiled", "lga", "units",
      "installedCapacityKw", "fuel", "avgMonthlyOutputMwh", "pricedFee", "pricedThresholdKw", "createdById", "updatedAt")
    VALUES ('o1', 1, 'OGSERC/OUN/2026/0001', 'Ifo Bottling', '2026-10-22', 'Ifo', 3, 650, 'Diesel', 120,
      10000000, 200, 'u1', now())`);
}, 180_000);

afterAll(async () => {
  await db?.end();
  const admin = pg(base.pathname.slice(1));
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
  await admin.end();
});

describe("category forms migration of existing records", () => {
  it("dry run reports exactly what the migration would do, and changes nothing", async () => {
    const report = await categoryFormsDryRun(url);
    expect(report).toContain("dry run (nothing has been changed)");
    expect(report).toContain("Submissions: 2");
    expect(report).toContain("filed as REG-01E: 1");
    expect(report).toContain("filed as REG-01F: 1");
    expect(report).toContain("Checklist values: 16 on the old 13-item list → 11 carried over");
    expect(report).toContain("Own-use notifications: 1, each with one generator-unit row");
    expect(report).toContain("licences table: NERC/MG/1 exp 2027-05-01");
    expect(report).toContain("other activities: EST");
    expect(report).toContain("holds any licence N, multi-State N");
    expect(report).toContain(
      "generator units: Total of 3 units (recorded before Form REG-01I): 650.000 kW, Diesel",
    );

    // Still the old shape: the old columns and table, no new rows, no audit entries.
    const old = await db.query(
      `SELECT "licenceNo", "secondaryActivityCode" FROM "Submission" WHERE "id" = 's1'`,
    );
    expect(old.rows[0]).toEqual({ licenceNo: "NERC/MG/1", secondaryActivityCode: "EST" });
    expect(
      (await db.query(`SELECT count(*)::int AS n FROM "DocumentChecklistItem"`)).rows[0].n,
    ).toBe(16);
    const ours = `SELECT count(*)::int AS n FROM "AuditLog" WHERE "action" LIKE 'Migrated%' OR "action" LIKE 'Category forms%'`;
    expect((await db.query(ours)).rows[0].n).toBe(0);
    const tables = await db.query(`SELECT to_regclass('"RegistrationForm"') AS t`);
    expect(tables.rows[0].t).toBeNull();
  });

  it("then moves the records to the per-form shape, auditing each", async () => {
    migrate();
    const subs = await db.query(
      `SELECT "id", "formFiled", "filingType"::text AS "filingType", "holdsAnyLicence", "multiStateLicensee"
       FROM "Submission" ORDER BY "ackSeq"`,
    );
    expect(subs.rows).toEqual([
      {
        id: "s1",
        formFiled: "REG-01E",
        filingType: "New registration",
        holdsAnyLicence: true,
        multiStateLicensee: false,
      },
      {
        id: "s2",
        formFiled: "REG-01F",
        filingType: "New registration",
        holdsAnyLicence: false,
        multiStateLicensee: false,
      },
    ]);
    const docs = await db.query(
      `SELECT "submissionId", "documentKey", "value"::text AS value FROM "DocumentChecklistItem"
       ORDER BY "submissionId", "documentKey"`,
    );
    expect(docs.rows.filter((d) => d.submissionId === "s1").map((d) => d.documentKey)).toEqual([
      "asset_register",
      "board_resolution",
      "constitution",
      "env_safety_permits",
      "financials",
      "incorporation",
      "licences",
      "single_line_diagram",
      "tariff_order",
    ]);
    expect(docs.rows.filter((d) => d.submissionId === "s2")).toEqual([
      { submissionId: "s2", documentKey: "env_safety_permits", value: "N/A" },
      { submissionId: "s2", documentKey: "incorporation", value: "N" },
    ]);
    const licence = await db.query(
      `SELECT "type", "number", "expiryDate"::text AS expiry FROM "SubmissionLicence"`,
    );
    expect(licence.rows).toEqual([
      {
        type: "NERC registration/permit (mini-grid/captive)",
        number: "NERC/MG/1",
        expiry: "2027-05-01",
      },
    ]);
    const other = await db.query(`SELECT "submissionId", "activityCode" FROM "SubmissionActivity"`);
    expect(other.rows).toEqual([{ submissionId: "s1", activityCode: "EST" }]);
    const unit = await db.query(
      `SELECT "makeModel", "capacityKw"::text AS kw, "fuel" FROM "OwnUseUnit"`,
    );
    expect(unit.rows).toEqual([
      {
        makeModel: "Total of 3 units (recorded before Form REG-01I)",
        kw: "650.000",
        fuel: "Diesel",
      },
    ]);

    const audit = await db.query(
      `SELECT "action", "reference", "detail" FROM "AuditLog" WHERE "action" <> 'Finance gate introduced' ORDER BY "id"`,
    );
    const s1 = audit.rows.find((a) => a.reference === "OGSERC/ACK/2026/00001");
    expect(s1.detail).toBe(
      "Form filed REG-01E (Category E applied); New registration. Checklist values carried over: 9. " +
        "Not carried over (left pending): 7. PPAs, gas, bulk supply & franchise agreements = Y; " +
        "9. Customer enumeration summary = Y; " +
        "12. Evidence of registration fee payment = Y (now ticked automatically from confirmed payments); " +
        "13. Multi-State: Ogun asset/customer register & boundary points = Y. " +
        "Licence No. NERC/MG/1, expiry 2027-05-01 moved to the licences table. " +
        "Secondary activity EST is now an other activity.",
    );
    expect(audit.rows.map((a) => a.action)).toEqual([
      "Migrated to category forms",
      "Migrated to category forms",
      "Migrated to Form REG-01I",
      "Category forms introduced",
    ]);

    // Old columns and the 13-item table are gone; check 1.10 sits after 1.9.
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'Submission' AND column_name IN ('licenceNo', 'licenceExpiry', 'secondaryActivityCode')`,
    );
    expect(cols.rows).toEqual([]);
    expect((await db.query(`SELECT to_regclass('"Schedule2Document"') AS t`)).rows[0].t).toBeNull();
    const checks = await db.query(
      `SELECT "id", "sortOrder", "text" FROM "EvaluationCheck" ORDER BY "sortOrder"`,
    );
    expect(checks.rows.map((c) => [c.id, c.sortOrder])).toEqual([
      ["1.2", 2],
      ["1.9", 9],
      ["1.10", 10],
      ["2.1", 11],
    ]);
    expect(checks.rows[0].text).toContain("REG-01I");
    expect(await categoryFormsDryRun(url)).toContain("already been applied");
  });

  it("locks the filing type and linked registration once saved", async () => {
    await expect(
      db.query(`UPDATE "Submission" SET "filingType" = 'Annual confirmation' WHERE "id" = 's1'`),
    ).rejects.toThrow(/cannot change/);
  });
});
