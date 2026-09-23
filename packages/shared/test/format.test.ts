import { describe, expect, it } from "vitest";
import {
  formatExactMetric,
  formatMetric,
  formatPercent,
  formatSignedMetric,
  protectSpreadsheetCell,
} from "../src/format.js";

describe("analytics formatting", () => {
  it("preserves fractional daily averages", () => {
    expect(formatExactMetric(0.4, "en-US", 1)).toBe("0.4");
    expect(formatExactMetric(1.25, "ru-RU", 1)).toBe("1,3");
    expect(formatExactMetric(-0.4, "en-US", 1)).toBe("-0.4");
    expect(formatExactMetric(1000, "en-US")).toBe("1,000");
  });
  it("distinguishes unavailable values and bounds precision", () => {
    expect(formatExactMetric(NaN)).toBe("—");
    expect(formatExactMetric(Infinity)).toBe("—");
    expect(formatExactMetric(1.234, "en-US", -1)).toBe("1");
    expect(formatExactMetric(1.234, "en-US", NaN)).toBe("1");
  });
  it("keeps exact values below ten thousand", () => {
    expect(formatMetric(1999)).toBe("1 999");
    expect(formatMetric(9999)).toBe("9 999");
  });

  it("uses international compact suffixes for larger values", () => {
    expect(formatMetric(22_700)).toBe("22.7K");
    expect(formatMetric(1_250_000)).toBe("1.3M");
  });

  it("signs net changes with a real minus and leaves zero unsigned", () => {
    expect(formatSignedMetric(12)).toBe("+12");
    expect(formatSignedMetric(-28)).toBe("−28");
    expect(formatSignedMetric(-22_700)).toBe("−22.7K");
    expect(formatSignedMetric(0)).toBe("0");
    expect(formatSignedMetric(0.3)).toBe("0");
    expect(formatSignedMetric(NaN)).toBe("0");
  });

  it("formats percentages without a redundant decimal", () => {
    expect(formatPercent(12)).toBe("12%");
    expect(formatPercent(12.34)).toBe("12.3%");
  });
  it("guards formula-like CSV text even after leading whitespace and control characters", () => {
    for (const value of [
      "=HYPERLINK(1)",
      "  =HYPERLINK(1)",
      "\t+SUM(1)",
      "\r@link",
      "\n-1+2",
      "＝1+2",
      "\uFEFF@link",
    ]) {
      expect(protectSpreadsheetCell(value)).toBe(`\t${value}`);
    }
    expect(protectSpreadsheetCell("A normal title")).toBe("A normal title");
    expect(protectSpreadsheetCell("A = formula in the middle")).toBe(
      "A = formula in the middle",
    );
  });
});
