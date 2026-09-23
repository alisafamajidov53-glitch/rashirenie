import { describe, expect, it } from "vitest";
import {
  SPARKLINE_BOTTOM,
  SPARKLINE_TOP,
  SPARKLINE_WIDTH,
  bucketAverage,
  smoothTrendPath,
  sparklinePoints,
  sparklinePointsAttribute,
} from "../src/index.js";

const MIDDLE = (SPARKLINE_TOP + SPARKLINE_BOTTOM) / 2;

describe("sparklinePoints", () => {
  it("draws a flat series through the middle, not along the floor", () => {
    // Regression guard. The old implementation used
    // `range = Math.max(1, max - min)`, so every sample of a constant series
    // mapped to ratio 0 and the line was rendered on the bottom edge — which
    // reads as "zero views" rather than "steady".
    const points = sparklinePoints([200, 200, 200, 200]);
    expect(points).toHaveLength(4);
    for (const point of points) expect(point.y).toBeCloseTo(MIDDLE, 5);
  });

  it("puts the minimum on the floor and the maximum on the ceiling", () => {
    const points = sparklinePoints([10, 20, 30]);
    expect(points[0]?.y).toBeCloseTo(SPARKLINE_BOTTOM, 5);
    expect(points[2]?.y).toBeCloseTo(SPARKLINE_TOP, 5);
    expect(points[1]?.y).toBeCloseTo(MIDDLE, 5);
  });

  it("keeps the shape of a series whose whole range is below 1", () => {
    // The old floor of 1 flattened these: retention ratios and views-per-minute
    // both live in this range.
    const points = sparklinePoints([0.2, 0.35, 0.5]);
    expect(points[0]?.y).toBeCloseTo(SPARKLINE_BOTTOM, 5);
    expect(points[2]?.y).toBeCloseTo(SPARKLINE_TOP, 5);
    expect(points[1]?.y).toBeGreaterThan(SPARKLINE_TOP);
    expect(points[1]?.y).toBeLessThan(SPARKLINE_BOTTOM);
  });

  it("spans the full width", () => {
    const points = sparklinePoints([1, 2, 3, 4, 5]);
    expect(points[0]?.x).toBe(0);
    expect(points.at(-1)?.x).toBe(SPARKLINE_WIDTH);
  });

  it("pads a single-sample series instead of dividing by zero", () => {
    const points = sparklinePoints([42]);
    expect(points).toHaveLength(2);
    for (const point of points) expect(Number.isFinite(point.y)).toBe(true);
  });

  it("handles an empty series", () => {
    const points = sparklinePoints([]);
    expect(points).toHaveLength(2);
    for (const point of points) expect(Number.isFinite(point.y)).toBe(true);
  });

  it("substitutes zero for non-finite samples", () => {
    const points = sparklinePoints([0, Number.NaN, 10, Number.POSITIVE_INFINITY]);
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it("formats an SVG points attribute", () => {
    expect(sparklinePointsAttribute([1, 2])).toBe("0.0,62.0 300.0,8.0");
  });
});

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
