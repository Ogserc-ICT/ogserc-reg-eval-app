import { describe, expect, it } from "vitest";
import { parseNairaToKobo } from "@/domain/money";
import { groupNairaTyping } from "../format";
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

describe("groupNairaTyping", () => {
  it.each([
    ["", ""],
    ["250000", "250,000"],
    ["1234567.5", "1,234,567.5"],
    ["1,234.567", "1,234.56"],
    ["₦12,3", "123"],
    ["007", "7"],
    [".5", "0.5"],
    ["1.2.3", "1.23"],
    ["abc", ""],
  ])("%j → %j", (input, shown) => expect(groupNairaTyping(input)).toBe(shown));

  it("gives back what parseNairaToKobo reads", () => {
    expect(parseNairaToKobo(groupNairaTyping("1234567.89"))).toBe(123_456_789);
  });
});
