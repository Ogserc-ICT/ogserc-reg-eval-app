// Inactivity sign-out (docs/DECISIONS.md, Sessions). Shared by the browser timer and the server session
// settings, so this module must not import server-only code.

/** The browser signs the user out after this long without mouse, keyboard, scroll or touch input. */
export const IDLE_SIGN_OUT_SECONDS = 4 * 60;

/** A warning with a countdown appears this long before the sign-out. */
export const IDLE_WARNING_SECONDS = 60;

/** While the user is active, the browser refreshes the session at most this often. */
export const SESSION_PING_SECONDS = 30;

/**
 * Server-side idle expiry: a backstop for when the browser timer never runs (tab closed, laptop asleep).
 * Longer than the browser limit plus one ping interval, so an active user is never cut off early.
 */
export const SESSION_MAX_AGE_SECONDS = 5 * 60;

/** Auth.js writes the new expiry to the database at most this often. */
export const SESSION_UPDATE_AGE_SECONDS = 15;
