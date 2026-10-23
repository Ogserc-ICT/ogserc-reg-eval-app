import type { Prisma } from "@prisma/client";
import { isIsoDate } from "@/domain/dates";
import { can } from "@/domain/roles";
import { writeAudit } from "./audit";
import { ForbiddenError } from "./errors";
import type { Actor, Db } from "./types";

// Audit log viewer (Phase 7). Read-only: entries are only ever appended by the services that change state.

export interface AuditFilters {
  /** Lagos calendar dates, inclusive. */
  from?: string;
  to?: string;
  /** A user id, or "system" for the scheduled job. */
  user?: string;
  action?: string;
  /** Matches the reference or the detail (case-insensitive). */
  q?: string;
}

export const AUDIT_PAGE_SIZE = 100;
/** Exports stop here; narrow the filters for more. */
export const AUDIT_EXPORT_LIMIT = 50_000;

/** Start of a Lagos calendar day as an instant (Lagos is UTC+1 all year). */
const lagosDayStart = (d: string) => new Date(`${d}T00:00:00+01:00`);

function whereFor(f: AuditFilters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.from && isIsoDate(f.from)) and.push({ timestamp: { gte: lagosDayStart(f.from) } });
  if (f.to && isIsoDate(f.to)) {
    const next = lagosDayStart(f.to);
    next.setUTCDate(next.getUTCDate() + 1);
    and.push({ timestamp: { lt: next } });
  }
  if (f.user === "system") and.push({ userId: null });
  else if (f.user) and.push({ userId: f.user });
  if (f.action) and.push({ action: f.action });
  const q = f.q?.trim();
  if (q) {
    and.push({
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { detail: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

function assertCanRead(actor: Actor) {
  if (!can(actor.roles, "audit.read")) throw new ForbiddenError();
}

/**
 * Where an entry's reference leads: the submission (Ack No.), own-use notification (OUN No.) or user
 * (email) it is about. References that match nothing get no link.
 */
async function linksFor(db: Db, references: string[]) {
  const refs = [...new Set(references)];
  const [subs, ouns, users] = await Promise.all([
    db.submission.findMany({ where: { ackNo: { in: refs } }, select: { id: true, ackNo: true } }),
    db.ownUseNotification.findMany({
      where: { ounNo: { in: refs } },
      select: { id: true, ounNo: true },
    }),
    db.user.findMany({ where: { email: { in: refs } }, select: { id: true, email: true } }),
  ]);
  return new Map<string, string>([
    ...subs.map((s) => [s.ackNo, `/submissions/${s.id}`] as const),
    ...ouns.map((o) => [o.ounNo, `/own-use/${o.id}`] as const),
    ...users.map((u) => [u.email, `/admin/users/${u.id}`] as const),
  ]);
}

export async function listAudit(db: Db, actor: Actor, filters: AuditFilters, page = 1) {
  assertCanRead(actor);
  const where = whereFor(filters);
  const [total, rows, actions, users] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      include: { user: { select: { name: true } } },
    }),
    db.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const links = await linksFor(
    db,
    rows.flatMap((r) => (r.reference ? [r.reference] : [])),
  );
  return {
    total,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    rows: rows.map((r) => ({
      id: String(r.id),
      timestamp: r.timestamp,
      user: r.user?.name ?? null,
      action: r.action,
      reference: r.reference,
      href: r.reference ? (links.get(r.reference) ?? null) : null,
      detail: r.detail,
    })),
    actions: actions.map((a) => a.action),
    users,
  };
}

/** Filters in use, for the export's own audit entry. */
export function describeFilters(filters: object): string {
  const used = Object.entries(filters).filter(
    ([, v]) => v !== "" && v !== undefined && v !== false,
  );
  return used.length ? `; filters ${used.map(([k, v]) => `${k}=${String(v)}`).join(", ")}` : "";
}

/** Every matching entry, oldest first, for CSV export. The export is itself audited. */
export async function exportAudit(db: Db, actor: Actor, filters: AuditFilters) {
  assertCanRead(actor);
  return db.$transaction(async (tx) => {
    const rows = await tx.auditLog.findMany({
      where: whereFor(filters),
      orderBy: { id: "asc" },
      take: AUDIT_EXPORT_LIMIT,
      include: { user: { select: { name: true, email: true } } },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Audit log exported",
      detail: `${rows.length} entries${describeFilters(filters)}`,
    });
    return rows;
  });
}

/** Lagos wall-clock time, e.g. "2026-10-22 19:59:35". */
export function lagosTimestamp(d: Date): string {
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}
