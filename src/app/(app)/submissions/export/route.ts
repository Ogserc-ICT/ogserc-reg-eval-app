import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { ForbiddenError } from "@/server/errors";
import { registerFiltersFrom } from "@/server/register";
import { exportRegister } from "@/server/register-export";

// Serverless hosts (Vercel) stop functions after a time limit. Exporting the whole Register assesses every submission.
export const maxDuration = 120;

/** The Register, filtered as on screen, as `?format=xlsx` (default) or `?format=csv`. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") === "csv" ? "csv" : "xlsx";
  try {
    const file = await exportRegister(
      db,
      user,
      format,
      registerFiltersFrom((k) => sp.get(k) ?? ""),
    );
    return new NextResponse(typeof file.body === "string" ? file.body : new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
}
