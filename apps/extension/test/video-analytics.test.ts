import { afterEach, describe, expect, it, vi } from "vitest";
import { getVideoAnalyticsDetails } from "../src/background/youtube";

const videoId = "abcdefghijk";
afterEach(() => vi.unstubAllGlobals());

function report(url: string) {
  const query = new URL(url).searchParams;
  if (query.get("dimensions") === "insightTrafficSourceType")
    return Response.json({
      rows: [
        ["YT_SEARCH", 100, 40],
        ["RELATED_VIDEO", 25, 10],
      ],
    });
  if (query.get("metrics") === "engagedViews")
    return Response.json({ rows: [[query.get("startDate"), 110]] });
  const metrics = query.get("metrics")!;
  return Response.json({
    rows: [
      metrics.includes("averageViewPercentage")
        ? [query.get("startDate"), 125, 50, 24, 40, 10, 2, 1, 4, 1]
        : [query.get("startDate"), 125, 50, 24, 10, 2, 4, 1],
    ],
  });
}

describe("video-scoped Analytics requests", () => {
  it("uses the complete 28-day total for traffic shares when it is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const query = new URL(url).searchParams;
        if (query.get("dimensions") === "insightTrafficSourceType")
          return Response.json({
            rows: [
              ["YT_SEARCH", 100, 40],
              ["RELATED_VIDEO", 25, 10],
            ],
          });
        const start = query.get("startDate");
        const end = query.get("endDate");
        if (query.get("metrics") === "engagedViews")
          return Response.json({
            rows: [
              [start, 200],
              [end, 0],
            ],
          });
        return Response.json({
          rows: [
            [start, 200, 80, 24, 40, 10, 2, 1, 4, 1],
            [end, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          ],
        });
      }),
    );
    const result = await getVideoAnalyticsDetails("test-token", videoId, "en");
    expect(result.history).toHaveLength(28);
    expect(result.trafficSources).toMatchObject([
      { share: 50, shareBasis: "all_views" },
      { share: 12.5, shareBasis: "all_views" },
    ]);
  });
  it("filters every report to the selected video, including engaged views and traffic", async () => {
    const fetch = vi.fn(async (url: string) => report(url));
    vi.stubGlobal("fetch", fetch);
    const result = await getVideoAnalyticsDetails("test-token", videoId, "en");
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [url] of fetch.mock.calls)
      expect(new URL(url).searchParams.get("filters")).toBe(`video==${videoId}`);
    expect(result.history[0]).toMatchObject({ views: 125, engagedViews: 110 });
    expect(result.historyDetailAvailable).toBe(true);
    expect(result.trafficSources[0]).toMatchObject({
      views: 100,
      share: 80,
      shareBasis: "reported_rows",
    });
    expect(result.warnings).toEqual([]);
  });

  it("keeps the video filter on the fallback report", async () => {
    const fetch = vi.fn(async (url: string) =>
      new URL(url).searchParams.get("metrics")?.includes("averageViewPercentage")
        ? new Response("Unsupported metric", { status: 400 })
        : report(url),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await getVideoAnalyticsDetails("test-token", videoId, "en");
    expect(result.history[0]).toMatchObject({
      views: 125,
      subscribersGained: 4,
      averageViewPercentage: null,
      shares: null,
    });
    expect(result.historyDetailAvailable).toBe(false);
    expect(result.warnings).toContain(
      "Average retention and shares are unavailable: YouTube returned a reduced report.",
    );
    for (const [url] of fetch.mock.calls)
      expect(new URL(url).searchParams.get("filters")).toBe(`video==${videoId}`);
  });

  it("does not export ordinary views as engaged views when that metric fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new URL(url).searchParams.get("metrics") === "engagedViews"
          ? new Response("Metric unavailable", { status: 400 })
          : report(url),
      ),
    );
    const result = await getVideoAnalyticsDetails("test-token", videoId, "en");
    expect(result.history[0]).toMatchObject({ views: 125, engagedViews: null });
    expect(result.history[0]?.estimatedMinutesWatched).toBe(50);
  });

  it("preserves history when traffic is unavailable and reports the partial failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new URL(url).searchParams.get("dimensions") === "insightTrafficSourceType"
          ? new Response("Unavailable", { status: 503 })
          : report(url),
      ),
    );
    const result = await getVideoAnalyticsDetails("test-token", videoId, "en");
    expect(result.history).toHaveLength(1);
    expect(result.trafficSources).toEqual([]);
    expect(result.warnings).toContain(
      "Traffic sources for this video are unavailable.",
    );
  });

  it("propagates expired authorization without silently trying other reports", async () => {
    const fetch = vi.fn(async () => new Response("Expired token", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      getVideoAnalyticsDetails("test-token", videoId, "en"),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("cancels an in-flight report without starting a fallback or traffic request", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = getVideoAnalyticsDetails(
      "test-token",
      videoId,
      "en",
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
