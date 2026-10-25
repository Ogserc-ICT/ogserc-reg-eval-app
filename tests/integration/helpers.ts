import { PrismaClient, type Prisma } from "@prisma/client";
import formsFile from "../../registration-forms.json";
import { PAYMENT_EVIDENCE_KEY } from "@/domain/forms";
import { inject } from "vitest";
import type { Role } from "@/domain/roles";
import { formatAckNo } from "@/domain/numbers";
import { COUNTER, nextCounter } from "@/server/counters";
import { hashPassword, verifyPassword } from "@/server/password";
import { priceNewSubmission } from "@/server/pricing";
import { fromIsoDate } from "@/server/reference-data";
import { seedReferenceData } from "@/server/seed";
import type { Actor } from "@/server/types";

export function testDb(): PrismaClient {
  return new PrismaClient({ datasourceUrl: inject("databaseUrl") });
}

/** Empty every table, then reseed reference data. TRUNCATE bypasses the row-level no-delete triggers. */
export async function resetDb(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  await seedReferenceData(db);
}

let n = 0;
/** Create a user directly (bypassing the service) and return it as an Actor. */
export async function makeUser(
  db: PrismaClient,
  roles: Role[],
  overrides: { email?: string; password?: string; active?: boolean } = {},
): Promise<Actor> {
  n++;
  const email = overrides.email ?? `user${n}@ogserc.test`;
  const user = await db.user.create({
    data: {
      name: `User ${n}`,
      email,
      roles,
      active: overrides.active ?? true,
      passwordHash: await hashPassword(overrides.password ?? "correct horse battery"),
    },
  });
  return { id: user.id, name: user.name, email: user.email, roles };
}

/** Whether these credentials are valid for an active user (no throttling; for assertions only). */
export async function canSignInWith(db: PrismaClient, email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  return !!user && user.active && (await verifyPassword(user.passwordHash, password));
}

export interface StoredSubmissionInput {
  primaryActivityCode?: string;
  installedCapacityMw?: number | null;
  dateSubmitted?: string;
  operatingOnEffectiveDate?: boolean;
  plannedStartDate?: string | null;
  licenceStatus?: string;
}

/**
 * Save a submission the way the intake action will (Phase 3): ack number from the counter and the
 * pricing snapshot taken in the same transaction.
 */
export async function saveSubmission(
  db: PrismaClient,
  createdById: string,
  input: StoredSubmissionInput = {},
) {
  const activityCode = input.primaryActivityCode ?? "MGD";
  const activity = await db.activity.findUniqueOrThrow({ where: { code: activityCode } });
  const dateSubmitted = input.dateSubmitted ?? "2026-10-22";
  const operating = input.operatingOnEffectiveDate ?? true;
  const capacity = input.installedCapacityMw === undefined ? 2.5 : input.installedCapacityMw;
  return db.$transaction(async (tx) => {
    const pricing = await priceNewSubmission(tx, {
      filingType: "NEW",
      primaryActivity: activity.name,
      otherActivities: [],
      installedCapacityMw: capacity,
      categoryOverride: null,
      operatingOnEffectiveDate: operating ? "Y" : "N",
      plannedStartDate: input.plannedStartDate ?? null,
    });
    const seq = await nextCounter(tx, COUNTER.ACK);
    return tx.submission.create({
      data: {
        ackSeq: seq,
        ackNo: formatAckNo("OGSERC/ACK", dateSubmitted, seq),
        registeredName: `Registrant ${seq} Ltd`,
        dateSubmitted: fromIsoDate(dateSubmitted),
        principalLga: "Ifo",
        formFiled: `REG-01${pricing.pricedCategory}`,
        primaryActivityCode: activityCode,
        installedCapacityMw: capacity,
        licenceStatus: input.licenceStatus ?? "NERC registration/permit (mini-grid/captive)",
        licences: { create: [{ sortOrder: 1, number: "NERC/1" }] },
        operatingOnEffectiveDate: operating,
        plannedStartDate: fromIsoDate(input.plannedStartDate ?? null),
        createdById,
        ...pricing,
      },
    });
  });
}

/**
 * Run `fn` as a workflow transaction, which may change status, decision and workflow dates (otherwise
 * refused by DB triggers). For tests that set up a state directly, e.g. what the daily review does.
 */
export function asWorkflow<T>(db: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('ogserc.workflow', 'on', true)`;
    return fn(tx);
  });
}

/**
 * §4.12: have a Finance officer (not the recorder) confirm every pending payment on a reference, as
 * the Finance Desk does. Releases the submission for evaluation when that clears the gate.
 */
export async function confirmPayments(db: PrismaClient, reference: string, today?: string) {
  const { confirmPayment } = await import("@/server/finance");
  const finance = await makeUser(db, ["FINANCE_OFFICER"]);
  const pending = await db.payment.findMany({
    where: { reference, status: "ACTIVE", financeStatus: "PENDING" },
    orderBy: { paymentSeq: "asc" },
  });
  for (const p of pending) {
    await confirmPayment(db, finance, p.id, { verified: true, remarks: "" }, { today });
  }
  return finance;
}

/** A form's checklist (every item staff set by hand) with one value, for updateDocuments. */
export function formDocuments(form = "REG-01E", value = "Y"): Record<string, string> {
  const def = formsFile.forms.find((f) => f.form === form);
  if (!def) throw new Error(`No form ${form}`);
  return Object.fromEntries(
    def.documents.filter((d) => d.key !== PAYMENT_EVIDENCE_KEY).map((d) => [d.key, value]),
  );
}

/** The evaluator confirms the category of the form filed (check 1.10), as before approval. */
export async function confirmFormCategory(
  db: PrismaClient,
  evaluator: Actor,
  id: string,
  today?: string,
) {
  const { confirmCategory } = await import("@/server/workflow");
  const row = await db.submission.findUniqueOrThrow({ where: { id } });
  await confirmCategory(
    db,
    evaluator,
    id,
    { category: row.formFiled.slice(-1), reason: "" },
    { today },
  );
}
