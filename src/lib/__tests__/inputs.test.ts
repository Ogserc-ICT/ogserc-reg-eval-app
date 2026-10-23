import { describe, expect, it } from "vitest";
import { parseNairaToKobo } from "@/domain/money";
import { safeInternalPath } from "../paths";

describe("parseNairaToKobo", () => {
  it.each([
    ["250,000", 25_000_000],
    ["₦1,234.50", 123_450],
    ["100000", 10_000_000],
    [" 0.5 ", 50],
  ])("%s → %d kobo", (input, kobo) => expect(parseNairaToKobo(input)).toBe(kobo));

  it.each(["", "abc", "1.234", "-5", "1e5", "12,34x"])("rejects %j", (input) =>
    expect(parseNairaToKobo(input)).toBeNull(),
  );
});

describe("safeInternalPath", () => {
  it("keeps same-site paths", () => {
    expect(safeInternalPath("/submissions/abc_1-2", "/x")).toBe("/submissions/abc_1-2");
  });

  it.each([
    "//evil.com",
    "//evil",
    "https://evil.com",
    "javascript:alert(1)",
    "/a?b=c",
    "",
    null,
    undefined,
  ])("falls back for %j", (path) => expect(safeInternalPath(path, "/payments")).toBe("/payments"));
});
