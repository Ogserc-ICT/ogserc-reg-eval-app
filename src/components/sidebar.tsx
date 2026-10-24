import Image from "next/image";
import Link from "next/link";
import { ROLE_LABELS, can, type Permission } from "@/domain/roles";
import { signOut } from "@/lib/auth";
import type { Actor } from "@/server/types";
import { SidebarNav } from "./sidebar-nav";

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
    // Pinned to the viewport so the user details and Sign out stay visible however far the page
    // scrolls; the nav scrolls on its own if it is ever taller than the screen.
    <aside className="border-gold-500 bg-brand-800 sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r-4 text-white">
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
      <SidebarNav
        items={NAV.filter((item) => can(user.roles, item.permission)).map(({ href, label }) => ({
          href,
          label,
        }))}
      />
      <div className="border-brand-700 shrink-0 border-t px-4 py-3 text-sm">
        <Link href="/account" className="block font-medium hover:underline">
          {user.name}
        </Link>
        <p className="text-brand-100 text-xs">{user.roles.map((r) => ROLE_LABELS[r]).join(", ")}</p>
        <form action={signOutAction} className="mt-3">
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
