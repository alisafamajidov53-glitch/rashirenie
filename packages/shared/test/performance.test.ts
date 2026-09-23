import { describe, expect, it } from "vitest";
import { calculateVideoPerformanceScore, type VideoSummary } from "../src/index.js";

function video(id: string, overrides: Partial<VideoSummary> = {}): VideoSummary {
  return {
    id,
    contentType: "video",
    title: `Video ${id}`,
    description: "0:00 Intro\n0:30 Result\n1:20 Summary #youtube",
    tags: ["youtube", "test", "video", "result", "guide"],
    thumbnailUrl: "https://i.ytimg.com/example.jpg",
    publishedAt: "2026-07-20T00:00:00.000Z",
    durationSeconds: 300,
    categoryId: "22",
    defaultLanguage: "en",
    captionsAvailable: true,
    views: 1_000,
    likes: 80,
    comments: 20,
    observedViewsLastHour: 20,
    observedMinutes: 60,
    observedViewsLast24Hours: 200,
    observedMinutes24Hours: 1_440,
    observedViewsLast48Hours: 260,
    observedMinutes48Hours: 2_880,
    viewsLast15Minutes: 5,
    observedMinutesLast15: 15,
    viewsPerMinuteLast15: 1 / 3,
    previous15MinutesViews: 4,
    previousObservedMinutes15: 15,
    previousViewsPerMinute15: 4 / 15,
    velocityTrendPercent: 25,
    analyticsViews28Days: 900,
    watchMinutes28Days: 2_700,
    averageViewPercentage28Days: 60,
    shares28Days: 10,
    subscribersGained28Days: 18,
    subscribersLost28Days: 3,
    analyticsAvailable28Days: true,
    ...overrides,
  };
}

describe("video performance score", () => {
  it("uses only transparent, deterministic factors", () => {
    const weak = video("weak", {
      views: 500,
      likes: 10,
      comments: 1,
      observedViewsLastHour: 2,
      averageViewPercentage28Days: 30,
      subscribersGained28Days: 2,
    });
    const strong = video("strong", {
      views: 10_000,
      likes: 900,
      comments: 140,
      observedViewsLastHour: 120,
      averageViewPercentage28Days: 72,
      subscribersGained28Days: 90,
      watchMinutes28Days: 4_500,
    });
    const middleA = video("middle-a", {
      views: 1_500,
      likes: 60,
      comments: 12,
      observedViewsLastHour: 15,
      averageViewPercentage28Days: 45,
      subscribersGained28Days: 10,
      watchMinutes28Days: 1_200,
    });
    const middleB = video("middle-b", {
      views: 3_000,
      likes: 180,
      comments: 25,
      observedViewsLastHour: 40,
      averageViewPercentage28Days: 55,
      subscribersGained28Days: 24,
      watchMinutes28Days: 1_800,
    });
    const cohort = [weak, middleA, middleB, strong];
    const score = calculateVideoPerformanceScore(
      strong,
      cohort,
      Date.parse("2026-07-28T00:00:00.000Z"),
    );
    expect(score.total).toBeGreaterThan(80);
    expect(score.confidence).toBe("high");
    expect(score.availableWeight).toBe(100);
    expect(score.sameFormatPeers).toBe(3);
    expect(score.factors).toHaveLength(6);
    expect(score.formula).toContain("скорость 25");
  });

  it("excludes unavailable Analytics factors instead of inventing values", () => {
    const publicOnly = video("public", {
      analyticsAvailable28Days: false,
      analyticsViews28Days: 0,
      watchMinutes28Days: 0,
      averageViewPercentage28Days: 0,
      subscribersGained28Days: 0,
      subscribersLost28Days: 0,
    });
    const score = calculateVideoPerformanceScore(publicOnly, [publicOnly]);
    expect(
      score.factors
        .filter((factor) => factor.source === "youtube_analytics_api")
        .every((factor) => !factor.available),
    ).toBe(true);
    expect(score.confidence).toBe("low");
    expect(score.total).toBeNull();
    expect(score.availableWeight).toBe(0);
  });

  it("scores measured zero retention and watch time as zero, not as missing", () => {
    const zero = video("zero", {
      analyticsDetailAvailable28Days: true,
      averageViewPercentage28Days: 0,
      watchMinutes28Days: 0,
    });
    const positive = video("positive", {
      analyticsDetailAvailable28Days: true,
      averageViewPercentage28Days: 50,
      watchMinutes28Days: 900,
    });
    const peerA = video("peer-a", {
      analyticsDetailAvailable28Days: true,
      watchMinutes28Days: 300,
    });
    const peerB = video("peer-b", {
      analyticsDetailAvailable28Days: true,
      watchMinutes28Days: 600,
    });
    const cohort = [zero, positive, peerA, peerB];
    const score = calculateVideoPerformanceScore(zero, cohort);
    expect(score.factors.find((factor) => factor.id === "retention")).toMatchObject({
      available: true,
      score: 0,
    });
    expect(score.factors.find((factor) => factor.id === "watch-time")).toMatchObject({
      available: true,
      score: 0,
    });
    expect(score.confidence).toBe("high");
    const positiveScore = calculateVideoPerformanceScore(positive, cohort);
    expect(
      positiveScore.factors.find((factor) => factor.id === "watch-time")?.score,
    ).toBe(10);
  });

  it("excludes detailed factors when Analytics only supplied basic video totals", () => {
    const basicOnly = video("basic", {
      analyticsDetailAvailable28Days: false,
      averageViewPercentage28Days: 60,
      watchMinutes28Days: 2_700,
    });
    const score = calculateVideoPerformanceScore(basicOnly, [
      basicOnly,
      video("peer-1"),
      video("peer-2"),
      video("peer-3"),
    ]);
    expect(score.factors.find((factor) => factor.id === "retention")?.available).toBe(
      false,
    );
    expect(score.factors.find((factor) => factor.id === "watch-time")?.available).toBe(
      false,
    );
    expect(
      score.factors.find((factor) => factor.id === "subscriber-conversion")?.available,
    ).toBe(true);
    expect(score.confidence).toBe("medium");
    expect(score.availableWeight).toBe(70);
  });

  it("never ranks a video against itself or a different format", () => {
    const target = video("target", { contentType: "shorts" });
    const mixed = [
      target,
      video("short-peer", { contentType: "shorts" }),
      video("long-1"),
      video("long-2"),
      video("long-3"),
    ];
    const score = calculateVideoPerformanceScore(target, mixed);
    expect(score.sameFormatPeers).toBe(1);
    expect(score.total).toBeNull();
    expect(score.factors.find((factor) => factor.id === "engagement")).toMatchObject({
      available: false,
      peerCount: 1,
      unavailableReason: "insufficient_peers",
    });
  });

  it("does not publish a precise index from public-only partial coverage", () => {
    const publicOnly = video("public", {
      analyticsAvailable28Days: false,
      analyticsViews28Days: 0,
      watchMinutes28Days: 0,
    });
    const score = calculateVideoPerformanceScore(publicOnly, [
      publicOnly,
      video("peer-1"),
      video("peer-2"),
      video("peer-3"),
    ]);
    expect(score.availableWeight).toBe(55);
    expect(score.total).toBeNull();
    expect(score.confidence).toBe("low");
  });

  it("explains why an unconfirmed format cannot enter a comparison", () => {
    const target = video("unknown", { contentType: "unknown" });
    const score = calculateVideoPerformanceScore(target, [
      target,
      video("peer-1", { contentType: "unknown" }),
      video("peer-2", { contentType: "unknown" }),
      video("peer-3", { contentType: "unknown" }),
    ]);
    expect(score.total).toBeNull();
    expect(score.factors.find((factor) => factor.id === "engagement")).toMatchObject({
      available: false,
      unavailableReason: "unsupported_format",
    });
  });
});
