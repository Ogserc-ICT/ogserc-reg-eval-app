import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { can } from "@/domain/roles";
import { requirePermission } from "@/lib/session";

const SECTIONS = [
  {
    href: "/admin/users",
    title: "Users and roles",
    text: "Create staff accounts, assign roles, deactivate, reset passwords.",
  },
  {
    href: "/admin/settings",
    title: "Settings",
    text: "Effective Date, periods, number prefixes, signatories and Commission policy choices.",
  },
  {
    href: "/admin/fees",
    title: "Fee table (Schedule 3)",
    text: "Registration fees and late charges per category. Changes need a reason and are audited.",
  },
  {
    href: "/admin/activities",
    title: "Activity → category map",
    text: "Which Schedule 3 category each activity falls in, by capacity. Changes are audited.",
  },
  {
    href: "/admin/import",
    title: "Import from the workbook",
    text: "Bring existing Register rows, payments and own-use notifications in from the Excel workbook.",
  },
] as const;

export default async function AdminPage() {
  const user = await requirePermission("admin.users");
  return (
    <div>
      <PageHeader title="Admin" />
      <ul className="grid max-w-3xl gap-3 sm:grid-cols-2">
        {SECTIONS.filter(
          (s) =>
            (s.href !== "/admin/settings" || can(user.roles, "admin.settings")) &&
            (s.href !== "/admin/import" || can(user.roles, "register.import")) &&
            ((s.href !== "/admin/fees" && s.href !== "/admin/activities") ||
              can(user.roles, "admin.referenceData")),
        ).map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="hover:border-brand-600 block h-full rounded border border-gray-200 bg-white p-4"
            >
              <span className="text-brand-800 font-medium">{s.title}</span>
              <span className="mt-1 block text-sm text-gray-600">{s.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
