import { PrismaClient } from "@prisma/client";

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Interactive transactions default to 30 s, not Prisma's 5 s: in production every query crosses from
// the app's region to the database's, and saving a submission runs some 30 queries in one transaction.
// Transactions that pass their own timeout keep it.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ transactionOptions: { timeout: 30_000, maxWait: 10_000 } });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
