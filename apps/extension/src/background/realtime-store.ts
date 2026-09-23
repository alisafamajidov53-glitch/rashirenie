import {
  aggregateRealtimeSeries,
  appendRealtimePoint,
  observedViewsInLast24Hours,
  observedViewsInLast48Hours,
  observedViewsInLastHour,
  pruneRealtimePoints,
  realtimeVelocity,
  type RealtimePoint,
} from "@channelpilot/shared";

// V2 deliberately starts a clean channel-total series. Older builds could
// populate the same storage with a moving latest-video aggregate, which made
// 60-minute and 24-hour values jump when the top-50 list changed.
const STORAGE_KEY = "realtimeSamplesV2";
const CHANNEL_KEY = "realtimeSamplesChannelIdV2";
const MAX_OUT_OF_ORDER_DRIFT_MS = 2 * 60_000;

type SampleMap = Record<string, RealtimePoint[]>;
let saveQueue: Promise<void> = Promise.resolve();

async function readSamples(): Promise<SampleMap> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return value && typeof value === "object" ? (value as SampleMap) : {};
}

export async function saveSamples(
  videos: Array<{ id: string; views: number }>,
  capturedAt = Date.now(),
  channelId?: string,
): Promise<void> {
  const task = saveQueue.then(async () => {
    const channelState = channelId ? await chrome.storage.local.get(CHANNEL_KEY) : {};
    const storedChannelId = channelState[CHANNEL_KEY];
    const channelChanged = Boolean(channelId) && storedChannelId !== channelId;
    const samples = channelChanged ? {} : await readSamples();
    // Preserve sub-minute counter changes. Older builds rounded every request
    // to the minute, so 100 -> 101 inside the same minute overwrote the
    // baseline and the first view disappeared. Unchanged counters still keep
    // only one heartbeat per minute to avoid unnecessary storage growth.
    const capturedSecond = Math.floor(capturedAt / 1_000) * 1_000;
    for (const [id, points] of Object.entries(samples)) {
      const newestStoredAt = Array.isArray(points)
        ? points.reduce(
            (latest, point) =>
              Number.isFinite(point?.capturedAt)
                ? Math.max(latest, point.capturedAt)
                : latest,
            capturedSecond,
          )
        : capturedSecond;
      const pruneAt =
        newestStoredAt <= capturedSecond + MAX_OUT_OF_ORDER_DRIFT_MS
          ? newestStoredAt
          : capturedSecond;
      const pruned = Array.isArray(points) ? pruneRealtimePoints(points, pruneAt) : [];
      if (pruned.length > 0) samples[id] = pruned;
      else delete samples[id];
    }
    for (const video of videos) {
      if (!video.id || !Number.isFinite(video.views)) continue;
      const nextViews = Math.max(0, Math.round(video.views));
      const points = samples[video.id] ?? [];
      const latest = points.at(-1);
      const latestRawViews =
        latest === undefined
          ? undefined
          : Math.max(0, Math.round(latest.rawViews ?? latest.views));
      const sameMinute =
        latest !== undefined &&
        Math.floor(latest.capturedAt / 60_000) === Math.floor(capturedSecond / 60_000);
      if (sameMinute && latestRawViews === nextViews) continue;
      samples[video.id] = appendRealtimePoint(points, {
        capturedAt: capturedSecond,
        views: nextViews,
        rawViews: nextViews,
      });
    }
    const newestSeries = Object.entries(samples)
      .sort(
        ([, left], [, right]) =>
          (right.at(-1)?.capturedAt ?? 0) - (left.at(-1)?.capturedAt ?? 0),
      )
      // The channel total plus the latest 50 uploads are the active working
      // set. Keep a small churn buffer without retaining every historical
      // upload forever.
      .slice(0, 56);
    await chrome.storage.local.set({
      [STORAGE_KEY]: Object.fromEntries(newestSeries),
      ...(channelId ? { [CHANNEL_KEY]: channelId } : {}),
    });
  });
  saveQueue = task.catch(() => undefined);
  await task;
}

export async function clearRealtimeSamples(): Promise<void> {
  await saveQueue.catch(() => undefined);
  await chrome.storage.local.remove([STORAGE_KEY, CHANNEL_KEY]);
}

export async function getObservedStats(videoIds: string[]): Promise<
  Record<
    string,
    {
      views: number;
      observedMinutes: number;
      viewsLast24Hours: number;
      observedMinutes24Hours: number;
      viewsLast48Hours: number;
      observedMinutes48Hours: number;
      viewsLast15Minutes: number;
      observedMinutesLast15: number;
      viewsPerMinuteLast15: number;
      previous15MinutesViews: number;
      previousObservedMinutes15: number;
      previousViewsPerMinute15: number;
      velocityTrendPercent: number;
    }
  >
> {
  const samples = await readSamples();
  return Object.fromEntries(
    videoIds.map((id) => [
      id,
      {
        ...observedViewsInLastHour(samples[id] ?? []),
        ...(() => {
          const day = observedViewsInLast24Hours(samples[id] ?? []);
          const twoDays = observedViewsInLast48Hours(samples[id] ?? []);
          return {
            viewsLast24Hours: day.views,
            observedMinutes24Hours: day.observedMinutes,
            viewsLast48Hours: twoDays.views,
            observedMinutes48Hours: twoDays.observedMinutes,
          };
        })(),
        ...realtimeVelocity(samples[id] ?? []),
      },
    ]),
  );
}

export async function getRealtimeSeries(videoIds: string[]): Promise<RealtimePoint[]> {
  const samples = await readSamples();
  return aggregateRealtimeSeries(videoIds.map((id) => samples[id] ?? []));
}
