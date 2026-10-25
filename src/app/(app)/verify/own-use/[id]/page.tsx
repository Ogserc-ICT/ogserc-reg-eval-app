import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { getOwnUseVerification } from "@/server/verify";
import { VerificationView } from "../../verification-view";

/** QR target of an own-use (REG-01I) certificate. */
export default async function VerifyOwnUsePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("records.read");
  const v = await getOwnUseVerification(db, actor, (await params).id);
  if (!v) notFound();
  return (
    <VerificationView v={v} open={{ href: `/own-use/${v.id}`, label: "Open the notification" }} />
  );
}
