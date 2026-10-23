import { afterEach, describe, expect, it, vi } from "vitest";
import { appToday, testClockValue } from "../clock";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("test clock (APP_TODAY)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless APP_TODAY is set", () => {
    expect(testClockValue(env({ NODE_ENV: "development" }))).toBeNull();
    expect(testClockValue(env({ NODE_ENV: "development", APP_TODAY: " " }))).toBeNull();
  });

  it("pins today in development and test", () => {
    expect(testClockValue(env({ NODE_ENV: "development", APP_TODAY: "2026-12-25" }))).toBe(
      "2026-12-25",
    );
    vi.stubEnv("APP_TODAY", "2027-01-31");
    expect(appToday()).toBe("2027-01-31");
  });

  it("refuses to run in production", () => {
    expect(() => testClockValue(env({ NODE_ENV: "production", APP_TODAY: "2026-12-25" }))).toThrow(
      /production/,
    );
  });

  it("rejects a malformed date", () => {
    expect(() => testClockValue(env({ NODE_ENV: "development", APP_TODAY: "25/12/2026" }))).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() =>
      testClockValue(env({ NODE_ENV: "development", APP_TODAY: "2026-02-30" })),
    ).toThrow();
  });

  it("falls back to the real Lagos date", () => {
    vi.stubEnv("APP_TODAY", "");
    expect(appToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
