import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { getVerification } from "@/server/verify";
import { VerificationView } from "../verification-view";

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("records.read");
  const v = await getVerification(db, actor, (await params).id);
  if (!v) notFound();
  return (
    <VerificationView v={v} open={{ href: `/submissions/${v.id}`, label: "Open the submission" }} />
  );
}
