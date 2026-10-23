import { createHash, timingSafeEqual } from "node:crypto";
import { runDailyReview } from "@/server/daily-review";
import { db } from "@/lib/db";

// §4.10: run once a day at 06:00 Africa/Lagos (05:00 UTC; Lagos has no daylight saving).
// - Vercel Cron (vercel.json) sends GET with "Authorization: Bearer $CRON_SECRET".
// - The Docker scheduler (deploy/) sends POST with the same header.
// Refuses every request unless CRON_SECRET is set (at least 32 characters).

export const dynamic = "force-dynamic";
// Reviewing every submission takes a few seconds at most; allow headroom on serverless hosts.
export const maxDuration = 120;

const digest = (s: string) => createHash("sha256").update(s).digest();

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32) return false;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return timingSafeEqual(digest(given), digest(secret));
}

async function handle(request: Request) {
  if (!authorised(request)) return new Response("Unauthorised", { status: 401 });
  const run = await runDailyReview(db, null);
  return Response.json({
    today: run.today,
    provisional: run.provisional.length,
    overdueDeficiency: run.overdueDeficiency.length,
    locked: run.locked.length,
    summary: run.summary,
  });
}

export const GET = handle;
export const POST = handle;
