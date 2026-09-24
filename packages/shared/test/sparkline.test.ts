import { describe, expect, it } from "vitest";
import { bucketAverage, smoothTrendPath } from "../src/index.js";

describe("bucketAverage", () => {
  it("keeps short series untouched", () => {
    expect(bucketAverage([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it("averages long series into equal buckets", () => {
    const result = bucketAverage([1, 3, 5, 7, 9, 11], 3);
    expect(result).toEqual([2, 6, 10]);
  });
});

describe("smoothTrendPath", () => {
  it("draws on a zero baseline, so a small dip is not a crash", () => {
    const { line } = smoothTrendPath([14, 11, 14], 300, 64);
    const ys = [...line.matchAll(/(-?\d+\.\d),(-?\d+\.\d)/g)].map((m) => Number(m[2]));
    // 11 of 14 is still ~79% of the height, far from the floor at 62.
    expect(Math.max(...ys)).toBeLessThan(20);
  });

  it("never overshoots the box", () => {
    const { line } = smoothTrendPath([0, 100, 0, 100, 0], 300, 64);
    for (const match of line.matchAll(/(-?\d+\.\d),(-?\d+\.\d)/g)) {
      expect(Number(match[2])).toBeGreaterThanOrEqual(4);
      expect(Number(match[2])).toBeLessThanOrEqual(62);
    }
  });

  it("closes the area down to the baseline and reports the last point", () => {
    const path = smoothTrendPath([1, 2, 3], 300, 64);
    expect(path.area.endsWith("L300.0,64.0 L0,64.0 Z")).toBe(true);
    expect(path.last.x).toBe(300);
  });

  it("handles empty and flat series", () => {
    expect(smoothTrendPath([]).line).toMatch(/^M0\.0,/);
    expect(smoothTrendPath([0, 0, 0]).last.y).toBeCloseTo(33, 0);
  });
});
