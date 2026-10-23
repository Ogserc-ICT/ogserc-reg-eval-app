import type { Tx } from "./types";

export interface AuditEntry {
  /** Authenticated user; null only for the scheduled system job. */
  userId: string | null;
  action: string;
  reference?: string | null;
  detail?: string | null;
}

/** Append an AuditLog row. Call inside the same transaction as the state change. */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      reference: entry.reference ?? null,
      detail: entry.detail ?? null,
    },
  });
}
