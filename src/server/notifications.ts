import type { Prisma } from "@prisma/client";
import {
  planNotifications,
  type NotificationEvent,
  type SubmissionSubject,
} from "@/domain/notifications";
import type { Actor, Db, Tx } from "./types";

// In-app notifications (docs/DECISIONS.md, Notifications). Who is told what is decided by the pure
// planNotifications; this module resolves roles to people and stores one row per person.

export const NOTIFICATION_LIST_LIMIT = 30;

/** The submission and its officers, as the notification rules need them. */
export function subjectOf(state: {
  row: { id: string; ackNo: string; registeredName: string; createdById: string | null };
  evaluation: {
    evaluatingOfficerId: string | null;
    reviewingSupervisorId: string | null;
    approvingOfficerId: string | null;
  };
}): SubmissionSubject {
  return {
    id: state.row.id,
    ackNo: state.row.ackNo,
    name: state.row.registeredName,
    createdById: state.row.createdById,
    evaluatingOfficerId: state.evaluation.evaluatingOfficerId,
    reviewingSupervisorId: state.evaluation.reviewingSupervisorId,
    approvingOfficerId: state.evaluation.approvingOfficerId,
  };
}

/**
 * Store the notifications for an event. Call inside the transaction that made the change, so they
 * exist exactly when the change does. The user who caused it and inactive users are left out; each
 * person gets an event's notice once.
 */
export async function notify(tx: Tx, actorId: string | null, event: NotificationEvent) {
  const plans = planNotifications(event);
  if (!plans.length) return;
  const roles = [...new Set(plans.flatMap((p) => p.audience.roles))];
  const ids = [...new Set(plans.flatMap((p) => p.audience.userIds))];
  const people = await tx.user.findMany({
    where: { active: true, OR: [{ id: { in: ids } }, { roles: { hasSome: roles } }] },
    select: { id: true, roles: true },
  });

  const told = new Set<string>(actorId ? [actorId] : []);
  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const plan of plans) {
    for (const u of people) {
      const inAudience =
        plan.audience.userIds.includes(u.id) ||
        u.roles.some((r) => plan.audience.roles.includes(r));
      if (!inAudience || told.has(u.id)) continue;
      told.add(u.id);
      const { title, body, href, reference } = plan;
      rows.push({ userId: u.id, title, body, href, reference });
    }
  }
  if (rows.length) await tx.notification.createMany({ data: rows });
}

/** The user's latest notifications and how many are unread. */
export async function listNotifications(db: Db, actor: Actor) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: "desc" },
      take: NOTIFICATION_LIST_LIMIT,
      select: { id: true, title: true, body: true, href: true, createdAt: true, readAt: true },
    }),
    unreadCount(db, actor.id),
  ]);
  return {
    unread,
    items: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      href: n.href,
      createdAt: n.createdAt.toISOString(),
      read: !!n.readAt,
    })),
  };
}

export function unreadCount(db: Db, userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

/** Mark one of the user's own notifications read (someone else's id changes nothing). */
export async function markNotificationRead(db: Db, actor: Actor, id: string) {
  await db.notification.updateMany({
    where: { id, userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(db: Db, actor: Actor) {
  await db.notification.updateMany({
    where: { userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
}
