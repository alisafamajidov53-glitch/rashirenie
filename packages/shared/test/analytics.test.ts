import { describe, expect, it } from "vitest";
import {
  analyticsChartDomain,
  compareAnalyticsValues,
  fillAnalyticsDays,
  type AnalyticsDay,
} from "../src/index.js";

function day(date: string, views: number): AnalyticsDay {
  return {
    date,
    views,
    engagedViews: views,
    estimatedMinutesWatched: 0,
    averageViewDuration: 0,
    averageViewPercentage: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    subscribersGained: 0,
    subscribersLost: 0,
  };
}

describe("analytics calendar", () => {
  it("rejects dates that JavaScript silently rolls into the next month", () => {
    expect(
      fillAnalyticsDays([day("2026-03-01", 4)], "2026-02-30", "2026-03-02"),
    ).toEqual([]);
    expect(
      fillAnalyticsDays([day("2026-02-30", 4)], "2026-02-01", "2026-03-02"),
    ).toEqual([]);
  });
  it("accepts a valid leap day", () => {
    expect(
      fillAnalyticsDays([day("2024-02-29", 4)], "2024-02-28", "2024-02-29"),
    ).toHaveLength(2);
  });
  it("fills missing inactive dates so rolling periods stay equal", () => {
    expect(
      fillAnalyticsDays(
        [day("2026-07-20", 10), day("2026-07-22", 30), day("2026-07-23", 0)],
        "2026-07-20",
        "2026-07-23",
      ).map(({ date, views }) => ({ date, views })),
    ).toEqual([
      { date: "2026-07-20", views: 10 },
      { date: "2026-07-21", views: 0 },
      { date: "2026-07-22", views: 30 },
      { date: "2026-07-23", views: 0 },
    ]);
  });

  it("rejects invalid or unbounded date ranges", () => {
    expect(fillAnalyticsDays([], "bad-date", "2026-07-23")).toEqual([]);
    expect(fillAnalyticsDays([], "2026-07-24", "2026-07-23")).toEqual([]);
    expect(fillAnalyticsDays([], "2025-01-01", "2026-07-23")).toEqual([]);
  });

  it("does not invent zeroes after the latest processed Analytics day", () => {
    expect(
      fillAnalyticsDays(
        [day("2026-07-20", 10), day("2026-07-21", 12)],
        "2026-07-20",
        "2026-07-23",
      ).map(({ date }) => date),
    ).toEqual(["2026-07-20", "2026-07-21"]);
  });
});

describe("analytics chart domain", () => {
  it("keeps missing analytics last in ascending and descending order", () => {
    const values = [-Infinity, 10, 0, 5];
    expect([...values].sort((a, b) => compareAnalyticsValues(a, b))).toEqual([
      10,
      5,
      0,
      -Infinity,
    ]);
    expect([...values].sort((a, b) => compareAnalyticsValues(a, b, false))).toEqual([
      0,
      5,
      10,
      -Infinity,
    ]);
    expect(compareAnalyticsValues(NaN, -Infinity)).toBe(0);
  });
  it("includes zero for negative-only subscriber changes", () => {
    expect(analyticsChartDomain([-8, -3, -2])).toEqual({ min: -8, max: 0 });
  });
  it("preserves both gains and losses", () => {
    expect(analyticsChartDomain([-8, 12])).toEqual({ min: -8, max: 12 });
  });
  it("handles empty, zero and non-finite data", () => {
    expect(analyticsChartDomain([])).toEqual({ min: 0, max: 1 });
    expect(analyticsChartDomain([0, NaN, Infinity])).toEqual({ min: 0, max: 1 });
  });
});
