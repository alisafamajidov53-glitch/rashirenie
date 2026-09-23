import type { RealtimePoint, RealtimeSource } from "./types.js";

/**
 * How often the background alarm collects a public-counter snapshot.
 *
 * Shared because the widget tells the user how fresh its numbers are: it said
 * "updates every minute" for a while after the alarm moved to five minutes to
 * save API quota, and a constant in one place is how that cannot recur.
 */
export const REALTIME_COLLECTION_PERIOD_MINUTES = 5;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TWO_DAYS_MS = 48 * HOUR_MS;
const RETENTION_MS = 50 * HOUR_MS;
// One heartbeat per minute plus change-only sub-minute samples. This covers a
// busy channel for the full 50-hour retention window without truncating its
// 48-hour graph.
const MAX_POINTS_PER_SERIES = 7_500;
const MAX_SAMPLE_DRIFT_MS = 2 * 60_000;
const COUNTER_RESET_MINIMUM = 10;
const COUNTER_RESET_CONFIRMATION_SAMPLES = 5;
const COUNTER_RESET_CONFIRMATION_MS = 4 * 60_000;
const MINIMUM_VELOCITY_TREND_MINUTES = 5;

function isCounterReset(previousHigh: number, current: number): boolean {
  if (current >= previousHigh) return false;
  const decrease = previousHigh - current;
  // A percentage threshold freezes large channels after a normal correction:
  // even a -100 adjustment on an 8M-view channel would otherwise need to
  // recover thousands of views. Consecutive confirmation samples already
  // protect against short-lived stale responses.
  return decrease >= COUNTER_RESET_MINIMUM;
}

function normalizedPoints(points: RealtimePoint[], now = Date.now()): RealtimePoint[] {
  const byTimestamp = new Map<
    number,
    { views: number; rawViews: number; hasRawViews: boolean }
  >();
  for (const point of points) {
    if (
      !Number.isFinite(point.capturedAt) ||
      !Number.isFinite(point.views) ||
      (point.rawViews !== undefined && !Number.isFinite(point.rawViews)) ||
      point.capturedAt < now - RETENTION_MS ||
      point.capturedAt > now
    ) {
      continue;
    }
    const views = Math.max(0, Math.round(point.views));
    const hasRawViews = point.rawViews !== undefined;
    const rawViews = Math.max(
      0,
      Math.round(hasRawViews ? point.rawViews! : point.views),
    );
    const current = byTimestamp.get(point.capturedAt);
    if (
      !current ||
      rawViews > current.rawViews ||
      (rawViews === current.rawViews && views > current.views)
    ) {
      byTimestamp.set(point.capturedAt, {
        views,
        rawViews,
        hasRawViews,
      });
    }
  }
  let adjustedViews = 0;
  let rawHighWater: number | undefined;
  let pendingReset:
    | {
        startedAt: number;
        firstRawViews: number;
        samples: number;
      }
    | undefined;
  return [...byTimestamp.entries()]
    .sort(([left], [right]) => left - right)
    .map(([capturedAt, point], index) => {
      if (index === 0) {
        adjustedViews = point.views;
        rawHighWater = point.rawViews;
      } else if (point.hasRawViews && rawHighWater !== undefined) {
        if (isCounterReset(rawHighWater, point.rawViews)) {
          pendingReset ??= {
            startedAt: capturedAt,
            firstRawViews: point.rawViews,
            samples: 0,
          };
          pendingReset.samples += 1;
          if (
            pendingReset.samples >= COUNTER_RESET_CONFIRMATION_SAMPLES &&
            capturedAt - pendingReset.startedAt >= COUNTER_RESET_CONFIRMATION_MS
          ) {
            // YouTube can briefly serve a stale, much lower public counter.
            // Require several consecutive minute snapshots before treating a
            // decrease as a real deletion/correction. Once confirmed, retain
            // the old total and count only growth observed after the reset.
            adjustedViews += Math.max(0, point.rawViews - pendingReset.firstRawViews);
            rawHighWater = point.rawViews;
            pendingReset = undefined;
          }
        } else if (point.rawViews > rawHighWater) {
          adjustedViews += point.rawViews - rawHighWater;
          rawHighWater = point.rawViews;
          pendingReset = undefined;
        } else {
          pendingReset = undefined;
        }
      } else {
        // Legacy samples did not preserve the raw counter. Keep their existing
        // monotonic value so upgrades do not rewrite historical activity.
        adjustedViews = Math.max(adjustedViews, point.views);
        rawHighWater =
          rawHighWater === undefined
            ? point.rawViews
            : Math.max(rawHighWater, point.rawViews);
        pendingReset = undefined;
      }
      return {
        capturedAt,
        views: adjustedViews,
        ...(point.hasRawViews ? { rawViews: point.rawViews } : {}),
      };
    })
    .slice(-MAX_POINTS_PER_SERIES);
}

export function appendRealtimePoint(
  points: RealtimePoint[],
  next: RealtimePoint,
  now = next.capturedAt,
): RealtimePoint[] {
  // The default clock comes from the incoming sample. Corrupt timestamps must
  // not disable retention filtering (NaN) or evict the entire history (Infinity).
  const referenceNow = Number.isFinite(now) ? now : Date.now();
  const latestNearbyTimestamp = points.reduce(
    (latest, point) =>
      Number.isFinite(point.capturedAt) &&
      point.capturedAt > latest &&
      point.capturedAt <= referenceNow + MAX_SAMPLE_DRIFT_MS
        ? point.capturedAt
        : latest,
    referenceNow,
  );
  // Alarm callbacks and manual refreshes can complete out of order. Preserve a
  // newer valid minute instead of truncating it when an older request finishes
  // last; still reject timestamps far in the future as corrupt data.
  const normalizationNow = Math.max(referenceNow, latestNearbyTimestamp);
  const normalized = normalizedPoints(points, normalizationNow);
  // A malformed retry must not replace an already valid sample at this minute.
  if (
    !Number.isFinite(next.capturedAt) ||
    !Number.isFinite(next.views) ||
    (next.rawViews !== undefined && !Number.isFinite(next.rawViews))
  )
    return normalized;
  const existing = normalized.find((point) => point.capturedAt === next.capturedAt);
  if (existing) {
    const nextRaw = Math.max(0, Math.round(next.rawViews ?? next.views));
    const existingRaw = Math.max(0, Math.round(existing.rawViews ?? existing.views));
    const rawHighWater = Math.max(existingRaw, nextRaw);
    const merged: RealtimePoint = {
      capturedAt: next.capturedAt,
      views: Math.max(existing.views + Math.max(0, nextRaw - existingRaw), next.views),
      ...(existing.rawViews !== undefined || next.rawViews !== undefined
        ? { rawViews: rawHighWater }
        : {}),
    };
    return normalizedPoints(
      [...normalized.filter((point) => point.capturedAt !== next.capturedAt), merged],
      normalizationNow,
    );
  }
  return normalizedPoints([...normalized, next], normalizationNow);
}

export function pruneRealtimePoints(
  points: RealtimePoint[],
  now = Date.now(),
): RealtimePoint[] {
  return normalizedPoints(points, now);
}

function observedViewsInWindow(
  points: RealtimePoint[],
  windowMs: number,
  maximumMinutes: number,
  now = Date.now(),
): { views: number; observedMinutes: number } {
  const sorted = normalizedPoints(points, now);
  if (sorted.length < 2) return { views: 0, observedMinutes: 0 };

  const latest = sorted.at(-1)!;
  if (latest.capturedAt < now - windowMs) {
    return { views: 0, observedMinutes: 0 };
  }
  // Anchor the rolling window to the latest successful API snapshot. Browser
  // alarms and foreground refreshes can drift from their intended cadence.
  // Using wall-clock seconds here made a complete hour look like 59 minutes;
  // using a pre-boundary sample could conversely count 61–62 minutes.
  const boundary = latest.capturedAt - windowMs;
  const baseline = sorted.find((point) => point.capturedAt >= boundary) ?? latest;

  return {
    views: Math.max(0, latest.views - baseline.views),
    observedMinutes: Math.min(
      maximumMinutes,
      Math.max(0, Math.round((latest.capturedAt - baseline.capturedAt) / 60_000)),
    ),
  };
}

export function observedViewsInLastHour(
  points: RealtimePoint[],
  now = Date.now(),
): { views: number; observedMinutes: number } {
  return observedViewsInWindow(points, HOUR_MS, 60, now);
}

export function observedViewsInLast24Hours(
  points: RealtimePoint[],
  now = Date.now(),
): { views: number; observedMinutes: number } {
  return observedViewsInWindow(points, DAY_MS, 24 * 60, now);
}

export function observedViewsInLast48Hours(
  points: RealtimePoint[],
  now = Date.now(),
): { views: number; observedMinutes: number } {
  return observedViewsInWindow(points, TWO_DAYS_MS, 48 * 60, now);
}

export interface RealtimeWindowCoverage {
  observedMinutes: number;
  targetMinutes: number;
  ratio: number;
  complete: boolean;
}

export function realtimeWindowCoverage(
  observedMinutes: number,
  targetMinutes: number,
): RealtimeWindowCoverage {
  const target = Math.max(1, Math.round(targetMinutes));
  const observed = Math.min(
    target,
    Math.max(0, Math.floor(Number.isFinite(observedMinutes) ? observedMinutes : 0)),
  );
  return {
    observedMinutes: observed,
    targetMinutes: target,
    ratio: observed / target,
    complete: observed >= target,
  };
}

export interface RealtimeObservation {
  views: number;
  observedMinutes: number;
}

export interface CombinedRealtimeObservation extends RealtimeObservation {
  source: RealtimeSource;
}

function safeObservation(observation: RealtimeObservation): RealtimeObservation {
  return {
    views: Math.max(
      0,
      Math.round(Number.isFinite(observation.views) ? observation.views : 0),
    ),
    observedMinutes: Math.max(
      0,
      Math.round(
        Number.isFinite(observation.observedMinutes) ? observation.observedMinutes : 0,
      ),
    ),
  };
}

/**
 * The public channel counter can be reconciled later than the counters of
 * individual uploads. Use the greater independently observed delta, never
 * their sum: the two sources describe the same views and summing them would
 * double-count traffic once the channel counter catches up.
 */
export function combineRealtimeObservations(
  channel: RealtimeObservation,
  videos: RealtimeObservation[],
): CombinedRealtimeObservation {
  const safeChannel = safeObservation(channel);
  const safeVideos = videos.map(safeObservation);
  const videoViews = safeVideos.reduce(
    (total, observation) => total + observation.views,
    0,
  );
  const videoObservedMinutes = safeVideos.reduce(
    (maximum, observation) => Math.max(maximum, observation.observedMinutes),
    0,
  );
  const useVideoDelta = videoViews > safeChannel.views;
  return {
    views: Math.max(safeChannel.views, videoViews),
    observedMinutes: Math.max(safeChannel.observedMinutes, videoObservedMinutes),
    source: useVideoDelta ? "hybrid_video_delta" : "channel_total",
  };
}

export function aggregateRealtimeSeries(series: RealtimePoint[][]): RealtimePoint[] {
  const buckets = new Map<
    number,
    { views: number; rawViews: number; hasRawViews: boolean }
  >();
  for (const points of series) {
    for (const point of points) {
      const current = buckets.get(point.capturedAt) ?? {
        views: 0,
        rawViews: 0,
        hasRawViews: false,
      };
      current.views += point.views;
      current.rawViews += point.rawViews ?? point.views;
      current.hasRawViews ||= point.rawViews !== undefined;
      buckets.set(point.capturedAt, current);
    }
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([capturedAt, point]) => ({
      capturedAt,
      views: point.views,
      ...(point.hasRawViews ? { rawViews: point.rawViews } : {}),
    }))
    .slice(-3_060);
}

function observedWindowStats(
  points: RealtimePoint[],
  from: number,
  to: number,
): { views: number; observedMinutes: number; viewsPerMinute: number } {
  const inside = points.filter(
    (point) => point.capturedAt >= from && point.capturedAt <= to,
  );
  if (inside.length < 2) {
    return { views: 0, observedMinutes: 0, viewsPerMinute: 0 };
  }
  const baseline = inside[0]!;
  const end = inside.at(-1)!;
  const observedMinutes = Math.max(0, (end.capturedAt - baseline.capturedAt) / 60_000);
  if (observedMinutes <= 0) {
    return { views: 0, observedMinutes: 0, viewsPerMinute: 0 };
  }
  const views = Math.max(0, end.views - baseline.views);
  return {
    views,
    observedMinutes: Math.min(15, Math.round(observedMinutes * 10) / 10),
    viewsPerMinute: views / observedMinutes,
  };
}

export interface RealtimeVelocity {
  viewsLast15Minutes: number;
  observedMinutesLast15: number;
  viewsPerMinuteLast15: number;
  previous15MinutesViews: number;
  previousObservedMinutes15: number;
  previousViewsPerMinute15: number;
  velocityTrendPercent: number;
}

export function realtimeVelocity(
  points: RealtimePoint[],
  now = Date.now(),
): RealtimeVelocity {
  const quarter = 15 * 60_000;
  const sorted = normalizedPoints(points, now);
  const latest = sorted.at(-1);
  if (!latest || latest.capturedAt < now - MAX_SAMPLE_DRIFT_MS) {
    return {
      viewsLast15Minutes: 0,
      observedMinutesLast15: 0,
      viewsPerMinuteLast15: 0,
      previous15MinutesViews: 0,
      previousObservedMinutes15: 0,
      previousViewsPerMinute15: 0,
      velocityTrendPercent: 0,
    };
  }
  const current = observedWindowStats(
    sorted,
    latest.capturedAt - quarter,
    latest.capturedAt,
  );
  const previous = observedWindowStats(
    sorted,
    latest.capturedAt - 2 * quarter,
    latest.capturedAt - quarter,
  );
  const velocityTrendPercent =
    current.observedMinutes < MINIMUM_VELOCITY_TREND_MINUTES ||
    previous.observedMinutes < MINIMUM_VELOCITY_TREND_MINUTES
      ? 0
      : previous.viewsPerMinute === 0
        ? current.viewsPerMinute > 0
          ? 100
          : 0
        : Math.round(
            ((current.viewsPerMinute - previous.viewsPerMinute) /
              previous.viewsPerMinute) *
              100,
          );
  return {
    viewsLast15Minutes: current.views,
    observedMinutesLast15: current.observedMinutes,
    viewsPerMinuteLast15: Math.round(current.viewsPerMinute * 1_000) / 1_000,
    previous15MinutesViews: previous.views,
    previousObservedMinutes15: previous.observedMinutes,
    previousViewsPerMinute15: Math.round(previous.viewsPerMinute * 1_000) / 1_000,
    velocityTrendPercent: Math.max(-100, Math.min(999, velocityTrendPercent)),
  };
}
