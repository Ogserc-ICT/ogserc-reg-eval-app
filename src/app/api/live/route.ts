import { db } from "@/lib/db";
import { currentSessionToken } from "@/lib/session";
import { unreadCount } from "@/server/notifications";
import { sessionStore } from "@/server/session-store";

// Polled by every open page (src/components/notification-bell.tsx) to show other users' changes without
// a manual refresh. Every state change writes an AuditLog row, so the newest row id works as a version.
// Reads the session without extending it: background polling must not count as user activity.

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await currentSessionToken();
  const found = token ? await sessionStore(db).getSessionAndUser(token) : null;
  if (!found) return new Response(null, { status: 401 });

  const [latest, unread] = await Promise.all([
    db.auditLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }),
    unreadCount(db, found.user.id),
  ]);
  return Response.json(
    { version: String(latest?.id ?? 0), unread },
    { headers: { "Cache-Control": "no-store" } },
  );
}
