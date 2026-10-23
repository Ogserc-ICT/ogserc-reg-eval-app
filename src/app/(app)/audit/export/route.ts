import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { exportAudit, lagosTimestamp, type AuditFilters } from "@/server/audit-log";
import { appToday } from "@/server/clock";
import { ForbiddenError } from "@/server/errors";

// Serverless hosts (Vercel) stop functions after a time limit. Up to 50,000 audit entries.
export const maxDuration = 120;

/** The audit log, filtered as on screen, as CSV. The export itself is audited. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const sp = request.nextUrl.searchParams;
  const filters: AuditFilters = {
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    user: sp.get("user") ?? "",
    action: sp.get("action") ?? "",
    q: sp.get("q") ?? "",
  };
  try {
    const rows = await exportAudit(db, user, filters);
    const csv = toCsv(
      ["Entry", "Time (Lagos)", "User", "User email", "Action", "Reference", "Detail"],
      rows.map((r) => [
        String(r.id),
        lagosTimestamp(r.timestamp),
        r.user?.name ?? "System",
        r.user?.email ?? "",
        r.action,
        r.reference,
        r.detail,
      ]),
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ogserc-audit-log-${appToday()}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
}
