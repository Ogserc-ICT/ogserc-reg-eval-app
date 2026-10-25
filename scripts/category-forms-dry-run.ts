// Dry run of the category forms migrations (prisma/migrations/20261024200000_category_forms_enums to
// 20261024200300_category_forms_cleanup): runs them inside one transaction, reports what they did to
// the existing records, then rolls everything back. Nothing is changed.
//
//   npm run category-forms:dry-run                      (DATABASE_URL from .env)
//   DATABASE_URL=postgresql://… npm run category-forms:dry-run
//
// While it runs (a few seconds), the transaction holds locks on the tables it alters, so staff saves
// wait until it finishes. AuditLog ids used inside the transaction are skipped afterwards (sequences
// are not rolled back); no audit entry is kept.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { Client } from "pg";

export const CATEGORY_FORMS_MIGRATIONS = [
  "20261024200000_category_forms_enums",
  "20261024200100_category_forms_schema",
  "20261024200200_category_forms_existing_records",
  "20261024200300_category_forms_cleanup",
];

/** Prisma's `?schema=public` is not a libpq parameter; keep the others (e.g. sslmode). */
function pgUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("schema");
  return u.toString();
}

interface SubmissionReport {
  ackNo: string;
  registeredName: string;
  status: string;
  formFiled: string;
  documents: string | null;
  licences: string | null;
  otherActivities: string | null;
  conditions: string;
  audit: string | null;
}

export async function categoryFormsDryRun(databaseUrl: string): Promise<string> {
  const client = new Client({ connectionString: pgUrl(databaseUrl) });
  await client.connect();
  const out: string[] = [];
  const say = (line = "") => out.push(line);
  try {
    const applied = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE migration_name = ANY($1) AND finished_at IS NOT NULL`,
      [CATEGORY_FORMS_MIGRATIONS],
    );
    const done = new Set(applied.rows.map((r) => r.migration_name));
    const pending = CATEGORY_FORMS_MIGRATIONS.filter((m) => !done.has(m));
    if (!pending.length) {
      say("The category forms migrations have already been applied to this database.");
      return out.join("\n");
    }
    const before = await client.query<{ submissions: string; ownuse: string; items: string }>(
      `SELECT (SELECT count(*) FROM "Submission") AS submissions,
              (SELECT count(*) FROM "OwnUseNotification") AS ownuse,
              (SELECT count(*) FROM "DocumentChecklistItem") AS items`,
    );

    await client.query("BEGIN");
    try {
      for (const m of pending) {
        await client.query(
          readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"),
        );
      }

      const subs = await client.query<SubmissionReport>(`
        SELECT s."ackNo", s."registeredName", s."status"::text AS status, s."formFiled",
          (SELECT string_agg(d."documentKey" || '=' || d."value"::text, ', ' ORDER BY f."sortOrder")
             FROM "DocumentChecklistItem" d
             LEFT JOIN "FormDocument" f ON f."form" = s."formFiled" AND f."key" = d."documentKey"
            WHERE d."submissionId" = s."id") AS documents,
          (SELECT string_agg(coalesce(l."number", '(no number)')
                  || coalesce(' exp ' || to_char(l."expiryDate", 'YYYY-MM-DD'), ''), '; ')
             FROM "SubmissionLicence" l WHERE l."submissionId" = s."id") AS licences,
          (SELECT string_agg(a."activityCode", ', ' ORDER BY a."sortOrder")
             FROM "SubmissionActivity" a WHERE a."submissionId" = s."id") AS "otherActivities",
          'holds any licence ' || coalesce(CASE WHEN s."holdsAnyLicence" THEN 'Y' ELSE 'N' END, '-')
            || ', multi-State ' || coalesce(CASE WHEN s."multiStateLicensee" THEN 'Y' ELSE 'N' END, '-')
            AS conditions,
          (SELECT a."detail" FROM "AuditLog" a
            WHERE a."reference" = s."ackNo" AND a."action" = 'Migrated to category forms'
            ORDER BY a."id" DESC LIMIT 1) AS audit
        FROM "Submission" s ORDER BY s."ackSeq"`);
      const ouns = await client.query<{ ounNo: string; name: string; units: string | null }>(`
        SELECT o."ounNo", o."name",
          (SELECT string_agg(coalesce(u."makeModel" || ': ', '') || u."capacityKw"::text || ' kW'
                  || coalesce(', ' || u."fuel", ''), '; ')
             FROM "OwnUseUnit" u WHERE u."ownUseNotificationId" = o."id") AS units
        FROM "OwnUseNotification" o ORDER BY o."ounSeq"`);
      const after = await client.query<{ items: string }>(
        `SELECT count(*) AS items FROM "DocumentChecklistItem"`,
      );
      const summary = await client.query<{ detail: string }>(
        `SELECT "detail" FROM "AuditLog" WHERE "action" = 'Category forms introduced'
         ORDER BY "id" DESC LIMIT 1`,
      );
      const byForm = new Map<string, number>();
      for (const s of subs.rows) byForm.set(s.formFiled, (byForm.get(s.formFiled) ?? 0) + 1);

      const b = before.rows[0]!;
      say("Category forms REG-01A to K — dry run (nothing has been changed)");
      say(`Migrations that would run: ${pending.join(", ")}`);
      say();
      say(`Submissions: ${b.submissions}`);
      for (const [form, n] of [...byForm].sort()) say(`  filed as ${form}: ${n}`);
      say(`  all as filing type "New registration"`);
      say(
        `Checklist values: ${b.items} on the old 13-item list → ${after.rows[0]!.items} carried over to the per-form keys (the rest are left pending; each submission's audit entry lists them)`,
      );
      say(`Own-use notifications: ${b.ownuse}, each with one generator-unit row`);
      if (summary.rows[0]) say(`Summary audit entry: ${summary.rows[0].detail}`);
      for (const s of subs.rows) {
        say();
        say(`${s.ackNo}  ${s.registeredName}  (${s.status})`);
        say(`  form filed: ${s.formFiled}; ${s.conditions}`);
        say(`  checklist: ${s.documents ?? "(none)"}`);
        if (s.licences) say(`  licences table: ${s.licences}`);
        if (s.otherActivities) say(`  other activities: ${s.otherActivities}`);
        if (s.audit) say(`  audit entry: ${s.audit}`);
      }
      for (const o of ouns.rows) {
        say();
        say(`${o.ounNo}  ${o.name}`);
        say(`  generator units: ${o.units ?? "(none)"}`);
      }
    } finally {
      await client.query("ROLLBACK");
    }
    return out.join("\n");
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  // Like Prisma, read .env when DATABASE_URL is not already set (it may start with a BOM).
  if (!process.env.DATABASE_URL && existsSync(".env")) {
    const vars = parseEnv(readFileSync(".env", "utf8").replace(/^﻿/, ""));
    if (vars.DATABASE_URL) process.env.DATABASE_URL = vars.DATABASE_URL;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  categoryFormsDryRun(url)
    .then((report) => console.log(report))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
