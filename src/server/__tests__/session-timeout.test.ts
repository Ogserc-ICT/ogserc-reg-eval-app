import { describe, expect, it } from "vitest";
import {
  IDLE_SIGN_OUT_SECONDS,
  IDLE_WARNING_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  SESSION_PING_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "@/lib/session-timeout";

describe("inactivity sign-out settings", () => {
  it("signs out after 4 minutes, warning in the last minute", () => {
    expect(IDLE_SIGN_OUT_SECONDS).toBe(240);
    expect(IDLE_WARNING_SECONDS).toBeLessThan(IDLE_SIGN_OUT_SECONDS);
  });

  it("never lets the server expire an active user's session before the browser timer", () => {
    // Worst case: the last ping was just before a burst of activity that sent no ping, then the user
    // went idle. The browser signs out at most IDLE + PING after that ping; the database expiry is at
    // least MAX_AGE - UPDATE_AGE after it.
    expect(IDLE_SIGN_OUT_SECONDS + SESSION_PING_SECONDS).toBeLessThan(
      SESSION_MAX_AGE_SECONDS - SESSION_UPDATE_AGE_SECONDS,
    );
  });
});
