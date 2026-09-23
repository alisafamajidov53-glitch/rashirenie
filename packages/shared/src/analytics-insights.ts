import type { AnalyticsBreakdownItem, AnalyticsDay, VideoSummary } from "./types.js";

/** Prefer the full-period view total; never call a truncated top-N subtotal 100% of traffic. */
export function breakdownShares(
  items: AnalyticsBreakdownItem[],
  fullPeriodViews: number | null,
): AnalyticsBreakdownItem[] {
  const safeViews = (views: number) =>
    Number.isFinite(views) ? Math.max(0, views) : 0;
  const reportedViews = items.reduce((sum, item) => sum + safeViews(item.views), 0);
  const allViewsAvailable =
    fullPeriodViews !== null &&
    Number.isFinite(fullPeriodViews) &&
    fullPeriodViews > 0 &&
    fullPeriodViews >= reportedViews;
  const denominator = allViewsAvailable ? fullPeriodViews : reportedViews;
  return items.map((item) => ({
    ...item,
    share: denominator > 0 ? (safeViews(item.views) / denominator) * 100 : 0,
    shareBasis: allViewsAvailable ? "all_views" : "reported_rows",
  }));
}

export type ContentCohort = "all" | "shorts" | "video" | "unknown";
export function inContentCohort(video: VideoSummary, cohort: ContentCohort): boolean {
  if (cohort === "all") return true;
  if (cohort === "unknown")
    return video.contentType !== "shorts" && video.contentType !== "video";
  return video.contentType === cohort;
}

export function compareAnalyticsPeriods(history: AnalyticsDay[], days: 7 | 14) {
  const rows = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const last = rows.at(-1)?.date;
  const end = last ? Date.parse(`${last}T00:00:00Z`) : NaN;
  const dates = Number.isFinite(end)
    ? Array.from({ length: days * 2 }, (_, index) =>
        new Date(end - (days * 2 - 1 - index) * 86_400_000).toISOString().slice(0, 10),
      )
    : [];
  const byDate = new Map(rows.map((day) => [day.date, day]));
  const ready = dates.length > 0 && dates.every((date) => byDate.has(date));
  const previous = dates.slice(0, days).flatMap((date) => byDate.get(date) ?? []);
  const current = dates.slice(days).flatMap((date) => byDate.get(date) ?? []);
  const total = (source: AnalyticsDay[], key: "views" | "watch" | "subscribers") =>
    source.reduce(
      (sum, day) =>
        sum +
        (key === "views"
          ? day.views
          : key === "watch"
            ? day.estimatedMinutesWatched
            : day.subscribersGained - day.subscribersLost),
      0,
    );
  const metrics = (["views", "watch", "subscribers"] as const).map((key) => {
    const before = total(previous, key);
    const after = total(current, key);
    const valid = ready && Number.isFinite(before) && Number.isFinite(after);
    return {
      key,
      current: valid ? after : null,
      previous: valid ? before : null,
      delta: valid ? after - before : null,
      percent: valid && before > 0 ? ((after - before) / before) * 100 : null,
    };
  });
  return {
    ready,
    metrics,
    currentStart: dates[days],
    currentEnd: dates.at(-1),
    previousStart: dates[0],
    previousEnd: dates[days - 1],
  };
}

export function cohortBenchmark(video: VideoSummary, videos: VideoSummary[]) {
  if (video.contentType !== "shorts" && video.contentType !== "video") return null;
  const peers = videos.filter(
    (item) =>
      item.id !== video.id &&
      item.contentType === video.contentType &&
      item.analyticsAvailable28Days &&
      Number.isFinite(item.analyticsViews28Days) &&
      item.analyticsViews28Days >= 0,
  );
  if (
    !video.analyticsAvailable28Days ||
    !Number.isFinite(video.analyticsViews28Days) ||
    video.analyticsViews28Days < 0 ||
    peers.length < 3
  )
    return null;
  const values = peers.map((item) => item.analyticsViews28Days).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
  // Keep confirmed zero-view peers in the cohort without dividing by zero.
  if (median <= 0) return null;
  return { count: peers.length, median, ratio: video.analyticsViews28Days / median };
}
