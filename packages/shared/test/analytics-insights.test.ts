import { describe, expect, it } from "vitest";
import {
  breakdownShares,
  compareAnalyticsPeriods,
  inContentCohort,
  cohortBenchmark,
  type AnalyticsDay,
  type VideoSummary,
} from "../src/index.js";
const history = Array.from(
  { length: 28 },
  (_, i) =>
    ({
      date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
      views: i < 14 ? 10 : 20,
      estimatedMinutesWatched: 5,
      subscribersGained: 1,
      subscribersLost: 2,
    }) as AnalyticsDay,
);
describe("equal periods", () => {
  it("compares complete equal windows, independent of input order", () => {
    const result = compareAnalyticsPeriods([...history].reverse(), 14);
    expect(result.ready).toBe(true);
    expect(result.metrics[0]).toMatchObject({
      current: 280,
      previous: 140,
      delta: 140,
      percent: 100,
    });
    expect(result.metrics[2]?.percent).toBeNull();
  });
  it("rejects missing calendar dates and incomplete history", () => {
    expect(
      compareAnalyticsPeriods(
        history.filter((_, i) => i !== 20),
        7,
      ).ready,
    ).toBe(false);
    expect(compareAnalyticsPeriods(history.slice(-7), 7).metrics[0]?.delta).toBeNull();
  });
  it("does not invent a percentage for a zero baseline", () => {
    const rows = history.map((day, i) => ({ ...day, views: i < 14 ? 0 : 20 }));
    expect(compareAnalyticsPeriods(rows, 14).metrics[0]).toMatchObject({
      delta: 280,
      percent: null,
    });
  });
});
describe("breakdown shares", () => {
  const rows = [
    { key: "a", label: "A", views: 60, estimatedMinutesWatched: 10, share: 0 },
    { key: "b", label: "B", views: 40, estimatedMinutesWatched: 5, share: 0 },
  ];
  it("uses all period views instead of pretending a truncated top-N is 100%", () => {
    expect(breakdownShares(rows, 200)).toMatchObject([
      { share: 30, shareBasis: "all_views" },
      { share: 20, shareBasis: "all_views" },
    ]);
  });
  it("labels the fallback when the full period is missing or inconsistent", () => {
    expect(breakdownShares(rows, null)).toMatchObject([
      { share: 60, shareBasis: "reported_rows" },
      { share: 40, shareBasis: "reported_rows" },
    ]);
    expect(breakdownShares(rows, 80)[0]).toMatchObject({
      share: 60,
      shareBasis: "reported_rows",
    });
  });
  it("keeps malformed API values out of percentages", () => {
    expect(breakdownShares([{ ...rows[0]!, views: Number.NaN }], 200)[0]).toMatchObject(
      {
        share: 0,
        shareBasis: "all_views",
      },
    );
  });
});
describe("confirmed formats", () => {
  it("includes confirmed zero-view peers without inventing a ratio for a zero median", () => {
    const video = {
      id: "selected",
      contentType: "video",
      analyticsAvailable28Days: true,
      analyticsViews28Days: 100,
    } as VideoSummary;
    const peers = [0, 10, 20].map((views, index) => ({
      ...video,
      id: String(index),
      analyticsViews28Days: views,
    }));
    expect(cohortBenchmark(video, peers)).toMatchObject({
      count: 3,
      median: 10,
      ratio: 10,
    });
    expect(
      cohortBenchmark(
        video,
        peers.map((item) => ({ ...item, analyticsViews28Days: 0 })),
      ),
    ).toBeNull();
  });
  it("does not infer Shorts from duration", () => {
    const video = { durationSeconds: 30 } as VideoSummary;
    expect(inContentCohort(video, "shorts")).toBe(false);
    expect(inContentCohort(video, "unknown")).toBe(true);
  });
  it("requires three same-format peers for a benchmark", () => {
    const video = {
      id: "a",
      contentType: "shorts",
      analyticsAvailable28Days: true,
      analyticsViews28Days: 100,
    } as VideoSummary;
    const peers = [10, 20, 30].map((views, i) => ({
      ...video,
      id: String(i),
      analyticsViews28Days: views,
    }));
    expect(cohortBenchmark(video, peers)?.median).toBe(20);
    expect(cohortBenchmark(video, peers.slice(0, 2))).toBeNull();
    expect(
      cohortBenchmark(
        video,
        peers.map((item) => ({ ...item, contentType: "video" })),
      ),
    ).toBeNull();
  });
});
