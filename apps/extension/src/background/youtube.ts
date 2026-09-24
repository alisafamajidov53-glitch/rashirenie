import type {
  AnalyticsDay,
  AnalyticsBreakdownItem,
  ChannelSummary,
  CompetitorSnapshot,
  CompetitorVideo,
  DashboardData,
  RealtimePoint,
  RealtimeSource,
  SupportedLanguage,
  VideoSummary,
  VideoAnalyticsDetails,
  YouTubeComment,
} from "@channelpilot/shared";
import {
  breakdownShares,
  classifyCommentText,
  combineRealtimeObservations,
  fillAnalyticsDays,
  median,
} from "@channelpilot/shared";
import { observedStats, realtimeSeries, saveSamples } from "./realtime-store";

const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2";
const CHANNEL_SAMPLE_ID = "__channel_total__";

interface YouTubeList<T> {
  items?: T[];
}

interface ChannelResource {
  id: string;
  snippet: {
    title: string;
    thumbnails?: { default?: { url: string }; medium?: { url: string } };
  };
  statistics: {
    subscriberCount?: string;
    viewCount?: string;
    videoCount?: string;
  };
  contentDetails: {
    relatedPlaylists: { uploads: string };
  };
}

interface PlaylistItemResource {
  contentDetails: { videoId: string };
}

interface VideoResource {
  id: string;
  snippet: {
    title: string;
    description?: string;
    tags?: string[];
    publishedAt: string;
    categoryId?: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    thumbnails?: {
      maxres?: { url: string };
      standard?: { url: string };
      medium?: { url: string };
      high?: { url: string };
      default?: { url: string };
    };
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration?: string;
    caption?: string;
  };
}

interface SearchResource {
  id?: { channelId?: string };
}

interface CommentThreadResource {
  id: string;
  snippet: {
    videoId?: string;
    totalReplyCount?: number;
    topLevelComment?: {
      id?: string;
      snippet?: {
        authorDisplayName?: string;
        authorProfileImageUrl?: string;
        textOriginal?: string;
        publishedAt?: string;
        likeCount?: number;
      };
    };
  };
}

interface AnalyticsReport {
  columnHeaders?: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
}

interface VideoAnalytics28Days {
  detailAvailable: boolean;
  views: number;
  watchMinutes: number;
  averageViewPercentage: number;
  shares: number;
  subscribersGained: number;
  subscribersLost: number;
}

interface GoogleApiErrorBody {
  error?: {
    message?: unknown;
    errors?: Array<{ reason?: unknown }>;
    details?: Array<{ reason?: unknown }>;
  };
}

/**
 * Google's error envelope reduced to its message and reason codes.
 *
 * The whole JSON body used to become the error message, so the dashboard's
 * error banner showed forty lines of `{ "error": { "code": 403, ...`. The
 * reasons are kept because callers match on them (quotaExceeded,
 * accessNotConfigured, SERVICE_DISABLED, ACCESS_TOKEN_SCOPE_INSUFFICIENT).
 */
function describeApiError(body: string): { summary: string; reasons: string[] } {
  try {
    const parsed = JSON.parse(body) as GoogleApiErrorBody;
    const message = parsed.error?.message;
    if (typeof message === "string" && message) {
      const reasons = [
        ...new Set(
          [...(parsed.error?.errors ?? []), ...(parsed.error?.details ?? [])]
            .map((item) => item?.reason)
            .filter(
              (reason): reason is string => typeof reason === "string" && !!reason,
            ),
        ),
      ];
      return {
        summary: reasons.length ? `${message} (${reasons.join(", ")})` : message,
        reasons,
      };
    }
  } catch {
    // Not JSON (an HTML error page, a proxy message): fall through.
  }
  return { summary: body.replace(/\s+/g, " ").trim(), reasons: [] };
}

class YouTubeApiError extends Error {
  readonly status: number;
  /** Concise message with the reason codes, not the raw response body. */
  readonly detail: string;
  readonly reasons: string[];

  constructor(status: number, body: string) {
    const { summary, reasons } = describeApiError(body);
    super(`YouTube API ${status}: ${summary.slice(0, 600)}`);
    this.name = "YouTubeApiError";
    this.status = status;
    this.detail = summary;
    this.reasons = reasons;
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof YouTubeApiError && error.status === 401;
}

function analyticsWarning(
  scope: Record<SupportedLanguage, string>,
  error: unknown,
  language: SupportedLanguage,
): string {
  const detail =
    error instanceof YouTubeApiError
      ? error.detail
      : error instanceof Error
        ? error.message
        : String(error);
  return `${scope[language]}: ${detail.replace(/\s+/g, " ").slice(0, 320)}`;
}

async function youtubeFetch<T>(
  url: string,
  token: string,
  externalSignal?: AbortSignal,
): Promise<T> {
  // An AbortSignal that is already aborted never fires another "abort" event,
  // so a listener attached after the fact (below) would silently miss it and
  // let the request proceed uncancelled. This can happen here because the
  // caller may have awaited something (e.g. a token refresh) between the
  // signal aborting and this specific fetch starting.
  if (externalSignal?.aborted) {
    throw externalSignal.reason instanceof Error
      ? externalSignal.reason
      : new DOMException("The operation was aborted", "AbortError");
  }
  const controller = new AbortController();
  // A reasoned abort: without one fetch rejects with "signal is aborted
  // without reason", which is what the widget used to show for a slow network.
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("YouTube API request timed out", "TimeoutError"),
      ),
    20_000,
  );
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  try {
    // An empty token means a request authorized by an API key in the URL,
    // which must not carry an Authorization header as well.
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new YouTubeApiError(response.status, detail);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

function number(value?: string | number): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDurationSeconds(value?: string): number {
  if (!value) return 0;
  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/u,
  );
  if (!match) return 0;
  return Math.max(
    0,
    Math.round(
      number(match[1]) * 86_400 +
        number(match[2]) * 3_600 +
        number(match[3]) * 60 +
        number(match[4]),
    ),
  );
}

function thumbnailUrl(video: VideoResource): string {
  return (
    video.snippet.thumbnails?.maxres?.url ??
    video.snippet.thumbnails?.standard?.url ??
    video.snippet.thumbnails?.high?.url ??
    video.snippet.thumbnails?.medium?.url ??
    video.snippet.thumbnails?.default?.url ??
    ""
  );
}

function toDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function analyticsRange(days = 28): { startDate: string; endDate: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  return { startDate: toDate(start), endDate: toDate(end) };
}

function completePeriodViews(history: AnalyticsDay[]): number | null {
  const range = analyticsRange();
  if (
    history.length !== 28 ||
    history[0]?.date !== range.startDate ||
    history.at(-1)?.date !== range.endDate ||
    history.some((day) => !Number.isFinite(day.views) || day.views < 0)
  ) {
    return null;
  }
  return history.reduce((sum, day) => sum + day.views, 0);
}

function reportValue(
  report: AnalyticsReport,
  row: Array<string | number>,
  name: string,
  fallbackIndex: number,
): number {
  const headerIndex =
    report.columnHeaders?.findIndex((header) => header.name === name) ?? -1;
  return number(row[headerIndex >= 0 ? headerIndex : fallbackIndex]);
}

async function getChannel(
  token: string,
  language: SupportedLanguage,
): Promise<{
  summary: ChannelSummary;
  uploadsPlaylist: string;
}> {
  const query = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    mine: "true",
  });
  const response = await youtubeFetch<YouTubeList<ChannelResource>>(
    `${DATA_API}/channels?${query}`,
    token,
  );
  const channel = response.items?.[0];
  if (!channel) {
    throw new Error(
      language === "en"
        ? "No YouTube channel was found for this Google account"
        : "Для Google-аккаунта не найден YouTube-канал",
    );
  }
  return {
    summary: {
      id: channel.id,
      title: channel.snippet.title,
      avatarUrl:
        channel.snippet.thumbnails?.medium?.url ??
        channel.snippet.thumbnails?.default?.url ??
        "",
      subscribers: number(channel.statistics.subscriberCount),
      views: number(channel.statistics.viewCount),
      videos: number(channel.statistics.videoCount),
    },
    uploadsPlaylist: channel.contentDetails.relatedPlaylists.uploads,
  };
}

async function getRecentVideos(
  token: string,
  uploadsPlaylist: string,
): Promise<VideoSummary[]> {
  const playlistQuery = new URLSearchParams({
    part: "contentDetails",
    playlistId: uploadsPlaylist,
    maxResults: "50",
  });
  const playlist = await youtubeFetch<YouTubeList<PlaylistItemResource>>(
    `${DATA_API}/playlistItems?${playlistQuery}`,
    token,
  );
  const ids = (playlist.items ?? []).map((item) => item.contentDetails.videoId);
  if (ids.length === 0) return [];

  const videoQuery = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    id: ids.join(","),
  });
  const response = await youtubeFetch<YouTubeList<VideoResource>>(
    `${DATA_API}/videos?${videoQuery}`,
    token,
  );
  const byId = new Map((response.items ?? []).map((video) => [video.id, video]));
  return ids.flatMap((id) => {
    const video = byId.get(id);
    if (!video) return [];
    return [
      {
        id,
        title: video.snippet.title,
        description: video.snippet.description ?? "",
        tags: video.snippet.tags ?? [],
        thumbnailUrl: thumbnailUrl(video),
        publishedAt: video.snippet.publishedAt,
        durationSeconds: isoDurationSeconds(video.contentDetails?.duration),
        categoryId: video.snippet.categoryId ?? "",
        defaultLanguage:
          video.snippet.defaultLanguage ?? video.snippet.defaultAudioLanguage ?? "",
        captionsAvailable: video.contentDetails?.caption === "true",
        views: number(video.statistics.viewCount),
        likes: number(video.statistics.likeCount),
        comments: number(video.statistics.commentCount),
        observedViewsLastHour: 0,
        observedMinutes: 0,
        observedViewsLast24Hours: 0,
        observedMinutes24Hours: 0,
        observedViewsLast48Hours: 0,
        observedMinutes48Hours: 0,
        viewsLast15Minutes: 0,
        observedMinutesLast15: 0,
        viewsPerMinuteLast15: 0,
        previous15MinutesViews: 0,
        previousObservedMinutes15: 0,
        previousViewsPerMinute15: 0,
        velocityTrendPercent: 0,
        analyticsViews28Days: 0,
        watchMinutes28Days: 0,
        averageViewPercentage28Days: 0,
        shares28Days: 0,
        subscribersGained28Days: 0,
        subscribersLost28Days: 0,
        analyticsAvailable28Days: false,
      },
    ];
  });
}

async function getAnalyticsHistory(
  token: string,
  language: SupportedLanguage,
  videoId?: string,
  signal?: AbortSignal,
): Promise<{ data: AnalyticsDay[]; detailAvailable: boolean; warnings: string[] }> {
  const range = analyticsRange();
  const baseQuery = {
    ids: "channel==MINE",
    ...range,
    dimensions: "day",
    sort: "day",
    ...(videoId ? { filters: `video==${videoId}` } : {}),
  };
  try {
    const query = new URLSearchParams({
      ...baseQuery,
      metrics:
        "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost",
    });
    const report = await youtubeFetch<AnalyticsReport>(
      `${ANALYTICS_API}/reports?${query}`,
      token,
      signal,
    );
    const history = (report.rows ?? []).map((row) => ({
      date: String(row[0] ?? ""),
      views: number(row[1]),
      engagedViews: null,
      estimatedMinutesWatched: number(row[2]),
      averageViewDuration: number(row[3]),
      averageViewPercentage: number(row[4]),
      likes: number(row[5]),
      comments: number(row[6]),
      shares: number(row[7]),
      subscribersGained: number(row[8]),
      subscribersLost: number(row[9]),
    }));
    try {
      const engagedQuery = new URLSearchParams({
        ...baseQuery,
        metrics: "engagedViews",
      });
      const engagedReport = await youtubeFetch<AnalyticsReport>(
        `${ANALYTICS_API}/reports?${engagedQuery}`,
        token,
        signal,
      );
      const engagedByDate = new Map(
        (engagedReport.rows ?? []).map((row) => [String(row[0] ?? ""), number(row[1])]),
      );
      return {
        data: fillAnalyticsDays(
          history.map((day) => ({
            ...day,
            engagedViews: engagedByDate.get(day.date) ?? (day.views === 0 ? 0 : null),
          })),
          range.startDate,
          range.endDate,
        ),
        detailAvailable: true,
        warnings: [],
      };
    } catch (error) {
      if (signal?.aborted || isUnauthorized(error)) throw error;
      return {
        data: fillAnalyticsDays(history, range.startDate, range.endDate),
        detailAvailable: true,
        warnings: [],
      };
    }
  } catch (primaryError) {
    if (signal?.aborted || isUnauthorized(primaryError)) throw primaryError;
    try {
      const fallbackQuery = new URLSearchParams({
        ...baseQuery,
        metrics:
          "views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained,subscribersLost",
      });
      const report = await youtubeFetch<AnalyticsReport>(
        `${ANALYTICS_API}/reports?${fallbackQuery}`,
        token,
        signal,
      );
      return {
        data: fillAnalyticsDays(
          (report.rows ?? []).map((row) => ({
            date: String(row[0] ?? ""),
            views: number(row[1]),
            engagedViews: null,
            estimatedMinutesWatched: number(row[2]),
            averageViewDuration: number(row[3]),
            averageViewPercentage: null,
            likes: number(row[4]),
            comments: number(row[5]),
            shares: null,
            subscribersGained: number(row[6]),
            subscribersLost: number(row[7]),
          })),
          range.startDate,
          range.endDate,
        ).map((day) => ({
          ...day,
          averageViewPercentage: null,
          shares: null,
        })),
        detailAvailable: false,
        warnings: [
          language === "ru"
            ? "Среднее удержание и репосты недоступны: YouTube вернул сокращённый отчёт."
            : "Average retention and shares are unavailable: YouTube returned a reduced report.",
        ],
      };
    } catch (fallbackError) {
      if (signal?.aborted || isUnauthorized(fallbackError)) throw fallbackError;
      return {
        data: [],
        detailAvailable: false,
        warnings: [
          analyticsWarning(
            {
              ru: "История YouTube Analytics недоступна",
              en: "YouTube Analytics history is unavailable",
            },
            fallbackError,
            language,
          ),
        ],
      };
    }
  }
}

async function getVideoAnalytics(
  token: string,
  videoIds: string[],
  language: SupportedLanguage,
): Promise<{
  data: Map<string, VideoAnalytics28Days>;
  warnings: string[];
}> {
  if (videoIds.length === 0) return { data: new Map(), warnings: [] };
  const range = analyticsRange();
  const metricSets = [
    [
      "views",
      "estimatedMinutesWatched",
      "averageViewPercentage",
      "shares",
      "subscribersGained",
      "subscribersLost",
    ],
    ["views", "subscribersGained", "subscribersLost"],
  ];
  let lastError: unknown;
  for (const metrics of metricSets) {
    try {
      const batches = Array.from(
        { length: Math.ceil(videoIds.length / 25) },
        (_, index) => videoIds.slice(index * 25, index * 25 + 25),
      );
      const reports = await Promise.all(
        batches.map((batch) => {
          const query = new URLSearchParams({
            ids: "channel==MINE",
            ...range,
            dimensions: "video",
            filters: `video==${batch.join(",")}`,
            metrics: metrics.join(","),
            sort: "-views",
            maxResults: String(batch.length),
          });
          return youtubeFetch<AnalyticsReport>(
            `${ANALYTICS_API}/reports?${query}`,
            token,
          );
        }),
      );
      const data = new Map<string, VideoAnalytics28Days>();
      for (const report of reports) {
        const fallbackIndex = (metric: string) => {
          const index = metrics.indexOf(metric);
          return index >= 0 ? index + 1 : Number.MAX_SAFE_INTEGER;
        };
        for (const row of report.rows ?? []) {
          const id = String(row[0] ?? "");
          if (!videoIds.includes(id)) continue;
          data.set(id, {
            detailAvailable: metrics.includes("averageViewPercentage"),
            views: reportValue(report, row, "views", fallbackIndex("views")),
            watchMinutes: reportValue(
              report,
              row,
              "estimatedMinutesWatched",
              fallbackIndex("estimatedMinutesWatched"),
            ),
            averageViewPercentage: reportValue(
              report,
              row,
              "averageViewPercentage",
              fallbackIndex("averageViewPercentage"),
            ),
            shares: reportValue(report, row, "shares", fallbackIndex("shares")),
            subscribersGained: reportValue(
              report,
              row,
              "subscribersGained",
              fallbackIndex("subscribersGained"),
            ),
            subscribersLost: reportValue(
              report,
              row,
              "subscribersLost",
              fallbackIndex("subscribersLost"),
            ),
          });
        }
      }
      return {
        data,
        warnings: metrics.includes("averageViewPercentage")
          ? []
          : [
              language === "ru"
                ? "Удержание, время просмотра и репосты по отдельным видео недоступны: YouTube вернул сокращённый отчёт."
                : "Per-video retention, watch time and shares are unavailable: YouTube returned a reduced report.",
            ],
      };
    } catch (error) {
      if (isUnauthorized(error)) throw error;
      lastError = error;
      // Some channels do not expose every optional metric. Retry with the
      // core subscription metrics before gracefully returning no attribution.
    }
  }
  return {
    data: new Map(),
    warnings: [
      analyticsWarning(
        {
          ru: "Атрибуция подписчиков по видео недоступна",
          en: "Per-video subscriber attribution is unavailable",
        },
        lastError,
        language,
      ),
    ],
  };
}

type BreakdownDimension =
  "insightTrafficSourceType" | "country" | "deviceType" | "subscribedStatus";

const BREAKDOWN_LABELS: Record<
  Exclude<BreakdownDimension, "country">,
  Record<string, Record<SupportedLanguage, string>>
> = {
  insightTrafficSourceType: {
    YT_SEARCH: { ru: "Поиск YouTube", en: "YouTube Search" },
    RELATED_VIDEO: { ru: "Похожие видео", en: "Suggested videos" },
    SHORTS: { ru: "Лента Shorts", en: "Shorts feed" },
    SUBSCRIBER: { ru: "Подписки и главная", en: "Subscriptions & home" },
    EXT_URL: { ru: "Внешние сайты", en: "External" },
    PLAYLIST: { ru: "Плейлисты", en: "Playlists" },
    NOTIFICATION: { ru: "Уведомления", en: "Notifications" },
    END_SCREEN: { ru: "Конечные заставки", en: "End screens" },
    YT_CHANNEL: { ru: "Страницы каналов", en: "Channel pages" },
    NO_LINK_OTHER: { ru: "Прямые и другие", en: "Direct & other" },
    // Less frequent types used to fall through to the lowercased enum name,
    // so the list read "yt other page" next to "Поиск YouTube".
    YT_OTHER_PAGE: { ru: "Другие страницы YouTube", en: "Other YouTube pages" },
    YT_PLAYLIST_PAGE: { ru: "Страницы плейлистов", en: "Playlist pages" },
    NO_LINK_EMBEDDED: { ru: "Встроенный плеер", en: "Embedded player" },
    ADVERTISING: { ru: "Реклама на YouTube", en: "YouTube advertising" },
    PROMOTED: { ru: "Продвижение", en: "Promoted" },
    HASHTAGS: { ru: "Страницы хештегов", en: "Hashtag pages" },
    SOUND_PAGE: { ru: "Страницы звуков", en: "Sound pages" },
    VIDEO_REMIXES: { ru: "Ремиксы", en: "Remixes" },
    SHORTS_CONTENT_LINKS: { ru: "Ссылки из Shorts", en: "Shorts content links" },
    CAMPAIGN_CARD: { ru: "Карточки кампаний", en: "Campaign cards" },
    ANNOTATION: { ru: "Аннотации", en: "Annotations" },
    LIVE_REDIRECT: { ru: "Переходы с трансляций", en: "Live redirects" },
    PRODUCT_PAGE: { ru: "Страницы товаров", en: "Product pages" },
  },
  deviceType: {
    DESKTOP: { ru: "Компьютер", en: "Desktop" },
    MOBILE: { ru: "Телефон", en: "Mobile" },
    TABLET: { ru: "Планшет", en: "Tablet" },
    TV: { ru: "Телевизор", en: "TV" },
    GAME_CONSOLE: { ru: "Игровая консоль", en: "Game console" },
    AUTOMOTIVE: { ru: "Автомобиль", en: "Automotive" },
    WEARABLE: { ru: "Носимое устройство", en: "Wearable" },
    UNKNOWN_PLATFORM: { ru: "Неизвестно", en: "Unknown" },
  },
  subscribedStatus: {
    SUBSCRIBED: { ru: "Подписанные зрители", en: "Subscribed viewers" },
    UNSUBSCRIBED: { ru: "Неподписанные зрители", en: "Not subscribed" },
  },
};

export function breakdownLabel(
  dimension: BreakdownDimension,
  key: string,
  language: SupportedLanguage,
): string {
  if (dimension === "country") {
    // "Россия", not "RU": the country list was the one breakdown still showing
    // raw API codes. ZZ (unknown region) and malformed codes keep the code.
    const code = key.toUpperCase();
    try {
      const name = new Intl.DisplayNames([language], { type: "region" }).of(code);
      return name && name !== code && code !== "ZZ" ? name : code;
    } catch {
      return code;
    }
  }
  return (
    BREAKDOWN_LABELS[dimension][key]?.[language] ??
    key.replaceAll("_", " ").toLocaleLowerCase()
  );
}

async function getAnalyticsBreakdown(
  token: string,
  dimension: BreakdownDimension,
  language: SupportedLanguage,
  videoId?: string,
  signal?: AbortSignal,
): Promise<AnalyticsBreakdownItem[]> {
  const query = new URLSearchParams({
    ids: "channel==MINE",
    ...analyticsRange(),
    dimensions: dimension,
    ...(videoId ? { filters: `video==${videoId}` } : {}),
    metrics: "views,estimatedMinutesWatched",
    sort: "-views",
    maxResults: dimension === "country" ? "15" : "20",
  });
  const report = await youtubeFetch<AnalyticsReport>(
    `${ANALYTICS_API}/reports?${query}`,
    token,
    signal,
  );
  const rows = (report.rows ?? []).map((row) => ({
    key: String(row[0] ?? ""),
    label: breakdownLabel(dimension, String(row[0] ?? ""), language),
    views: reportValue(report, row, "views", 1),
    estimatedMinutesWatched: reportValue(report, row, "estimatedMinutesWatched", 2),
    share: 0,
  }));
  return breakdownShares(rows, null);
}

async function getAnalyticsBreakdowns(
  token: string,
  language: SupportedLanguage,
): Promise<{
  trafficSources: AnalyticsBreakdownItem[];
  countries: AnalyticsBreakdownItem[];
  devices: AnalyticsBreakdownItem[];
  subscribedStatus: AnalyticsBreakdownItem[];
  warnings: string[];
}> {
  const dimensions: BreakdownDimension[] = [
    "insightTrafficSourceType",
    "country",
    "deviceType",
    "subscribedStatus",
  ];
  const results = await Promise.allSettled(
    dimensions.map((dimension) => getAnalyticsBreakdown(token, dimension, language)),
  );
  const unauthorized = results.find(
    (result) => result.status === "rejected" && isUnauthorized(result.reason),
  );
  if (unauthorized?.status === "rejected") throw unauthorized.reason;
  const value = (dimension: BreakdownDimension) => {
    const index = dimensions.indexOf(dimension);
    const result = results[index];
    return result?.status === "fulfilled" ? result.value : [];
  };
  const warnings = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          analyticsWarning(
            {
              ru: `Разбивка Analytics «${dimensions[index]}» недоступна`,
              en: `Analytics breakdown “${dimensions[index]}” is unavailable`,
            },
            result.reason,
            language,
          ),
        ]
      : [],
  );
  return {
    trafficSources: value("insightTrafficSourceType"),
    countries: value("country"),
    devices: value("deviceType"),
    subscribedStatus: value("subscribedStatus"),
    warnings,
  };
}

export interface RealtimeDashboardSnapshot {
  channel: ChannelSummary;
  channelObservedViewsLastHour: number;
  channelObservedMinutes: number;
  channelRealtimeSource: RealtimeSource;
  channelObservedViewsLast24Hours: number;
  channelObservedMinutes24Hours: number;
  channelRealtimeSource24Hours: RealtimeSource;
  channelObservedViewsLast48Hours: number;
  channelObservedMinutes48Hours: number;
  channelRealtimeSource48Hours: RealtimeSource;
  videos: VideoSummary[];
  realtimeSeries: RealtimePoint[];
  sampledAt: string;
  realtimeWarmup: boolean;
}

export async function collectRealtime(
  token: string,
  language: SupportedLanguage = "ru",
): Promise<RealtimeDashboardSnapshot> {
  const { summary: channel, uploadsPlaylist } = await getChannel(token, language);
  let videos = await getRecentVideos(token, uploadsPlaylist);
  const samples = await saveSamples(
    [
      { id: CHANNEL_SAMPLE_ID, views: channel.views },
      ...videos.map((video) => ({ id: video.id, views: video.views })),
    ],
    Date.now(),
    channel.id,
  );
  const observed = observedStats(samples, [
    CHANNEL_SAMPLE_ID,
    ...videos.map((video) => video.id),
  ]);
  const channelObserved = observed[CHANNEL_SAMPLE_ID] ?? {
    views: 0,
    observedMinutes: 0,
    viewsLast24Hours: 0,
    observedMinutes24Hours: 0,
    viewsLast48Hours: 0,
    observedMinutes48Hours: 0,
    viewsLast15Minutes: 0,
    observedMinutesLast15: 0,
    viewsPerMinuteLast15: 0,
    previous15MinutesViews: 0,
    previousObservedMinutes15: 0,
    previousViewsPerMinute15: 0,
    velocityTrendPercent: 0,
  };
  const channelRealtimeSeries = realtimeSeries(samples, [CHANNEL_SAMPLE_ID]);
  videos = videos.map((video) => ({
    ...video,
    observedViewsLastHour: observed[video.id]?.views ?? 0,
    observedMinutes: observed[video.id]?.observedMinutes ?? 0,
    observedViewsLast24Hours: observed[video.id]?.viewsLast24Hours ?? 0,
    observedMinutes24Hours: observed[video.id]?.observedMinutes24Hours ?? 0,
    observedViewsLast48Hours: observed[video.id]?.viewsLast48Hours ?? 0,
    observedMinutes48Hours: observed[video.id]?.observedMinutes48Hours ?? 0,
    viewsLast15Minutes: observed[video.id]?.viewsLast15Minutes ?? 0,
    observedMinutesLast15: observed[video.id]?.observedMinutesLast15 ?? 0,
    viewsPerMinuteLast15: observed[video.id]?.viewsPerMinuteLast15 ?? 0,
    previous15MinutesViews: observed[video.id]?.previous15MinutesViews ?? 0,
    previousObservedMinutes15: observed[video.id]?.previousObservedMinutes15 ?? 0,
    previousViewsPerMinute15: observed[video.id]?.previousViewsPerMinute15 ?? 0,
    velocityTrendPercent: observed[video.id]?.velocityTrendPercent ?? 0,
  }));
  const hourObservation = combineRealtimeObservations(
    {
      views: channelObserved.views,
      observedMinutes: channelObserved.observedMinutes,
    },
    videos.map((video) => ({
      views: video.observedViewsLastHour,
      observedMinutes: video.observedMinutes,
    })),
  );
  const dayObservation = combineRealtimeObservations(
    {
      views: channelObserved.viewsLast24Hours,
      observedMinutes: channelObserved.observedMinutes24Hours,
    },
    videos.map((video) => ({
      views: video.observedViewsLast24Hours,
      observedMinutes: video.observedMinutes24Hours,
    })),
  );
  const twoDayObservation = combineRealtimeObservations(
    {
      views: channelObserved.viewsLast48Hours,
      observedMinutes: channelObserved.observedMinutes48Hours,
    },
    videos.map((video) => ({
      views: observed[video.id]?.viewsLast48Hours ?? 0,
      observedMinutes: observed[video.id]?.observedMinutes48Hours ?? 0,
    })),
  );
  // Only the channel-wide public counter covers all videos. Summing a moving
  // list of absolute totals creates artificial spikes whenever a video enters
  // or leaves it. Per-video rolling deltas are safe to use as a faster lower
  // bound, though: select the larger delta instead of adding both sources.
  return {
    channel,
    channelObservedViewsLastHour: hourObservation.views,
    channelObservedMinutes: hourObservation.observedMinutes,
    channelRealtimeSource: hourObservation.source,
    channelObservedViewsLast24Hours: dayObservation.views,
    channelObservedMinutes24Hours: dayObservation.observedMinutes,
    channelRealtimeSource24Hours: dayObservation.source,
    channelObservedViewsLast48Hours: twoDayObservation.views,
    channelObservedMinutes48Hours: twoDayObservation.observedMinutes,
    channelRealtimeSource48Hours: twoDayObservation.source,
    videos,
    realtimeSeries: channelRealtimeSeries,
    sampledAt: new Date().toISOString(),
    realtimeWarmup: hourObservation.observedMinutes < 60,
  };
}

async function getVideoFormats(
  token: string,
  videoIds: string[],
  language: SupportedLanguage,
): Promise<{
  data: Map<string, NonNullable<VideoSummary["contentType"]>>;
  warnings: string[];
}> {
  const data = new Map<string, NonNullable<VideoSummary["contentType"]>>();
  try {
    // Query confirmed content types, not duration-based guesses. A single video
    // may have several report rows; conflicting classifications stay unknown.
    for (let offset = 0; offset < videoIds.length; offset += 25) {
      const ids = videoIds.slice(offset, offset + 25);
      const query = new URLSearchParams({
        ids: "channel==MINE",
        ...analyticsRange(),
        dimensions: "video,creatorContentType",
        metrics: "views",
        filters: `video==${ids.join(",")}`,
        sort: "-views",
        maxResults: "200",
      });
      const report = await youtubeFetch<AnalyticsReport>(
        `${ANALYTICS_API}/reports?${query}`,
        token,
      );
      for (const row of report.rows ?? []) {
        const id = String(row[0]);
        if (!ids.includes(id)) continue;
        const type =
          row[1] === "SHORTS"
            ? "shorts"
            : row[1] === "VIDEO_ON_DEMAND"
              ? "video"
              : "other";
        data.set(id, data.has(id) && data.get(id) !== type ? "unknown" : type);
      }
    }
    return { data, warnings: [] };
  } catch (error) {
    if (isUnauthorized(error)) throw error;
    return {
      data,
      warnings: [
        language === "ru"
          ? "Тип части видео не подтверждён Analytics. Они показаны отдельно."
          : "Analytics could not confirm some video types. They are shown separately.",
      ],
    };
  }
}

export async function getVideoAnalyticsDetails(
  token: string,
  videoId: string,
  language: SupportedLanguage,
  signal?: AbortSignal,
): Promise<VideoAnalyticsDetails> {
  const history = await getAnalyticsHistory(token, language, videoId, signal);
  let trafficSources: AnalyticsBreakdownItem[] = [];
  const warnings = [...history.warnings];
  try {
    trafficSources = await getAnalyticsBreakdown(
      token,
      "insightTrafficSourceType",
      language,
      videoId,
      signal,
    );
  } catch (error) {
    if (signal?.aborted || isUnauthorized(error)) throw error;
    warnings.push(
      language === "ru"
        ? "Источники трафика этого видео недоступны."
        : "Traffic sources for this video are unavailable.",
    );
  }
  return {
    videoId,
    historyDetailAvailable: history.detailAvailable,
    history: history.data,
    trafficSources: breakdownShares(trafficSources, completePeriodViews(history.data)),
    warnings,
    sampledAt: new Date().toISOString(),
  };
}

export async function getDashboard(
  token: string,
  language: SupportedLanguage = "ru",
): Promise<DashboardData> {
  const realtime = await collectRealtime(token, language);
  let videos = realtime.videos;
  const [historyResult, videoAnalyticsResult, breakdowns, formats] = await Promise.all([
    getAnalyticsHistory(token, language),
    getVideoAnalytics(
      token,
      videos.map((video) => video.id),
      language,
    ),
    getAnalyticsBreakdowns(token, language),
    getVideoFormats(
      token,
      videos.map((video) => video.id),
      language,
    ),
  ]);
  const history = historyResult.data;
  const fullPeriodViews = completePeriodViews(history);
  const videoAnalytics = videoAnalyticsResult.data;
  videos = videos.map((video) => {
    video = { ...video, contentType: formats.data.get(video.id) ?? "unknown" };
    const analytics = videoAnalytics.get(video.id);
    return analytics
      ? {
          ...video,
          analyticsViews28Days: analytics.views,
          watchMinutes28Days: analytics.watchMinutes,
          averageViewPercentage28Days: analytics.averageViewPercentage,
          shares28Days: analytics.shares,
          subscribersGained28Days: analytics.subscribersGained,
          subscribersLost28Days: analytics.subscribersLost,
          analyticsAvailable28Days: true,
          analyticsDetailAvailable28Days: analytics.detailAvailable,
        }
      : video;
  });

  return {
    ...realtime,
    videos,
    history,
    historyDetailAvailable: historyResult.detailAvailable,
    analyticsSampledAt: new Date().toISOString(),
    trafficSources: breakdownShares(breakdowns.trafficSources, fullPeriodViews),
    countries: breakdownShares(breakdowns.countries, fullPeriodViews),
    devices: breakdownShares(breakdowns.devices, fullPeriodViews),
    subscribedStatus: breakdownShares(breakdowns.subscribedStatus, fullPeriodViews),
    analyticsWarnings: [
      ...historyResult.warnings,
      ...videoAnalyticsResult.warnings,
      ...breakdowns.warnings,
      ...formats.warnings,
    ],
  };
}

export function channelLookup(
  value: string,
):
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "search"; value: string } {
  let query = value.trim().slice(0, 300);
  // A non-Latin handle copied from the address bar arrives percent-encoded
  // (youtube.com/@%D0%9C…). Undecoded it matched no handle pattern and fell
  // through to search.list, which costs 100 quota units instead of 1.
  try {
    query = decodeURIComponent(query);
  } catch {
    // A literal "%" in a plain search phrase is not an encoding; keep it.
  }
  const idMatch = query.match(/(?:^|\/channel\/)(UC[\w-]{20,30})(?:$|[/?#])/u);
  if (idMatch?.[1]) return { kind: "id", value: idMatch[1] };
  const handleMatch = query.match(/(?:^@|youtube\.com\/@)([\p{L}\p{N}_.-]{3,100})/iu);
  if (handleMatch?.[1]) return { kind: "handle", value: handleMatch[1] };
  if (/^UC[\w-]{20,30}$/u.test(query)) {
    return { kind: "id", value: query };
  }
  return { kind: "search", value: query };
}

async function resolveCompetitorChannelId(
  token: string,
  input: string,
  language: SupportedLanguage,
  signal?: AbortSignal,
): Promise<string> {
  const lookup = channelLookup(input);
  if (!lookup.value) {
    throw new Error(
      language === "en"
        ? "Enter a YouTube channel name or URL"
        : "Введите название или ссылку на YouTube-канал",
    );
  }
  if (lookup.kind === "id") return lookup.value;
  if (lookup.kind === "handle") {
    const query = new URLSearchParams({
      part: "id",
      forHandle: lookup.value,
    });
    const response = await youtubeFetch<YouTubeList<{ id: string }>>(
      `${DATA_API}/channels?${query}`,
      token,
      signal,
    );
    const id = response.items?.[0]?.id;
    if (id) return id;
  }
  const query = new URLSearchParams({
    part: "snippet",
    type: "channel",
    q: lookup.value,
    maxResults: "1",
  });
  const response = await youtubeFetch<YouTubeList<SearchResource>>(
    `${DATA_API}/search?${query}`,
    token,
    signal,
  );
  const id = response.items?.[0]?.id?.channelId;
  if (!id) {
    throw new Error(
      language === "en" ? "YouTube channel was not found" : "YouTube-канал не найден",
    );
  }
  return id;
}

async function getVideoResources(
  token: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<VideoResource[]> {
  if (ids.length === 0) return [];
  const query = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    id: ids.slice(0, 50).join(","),
  });
  const response = await youtubeFetch<YouTubeList<VideoResource>>(
    `${DATA_API}/videos?${query}`,
    token,
    signal,
  );
  return response.items ?? [];
}

export async function getCompetitorSnapshot(
  token: string,
  input: string,
  language: SupportedLanguage = "ru",
  signal?: AbortSignal,
): Promise<CompetitorSnapshot> {
  const channelId = await resolveCompetitorChannelId(token, input, language, signal);
  const channelQuery = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    id: channelId,
  });
  const channelResponse = await youtubeFetch<YouTubeList<ChannelResource>>(
    `${DATA_API}/channels?${channelQuery}`,
    token,
    signal,
  );
  const channel = channelResponse.items?.[0];
  if (!channel) {
    throw new Error(
      language === "en"
        ? "The competitor channel is unavailable"
        : "Канал конкурента недоступен",
    );
  }
  const playlistQuery = new URLSearchParams({
    part: "contentDetails",
    playlistId: channel.contentDetails.relatedPlaylists.uploads,
    maxResults: "20",
  });
  const playlist = await youtubeFetch<YouTubeList<PlaylistItemResource>>(
    `${DATA_API}/playlistItems?${playlistQuery}`,
    token,
    signal,
  );
  const ids = (playlist.items ?? []).map((item) => item.contentDetails.videoId);
  const resources = await getVideoResources(token, ids, signal);
  const byId = new Map(resources.map((video) => [video.id, video]));
  const recentVideos: CompetitorVideo[] = ids.flatMap((id) => {
    const video = byId.get(id);
    if (!video) return [];
    return [
      {
        id,
        title: video.snippet.title,
        thumbnailUrl: thumbnailUrl(video),
        publishedAt: video.snippet.publishedAt,
        durationSeconds: isoDurationSeconds(video.contentDetails?.duration),
        views: number(video.statistics.viewCount),
        likes: number(video.statistics.likeCount),
        comments: number(video.statistics.commentCount),
      },
    ];
  });
  const cutoff = Date.now() - 30 * 86_400_000;
  return {
    channel: {
      id: channel.id,
      title: channel.snippet.title,
      avatarUrl:
        channel.snippet.thumbnails?.medium?.url ??
        channel.snippet.thumbnails?.default?.url ??
        "",
      subscribers: number(channel.statistics.subscriberCount),
      views: number(channel.statistics.viewCount),
      videos: number(channel.statistics.videoCount),
    },
    recentVideos,
    averageViews: recentVideos.length
      ? Math.round(
          recentVideos.reduce((sum, video) => sum + video.views, 0) /
            recentVideos.length,
        )
      : 0,
    medianViews: Math.round(median(recentVideos.map((video) => video.views))),
    uploadsLast30Days: recentVideos.filter(
      (video) => Date.parse(video.publishedAt) >= cutoff,
    ).length,
    fetchedAt: new Date().toISOString(),
    source: "youtube_public_api",
  };
}

/** Plain-language errors for the comment request, which a creator can act on. */
function commentsError(error: unknown, language: SupportedLanguage): unknown {
  if (!(error instanceof YouTubeApiError)) return error;
  const has = (...reasons: string[]) =>
    reasons.some((reason) => error.reasons.includes(reason));
  const message = (ru: string, en: string) => new Error(language === "en" ? en : ru);
  if (has("commentsDisabled")) {
    return message(
      "Комментарии к этому видео отключены.",
      "Comments are turned off for this video.",
    );
  }
  if (has("videoNotFound")) {
    return message(
      "YouTube не нашёл это видео — возможно, оно удалено или стало приватным.",
      "YouTube could not find this video — it may have been deleted or made private.",
    );
  }
  if (has("API_KEY_INVALID", "keyInvalid", "keyExpired", "API_KEY_EXPIRED")) {
    return message(
      "Ключ YouTube Data API недействителен. Проверьте его в разделе «Подключения».",
      "The YouTube Data API key is not valid. Check it under Connections.",
    );
  }
  if (has("accessNotConfigured", "SERVICE_DISABLED", "API_KEY_SERVICE_BLOCKED")) {
    return message(
      "Этому ключу недоступен YouTube Data API v3: включите API в проекте ключа или разрешите его в ограничениях ключа.",
      "YouTube Data API v3 is not available to this key: enable the API in the key's project or allow it in the key's restrictions.",
    );
  }
  if (
    has(
      "API_KEY_HTTP_REFERRER_BLOCKED",
      "API_KEY_IP_ADDRESS_BLOCKED",
      "API_KEY_ANDROID_APP_BLOCKED",
      "API_KEY_IOS_APP_BLOCKED",
    )
  ) {
    return message(
      "Ключ ограничен по сайтам или IP-адресам — Chrome-расширение под такие ограничения не подходит. Ограничьте ключ по API (YouTube Data API v3).",
      "The key is restricted to websites or IP addresses, which a Chrome extension cannot match. Restrict it by API (YouTube Data API v3) instead.",
    );
  }
  if (has("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded")) {
    return message(
      "Квота YouTube Data API для этого ключа исчерпана. Попробуйте позже.",
      "The YouTube Data API quota for this key is used up. Try again later.",
    );
  }
  return error;
}

/**
 * Public comments of one video, read with an API key.
 *
 * commentThreads.list refuses the extension's read-only OAuth token with
 * ACCESS_TOKEN_SCOPE_INSUFFICIENT: for comments Google only accepts the
 * read-write youtube.force-ssl scope. Asking every creator for write access to
 * their channel in order to *read* comments is the wrong trade, so the grant
 * stays read-only and public comments are read with a key instead.
 */
export async function getVideoComments(
  apiKey: string,
  videoId: string,
  language: SupportedLanguage = "ru",
  signal?: AbortSignal,
): Promise<YouTubeComment[]> {
  if (!/^[\w-]{6,32}$/u.test(videoId)) {
    throw new Error("Invalid YouTube video ID");
  }
  const query = new URLSearchParams({
    part: "snippet",
    videoId,
    maxResults: "100",
    order: "time",
    textFormat: "plainText",
    key: apiKey,
  });
  let response: YouTubeList<CommentThreadResource>;
  try {
    response = await youtubeFetch<YouTubeList<CommentThreadResource>>(
      `${DATA_API}/commentThreads?${query}`,
      "",
      signal,
    );
  } catch (error) {
    throw commentsError(error, language);
  }
  return (response.items ?? []).flatMap((thread) => {
    const comment = thread.snippet.topLevelComment;
    const snippet = comment?.snippet;
    const id = comment?.id ?? thread.id;
    const text = snippet?.textOriginal?.trim().slice(0, 10_000) ?? "";
    if (!id || !text) return [];
    return [
      {
        id,
        videoId: thread.snippet.videoId ?? videoId,
        authorDisplayName: snippet?.authorDisplayName?.trim().slice(0, 200) ?? "",
        authorProfileImageUrl: snippet?.authorProfileImageUrl?.slice(0, 2_048) ?? "",
        text,
        publishedAt: snippet?.publishedAt ?? "",
        likeCount: number(snippet?.likeCount),
        replyCount: number(thread.snippet.totalReplyCount),
        ...classifyCommentText(text),
      },
    ];
  });
}
