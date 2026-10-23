import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../csv";

describe("CSV", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Plot 1, "Main" Road')).toBe('"Plot 1, ""Main"" Road"');
    expect(csvCell("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(csvCell(null)).toBe("");
  });

  it("stops text from running as a spreadsheet formula", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+234 800")).toBe("'+234 800");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5000)).toBe("-5000");
  });

  it("starts with a byte-order mark and uses CRLF", () => {
    expect(toCsv(["A", "B"], [["₦1", 2]])).toBe("﻿A,B\r\n₦1,2\r\n");
  });
});
