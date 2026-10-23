import { PageHeader } from "@/components/page-header";
import { ROLE_LABELS } from "@/domain/roles";
import { requireUser } from "@/lib/session";
import { PasswordForm } from "./password-form";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div>
      <PageHeader title="My account" />
      <dl className="mb-6 grid max-w-md grid-cols-[8rem_1fr] gap-y-1 text-sm">
        <dt className="text-gray-500">Name</dt>
        <dd>{user.name}</dd>
        <dt className="text-gray-500">Email</dt>
        <dd>{user.email}</dd>
        <dt className="text-gray-500">Roles</dt>
        <dd>{user.roles.map((r) => ROLE_LABELS[r]).join(", ")}</dd>
      </dl>
      <h2 className="text-brand-800 mb-3 text-lg font-semibold">Change password</h2>
      <PasswordForm />
    </div>
  );
}
