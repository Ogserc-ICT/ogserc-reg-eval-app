import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { resetPasswordAction, unlockUserAction, updateUserAction } from "../../actions";
import { UnlockForm } from "../unlock-form";
import { ResetPasswordForm } from "../reset-password-form";
import { UserForm } from "../user-form";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("admin.users");
  const { id } = await params;
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, roles: true, active: true, lockedUntil: true },
  });
  if (!user) notFound();

  return (
    <div>
      <PageHeader title={user.name} back={{ href: "/admin/users", label: "Users and roles" }} />
      {user.lockedUntil && user.lockedUntil > new Date() && (
        <UnlockForm
          action={unlockUserAction.bind(null, user.id)}
          lockedUntil={user.lockedUntil.toISOString()}
        />
      )}
      <UserForm mode="edit" action={updateUserAction.bind(null, user.id)} initial={user} />
      <h2 className="text-brand-800 mt-8 mb-3 text-lg font-semibold">Reset password</h2>
      <ResetPasswordForm action={resetPasswordAction.bind(null, user.id)} />
    </div>
  );
}
