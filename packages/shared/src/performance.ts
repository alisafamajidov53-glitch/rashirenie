import type { VideoSummary } from "./types.js";

export interface VideoPerformanceFactor {
  id:
    | "realtime-velocity"
    | "engagement"
    | "retention"
    | "subscriber-conversion"
    | "lifetime-pace"
    | "watch-time";
  label: string;
  score: number;
  max: number;
  available: boolean;
  peerCount: number;
  unavailableReason:
    "missing_data" | "insufficient_peers" | "unsupported_format" | null;
  value: number;
  unit: string;
  source: "youtube_data_api" | "youtube_analytics_api" | "observed_delta";
  explanation: string;
}

export interface VideoPerformanceScore {
  total: number | null;
  availableWeight: number;
  sameFormatPeers: number;
  confidence: "low" | "medium" | "high";
  factors: VideoPerformanceFactor[];
  formula: string;
  calculatedAt: string;
}

/** Likes and comments per 100 public views. */
export function engagementPercent(video: VideoSummary): number {
  return video.views > 0 ? ((video.likes + video.comments) / video.views) * 100 : 0;
}

/**
 * Views an hour at the pace observed in the last hour. Zero until five minutes
 * are observed: a two-minute sample extrapolated to an hour is noise.
 */
export function hourlyPace(video: VideoSummary): number {
  return video.observedMinutes >= 5
    ? (video.observedViewsLastHour / video.observedMinutes) * 60
    : 0;
}

/** Views a day at the pace observed over the last 24 hours (15 minutes minimum). */
export function dailyPace(video: VideoSummary): number {
  return video.observedMinutes24Hours >= 15
    ? (video.observedViewsLast24Hours / video.observedMinutes24Hours) * 1_440
    : 0;
}

function lifetimePace(video: VideoSummary, now: number): number {
  const published = Date.parse(video.publishedAt);
  if (!Number.isFinite(published) || video.views <= 0) return 0;
  const ageDays = Math.max(1 / 24, (now - published) / 86_400_000);
  return video.views / ageDays;
}

function subscriberConversion(video: VideoSummary): number {
  if (!video.analyticsAvailable28Days || video.analyticsViews28Days <= 0) {
    return 0;
  }
  return (
    ((video.subscribersGained28Days - video.subscribersLost28Days) /
      video.analyticsViews28Days) *
    1_000
  );
}

function watchTimePerView(video: VideoSummary): number {
  return video.analyticsViews28Days > 0
    ? video.watchMinutes28Days / video.analyticsViews28Days
    : 0;
}

function percentile(value: number, peers: number[]): number {
  if (!Number.isFinite(value) || peers.length === 0) return 0;
  const below = peers.filter((candidate) => candidate < value).length;
  const equal = peers.filter((candidate) => candidate === value).length;
  return Math.max(0, Math.min(1, (below + equal / 2) / peers.length));
}

function relativeFactor(
  measured: boolean,
  value: number,
  peers: VideoSummary[],
  eligible: (video: VideoSummary) => boolean,
  metric: (video: VideoSummary) => number,
  maximum: number,
  formatConfirmed: boolean,
): Pick<
  VideoPerformanceFactor,
  "available" | "score" | "peerCount" | "unavailableReason"
> {
  const values = peers.filter(eligible).map(metric).filter(Number.isFinite);
  const available = measured && Number.isFinite(value) && values.length >= 3;
  return {
    available,
    score: available ? Math.round(percentile(value, values) * maximum) : 0,
    peerCount: values.length,
    unavailableReason: available
      ? null
      : !measured || !Number.isFinite(value)
        ? "missing_data"
        : formatConfirmed
          ? "insufficient_peers"
          : "unsupported_format",
  };
}

export function calculateVideoPerformanceScore(
  video: VideoSummary,
  cohort: VideoSummary[],
  now = Date.now(),
): VideoPerformanceScore {
  // Relative factors are meaningful only against other videos of a confirmed,
  // matching format. Never rank a Short against a long-form video or against itself.
  const formatConfirmed =
    video.contentType === "shorts" || video.contentType === "video";
  const peers = formatConfirmed
    ? cohort.filter(
        (item) => item.id !== video.id && item.contentType === video.contentType,
      )
    : [];
  const velocityMeasured =
    video.observedMinutes >= 5 &&
    Number.isFinite(video.observedViewsLastHour) &&
    video.observedViewsLastHour >= 0;
  const engagementMeasured =
    video.views > 0 &&
    Number.isFinite(video.views) &&
    Number.isFinite(video.likes) &&
    Number.isFinite(video.comments) &&
    video.likes >= 0 &&
    video.comments >= 0;
  const detailedAnalyticsAvailable =
    video.analyticsAvailable28Days &&
    video.analyticsDetailAvailable28Days !== false &&
    video.analyticsViews28Days > 0;
  const retentionAvailable =
    detailedAnalyticsAvailable &&
    Number.isFinite(video.averageViewPercentage28Days) &&
    video.averageViewPercentage28Days >= 0;
  const subscriberMeasured =
    video.analyticsAvailable28Days &&
    video.analyticsViews28Days > 0 &&
    Number.isFinite(video.subscribersGained28Days) &&
    Number.isFinite(video.subscribersLost28Days);
  const lifetimeMeasured =
    video.views > 0 &&
    Number.isFinite(video.views) &&
    Number.isFinite(Date.parse(video.publishedAt)) &&
    Date.parse(video.publishedAt) <= now;
  const watchTimeAvailable =
    detailedAnalyticsAvailable &&
    Number.isFinite(video.watchMinutes28Days) &&
    video.watchMinutes28Days >= 0;

  const velocity = hourlyPace(video);
  const interaction = engagementPercent(video);
  const retention = video.averageViewPercentage28Days;
  const subscribers = subscriberConversion(video);
  const pace = lifetimePace(video, now);
  const watchMinutes = watchTimePerView(video);

  const velocityScore = relativeFactor(
    velocityMeasured,
    velocity,
    peers,
    (item) =>
      item.observedMinutes >= 5 &&
      Number.isFinite(item.observedViewsLastHour) &&
      item.observedViewsLastHour >= 0,
    hourlyPace,
    25,
    formatConfirmed,
  );
  const engagementScore = relativeFactor(
    engagementMeasured,
    interaction,
    peers,
    (item) =>
      item.views > 0 &&
      Number.isFinite(item.likes) &&
      Number.isFinite(item.comments) &&
      item.likes >= 0 &&
      item.comments >= 0,
    engagementPercent,
    20,
    formatConfirmed,
  );
  const subscriberScore = relativeFactor(
    subscriberMeasured,
    subscribers,
    peers,
    (item) =>
      item.analyticsAvailable28Days &&
      item.analyticsViews28Days > 0 &&
      Number.isFinite(item.subscribersGained28Days) &&
      Number.isFinite(item.subscribersLost28Days),
    subscriberConversion,
    15,
    formatConfirmed,
  );
  const lifetimeScore = relativeFactor(
    lifetimeMeasured,
    pace,
    peers,
    (item) =>
      item.views > 0 &&
      Number.isFinite(item.views) &&
      Number.isFinite(Date.parse(item.publishedAt)) &&
      Date.parse(item.publishedAt) <= now,
    (item) => lifetimePace(item, now),
    10,
    formatConfirmed,
  );
  const watchTimeScore = relativeFactor(
    watchTimeAvailable,
    watchMinutes,
    peers,
    (item) =>
      item.analyticsAvailable28Days &&
      item.analyticsDetailAvailable28Days !== false &&
      item.analyticsViews28Days > 0 &&
      Number.isFinite(item.watchMinutes28Days) &&
      item.watchMinutes28Days >= 0,
    watchTimePerView,
    10,
    formatConfirmed,
  );

  const factors: VideoPerformanceFactor[] = [
    {
      id: "realtime-velocity",
      label: "Наблюдаемая скорость",
      ...velocityScore,
      max: 25,
      value: velocity,
      unit: "просмотров/ч",
      source: "observed_delta",
      explanation:
        "Перцентиль темпа среди как минимум 3 других видео того же формата; требуется 5 минут наблюдений.",
    },
    {
      id: "engagement",
      label: "Вовлечённость",
      ...engagementScore,
      max: 20,
      value: interaction,
      unit: "%",
      source: "youtube_data_api",
      explanation: "Перцентиль отношения (лайки + комментарии) / публичные просмотры.",
    },
    {
      id: "retention",
      label: "Среднее удержание",
      score: retentionAvailable ? Math.round(Math.min(1, retention / 70) * 20) : 0,
      max: 20,
      available: retentionAvailable,
      peerCount: 0,
      unavailableReason: retentionAvailable ? null : "missing_data",
      value: retention,
      unit: "%",
      source: "youtube_analytics_api",
      explanation:
        "Средний процент просмотра за доступный 28‑дневный период; 70% соответствует максимуму фактора.",
    },
    {
      id: "subscriber-conversion",
      label: "Конверсия в подписку",
      ...subscriberScore,
      max: 15,
      value: subscribers,
      unit: "чистых/1K",
      source: "youtube_analytics_api",
      explanation:
        "Перцентиль чистого прироста подписчиков на 1000 аналитических просмотров.",
    },
    {
      id: "lifetime-pace",
      label: "Темп за срок жизни",
      ...lifetimeScore,
      max: 10,
      value: pace,
      unit: "просмотров/день",
      source: "youtube_data_api",
      explanation:
        "Публичные просмотры делятся на возраст видео и сравниваются с другими публикациями канала.",
    },
    {
      id: "watch-time",
      label: "Время просмотра на просмотр",
      ...watchTimeScore,
      max: 10,
      value: watchMinutes,
      unit: "мин/просмотр",
      source: "youtube_analytics_api",
      explanation:
        "Перцентиль среднего времени просмотра относительно последних видео канала.",
    },
  ];
  const available = factors.filter((factor) => factor.available);
  const availableWeight = available.reduce((total, factor) => total + factor.max, 0);
  const earned = available.reduce((total, factor) => total + factor.score, 0);
  const total =
    availableWeight >= 70
      ? Math.max(0, Math.min(100, Math.round((earned / availableWeight) * 100)))
      : null;
  return {
    total,
    availableWeight,
    sameFormatPeers: peers.length,
    confidence:
      availableWeight >= 85 ? "high" : availableWeight >= 70 ? "medium" : "low",
    factors,
    formula:
      "Веса: скорость 25, вовлечённость 20, удержание 20, подписки 15, темп за срок жизни 10, время просмотра 10. Для относительных факторов нужны 3 других видео того же формата. Индекс показывается при полноте от 70/100; недоступные факторы исключаются из знаменателя.",
    calculatedAt: new Date(now).toISOString(),
  };
}
