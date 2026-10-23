import type { Tx } from "./types";

export const COUNTER = {
  ACK: "ACK",
  PAYMENT: "PAY",
  OUN: "OUN",
  /** Registration serials restart each calendar year (SPEC §3). */
  registration: (year: number) => `REG:${year}`,
} as const;

/**
 * Next value of a sequence. The row lock taken by the upsert serialises concurrent callers until
 * the transaction commits, and a rolled-back transaction releases its number unused.
 */
export async function nextCounter(tx: Tx, name: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("name", "value") VALUES (${name}, 1)
    ON CONFLICT ("name") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error(`Counter ${name} did not return a value`);
  return value;
}
