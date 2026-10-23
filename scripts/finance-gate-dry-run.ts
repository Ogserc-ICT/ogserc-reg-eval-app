// Dry run of the Finance gate data migration (prisma/migrations/20261024090200_finance_gate_existing_records):
// lists what it would change, changing nothing. Works before or after the schema parts are applied.
//
//   npm run finance-gate:dry-run                      (DATABASE_URL from .env)
//   DATABASE_URL=postgresql://… npm run finance-gate:dry-run
import { PrismaClient } from "@prisma/client";

const CLOSED = ["Registered", "Refused", "Lapsed", "Cancelled"];

async function main() {
  const db = new PrismaClient();
  try {
    const columns = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Payment' AND column_name = 'financeStatus'`;
    const hasFinanceStatus = columns.length > 0;
    const applied = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "_prisma_migrations"
      WHERE migration_name = '20261024090200_finance_gate_existing_records' AND finished_at IS NOT NULL`;
    if (Number(applied[0]?.n ?? 0) > 0) {
      console.log("The Finance gate data migration has already been applied to this database.");
    }

    // Same rule as the migration. Before the schema change no payment can be Finance-confirmed.
    const confirmed = hasFinanceStatus
      ? `AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."submissionId" = s."id"
           AND p."status" = 'ACTIVE' AND p."financeStatus" = 'CONFIRMED')`
      : "";
    const moves = await db.$queryRawUnsafe<{ ackNo: string; name: string; status: string }[]>(
      `SELECT s."ackNo", s."registeredName" AS name, s."status"::text AS status FROM "Submission" s
       WHERE s."status"::text NOT IN ('Acknowledged - Awaiting Payment', ${CLOSED.map((c) => `'${c}'`).join(", ")})
       ${confirmed}
       ORDER BY s."ackSeq"`,
    );
    const total = await db.submission.count();
    const payments = await db.$queryRawUnsafe<{ n: bigint }[]>(
      hasFinanceStatus
        ? `SELECT count(*) AS n FROM "Payment" WHERE "financeStatus" = 'PENDING'`
        : `SELECT count(*) AS n FROM "Payment"`,
    );
    const byStatus = new Map<string, number>();
    for (const m of moves) byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1);

    console.log(`Submissions in the database: ${total}`);
    console.log(`Would return to "Acknowledged - Awaiting Payment": ${moves.length}`);
    for (const [status, n] of byStatus) console.log(`  from ${status}: ${n}`);
    for (const m of moves) console.log(`  ${m.ackNo}  ${m.name}  (${m.status})`);
    console.log(
      `Unchanged: ${total - moves.length} (closed, already awaiting payment, or Finance-confirmed)`,
    );
    console.log(
      `Payments that will be Pending until Finance confirms them: ${Number(payments[0]?.n ?? 0)}`,
    );
    console.log(
      `Audit entries the migration would write: ${moves.length} (one per submission) + 1 summary`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
