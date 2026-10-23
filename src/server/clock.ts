import { isIsoDate, todayInLagos } from "@/domain/dates";
import type { IsoDate } from "@/domain/types";

/**
 * Dev/test clock: APP_TODAY=YYYY-MM-DD makes every "today" calculation use that date (deadlines,
 * SLA, lapse, determination, registration dates). Refused in production.
 * Timestamps (audit times, sign-in, sessions) always use the real clock.
 */
export function testClockValue(env: NodeJS.ProcessEnv = process.env): IsoDate | null {
  const value = env.APP_TODAY?.trim();
  if (!value) return null;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "APP_TODAY is set in production. Remove it: the test clock is for development only.",
    );
  }
  if (!isIsoDate(value)) throw new Error(`APP_TODAY must be a date as YYYY-MM-DD, got "${value}".`);
  return value;
}

/** Today in Africa/Lagos, or the dev test clock. Use this everywhere on the server, never `new Date()`. */
export function appToday(): IsoDate {
  return testClockValue() ?? todayInLagos();
}
