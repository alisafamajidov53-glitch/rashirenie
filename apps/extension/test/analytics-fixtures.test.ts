import { describe, expect, it } from "vitest";
import type { VideoAnalyticsDetails } from "@channelpilot/shared";
import { createChromeFixture, videoHistoryFixture } from "./analytics-fixtures";

describe("video analytics preview data", () => {
  it("matches the selected video's 28-day totals rather than the channel history", async () => {
    const fixture = createChromeFixture();
    const video = fixture.dashboard.videos[0]!;
    const response = await fixture.chrome.runtime.sendMessage({
      type: "GET_VIDEO_ANALYTICS",
      videoId: video.id,
    });
    expect(response.ok).toBe(true);
    const details = response.data as VideoAnalyticsDetails;
    expect(details.history).toHaveLength(28);
    expect(details.history.map((day) => day.date)).toEqual(
      fixture.dashboard.history.map((day) => day.date),
    );
    expect(details.history.reduce((sum, day) => sum + day.views, 0)).toBe(
      video.analyticsViews28Days,
    );
    expect(
      details.history.reduce((sum, day) => sum + day.estimatedMinutesWatched, 0),
    ).toBe(video.watchMinutes28Days);
    expect(details.history.reduce((sum, day) => sum + day.subscribersGained, 0)).toBe(
      video.subscribersGained28Days,
    );
    expect(details.trafficSources[0]?.views).toBe(video.analyticsViews28Days);
    expect(details.history).not.toEqual(fixture.dashboard.history);
  });

  it("does not invent a history for an unknown video", async () => {
    const fixture = createChromeFixture();
    const response = await fixture.chrome.runtime.sendMessage({
      type: "GET_VIDEO_ANALYTICS",
      videoId: "unknown-video",
    });
    const details = response.data as VideoAnalyticsDetails;
    expect(details.history).toEqual([]);
    expect(details.trafficSources).toEqual([]);
  });

  it("never assigns demo views before publication", () => {
    const fixture = createChromeFixture();
    const video = {
      ...fixture.dashboard.videos[0]!,
      publishedAt: "2026-09-15T12:00:00Z",
    };
    const history = videoHistoryFixture(video, fixture.dashboard.history);
    expect(
      history.filter((day) => day.date < "2026-09-15").every((day) => day.views === 0),
    ).toBe(true);
    expect(history.reduce((sum, day) => sum + day.views, 0)).toBe(
      video.analyticsViews28Days,
    );
  });
});
