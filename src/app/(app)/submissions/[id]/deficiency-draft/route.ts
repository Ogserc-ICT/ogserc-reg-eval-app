import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { previewDeficiencyNotice } from "@/server/documents";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";

/** Watermarked draft of the deficiency notice issuing would produce now. Not stored. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  try {
    const bytes = await previewDeficiencyNotice(db, user, (await params).id);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="DRAFT-deficiency-notice.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    if (e instanceof ValidationError) return new NextResponse(e.message, { status: 409 });
    throw e;
  }
}
