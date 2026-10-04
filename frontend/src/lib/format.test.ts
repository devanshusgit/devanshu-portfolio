import { describe, expect, it } from "vitest";
import { csvCell, formatFeature, formatSci, toCsv } from "./format";

describe("CSV export", () => {
  it("neutralises spreadsheet formula injection but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-5.2")).toBe("-5.2");
    expect(csvCell(-5.2)).toBe("-5.2");
  });

  it("quotes cells containing delimiters and escapes quotes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [{ a: 1, b: "x,y" }])).toBe('a,b\n1,"x,y"\n');
  });
});

describe("feature formatting", () => {
  it("formats values with sensible precision", () => {
    expect(formatFeature("pressure", 229.84)).toBe("229.8");
    expect(formatFeature("conductivity", 1.62e-12)).toBe("1.62e-12");
    expect(formatFeature("conductivity", 2.4e6)).toBe("2.40e6");
    expect(formatFeature("contact_duration", 0.1514)).toBe("0.151");
    expect(formatFeature("vibration", null)).toBe("—");
    expect(formatSci(0.5)).toBe("0.500");
  });
});
