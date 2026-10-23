import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";
import { createUserAction } from "../../actions";
import { UserForm } from "../user-form";

export default async function NewUserPage() {
  await requirePermission("admin.users");
  return (
    <div>
      <PageHeader title="New user" back={{ href: "/admin/users", label: "Users and roles" }} />
      <UserForm mode="create" action={createUserAction} />
    </div>
  );
}
