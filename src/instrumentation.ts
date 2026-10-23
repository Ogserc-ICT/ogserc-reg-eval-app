// Runs once when the server starts. Refuse to start with a misconfigured test clock (APP_TODAY set
// in production, or not a valid date) or without a valid APP_URL in production (certificate QR codes).
import { appBaseUrl } from "@/server/app-url";
import { testClockValue } from "@/server/clock";

export function register() {
  try {
    const today = testClockValue();
    if (today) console.warn(`[ogserc] Test clock active: today is ${today} (APP_TODAY).`);
    appBaseUrl();
  } catch (e) {
    console.error(`[ogserc] Refusing to start: ${(e as Error).message}`);
    if (process.env.NEXT_RUNTIME === "nodejs") process.exit(1);
    throw e;
  }
}
