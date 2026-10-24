import { IdleSignOut } from "@/components/idle-sign-out";
import { NotificationBell } from "@/components/notification-bell";
import { Sidebar } from "@/components/sidebar";
import { formatDate } from "@/domain/dates";
import { requireUser } from "@/lib/session";
import { testClockValue } from "@/server/clock";

// Every page in this group needs a signed-in, active user.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const testClock = testClockValue();
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Stays at the top while the page scrolls, like the sidebar. */}
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-end border-b border-gray-200 bg-white/95 px-6 backdrop-blur">
          <NotificationBell />
        </header>
        <main className="min-w-0 flex-1 p-6">
          {testClock && (
            <p
              role="note"
              className="mb-4 rounded border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm text-violet-900"
            >
              Test clock is on: the app treats today as {formatDate(testClock)} (APP_TODAY).
              Development only.
            </p>
          )}
          {children}
        </main>
      </div>
      <IdleSignOut />
    </div>
  );
}
