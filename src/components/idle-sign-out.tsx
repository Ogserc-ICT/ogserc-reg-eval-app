"use client";

import { useEffect, useRef, useState } from "react";
import { idleSignOutAction } from "@/app/(app)/actions";
import {
  IDLE_SIGN_OUT_SECONDS,
  IDLE_WARNING_SECONDS,
  SESSION_PING_SECONDS,
} from "@/lib/session-timeout";

// Last activity across every open tab of the app, so working in one tab keeps the others signed in.
const STORAGE_KEY = "ogserc:last-activity";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"];
const IDLE_PAGE = "/login?reason=idle";

function readShared(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(time: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(time));
  } catch {
    // Private window or blocked storage: this tab still times out on its own.
  }
}

/**
 * Signs the user out after IDLE_SIGN_OUT_SECONDS without input, with a countdown warning first.
 * While the user is active it refreshes the session (and its cookie) every SESSION_PING_SECONDS;
 * page renders alone do not extend the cookie.
 */
export function IdleSignOut() {
  const lastActivity = useRef(0);
  const lastPing = useRef(0);
  const signingOut = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const now = () => Date.now();

    function signOutNow() {
      if (signingOut.current) return;
      signingOut.current = true;
      // The action redirects; if it cannot reach the server, leave anyway.
      idleSignOutAction().catch(() => window.location.assign(IDLE_PAGE));
    }

    async function ping() {
      lastPing.current = now();
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const session = res.ok ? await res.json() : null;
        // The server already ended the session (expired, deactivated, signed out elsewhere).
        if (res.ok && !session?.user) window.location.assign(IDLE_PAGE);
      } catch {
        // Offline for a moment: try again on the next activity.
      }
    }

    function markActive() {
      const t = now();
      // Writing on every mouse move is wasteful; once a second is plenty.
      if (t - lastActivity.current < 1000) return;
      lastActivity.current = t;
      writeShared(t);
      if (t - lastPing.current >= SESSION_PING_SECONDS * 1000) void ping();
    }

    function check() {
      if (signingOut.current) return;
      const last = Math.max(lastActivity.current, readShared());
      const left = IDLE_SIGN_OUT_SECONDS - Math.floor((now() - last) / 1000);
      if (left <= 0) {
        setSecondsLeft(0);
        signOutNow();
      } else {
        setSecondsLeft(left <= IDLE_WARNING_SECONDS ? left : null);
      }
    }

    // Opening a page counts as activity.
    lastActivity.current = 0;
    markActive();
    for (const e of ACTIVITY_EVENTS) {
      window.addEventListener(e, markActive, { passive: true, capture: true });
    }
    // After the laptop wakes or the tab comes back, check straight away.
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 1000);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, markActive, { capture: true });
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, []);

  if (secondsLeft === null) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-4 rounded-lg border border-amber-400 bg-amber-50 px-5 py-3 text-sm text-amber-950 shadow-lg"
    >
      <p>
        {secondsLeft > 0 ? (
          <>
            No activity for a while. You will be signed out in{" "}
            <strong className="tabular-nums">{secondsLeft}</strong> seconds.
          </>
        ) : (
          "Signing out…"
        )}
      </p>
      {secondsLeft > 0 && (
        // The click itself is activity (caught by the listeners above); this only hides the warning at once.
        <button
          type="button"
          onClick={() => setSecondsLeft(null)}
          className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-1.5 font-medium text-white"
        >
          Stay signed in
        </button>
      )}
    </div>
  );
}
