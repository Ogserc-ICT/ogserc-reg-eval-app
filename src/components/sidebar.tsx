import Image from "next/image";
import Link from "next/link";
import { ROLE_LABELS, can, type Permission } from "@/domain/roles";
import { signOut } from "@/lib/auth";
import type { Actor } from "@/server/types";

// Links are hidden when the user lacks the permission; every page and action still checks on the server.
// Pages without a route yet arrive in later phases.
const NAV: { href: string; label: string; permission: Permission }[] = [
  { href: "/", label: "Dashboard", permission: "dashboard.read" },
  { href: "/submissions", label: "Register", permission: "records.read" },
  { href: "/own-use", label: "Own-use notifications", permission: "records.read" },
  { href: "/payments", label: "Payments", permission: "records.read" },
  { href: "/finance", label: "Finance Desk", permission: "payment.confirm" },
  { href: "/evaluations", label: "Evaluations", permission: "records.read" },
  { href: "/audit", label: "Audit log", permission: "audit.read" },
  { href: "/admin", label: "Admin", permission: "admin.users" },
];

export function Sidebar({ user }: { user: Actor }) {
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <aside className="border-gold-500 bg-brand-800 flex w-56 shrink-0 flex-col border-r-4 text-white">
      <div className="bg-white px-4 py-3">
        <Image
          src="/ogserc-logo.png"
          alt="OGSERC"
          width={160}
          height={36}
          priority
          style={{ height: "auto" }}
        />
      </div>
      <p className="text-gold-300 px-4 pt-3 pb-2 text-xs tracking-wide uppercase">
        Registration &amp; Evaluation
      </p>
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
        {NAV.filter((item) => can(user.roles, item.permission)).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="hover:bg-brand-700 focus-visible:outline-gold-400 rounded px-3 py-2 text-sm focus-visible:outline-2"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-brand-700 mt-auto border-t px-4 py-3 text-sm">
        <Link href="/account" className="block font-medium hover:underline">
          {user.name}
        </Link>
        <p className="text-brand-100 text-xs">{user.roles.map((r) => ROLE_LABELS[r]).join(", ")}</p>
        <form action={signOutAction} className="mt-2">
          <button type="submit" className="text-gold-300 text-xs hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
