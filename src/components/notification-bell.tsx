"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(app)/actions";

/** How often an open, visible page asks the server whether anything changed. */
export const LIVE_POLL_SECONDS = 15;

type Item = Awaited<ReturnType<typeof loadNotificationsAction>>["items"][number];

/** True while the user is typing in a field, when a refresh would be unwelcome. */
function isEditing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["button", "submit", "reset", "checkbox", "radio", "file", "hidden"].includes(type);
}

/**
 * Keeps the page in step with other users. Every LIVE_POLL_SECONDS (only while the tab is visible) it
 * asks /api/live for the newest change; when there is one, the page's data is refreshed in place,
 * waiting until the user leaves the field they are typing in. Returns the unread notification count
 * and a function to check again at once.
 */
function useLiveUpdates(): [number, () => void] {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const version = useRef<string | null>(null);
  const pending = useRef(false);
  const pollNow = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;

    function refreshWhenFree() {
      if (isEditing()) {
        pending.current = true;
      } else {
        pending.current = false;
        router.refresh();
      }
    }

    async function poll() {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (res.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!res.ok) return;
        const live: { version: string; unread: number } = await res.json();
        setUnread(live.unread);
        if (version.current !== null && live.version !== version.current) refreshWhenFree();
        version.current = live.version;
      } catch {
        // Offline for a moment: the next poll catches up.
      }
    }

    function onFocusOut() {
      // Let focus settle on the next element before deciding.
      if (pending.current) window.setTimeout(refreshWhenFree, 0);
    }

    pollNow.current = () => void poll();
    void poll();
    const timer = window.setInterval(poll, LIVE_POLL_SECONDS * 1000);
    document.addEventListener("visibilitychange", poll);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [router]);

  return [unread, useCallback(() => pollNow.current(), [])];
}

const ago = (iso: string) => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Lagos",
  });
};

export function NotificationBell() {
  const router = useRouter();
  const [unread, checkNow] = useLiveUpdates();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setItems((await loadNotificationsAction()).items);
    } catch {
      setItems((current) => current ?? []);
    }
  }, []);

  // Keep the open list current as new notifications arrive.
  useEffect(() => {
    if (open) void load();
  }, [open, unread, load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function openItem(item: Item) {
    setOpen(false);
    if (!item.read) {
      await markNotificationReadAction(item.id).catch(() => {});
      checkNow();
    }
    router.push(item.href);
  }

  async function markAll() {
    await markAllNotificationsReadAction().catch(() => {});
    setItems((current) => current?.map((n) => ({ ...n, read: true })) ?? null);
    checkNow();
  }

  const shown = unread > 99 ? "99+" : String(unread);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="hover:bg-brand-50 focus-visible:outline-brand-600 relative rounded-full p-2 text-gray-700 focus-visible:outline-2"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] leading-none font-bold text-white ring-2 ring-white">
            {shown}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-96 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
            <h2 className="text-brand-800 text-sm font-semibold">Notifications</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-brand-700 text-xs font-medium hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>
          {items === null ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">No notifications yet.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-gray-50 ${n.read ? "" : "bg-brand-50/60"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-red-600"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm ${n.read ? "text-gray-700" : "font-semibold text-gray-900"}`}
                      >
                        {n.title}
                        {!n.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="line-clamp-2 block text-xs text-gray-600" title={n.body}>
                        {n.body}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-gray-400">
                        {ago(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
