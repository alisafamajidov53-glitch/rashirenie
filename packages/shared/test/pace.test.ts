import { describe, expect, it } from "vitest";
import {
  dailyPace,
  engagementPercent,
  hourlyPace,
  median,
  percentChange,
  type VideoSummary,
} from "../src/index.js";

const video = (patch: Partial<VideoSummary>) => patch as VideoSummary;

describe("pace and aggregate helpers", () => {
  it("extrapolates pace only from a long enough observation", () => {
    expect(hourlyPace(video({ observedViewsLastHour: 10, observedMinutes: 4 }))).toBe(
      0,
    );
    expect(hourlyPace(video({ observedViewsLastHour: 10, observedMinutes: 30 }))).toBe(
      20,
    );
    expect(
      dailyPace(video({ observedViewsLast24Hours: 30, observedMinutes24Hours: 14 })),
    ).toBe(0);
    expect(
      dailyPace(video({ observedViewsLast24Hours: 30, observedMinutes24Hours: 720 })),
    ).toBe(60);
  });

  it("reports engagement per hundred views", () => {
    expect(engagementPercent(video({ views: 0, likes: 5, comments: 1 }))).toBe(0);
    expect(engagementPercent(video({ views: 200, likes: 8, comments: 2 }))).toBe(5);
  });

  it("computes medians and percent changes without dividing by zero", () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, 0)).toBe(100);
    expect(percentChange(90, 100)).toBe(-10);
  });
});
