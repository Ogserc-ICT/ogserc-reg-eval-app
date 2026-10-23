import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ROLE_LABELS } from "@/domain/roles";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";

export default async function UsersPage() {
  await requirePermission("admin.users");
  const users = await db.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, roles: true, active: true, lockedUntil: true },
  });

  const now = new Date();

  return (
    <div>
      <PageHeader title="Users and roles" back={{ href: "/admin", label: "Admin" }}>
        <Link
          href="/admin/users/new"
          className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-2 text-sm font-medium text-white"
        >
          New user
        </Link>
      </PageHeader>
      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-50 text-brand-900 text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Roles</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "text-gray-400"}>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="text-brand-700 font-medium hover:underline"
                  >
                    {u.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.roles.map((r) => ROLE_LABELS[r]).join(", ")}</td>
                <td className="px-3 py-2">
                  {!u.active
                    ? "Inactive"
                    : u.lockedUntil && u.lockedUntil > now
                      ? "Locked"
                      : "Active"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
