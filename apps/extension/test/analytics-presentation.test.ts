import { describe, expect, it } from "vitest";
import { calculateVideoPerformanceScore } from "@channelpilot/shared";
import {
  performanceFactorValue,
  performanceScoreNote,
  performanceScoreTooltip,
  videoMomentum,
  videoMomentumLabel,
} from "../src/options/analytics-presentation";
import { videoFixture } from "./analytics-fixtures";

describe("video momentum presentation", () => {
  it("does not call an unobserved 15-minute trend accelerating", () => {
    const video = videoFixture("partial");
    video.observedMinutes = 60;
    video.observedMinutesLast15 = 0;
    video.previousObservedMinutes15 = 0;
    video.velocityTrendPercent = 90;
    expect(videoMomentum(video)).toBe("collecting");
    expect(videoMomentumLabel("collecting", "ru")).toBe("Сбор тренда");
  });

  it("separates truly warming, accelerating, slowing and steady videos", () => {
    const video = videoFixture("states");
    video.observedMinutes = 0;
    video.observedMinutes24Hours = 0;
    video.observedMinutesLast15 = 0;
    video.previousObservedMinutes15 = 0;
    expect(videoMomentum(video)).toBe("warming");

    video.observedMinutes = 60;
    video.observedMinutesLast15 = 15;
    video.previousObservedMinutes15 = 15;
    video.viewsPerMinuteLast15 = 2;
    video.velocityTrendPercent = 42;
    expect(videoMomentum(video)).toBe("hot");
    video.velocityTrendPercent = -45;
    expect(videoMomentum(video)).toBe("cooling");
    expect(videoMomentumLabel("cooling", "en")).toBe("Slowing");
    video.velocityTrendPercent = 0;
    expect(videoMomentum(video)).toBe("stable");
    video.velocityTrendPercent = Number.NaN;
    expect(videoMomentum(video)).toBe("collecting");
  });
});

describe("performance score presentation", () => {
  it("localizes measured factors and warns about different data coverage", () => {
    const video = videoFixture("score");
    const score = calculateVideoPerformanceScore(video, [video]);
    const en = performanceScoreTooltip(score, "en");
    expect(en).toContain("Observed velocity");
    expect(en).toContain("coverage reaches 70/100");
    expect(en).not.toContain("Наблюдаемая");
    const ru = performanceScoreTooltip(score, "ru");
    expect(ru).toContain("Наблюдаемая скорость");
    expect(ru).toContain("Индекс появится");
    expect(
      performanceFactorValue(
        score.factors.find((factor) => factor.id === "engagement")!,
        "en",
      ),
    ).toContain("%");

    const complete = calculateVideoPerformanceScore(video, [
      video,
      videoFixture("peer-a"),
      videoFixture("peer-b"),
      videoFixture("peer-c"),
    ]);
    expect(performanceScoreTooltip(complete, "en")).toContain(
      "not directly comparable",
    );

    const withoutAnalytics = videoFixture("public");
    withoutAnalytics.analyticsAvailable28Days = false;
    const publicScore = calculateVideoPerformanceScore(withoutAnalytics, [
      withoutAnalytics,
      videoFixture("public-peer-a"),
      videoFixture("public-peer-b"),
      videoFixture("public-peer-c"),
    ]);
    expect(performanceScoreNote(publicScore, "en")).toContain(
      "Data coverage is 55/100",
    );
  });
});
