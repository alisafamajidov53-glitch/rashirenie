import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AiModelCatalog,
  AiProvider,
  AnalysisResult,
  DashboardData,
  DashboardPage,
  ExtensionSettings,
  GoogleAuthStatus,
  GoogleSignInResult,
  RealtimeCollectorStatus,
  RealtimeSource,
  SupportedLanguage,
  TitleGenerationMode,
  VideoSummary,
  WorkspaceState,
} from "@channelpilot/shared";
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WORKSPACE_STATE,
  diffExtensionSettings,
  GEMINI_MODEL_OPTIONS,
  GROQ_MODEL_OPTIONS,
  TWELVELABS_MODEL_OPTIONS,
  formatMetric,
  formatPercent,
  formatExactMetric,
  formatSignedMetric,
  PANEL_TRANSPARENCY_RANGE,
  protectSpreadsheetCell,
  analyticsChartDomain,
  compareAnalyticsValues,
  isGoogleClientId,
  normalizeExtensionSettings,
  normalizeWorkspaceState,
  WORKSPACE_STORAGE_KEY,
  calculateVideoPerformanceScore,
  dailyPace,
  engagementPercent,
  hourlyPace,
  median,
  percentChange,
  realtimeWindowCoverage,
  inContentCohort,
  buildChannelStyleContext,
  youtubeVideoIdFromUrl,
  DASHBOARD_PAGE_REQUEST_KEY,
  readDashboardPageRequest,
  type ContentCohort,
  type VideoContext,
} from "@channelpilot/shared";
import {
  analyzeMediaDirect,
  analyzeTextDirect,
  analyzeYouTubeVideoDirect,
} from "../lib/ai-direct";
import { rpc } from "../lib/rpc";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useInterfacePreferences } from "../hooks/useInterfacePreferences";
import {
  CommentsPage,
  CompetitorsPage,
  contentIdeasFromResult,
  IDEA_LIMIT,
  IdeasPage,
  PlannerPage,
  SeoPage,
} from "./workspace-pages";
import "./options.css";
import { DashboardNavigation, DashboardTopbar } from "./dashboard-chrome";
import {
  AnalyticsTrust,
  AnalyticsBreakdowns,
  PeriodComparison,
  ContentFormatFilter,
  VideoDetailsDialog,
} from "./analytics-panels";
import {
  performanceScoreTooltip,
  performanceScoreValue,
  videoMomentum,
  videoMomentumLabel,
} from "./analytics-presentation";
import { WidgetCompositionEditor } from "./widget-composition";
import { ThumbnailEditor } from "./thumbnail-editor";
import { formatTimestamp, matchesSearch, type ThumbnailFormat } from "./editor-utils";

type Page = DashboardPage;
type MetricPeriod = "60m" | "24h" | "all";
type TestResult = Record<
  "gemini" | "groq" | "twelveLabs",
  { ok: boolean; message: string }
>;
type NavIconName = DashboardPage;

const NAVIGATION: Array<[Page, Record<SupportedLanguage, string>, NavIconName]> = [
  ["overview", { ru: "Обзор", en: "Overview" }, "overview"],
  ["videos", { ru: "Видео и рост", en: "Videos & growth" }, "videos"],
  ["competitors", { ru: "Конкуренты", en: "Competitors" }, "competitors"],
  ["ideas", { ru: "Идеи", en: "Ideas" }, "ideas"],
  ["planner", { ru: "Планер", en: "Planner" }, "planner"],
  ["comments", { ru: "Комментарии", en: "Comments" }, "comments"],
  ["seo", { ru: "SEO-чеклист", en: "SEO checklist" }, "seo"],
  ["ai", { ru: "AI Studio", en: "AI Studio" }, "ai"],
  ["thumbnail", { ru: "Редактор превью", en: "Thumbnail editor" }, "thumbnail"],
  ["settings", { ru: "Подключения", en: "Connections" }, "settings"],
];

function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
      {name === "overview" && (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
          <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.7" />
          <rect x="13.5" y="10.5" width="7" height="10" rx="2" />
          <rect x="3.5" y="13" width="7" height="7.5" rx="2" />
        </>
      )}
      {name === "videos" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m10 9 5 3-5 3V9Z" />
        </>
      )}
      {name === "competitors" && (
        <>
          <path d="M16.5 20v-1.7a3.8 3.8 0 0 0-3.8-3.8H7.3a3.8 3.8 0 0 0-3.8 3.8V20" />
          <circle cx="10" cy="7.5" r="3.5" />
          <path d="M17 4.3a3.5 3.5 0 0 1 0 6.8M20.5 20v-1.7a3.8 3.8 0 0 0-2.8-3.65" />
        </>
      )}
      {name === "ideas" && (
        <>
          <path d="M9 18h6M9.5 21h5" />
          <path d="M8.2 15.3A6.6 6.6 0 1 1 15.8 15c-.65.5-.8 1.2-.8 2H9c0-.75-.2-1.25-.8-1.7Z" />
        </>
      )}
      {name === "planner" && (
        <>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M8 3v4M16 3v4M3 10h18M7 14h3M14 14h3M7 17.5h3" />
        </>
      )}
      {name === "comments" && (
        <>
          <path d="M20.5 11.5a8.5 8.5 0 0 1-9 8.48 9.2 9.2 0 0 1-3.2-.82L3.5 20.5l1.35-4.75A8.5 8.5 0 1 1 20.5 11.5Z" />
          <path d="M8 10h8M8 14h5" />
        </>
      )}
      {name === "seo" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.6 2.6L16.5 9" />
        </>
      )}
      {name === "ai" && (
        <>
          <path d="m12 3 .9 3.1A6.2 6.2 0 0 0 17 10.2l3 .8-3 .9A6.2 6.2 0 0 0 12.9 16L12 19l-.9-3A6.2 6.2 0 0 0 7 11.9L4 11l3-.8a6.2 6.2 0 0 0 4.1-4.1L12 3Z" />
          <path d="m19 3 .3 1.1A2.7 2.7 0 0 0 21 5.8l-1.1.3a2.7 2.7 0 0 0-1.7 1.7L18 9l-.3-1.2A2.7 2.7 0 0 0 16 6.1l-1-.3 1-.3a2.7 2.7 0 0 0 1.7-1.7L18 3l.3.8" />
        </>
      )}
      {name === "thumbnail" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="8.5" cy="9" r="1.5" />
          <path d="m5.5 17 4.2-4.2 2.8 2.7 2.5-2.4 3.5 3.9" />
        </>
      )}
      {name === "settings" && (
        <>
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
          <circle cx="10" cy="12" r="2" />
        </>
      )}
    </svg>
  );
}

function tr(language: SupportedLanguage, ru: string, en: string): string {
  return language === "ru" ? ru : en;
}

function scrollDashboardTop(): void {
  const motionSetting = document.documentElement.dataset.motion;
  const reduced =
    motionSetting === "reduced" ||
    (motionSetting === "system" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
}

function providerLabel(provider: AiProvider, language: SupportedLanguage): string {
  if (provider === "both") return "Gemini + Groq";
  if (provider === "twelvelabs") return "TwelveLabs";
  if (provider === "auto") {
    return tr(language, "Авто", "Auto");
  }
  return provider;
}

function candidateText(language: SupportedLanguage, value: string): string {
  if (language === "ru") return value;
  const translations: Record<string, string> = {
    "Оптимальная длина": "Optimal length",
    "Сильная поисковая релевантность": "Strong search relevance",
    "Выраженный зрительский хук": "Strong viewer hook",
    "Легко читается": "Easy to read",
    "Смысл виден на мобильном": "Mobile-friendly promise",
    "Добавьте главную поисковую фразу ближе к началу":
      "Move the primary search phrase closer to the beginning",
    "Сделайте результат или конфликт конкретнее":
      "Make the result or conflict more concrete",
    "Упростите формулировку и пунктуацию": "Simplify wording and punctuation",
    "Сократите заголовок для мобильной выдачи": "Shorten the title for mobile surfaces",
  };
  return translations[value] ?? value;
}

function compact(value: number): string {
  return formatMetric(value);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * useState that survives unmounting for the life of the tab. Session, not
 * local, storage: a filter left on yesterday should not greet the user today.
 */
function useSessionState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      return stored === null ? initial : (JSON.parse(stored) as T);
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved =
          typeof next === "function" ? (next as (current: T) => T)(current) : next;
        try {
          sessionStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage can be unavailable; the state still works for this visit.
        }
        return resolved;
      });
    },
    [key],
  );
  return [value, update];
}

function exportStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const SECRET_SETTING_KEYS = new Set([
  "youtubeApiKey",
  "geminiApiKey",
  "groqApiKey",
  "twelveLabsApiKey",
]);
const IMPORTABLE_SETTING_KEYS = new Set(
  Object.keys(DEFAULT_EXTENSION_SETTINGS).filter(
    (key) => !SECRET_SETTING_KEYS.has(key),
  ),
);

function csvCell(value: string | number | boolean | null | undefined): string {
  const raw = value == null ? "" : String(value);
  const text = typeof value === "string" ? protectSpreadsheetCell(raw) : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function videosCsv(data: DashboardData): string {
  const headers = [
    "video_id",
    "title",
    "published_at",
    "views_all_time",
    "views_15m",
    "observed_minutes_15m",
    "views_per_minute_15m",
    "views_previous_15m",
    "observed_minutes_previous_15m",
    "views_per_minute_previous_15m",
    "views_60m",
    "observed_minutes_60m",
    "views_24h",
    "observed_minutes_24h",
    "velocity_change_percent",
    "likes",
    "comments",
    "engagement_percent",
    "analytics_views_28d",
    "watch_minutes_28d",
    "average_view_percentage_28d",
    "shares_28d",
    "subscribers_gained_28d",
    "subscribers_lost_28d",
    "subscribers_net_28d",
    "subscribers_gained_per_1000_views",
    "subscribers_net_per_1000_views",
    "youtube_url",
  ];
  const rows = data.videos.map((video) => {
    const attributed = video.analyticsAvailable28Days;
    const detailed = attributed && video.analyticsDetailAvailable28Days !== false;
    const net = video.subscribersGained28Days - video.subscribersLost28Days;
    const gainedSubscribersPerThousand =
      attributed && video.analyticsViews28Days > 0
        ? (video.subscribersGained28Days / video.analyticsViews28Days) * 1_000
        : null;
    const netSubscribersPerThousand =
      attributed && video.analyticsViews28Days > 0
        ? (net / video.analyticsViews28Days) * 1_000
        : null;
    return [
      video.id,
      video.title,
      video.publishedAt,
      video.views,
      video.viewsLast15Minutes,
      video.observedMinutesLast15,
      video.viewsPerMinuteLast15,
      video.previous15MinutesViews,
      video.previousObservedMinutes15,
      video.previousViewsPerMinute15,
      video.observedViewsLastHour,
      video.observedMinutes,
      video.observedViewsLast24Hours,
      video.observedMinutes24Hours,
      video.velocityTrendPercent,
      video.likes,
      video.comments,
      engagementPercent(video).toFixed(3),
      attributed ? video.analyticsViews28Days : null,
      detailed ? video.watchMinutes28Days : null,
      detailed ? video.averageViewPercentage28Days.toFixed(3) : null,
      detailed ? video.shares28Days : null,
      attributed ? video.subscribersGained28Days : null,
      attributed ? video.subscribersLost28Days : null,
      attributed ? net : null,
      gainedSubscribersPerThousand?.toFixed(3),
      netSubscribersPerThousand?.toFixed(3),
      `https://www.youtube.com/watch?v=${video.id}`,
    ];
  });
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

export function historyCsv(data: DashboardData): string {
  const headers = [
    "date",
    "views",
    "engaged_views",
    "estimated_minutes_watched",
    "average_view_duration_seconds",
    "average_view_percentage",
    "likes",
    "comments",
    "shares",
    "subscribers_gained",
    "subscribers_lost",
    "subscribers_net",
  ];
  const rows = data.history.map((day) => [
    day.date,
    day.views,
    day.engagedViews,
    day.estimatedMinutesWatched,
    day.averageViewDuration,
    data.historyDetailAvailable === false
      ? null
      : day.averageViewPercentage?.toFixed(3),
    day.likes,
    day.comments,
    data.historyDetailAvailable === false ? null : day.shares,
    day.subscribersGained,
    day.subscribersLost,
    day.subscribersGained - day.subscribersLost,
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

type ChartMetric = "views" | "watch" | "subs";

function exactNumber(value: number, language: SupportedLanguage, digits = 0): string {
  return formatExactMetric(value, language === "ru" ? "ru-RU" : "en-US", digits);
}

function shortDate(iso: string, language: SupportedLanguage): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Interactive whole-channel chart: pick a metric, hover (or arrow-key) across the
 * 28-day series to read the exact value, watch-time and net-subscriber figures
 * for any single day. Paths stretch to the container width; the crosshair, dot
 * and tooltip are HTML so nothing is distorted by preserveAspectRatio.
 */
function InteractiveChart({
  history,
  language,
  accent = "#8067ff",
}: {
  history: DashboardData["history"];
  language: SupportedLanguage;
  accent?: string;
}) {
  const [metric, setMetric] = useState<ChartMetric>("views");
  const [hover, setHover] = useState<number | null>(null);
  const [days, setDays] = useState(28);
  const [showPrevious, setShowPrevious] = useState(true);
  const chartId = React.useId();
  const overlayRef = useRef<HTMLDivElement>(null);

  const { series, previous } = useMemo(() => {
    const toPoint = (day: DashboardData["history"][number]) => ({
      date: day.date,
      views: day.views,
      watch: day.estimatedMinutesWatched,
      subs: day.subscribersGained - day.subscribersLost,
    });
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const current = sorted.slice(-days).map(toPoint);
    // The window of equal length right before the visible one. Only drawn
    // when it is complete: a half-length ghost line would compare unequal
    // spans and read as a drop that did not happen.
    const before = sorted.slice(-days * 2, -days).map(toPoint);
    return {
      series: current,
      previous: before.length === current.length ? before : [],
    };
  }, [history, days]);

  if (series.length === 0) {
    return (
      <div className="empty-chart">
        {tr(language, "Данные накапливаются", "Data is accumulating")}
      </div>
    );
  }

  const metrics: Record<ChartMetric, { label: string; color: string; unit: string }> = {
    views: { label: tr(language, "Просмотры", "Views"), color: accent, unit: "" },
    watch: {
      label: tr(language, "Время просмотра", "Watch time"),
      color: "#31c9c0",
      unit: tr(language, "мин", "min"),
    },
    subs: {
      label: tr(language, "Чистые подписки", "Net subs"),
      color: "#37d8a2",
      unit: "",
    },
  };

  const W = 760;
  const H = 230;
  const padTop = 18;
  const padBottom = 26;
  const padX = 6;
  const plotH = H - padTop - padBottom;
  const values = series.map((point) => point[metric]);
  const previousValues = previous.map((point) => point[metric]);
  // Both lines share one scale, or the comparison would lie about the gap.
  const { min, max } = analyticsChartDomain([...values, ...previousValues]);
  const range = Math.max(max - min, 1);
  const count = series.length;
  const xAt = (index: number) =>
    count === 1 ? W / 2 : padX + (index / (count - 1)) * (W - padX * 2);
  const yAt = (value: number) => padTop + plotH - ((value - min) / range) * plotH;
  const leftPercent = (index: number) => (xAt(index) / W) * 100;
  const topPercent = (value: number) => (yAt(value) / H) * 100;

  const linePoints = values.map((value, index) => `${xAt(index)},${yAt(value)}`);
  const areaPath = `M${xAt(0)},${yAt(0)} L${linePoints.join(" L")} L${xAt(
    count - 1,
  )},${yAt(0)} Z`;
  const average = values.reduce((total, value) => total + value, 0) / count;
  const previousLine = previousValues
    .map((value, index) => `${xAt(index)},${yAt(value)}`)
    .join(" ");
  const total = values.reduce((sum, value) => sum + value, 0);
  const previousTotal = previousValues.reduce((sum, value) => sum + value, 0);
  const periodChange =
    previousValues.length > 0 && previousTotal !== 0
      ? ((total - previousTotal) / Math.abs(previousTotal)) * 100
      : null;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => padTop + plotH * ratio);
  const zeroVisible = min < 0;

  const fillId = `${chartId}-${metric}`;
  const active = hover !== null && hover >= 0 && hover < count ? hover : null;
  const activePoint = active !== null ? series[active] : undefined;
  const previousPoint = active !== null ? previous[active] : undefined;

  const moveTo = (index: number) => setHover(Math.max(0, Math.min(count - 1, index)));
  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const fraction = (event.clientX - rect.left) / rect.width;
    moveTo(Math.round(fraction * (count - 1)));
  };
  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = active ?? count - 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTo(current - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTo(current + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTo(count - 1);
    } else if (event.key === "Escape") {
      setHover(null);
    }
  };

  const tooltipLeft = active !== null ? leftPercent(active) : 0;
  const color = metrics[metric].color;

  return (
    <div className="ichart">
      <div
        className="ichart-toolbar"
        role="group"
        aria-label={tr(language, "Метрика", "Metric")}
      >
        {(Object.keys(metrics) as ChartMetric[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={metric === key}
            className={metric === key ? "active" : ""}
            style={
              metric === key
                ? ({ "--ichart-accent": metrics[key].color } as React.CSSProperties)
                : undefined
            }
            onClick={() => setMetric(key)}
          >
            <i style={{ background: metrics[key].color }} />
            {metrics[key].label}
          </button>
        ))}
      </div>
      <div className="analytics-chart-summary">
        <div>
          <span>{tr(language, "За выбранный период", "Selected period")}</span>
          <strong>
            {exactNumber(total, language)} <small>{metrics[metric].unit}</small>
            {periodChange !== null && (
              <em
                className={`ichart-delta ${periodChange > 0.5 ? "up" : periodChange < -0.5 ? "down" : "flat"}`}
                title={tr(
                  language,
                  `Предыдущие ${days} дн.: ${exactNumber(previousTotal, language)}`,
                  `Previous ${days} days: ${exactNumber(previousTotal, language)}`,
                )}
              >
                {periodChange > 0.5 ? "↑" : periodChange < -0.5 ? "↓" : "→"}{" "}
                {Math.abs(periodChange).toFixed(Math.abs(periodChange) < 10 ? 1 : 0)}%
              </em>
            )}
          </strong>
          <p>
            {tr(language, "В среднем за день", "Daily average")}:{" "}
            {exactNumber(average, language, 1)} {metrics[metric].unit}
            {periodChange !== null && (
              <> · {tr(language, "к прошлому периоду", "vs previous period")}</>
            )}
          </p>
        </div>
        <div
          className="analytics-range"
          role="group"
          aria-label={tr(language, "Период графика", "Chart period")}
        >
          {[7, 14, 28].map((period) => (
            <button
              key={period}
              aria-pressed={days === period}
              onClick={() => {
                setDays(period);
                setHover(null);
              }}
            >
              {period}
              {tr(language, "д", "d")}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={overlayRef}
        className="ichart-plot"
        tabIndex={0}
        role="slider"
        aria-label={`${metrics[metric].label}: ${tr(language, "наведите или используйте стрелки", "hover or use arrow keys")}`}
        aria-valuemin={0}
        aria-valuemax={count - 1}
        aria-valuenow={active ?? count - 1}
        aria-valuetext={`${shortDate((activePoint ?? series[count - 1]!).date, language)}: ${exactNumber((activePoint ?? series[count - 1]!)[metric], language)} ${metrics[metric].unit}`}
        onPointerMove={handlePointer}
        onPointerDown={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          handlePointer(event);
        }}
        onFocus={() => setHover(count - 1)}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setHover(null);
        }}
        onBlur={() => setHover(null)}
        onKeyDown={handleKey}
      >
        <svg
          className="ichart-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity=".34" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridLines.map((y) => (
            <line
              key={y}
              className="ichart-grid"
              x1="0"
              y1={y}
              x2={W}
              y2={y}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {zeroVisible && (
            <line
              className="ichart-zero"
              x1="0"
              y1={yAt(0)}
              x2={W}
              y2={yAt(0)}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <line
            className="ichart-average"
            x1="0"
            y1={yAt(average)}
            x2={W}
            y2={yAt(average)}
            vectorEffect="non-scaling-stroke"
          />
          <path d={areaPath} fill={`url(#${fillId})`} />
          {showPrevious && previousLine && (
            <polyline
              className="ichart-previous"
              points={previousLine}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeDasharray="5 5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <polyline
            points={linePoints.join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {count === 1 && (
            <circle cx={xAt(0)} cy={yAt(values[0]!)} r="4" fill={color} />
          )}
        </svg>
        {active !== null && activePoint && (
          <>
            <div
              className="ichart-crosshair"
              style={{ left: `${leftPercent(active)}%` }}
            />
            <div
              className="ichart-dot"
              style={{
                left: `${leftPercent(active)}%`,
                top: `${topPercent(activePoint[metric])}%`,
                background: color,
              }}
            />
            <div
              className="ichart-tooltip"
              style={{
                left: `${tooltipLeft}%`,
                transform: `translateX(${tooltipLeft > 65 ? "-100%" : tooltipLeft < 35 ? "0" : "-50%"})`,
              }}
            >
              <strong>{shortDate(activePoint.date, language)}</strong>
              <span style={{ color }}>
                {metrics[metric].label}: {exactNumber(activePoint[metric], language)}{" "}
                {metrics[metric].unit}
              </span>
              {showPrevious && previousPoint && (
                <em className="ichart-tooltip-previous">
                  {tr(language, "Тот же день раньше", "Same day, previous period")}{" "}
                  {shortDate(previousPoint.date, language)}:{" "}
                  {exactNumber(previousPoint[metric], language)}
                </em>
              )}
              <em>
                {tr(language, "Просмотры", "Views")}{" "}
                {exactNumber(activePoint.views, language)}
              </em>
              <em>
                {tr(language, "Мин просмотра", "Watch min")}{" "}
                {exactNumber(activePoint.watch, language)}
              </em>
              <em>
                {tr(language, "Чистые подписки", "Net subs")}{" "}
                {activePoint.subs >= 0 ? "+" : "−"}
                {exactNumber(Math.abs(activePoint.subs), language)}
              </em>
            </div>
          </>
        )}
      </div>
      <div className="ichart-axis">
        <span>{shortDate(series[0]!.date, language)}</span>
        {count > 2 && (
          <span>{shortDate(series[Math.floor((count - 1) / 2)]!.date, language)}</span>
        )}
        {count > 1 && <span>{shortDate(series[count - 1]!.date, language)}</span>}
      </div>
      <p className="analytics-chart-caption">
        {tr(
          language,
          "Горизонтальный пунктир — среднее за день. Доступно дней:",
          "Horizontal dashed line: daily average. Available days:",
        )}{" "}
        {count} / {days}
        {previousValues.length > 0 && (
          <label className="ichart-previous-toggle">
            <input
              type="checkbox"
              checked={showPrevious}
              onChange={(event) => setShowPrevious(event.target.checked)}
            />
            {tr(
              language,
              `Предыдущие ${days} дн. — тонкий пунктир`,
              `Previous ${days} days — thin dashed line`,
            )}
          </label>
        )}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  delta,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  delta?: string | undefined;
  tone: string;
}) {
  return (
    <article
      className="metric-card"
      style={{ "--metric-tone": tone } as React.CSSProperties}
    >
      <div className="metric-label">
        <i />
        {label}
      </div>
      <div className="metric-value">
        <strong>{value}</strong>
        {delta && <span>{delta}</span>}
      </div>
      <p>{note}</p>
    </article>
  );
}

function PeriodSwitch({
  value,
  onChange,
  language,
}: {
  value: MetricPeriod;
  onChange: (period: MetricPeriod) => void;
  language: SupportedLanguage;
}) {
  return (
    <div
      className="period-switch"
      role="group"
      aria-label={tr(language, "Период аналитики", "Analytics period")}
    >
      {(
        [
          ["60m", tr(language, "60 минут", "60 minutes")],
          ["24h", tr(language, "24 часа", "24 hours")],
          ["all", tr(language, "Всё время", "All time")],
        ] as Array<[MetricPeriod, string]>
      ).map(([id, label]) => (
        <button
          key={id}
          className={value === id ? "active" : ""}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

type VideoSortKey =
  | "smart"
  | "views"
  | "velocity"
  | "engagement"
  | "retention"
  | "subscribers"
  | "performance";

function VideoTable({
  videos: allVideos,
  period,
  onPeriod,
  onAnalyze,
  onEditThumbnail,
  language,
  limit,
  onBrowse,
}: {
  videos: VideoSummary[];
  period: MetricPeriod;
  onPeriod: (period: MetricPeriod) => void;
  onAnalyze: (video: VideoSummary) => void;
  onEditThumbnail: (video: VideoSummary) => void;
  language: SupportedLanguage;
  limit?: number;
  onBrowse?: () => void;
}) {
  // Search, sort and format survive leaving the page: they used to reset every
  // time the user opened a video in the editor and came back. The compact
  // preview on the overview keeps its own copy so it does not inherit a
  // filter set on the full table.
  const stateKey = limit ? "overview" : "videos";
  const [query, setQuery] = useSessionState(
    `channelpilot.videos.${stateKey}.query`,
    "",
  );
  const [sortKey, setSortKey] = useSessionState<VideoSortKey>(
    `channelpilot.videos.${stateKey}.sort`,
    "smart",
  );
  const [descending, setDescending] = useSessionState(
    `channelpilot.videos.${stateKey}.descending`,
    true,
  );
  const [cohort, setCohort] = useSessionState<ContentCohort>(
    `channelpilot.videos.${stateKey}.cohort`,
    "all",
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailFocus, setDetailFocus] = useState<"overview" | "score">("overview");
  const searchRef = useRef<HTMLInputElement>(null);
  // "/" focuses the search, as on YouTube and GitHub.
  useEffect(() => {
    if (limit) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (!searchRef.current || searchRef.current.offsetParent === null) return;
      event.preventDefault();
      searchRef.current.focus();
      searchRef.current.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [limit]);
  const videos = useMemo(
    () => allVideos.filter((video) => inContentCohort(video, cohort)),
    [allVideos, cohort],
  );
  const detailVideo = allVideos.find((video) => video.id === detailId);

  // The performance score compares a video against the whole cohort, so calling
  // it per row during render was O(n²) work repeated on every keystroke in the
  // search box. Compute it once per dataset instead.
  const scores = useMemo(
    () =>
      new Map(
        videos.map((video) => [
          video.id,
          calculateVideoPerformanceScore(video, videos),
        ]),
      ),
    [videos],
  );

  const valueFor = (video: VideoSummary) =>
    period === "60m"
      ? video.observedViewsLastHour
      : period === "24h"
        ? video.observedViewsLast24Hours
        : video.views;
  const smartValueFor = (video: VideoSummary) =>
    period === "60m"
      ? hourlyPace(video)
      : period === "24h"
        ? dailyPace(video)
        : video.views;
  const metricFor = (video: VideoSummary, key: VideoSortKey): number => {
    switch (key) {
      case "views":
        return valueFor(video);
      case "velocity":
        return video.viewsPerMinuteLast15;
      case "engagement":
        return engagementPercent(video);
      case "retention":
        return video.analyticsAvailable28Days &&
          video.analyticsDetailAvailable28Days !== false
          ? video.averageViewPercentage28Days
          : Number.NEGATIVE_INFINITY;
      case "subscribers":
        return video.analyticsAvailable28Days
          ? video.subscribersGained28Days - video.subscribersLost28Days
          : Number.NEGATIVE_INFINITY;
      case "performance":
        return scores.get(video.id)?.total ?? Number.NaN;
      default:
        return smartValueFor(video);
    }
  };

  // Matches title, tags and the video id, case- and ё-insensitively, and every
  // word of the query independently — "майнкрафт порталы" finds a video whose
  // title has the two words apart. It used to be one substring of the title.
  const filtered = videos.filter((video) =>
    matchesSearch(query, `${video.title} ${video.tags.join(" ")} ${video.id}`),
  );
  const sorted = [...filtered].sort(
    (left, right) =>
      compareAnalyticsValues(
        metricFor(left, sortKey),
        metricFor(right, sortKey),
        descending,
      ) || valueFor(right) - valueFor(left),
  );
  const visible = typeof limit === "number" ? sorted.slice(0, limit) : sorted;

  function toggleSort(key: VideoSortKey): void {
    if (sortKey === key) {
      setDescending((value) => !value);
      return;
    }
    setSortKey(key);
    setDescending(true);
  }
  function sortHeader(key: VideoSortKey, label: string) {
    const active = sortKey === key;
    return (
      <button
        type="button"
        className={`table-sort${active ? " active" : ""}`}
        aria-pressed={active}
        title={tr(language, `Сортировать: ${label}`, `Sort by ${label}`)}
        onClick={() => toggleSort(key)}
      >
        {label}
        <i aria-hidden="true">{active ? (descending ? "▾" : "▴") : "⇅"}</i>
      </button>
    );
  }

  // Aggregates follow the current search filter so the numbers always describe
  // exactly the rows on screen. Analytics-only figures are averaged over the
  // videos that actually have 28-day attribution.
  const withAnalytics = filtered.filter((video) => video.analyticsAvailable28Days);
  const withDetails = withAnalytics.filter(
    (video) => video.analyticsDetailAvailable28Days !== false,
  );
  const withRetention = withDetails.filter((video) => video.analyticsViews28Days > 0);
  const analyticsViews = sum(withRetention.map((video) => video.analyticsViews28Days));
  const publicViews = sum(filtered.map((video) => video.views));
  const totals = {
    count: filtered.length,
    analyticsCount: withAnalytics.length,
    views: publicViews,
    gained: sum(withAnalytics.map((video) => video.subscribersGained28Days)),
    lost: sum(withAnalytics.map((video) => video.subscribersLost28Days)),
    watchMinutes: sum(withDetails.map((video) => video.watchMinutes28Days)),
    retention: analyticsViews
      ? withRetention.reduce(
          (total, video) =>
            total + video.averageViewPercentage28Days * video.analyticsViews28Days,
          0,
        ) / analyticsViews
      : 0,
    engagement: publicViews
      ? (sum(filtered.map((video) => video.likes + video.comments)) / publicViews) * 100
      : 0,
  };
  const netSubscribers = totals.gained - totals.lost;
  return (
    <section
      className={`surface video-table-card ${onBrowse ? "video-table-preview" : ""}`}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {tr(language, "ДИНАМИКА КОНТЕНТА", "CONTENT VELOCITY")}
          </span>
          <h2>
            {tr(
              language,
              "Какие видео набирают просмотры",
              "Which videos are gaining views",
            )}
          </h2>
          <p>
            {tr(
              language,
              "Сравнение скорости, вовлечённости и общего результата.",
              "Compare velocity, engagement and lifetime performance.",
            )}
          </p>
        </div>
        <div className="table-tools">
          {!onBrowse && (
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              aria-label={tr(
                language,
                "Найти видео по названию, тегу или ID",
                "Find a video by title, tag or ID",
              )}
              aria-keyshortcuts="/"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
              placeholder={tr(
                language,
                "Название, тег или ID  ·  /",
                "Title, tag or ID  ·  /",
              )}
            />
          )}
          <PeriodSwitch value={period} onChange={onPeriod} language={language} />
        </div>
      </div>
      {!onBrowse && (
        <>
          <ContentFormatFilter
            value={cohort}
            onChange={setCohort}
            language={language}
          />
          <div
            className="video-totals"
            role="group"
            aria-label={tr(language, "Сводка", "Summary")}
          >
            <article>
              <span>{tr(language, "Видео в выборке", "Videos in view")}</span>
              <b>{totals.count}</b>
            </article>
            <article>
              <span>{tr(language, "Просмотров всего", "Total views")}</span>
              <b>{compact(totals.views)}</b>
            </article>
            <article>
              <span>{tr(language, "Подписки · 28д", "Subscribers · 28d")}</span>
              <b
                className={
                  totals.analyticsCount ? (netSubscribers >= 0 ? "good" : "bad") : ""
                }
              >
                {totals.analyticsCount ? formatSignedMetric(netSubscribers) : "—"}
              </b>
              <small>
                {totals.analyticsCount
                  ? `+${compact(totals.gained)} / −${compact(totals.lost)}`
                  : tr(language, "нет Analytics", "no Analytics")}
              </small>
            </article>
            <article>
              <span>{tr(language, "Среднее удержание", "Avg retention")}</span>
              <b>{analyticsViews > 0 ? formatPercent(totals.retention) : "—"}</b>
              <small>
                {withRetention.length
                  ? tr(
                      language,
                      `по ${withRetention.length} видео`,
                      `over ${withRetention.length} ${withRetention.length === 1 ? "video" : "videos"}`,
                    )
                  : tr(language, "нет Analytics", "no Analytics")}
              </small>
            </article>
            <article>
              <span>{tr(language, "Время просмотра · 28д", "Watch time · 28d")}</span>
              <b>{withDetails.length ? compact(totals.watchMinutes) : "—"}</b>
              <small>{tr(language, "минут", "minutes")}</small>
            </article>
            <article>
              <span>{tr(language, "Вовлечённость", "Engagement")}</span>
              <b>{publicViews > 0 ? formatPercent(totals.engagement, 2) : "—"}</b>
              <small>
                {tr(language, "лайки+комм. / просмотры", "likes+comments / views")}
              </small>
            </article>
          </div>
        </>
      )}
      <div className="video-table-head">
        <span>{tr(language, "Видео", "Video")}</span>
        {sortHeader("views", tr(language, "Просмотры", "Views"))}
        {sortHeader("velocity", tr(language, "Скорость", "Velocity"))}
        {sortHeader("engagement", "ER")}
        {sortHeader("retention", tr(language, "Удержание", "Retention"))}
        {sortHeader("subscribers", tr(language, "Подписки · 28д", "Subs · 28d"))}
        {sortHeader("performance", tr(language, "Статус", "Status"))}
        <span />
      </div>
      <div className="video-table-body">
        {visible.map((video, index) => {
          const value = valueFor(video);
          const speed = video.viewsPerMinuteLast15;
          const trend = video.velocityTrendPercent;
          const hasTrendEvidence =
            video.observedMinutesLast15 >= 5 &&
            video.previousObservedMinutes15 >= 5 &&
            Number.isFinite(speed) &&
            Number.isFinite(trend);
          const momentum = videoMomentum(video);
          const subscriberNet =
            video.subscribersGained28Days - video.subscribersLost28Days;
          const subscribersPerThousand =
            video.analyticsViews28Days > 0
              ? (video.subscribersGained28Days / video.analyticsViews28Days) * 1_000
              : 0;
          const performance =
            scores.get(video.id) ?? calculateVideoPerformanceScore(video, videos);
          const ageDays = Math.max(
            1,
            Math.round((Date.now() - Date.parse(video.publishedAt)) / 86_400_000),
          );
          const viewsPerDay = Number.isFinite(ageDays) ? video.views / ageDays : 0;
          return (
            <article className="analytics-video-row" key={video.id}>
              <div className="video-primary">
                <em>{String(index + 1).padStart(2, "0")}</em>
                <img src={video.thumbnailUrl} alt="" />
                <div>
                  <button
                    className="video-detail-link"
                    onClick={() => {
                      setDetailFocus("overview");
                      setDetailId(video.id);
                    }}
                    aria-label={`${tr(language, "Подробная аналитика", "Detailed analytics")}: ${video.title}`}
                  >
                    <strong>{video.title}</strong>
                  </button>
                  <span>
                    {new Date(video.publishedAt).toLocaleDateString(
                      language === "ru" ? "ru-RU" : "en-US",
                      { day: "2-digit", month: "2-digit", year: "2-digit" },
                    )}{" "}
                    · {compact(video.views)} {tr(language, "всего", "total")}
                    {!limit && (
                      <>
                        {" "}
                        · {compact(viewsPerDay)}
                        {tr(language, "/день", "/day")}
                      </>
                    )}
                  </span>
                </div>
              </div>
              <div className="table-stat">
                <strong>{compact(value)}</strong>
                <span>
                  {period === "24h" && video.observedMinutes24Hours < 1_440
                    ? // Kept in the same shape as the 60-minute label below
                      // ("47/60 мин"): the long "наблюдается … из 24 ч" wording
                      // was twice the width of its column and ellipsised away
                      // the number it existed to show.
                      tr(
                        language,
                        `${(video.observedMinutes24Hours / 60).toFixed(video.observedMinutes24Hours % 60 === 0 ? 0 : 1)}/24 ч`,
                        `${(video.observedMinutes24Hours / 60).toFixed(video.observedMinutes24Hours % 60 === 0 ? 0 : 1)}/24 h`,
                      )
                    : period === "60m"
                      ? video.observedMinutes >= 60
                        ? tr(language, "60 мин", "60 min")
                        : tr(
                            language,
                            `${video.observedMinutes}/60 мин`,
                            `${video.observedMinutes}/60 min`,
                          )
                      : tr(language, "за всё время", "lifetime")}
                </span>
              </div>
              <div className="table-stat">
                <strong
                  className={hasTrendEvidence ? (trend >= 0 ? "good" : "bad") : ""}
                >
                  {video.observedMinutesLast15 > 0
                    ? `${speed.toFixed(speed < 10 ? 1 : 0)} / ${tr(language, "мин", "min")}`
                    : "—"}
                </strong>
                <span>
                  {hasTrendEvidence
                    ? `${trend >= 0 ? "↑" : "↓"} ${Math.abs(trend)}% ${tr(language, "по темпу", "pace change")}`
                    : tr(
                        language,
                        `собрано ${video.observedMinutesLast15}/15 мин`,
                        `${video.observedMinutesLast15}/15 min observed`,
                      )}
                </span>
              </div>
              <div className="table-stat">
                <strong>{formatPercent(engagementPercent(video), 2)}</strong>
                <span>
                  ♥ {compact(video.likes)} · {compact(video.comments)}{" "}
                  {tr(language, "комм.", "comments")}
                </span>
              </div>
              <div className="table-stat">
                {video.analyticsAvailable28Days &&
                video.analyticsDetailAvailable28Days !== false ? (
                  <>
                    <strong>{formatPercent(video.averageViewPercentage28Days)}</strong>
                    <span>
                      {compact(video.watchMinutes28Days)}{" "}
                      {tr(language, "мин просмотра", "watch min")}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>—</strong>
                    <span>{tr(language, "нет Analytics", "no Analytics")}</span>
                  </>
                )}
              </div>
              <div className="table-stat subscriber-stat">
                {video.analyticsAvailable28Days ? (
                  <>
                    <strong>
                      <span className="subscriber-gained">
                        +{compact(video.subscribersGained28Days)}
                      </span>
                      <span className="subscriber-lost">
                        −{compact(video.subscribersLost28Days)}
                      </span>
                    </strong>
                    <span>
                      {tr(language, "чистый", "net")}{" "}
                      <b className={subscriberNet >= 0 ? "good" : "bad"}>
                        {formatSignedMetric(subscriberNet)}
                      </b>
                      {" · "}
                      {subscribersPerThousand.toFixed(1)}
                      {tr(language, "/1K", "/1K")}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>—</strong>
                    <span>
                      {tr(
                        language,
                        "нет атрибуции Analytics",
                        "Analytics attribution unavailable",
                      )}
                    </span>
                  </>
                )}
              </div>
              <div className="status-cell">
                <span className={`status-chip ${momentum}`}>
                  {videoMomentumLabel(momentum, language)}
                </span>
                <button
                  type="button"
                  className="momentum-score"
                  title={performanceScoreTooltip(performance, language)}
                  aria-label={`${tr(language, "Показать расчёт индекса", "Show score calculation")}: ${video.title}. ${performanceScoreValue(performance)}`}
                  onClick={() => {
                    setDetailFocus("score");
                    setDetailId(video.id);
                  }}
                >
                  <b>{performanceScoreValue(performance)}</b>
                  <span>
                    {tr(language, "Полнота", "Coverage")}: {performance.availableWeight}
                    /100
                  </span>
                </button>
              </div>
              <div className="row-actions">
                <button onClick={() => onAnalyze(video)}>
                  {tr(language, "AI-анализ", "AI analysis")}
                </button>
                <button onClick={() => onEditThumbnail(video)}>
                  {tr(language, "Превью", "Thumbnail")}
                </button>
                <a
                  href={`https://studio.youtube.com/video/${video.id}/analytics/tab-overview`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={tr(
                    language,
                    "Открыть аналитику видео в YouTube Studio",
                    "Open video analytics in YouTube Studio",
                  )}
                >
                  ↗
                </a>
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <p className="analytics-inline-note" role="status">
          {tr(
            language,
            "В этой группе пока нет видео. Попробуйте другой формат или запрос.",
            "No videos in this group yet. Try another format or search.",
          )}
        </p>
      )}
      {onBrowse && (
        <button className="secondary-button browse-videos" onClick={onBrowse}>
          {tr(language, "Все видео и фильтры", "All videos & filters")} →
        </button>
      )}
      {detailVideo && (
        <VideoDetailsDialog
          key={detailVideo.id}
          video={detailVideo}
          videos={allVideos}
          language={language}
          initialPerformanceOpen={detailFocus === "score"}
          onClose={() => setDetailId(null)}
          onAnalyze={onAnalyze}
          onEditThumbnail={onEditThumbnail}
          renderChart={(history) => (
            <InteractiveChart
              history={history}
              language={language}
              accent="var(--purple)"
            />
          )}
          performance={
            scores.get(detailVideo.id) ??
            calculateVideoPerformanceScore(detailVideo, videos)
          }
        />
      )}
    </section>
  );
}

function SettingsPanel({
  settings,
  setSettings,
  models,
  testing,
  testResult,
  saving,
  dirty,
  onSave,
  onDiscard,
  onTest,
  onRefreshModels,
  onCopy,
  onConnect,
  onExportSettings,
  onImportSettings,
  onClearCaches,
  onResetData,
  signedIn,
  reauthRequired,
  connecting,
  language,
}: {
  settings: ExtensionSettings;
  setSettings: (settings: ExtensionSettings) => void;
  models: AiModelCatalog;
  testing: boolean;
  testResult: TestResult | null;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onTest: () => void;
  onRefreshModels: () => void;
  onCopy: () => void;
  onConnect: () => void;
  onExportSettings: () => void;
  onImportSettings: (file: File) => void;
  onClearCaches: () => void;
  onResetData: () => void;
  signedIn: boolean | null;
  reauthRequired: boolean;
  connecting: boolean;
  language: SupportedLanguage;
}) {
  const redirectUri =
    typeof chrome !== "undefined" && chrome.identity?.getRedirectURL
      ? chrome.identity.getRedirectURL("google")
      : tr(
          language,
          "Доступно в установленном расширении",
          "Available in the installed extension",
        );
  const clientIdValid = isGoogleClientId(settings.googleClientId);
  const settingsImportRef = useRef<HTMLInputElement>(null);
  return (
    <section className="settings-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {tr(language, "БЕЗОПАСНОЕ ПОДКЛЮЧЕНИЕ", "SECURE CONNECTIONS")}
          </span>
          <h2>
            {tr(language, "Google, языки и AI API", "Google, languages & AI APIs")}
          </h2>
          <p>
            {tr(
              language,
              "Ключи сохраняются только внутри локального профиля Chrome.",
              "Keys stay inside your local Chrome profile.",
            )}
          </p>
        </div>
        <button
          className="primary-button"
          onClick={onSave}
          disabled={saving || !dirty}
          aria-busy={saving}
          title={dirty ? undefined : tr(language, "Изменений нет", "Nothing to save")}
        >
          {saving
            ? tr(language, "Сохраняем…", "Saving…")
            : tr(language, "Сохранить настройки", "Save settings")}
        </button>
      </div>
      <div className="settings-grid">
        <article className="surface settings-card wide language-settings">
          <div className="settings-title">
            <div className="settings-icon routing">文</div>
            <div>
              <strong>{tr(language, "Языки", "Languages")}</strong>
              <span>
                {tr(
                  language,
                  "Интерфейс и AI-генерация настраиваются отдельно",
                  "Configure interface and AI output separately",
                )}
              </span>
            </div>
          </div>
          <div className="language-select-grid">
            <label>
              {tr(language, "Язык интерфейса", "Interface language")}
              <select
                value={settings.interfaceLanguage}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    interfaceLanguage: event.target.value as SupportedLanguage,
                  })
                }
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>
              {tr(language, "Язык AI-генерации", "AI generation language")}
              <select
                value={settings.generationLanguage}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    generationLanguage: event.target.value as SupportedLanguage,
                  })
                }
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        </article>
        <article className="surface settings-card wide visibility-settings">
          <div className="settings-title">
            <div className="settings-icon routing">◉</div>
            <div>
              <strong>
                {tr(language, "Интерфейс в YouTube", "YouTube interface")}
              </strong>
              <span>
                {tr(
                  language,
                  "Каждый элемент можно скрыть независимо и вернуть через popup расширения",
                  "Hide each element independently and restore it from the extension popup",
                )}
              </span>
            </div>
          </div>
          <div className="visibility-grid">
            <label className="visibility-option">
              <input
                type="checkbox"
                checked={settings.showHeaderWidget}
                onChange={(event) =>
                  setSettings({ ...settings, showHeaderWidget: event.target.checked })
                }
              />
              <span>
                <b>{tr(language, "Верхняя аналитика", "Top analytics widget")}</b>
                <small>
                  {tr(
                    language,
                    "Строка метрик рядом с поиском — состав настраивается ниже",
                    "A strip of metrics next to search — choose them below",
                  )}
                </small>
              </span>
              <i />
            </label>
            <label className="visibility-option">
              <input
                type="checkbox"
                checked={settings.showLauncher}
                onChange={(event) =>
                  setSettings({ ...settings, showLauncher: event.target.checked })
                }
              />
              <span>
                <b>
                  {tr(language, "Кнопка ChannelPilot AI", "ChannelPilot AI button")}
                </b>
                <small>
                  {tr(
                    language,
                    "Плавающая кнопка для открытия боковой AI-панели",
                    "Floating button that opens the AI side panel",
                  )}
                </small>
              </span>
              <i />
            </label>
          </div>
          <WidgetCompositionEditor
            sections={settings.widgetSections}
            dockMetrics={settings.widgetDockMetrics}
            language={language}
            onChange={(patch) => setSettings({ ...settings, ...patch })}
          />
        </article>
        <article className="surface settings-card wide appearance-settings">
          <div className="settings-title">
            <div className="settings-icon routing">◐</div>
            <div>
              <strong>
                {tr(
                  language,
                  "Внешний вид и доступность",
                  "Appearance & accessibility",
                )}
              </strong>
              <span>
                {tr(
                  language,
                  "Тема, акцент, прозрачность, плотность и анимации",
                  "Theme, accent, transparency, density and motion",
                )}
              </span>
            </div>
          </div>
          <div className="appearance-grid">
            <label>
              {tr(language, "Тема", "Theme")}
              <select
                value={settings.theme}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    theme: event.target.value as ExtensionSettings["theme"],
                  })
                }
              >
                <option value="auto">
                  {tr(
                    language,
                    "Авто — как в системе и YouTube",
                    "Auto — system and YouTube",
                  )}
                </option>
                <option value="dark">{tr(language, "Тёмная", "Dark")}</option>
                <option value="light">{tr(language, "Светлая", "Light")}</option>
              </select>
            </label>
            <label>
              {tr(language, "Акцент", "Accent")}
              <select
                value={settings.accentColor}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    accentColor: event.target.value as ExtensionSettings["accentColor"],
                  })
                }
              >
                <option value="violet">{tr(language, "Фиолетовый", "Violet")}</option>
                <option value="cyan">{tr(language, "Голубой", "Cyan")}</option>
                <option value="emerald">{tr(language, "Изумрудный", "Emerald")}</option>
                <option value="coral">{tr(language, "Коралловый", "Coral")}</option>
              </select>
            </label>
            <label>
              {tr(language, "Плотность", "Density")}
              <select
                value={settings.density}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    density: event.target.value as ExtensionSettings["density"],
                  })
                }
              >
                <option value="comfortable">
                  {tr(language, "Комфортная", "Comfortable")}
                </option>
                <option value="compact">{tr(language, "Компактная", "Compact")}</option>
              </select>
            </label>
            <label>
              {tr(language, "Анимации", "Motion")}
              <select
                value={settings.animationMode}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    animationMode: event.target
                      .value as ExtensionSettings["animationMode"],
                  })
                }
              >
                <option value="system">
                  {tr(language, "Как в системе", "System")}
                </option>
                <option value="full">{tr(language, "Полные", "Full")}</option>
                <option value="reduced">
                  {tr(language, "Сокращённые", "Reduced")}
                </option>
              </select>
            </label>
            <label className="transparency-setting">
              {tr(language, "Непрозрачность стекла", "Glass opacity")}{" "}
              <b>{settings.panelTransparency}%</b>
              <input
                type="range"
                min={PANEL_TRANSPARENCY_RANGE.min}
                max={PANEL_TRANSPARENCY_RANGE.max}
                value={settings.panelTransparency}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    panelTransparency: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              {tr(language, "Обновление аналитики", "Analytics refresh")}
              <select
                value={settings.analyticsRefreshSeconds}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    analyticsRefreshSeconds: Number(event.target.value),
                  })
                }
              >
                <option value="60">60 {tr(language, "секунд", "seconds")}</option>
                <option value="120">2 {tr(language, "минуты", "minutes")}</option>
                <option value="300">5 {tr(language, "минут", "minutes")}</option>
              </select>
            </label>
          </div>
          <div className="visibility-grid">
            <label className="visibility-option">
              <input
                type="checkbox"
                checked={settings.notificationsEnabled}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    notificationsEnabled: event.target.checked,
                  })
                }
              />
              <span>
                <b>{tr(language, "Уведомления", "Notifications")}</b>
                <small>
                  {tr(
                    language,
                    "Напоминание Chrome за час до публикации из планера",
                    "A Chrome reminder an hour before a planned publication",
                  )}
                </small>
              </span>
              <i />
            </label>
            <label className="visibility-option">
              <input
                type="checkbox"
                checked={settings.allowAiMediaUploads}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    allowAiMediaUploads: event.target.checked,
                  })
                }
              />
              <span>
                <b>{tr(language, "Передача медиа в AI", "AI media uploads")}</b>
                <small>
                  {tr(
                    language,
                    "При включении видео, выбранное в YouTube Studio, автоматически анализируется через AI. В AI Studio файлы отправляются только после вашего выбора.",
                    "When enabled, videos selected in YouTube Studio are analyzed automatically. In AI Studio, files are sent only after you choose them.",
                  )}
                </small>
              </span>
              <i />
            </label>
            <label className="visibility-option">
              <input
                type="checkbox"
                checked={settings.debugLogging}
                onChange={(event) =>
                  setSettings({ ...settings, debugLogging: event.target.checked })
                }
              />
              <span>
                <b>{tr(language, "Отладочные логи", "Debug logs")}</b>
                <small>
                  {tr(
                    language,
                    "Только технические события; ключи всегда маскируются",
                    "Technical events only; keys are always redacted",
                  )}
                </small>
              </span>
              <i />
            </label>
          </div>
        </article>
        <article className="surface settings-card wide">
          <div className="settings-title">
            <div className="settings-icon google">G</div>
            <div>
              <strong>Google OAuth</strong>
              <span>
                {tr(
                  language,
                  "YouTube Data API и YouTube Analytics API",
                  "YouTube Data API and YouTube Analytics API",
                )}
              </span>
            </div>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
            >
              Google Cloud ↗
            </a>
          </div>
          <div
            className={`oauth-status ${reauthRequired ? "warning" : signedIn ? "connected" : clientIdValid ? "ready" : "invalid"}`}
          >
            <i />
            <div>
              <strong>
                {reauthRequired
                  ? tr(language, "Подключение сохранено", "Connection preserved")
                  : signedIn
                    ? tr(language, "Google подключён", "Google connected")
                    : clientIdValid
                      ? tr(language, "Client ID распознан", "Client ID recognized")
                      : tr(
                          language,
                          "Нужен OAuth Client ID",
                          "OAuth Client ID required",
                        )}
              </strong>
              <span>
                {reauthRequired
                  ? tr(
                      language,
                      "Срок токена истёк. Подтвердите аккаунт — канал и настройки не потеряны.",
                      "The access token expired. Confirm the account — your channel and settings are preserved.",
                    )
                  : signedIn
                    ? tr(
                        language,
                        "Read-only доступ к данным YouTube разрешён",
                        "Read-only access to YouTube data is granted",
                      )
                    : tr(
                        language,
                        "Используйте тип «Веб-приложение», не API key и не Client secret",
                        "Use the Web application type, not an API key or client secret",
                      )}
              </span>
            </div>
          </div>
          <label>
            OAuth Client ID
            <input
              value={settings.googleClientId}
              onChange={(event) =>
                setSettings({ ...settings, googleClientId: event.target.value })
              }
              placeholder="123456789-abc.apps.googleusercontent.com"
              aria-invalid={!clientIdValid && settings.googleClientId.length > 0}
            />
          </label>
          <label>
            Authorized redirect URI
            <div className="inline-field">
              <input value={redirectUri} readOnly />
              <button
                onClick={onCopy}
                disabled={
                  typeof chrome === "undefined" || !chrome.identity?.getRedirectURL
                }
              >
                {tr(language, "Копировать", "Copy")}
              </button>
            </div>
          </label>
          <div className="oauth-actions">
            <button
              className="primary-button"
              onClick={onConnect}
              disabled={connecting || !clientIdValid}
            >
              {connecting
                ? tr(language, "Подключаем…", "Connecting…")
                : reauthRequired
                  ? tr(language, "Обновить Google-сессию", "Refresh Google session")
                  : signedIn
                    ? tr(language, "Переподключить Google", "Reconnect Google")
                    : tr(
                        language,
                        "Сохранить и подключить Google",
                        "Save and connect Google",
                      )}
            </button>
            <span>
              {tr(
                language,
                `ID расширения: ${typeof chrome !== "undefined" ? (chrome.runtime?.id ?? "—") : "—"}`,
                `Extension ID: ${typeof chrome !== "undefined" ? (chrome.runtime?.id ?? "—") : "—"}`,
              )}
            </span>
          </div>
          <p className="helper">
            {tr(
              language,
              "В Google Cloud добавьте Redirect URI точно как показано выше, включите YouTube Data API v3 и YouTube Analytics API. Если OAuth consent screen в режиме Testing, добавьте свой аккаунт в Test users.",
              "In Google Cloud, add the redirect URI exactly as shown above and enable YouTube Data API v3 plus YouTube Analytics API. If the OAuth consent screen is in Testing, add your account under Test users.",
            )}
          </p>
          <div className="youtube-key-setting">
            <label>
              <span>
                {tr(
                  language,
                  "YouTube Data API key · для комментариев",
                  "YouTube Data API key · for comments",
                )}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr(language, "Создать ключ", "Create a key")} ↗
                </a>
              </span>
              <input
                type="password"
                value={settings.youtubeApiKey}
                onChange={(event) =>
                  setSettings({ ...settings, youtubeApiKey: event.target.value.trim() })
                }
                placeholder="AIza…"
                autoComplete="off"
              />
            </label>
            <p className="helper">
              {tr(
                language,
                "Google не отдаёт комментарии по read-only доступу, которым пользуется ChannelPilot. Ключ API из того же проекта Google Cloud («Учётные данные» → «Создать» → «Ключ API») читает только публичные комментарии. Ограничьте его по API: YouTube Data API v3.",
                "Google does not return comments with the read-only access ChannelPilot uses. An API key from the same Google Cloud project (Credentials → Create → API key) reads public comments only. Restrict it by API: YouTube Data API v3.",
              )}
            </p>
          </div>
        </article>

        <article className="surface settings-card">
          <div className="settings-title">
            <div className="settings-icon gemini">✦</div>
            <div>
              <strong>Google Gemini</strong>
              <span>
                {tr(language, "Мультимодальный анализ", "Multimodal analysis")}
              </span>
            </div>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
            >
              API key ↗
            </a>
          </div>
          <label>
            Gemini API key
            <input
              type="password"
              value={settings.geminiApiKey}
              onChange={(event) =>
                setSettings({ ...settings, geminiApiKey: event.target.value.trim() })
              }
              placeholder="AIza…"
              autoComplete="off"
            />
          </label>
          <label>
            {tr(language, "Модель", "Model")}
            <select
              value={settings.geminiModel}
              onChange={(event) =>
                setSettings({ ...settings, geminiModel: event.target.value })
              }
            >
              {!models.gemini.some((model) => model.id === settings.geminiModel) && (
                <option value={settings.geminiModel}>{settings.geminiModel}</option>
              )}
              {models.gemini.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <small>
            {language === "en"
              ? `Selected model: ${settings.geminiModel}`
              : models.gemini.find((model) => model.id === settings.geminiModel)
                  ?.description}
          </small>
          <div className="quota-helper">
            <span>⏱</span>
            <p>
              {tr(
                language,
                "При ошибке 429 ChannelPilot учитывает время ожидания. В режиме «Авто» видео последовательно переходит в TwelveLabs, затем в Groq.",
                "For a 429 error, ChannelPilot respects the retry delay. In Auto mode, video analysis falls back to TwelveLabs and then Groq.",
              )}
            </p>
            <a href="https://ai.dev/rate-limit" target="_blank" rel="noreferrer">
              {tr(language, "Проверить квоту", "Check quota")} ↗
            </a>
          </div>
        </article>

        <article className="surface settings-card">
          <div className="settings-title">
            <div className="settings-icon twelve">12</div>
            <div>
              <strong>TwelveLabs</strong>
              <span>
                {tr(language, "Нативное понимание видео", "Native video understanding")}
              </span>
            </div>
            <a
              href="https://playground.twelvelabs.io/dashboard/api-keys"
              target="_blank"
              rel="noreferrer"
            >
              API key ↗
            </a>
          </div>
          <label>
            TwelveLabs API key
            <input
              type="password"
              value={settings.twelveLabsApiKey}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  twelveLabsApiKey: event.target.value.trim(),
                })
              }
              placeholder="tlk_…"
              autoComplete="off"
            />
          </label>
          <label>
            {tr(language, "Модель", "Model")}
            <select
              value={settings.twelveLabsModel}
              onChange={(event) =>
                setSettings({ ...settings, twelveLabsModel: event.target.value })
              }
            >
              {models.twelveLabs.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <small>
            {language === "en"
              ? `Selected model: ${settings.twelveLabsModel}`
              : models.twelveLabs.find((model) => model.id === settings.twelveLabsModel)
                  ?.description}
          </small>
          <div className="quota-helper twelve-note">
            <span>▶</span>
            <p>
              {tr(
                language,
                "Pegasus анализирует кадры, речь, звук и текст в видео. Бесплатный план даёт 600 минут суммарно; прямые файлы — до 200 МБ.",
                "Pegasus analyzes frames, speech, sound, and on-screen text. The free plan includes 600 cumulative minutes; direct files are limited to 200 MB.",
              )}
            </p>
            <a
              href="https://docs.twelvelabs.io/docs/resources/frequently-asked-questions"
              target="_blank"
              rel="noreferrer"
            >
              {tr(language, "Лимиты", "Limits")} ↗
            </a>
          </div>
        </article>

        <article className="surface settings-card">
          <div className="settings-title">
            <div className="settings-icon groq">GQ</div>
            <div>
              <strong>Groq</strong>
              <span>
                {tr(language, "Быстрый текст и Whisper", "Fast text and Whisper")}
              </span>
            </div>
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
              API key ↗
            </a>
          </div>
          <label>
            Groq API key
            <input
              type="password"
              value={settings.groqApiKey}
              onChange={(event) =>
                setSettings({ ...settings, groqApiKey: event.target.value.trim() })
              }
              placeholder="gsk_…"
              autoComplete="off"
            />
          </label>
          <label>
            {tr(language, "Модель", "Model")}
            <select
              value={settings.groqModel}
              onChange={(event) =>
                setSettings({ ...settings, groqModel: event.target.value })
              }
            >
              {!models.groq.some((model) => model.id === settings.groqModel) && (
                <option value={settings.groqModel}>{settings.groqModel}</option>
              )}
              {models.groq.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <small>
            {language === "en"
              ? `Selected model: ${settings.groqModel}`
              : models.groq.find((model) => model.id === settings.groqModel)
                  ?.description}
          </small>
        </article>

        <article className="surface settings-card wide">
          <div className="settings-title">
            <div className="settings-icon routing">⇄</div>
            <div>
              <strong>{tr(language, "Режим AI", "AI mode")}</strong>
              <span>
                {tr(
                  language,
                  "Выберите провайдера или безопасную цепочку резервирования",
                  "Choose a provider or a resilient fallback chain",
                )}
              </span>
            </div>
          </div>
          <div className="provider-mode-grid">
            {(
              [
                [
                  "auto",
                  tr(language, "Авто", "Auto"),
                  tr(
                    language,
                    "Gemini → TwelveLabs → Groq",
                    "Gemini → TwelveLabs → Groq",
                  ),
                ],
                [
                  "gemini",
                  tr(language, "Только Gemini", "Gemini only"),
                  tr(language, "Визуальный анализ", "Visual analysis"),
                ],
                [
                  "twelvelabs",
                  tr(language, "Только TwelveLabs", "TwelveLabs only"),
                  tr(language, "Видео, звук и таймкоды", "Video, audio & timestamps"),
                ],
                [
                  "groq",
                  tr(language, "Только Groq", "Groq only"),
                  tr(language, "Максимальная скорость", "Maximum speed"),
                ],
                [
                  "both",
                  "Gemini + Groq",
                  tr(
                    language,
                    "Параллельный анализ и объединение",
                    "Parallel analysis and merge",
                  ),
                ],
              ] as Array<[AiProvider, string, string]>
            ).map(([id, title, text]) => (
              <button
                key={id}
                className={settings.preferredProvider === id ? "active" : ""}
                aria-pressed={settings.preferredProvider === id}
                onClick={() => setSettings({ ...settings, preferredProvider: id })}
              >
                <i /> <strong>{title}</strong>
                <span>{text}</span>
              </button>
            ))}
          </div>
          <div className="connection-actions">
            <button onClick={onTest} disabled={testing}>
              {testing
                ? tr(language, "Проверяем…", "Testing…")
                : tr(language, "Проверить API-ключи", "Test API keys")}
            </button>
            <button onClick={onRefreshModels} disabled={testing}>
              {tr(language, "Обновить список моделей", "Refresh model list")}
            </button>
            {testResult && (
              <div className="test-results">
                <span className={testResult.gemini.ok ? "ok" : "bad"}>
                  Gemini: {testResult.gemini.message}
                </span>
                <span className={testResult.twelveLabs.ok ? "ok" : "bad"}>
                  TwelveLabs: {testResult.twelveLabs.message}
                </span>
                <span className={testResult.groq.ok ? "ok" : "bad"}>
                  Groq: {testResult.groq.message}
                </span>
              </div>
            )}
          </div>
        </article>
        <article className="surface settings-card wide data-settings">
          <div className="settings-title">
            <div className="settings-icon routing">↥</div>
            <div>
              <strong>{tr(language, "Данные и перенос", "Data & portability")}</strong>
              <span>
                {tr(
                  language,
                  "Экспорт не содержит API-ключей. Сброс требует подтверждения.",
                  "Exports never contain API keys. Reset requires confirmation.",
                )}
              </span>
            </div>
          </div>
          <div className="data-actions">
            <button onClick={onExportSettings}>
              {tr(language, "Экспорт настроек", "Export settings")}
            </button>
            <button onClick={() => settingsImportRef.current?.click()}>
              {tr(language, "Импорт настроек", "Import settings")}
            </button>
            <input
              ref={settingsImportRef}
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportSettings(file);
                event.currentTarget.value = "";
              }}
            />
            <button onClick={onClearCaches}>
              {tr(language, "Очистить кэш API", "Clear API cache")}
            </button>
            <button className="danger" onClick={onResetData}>
              {tr(language, "Сбросить локальные данные", "Reset local data")}
            </button>
          </div>
        </article>
      </div>
      {/* The only save button sat at the top of a four-screen page, so an
          edit at the bottom meant scrolling back up to keep it. */}
      {dirty && (
        <div className="settings-savebar">
          <span className="settings-unsaved" role="status">
            {tr(language, "Есть несохранённые изменения", "Unsaved changes")}
          </span>
          <button className="secondary-button" onClick={onDiscard} disabled={saving}>
            {tr(language, "Отменить", "Discard")}
          </button>
          <button
            className="primary-button"
            onClick={onSave}
            disabled={saving}
            aria-busy={saving}
          >
            {saving
              ? tr(language, "Сохраняем…", "Saving…")
              : tr(language, "Сохранить", "Save")}
          </button>
        </div>
      )}
    </section>
  );
}

function App() {
  const [page, setPage] = useState<Page>("overview");
  // Derived during render rather than in an effect, so the editor never
  // renders once unmounted before being kept.
  const [editorVisited, setEditorVisited] = useState(false);
  if (page === "thumbnail" && !editorVisited) setEditorVisited(true);
  const [period, setPeriod] = useState<MetricPeriod>("60m");
  const [settings, setSettings] = useState<ExtensionSettings>(
    DEFAULT_EXTENSION_SETTINGS,
  );
  const [persistedSettings, setPersistedSettings] = useState<ExtensionSettings>(
    DEFAULT_EXTENSION_SETTINGS,
  );
  const [models, setModels] = useState<AiModelCatalog>({
    gemini: GEMINI_MODEL_OPTIONS,
    groq: GROQ_MODEL_OPTIONS,
    twelveLabs: TWELVELABS_MODEL_OPTIONS,
  });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState>(DEFAULT_WORKSPACE_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testing, setTesting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [aiTopic, setAiTopic] = useState("");
  const [aiResult, setAiResult] = useState<AnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState("");
  const [aiTone, setAiTone] = useState("professional");
  const [titleMode, setTitleMode] = useState<TitleGenerationMode>("seo");
  const [aiMediaFile, setAiMediaFile] = useState<File | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<VideoSummary | null>(null);
  const [channelIdeas, setChannelIdeas] = useState<AnalysisResult | null>(null);
  const [channelIdeasLoading, setChannelIdeasLoading] = useState(false);
  const [channelIdeasError, setChannelIdeasError] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeCollectorStatus | null>(
    null,
  );
  const [contentFormat, setContentFormat] = useState<"video" | "shorts">("video");
  const [editorFormat, setEditorFormat] = useState<ThumbnailFormat>("16:9");
  const [editorHeadline, setEditorHeadline] = useState("");
  const [editorTimestamp, setEditorTimestamp] = useState<number | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resettingData, setResettingData] = useState(false);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const resettingDataRef = useRef(false);
  const resetDialogRef = useRef<HTMLElement | null>(null);
  const resetFocusReturnRef = useRef<HTMLElement | null>(null);
  const loadRequestIdRef = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  const persistedSettingsRef = useRef<ExtensionSettings>(DEFAULT_EXTENSION_SETTINGS);
  const persistedInterfaceLanguageRef = useRef<SupportedLanguage>(
    DEFAULT_EXTENSION_SETTINGS.interfaceLanguage,
  );
  const languageRefreshIdRef = useRef(0);
  const aiRequestIdRef = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiMediaRequestRef = useRef(false);
  const channelIdeasAbortRef = useRef<AbortController | null>(null);
  const workspaceSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceQueuedSaveRef = useRef<Promise<void> | null>(null);
  const workspaceSaveSequenceRef = useRef(0);
  const workspacePendingSavesRef = useRef(0);
  const lastSavedWorkspaceRef = useRef<WorkspaceState>(DEFAULT_WORKSPACE_STATE);
  const workspaceRef = useRef<WorkspaceState>(DEFAULT_WORKSPACE_STATE);
  const language = settings.interfaceLanguage;
  const mediaUploadPermitted =
    settings.allowAiMediaUploads && persistedSettings.allowAiMediaUploads;
  const settingsDirty =
    Object.keys(diffExtensionSettings(settings, persistedSettings)).length > 0;
  useInterfacePreferences(settings);

  useEffect(() => {
    const syncSettings = (
      changes: { settings?: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes.settings?.newValue) return;
      const next = normalizeExtensionSettings(changes.settings.newValue);
      const previous = persistedSettingsRef.current;
      const languageChanged =
        next.interfaceLanguage !== persistedInterfaceLanguageRef.current;
      const connectionChanged = next.googleClientId !== previous.googleClientId;
      persistedSettingsRef.current = next;
      persistedInterfaceLanguageRef.current = next.interfaceLanguage;
      setPersistedSettings(next);
      setSettings((current) =>
        normalizeExtensionSettings({
          ...next,
          ...diffExtensionSettings(current, previous),
        }),
      );
      if (
        connectionChanged &&
        next.googleClientId !== settingsRef.current.googleClientId
      )
        void loadRef.current();
      else if (languageChanged && signedInRef.current)
        void refreshTranslatedDashboard(next.interfaceLanguage);
    };
    chrome.storage.onChanged.addListener(syncSettings);
    return () => chrome.storage.onChanged.removeListener(syncSettings);
  }, []);

  // A second cabinet window used to keep its own stale copy of the workspace:
  // edits made elsewhere never showed up, and the next local edit was rejected
  // as a conflict. Adopt the stored version whenever nothing local is pending.
  useEffect(() => {
    const syncWorkspace = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      const change = changes[WORKSPACE_STORAGE_KEY];
      if (areaName !== "local" || !change?.newValue) return;
      if (workspacePendingSavesRef.current > 0 || resettingDataRef.current) return;
      const next = normalizeWorkspaceState(change.newValue);
      if (next.updatedAt === lastSavedWorkspaceRef.current.updatedAt) return;
      lastSavedWorkspaceRef.current = next;
      workspaceRef.current = next;
      setWorkspace(next);
    };
    chrome.storage.onChanged.addListener(syncWorkspace);
    return () => chrome.storage.onChanged.removeListener(syncWorkspace);
  }, []);

  useEffect(() => {
    if (!settingsDirty) return;
    const warnOnClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnOnClose);
    return () => window.removeEventListener("beforeunload", warnOnClose);
  }, [settingsDirty]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // "Configure API keys" in the YouTube panel, a planner reminder and similar
  // links ask for one section. Honoured on load and while this tab is open,
  // since openOptionsPage focuses an existing dashboard instead of reloading it.
  useEffect(() => {
    const session = chrome.storage.session;
    if (!session) return;
    const consume = (value: unknown) => {
      const requested = readDashboardPageRequest(value);
      if (!requested) return;
      void session.remove(DASHBOARD_PAGE_REQUEST_KEY).catch(() => undefined);
      setPage(requested);
    };
    void session
      .get(DASHBOARD_PAGE_REQUEST_KEY)
      .then((stored) => consume(stored[DASHBOARD_PAGE_REQUEST_KEY]))
      .catch(() => undefined);
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "session")
        consume(changes[DASHBOARD_PAGE_REQUEST_KEY]?.newValue);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    scrollDashboardTop();
  }, [page]);

  useEffect(() => {
    if (!resetDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      resetDialogRef.current
        ?.querySelector<HTMLElement>("[data-dialog-autofocus]")
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !resettingDataRef.current) {
        setResetDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        resetDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) {
        event.preventDefault();
        resetDialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      resetFocusReturnRef.current?.focus();
    };
  }, [resetDialogOpen]);

  const showNotice = useCallback((message: string) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 2600);
  }, []);

  useEffect(() => {
    if (mediaUploadPermitted) return;
    setAiMediaFile((current) => (current ? null : current));
    if (!aiMediaRequestRef.current) return;
    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    aiMediaRequestRef.current = false;
    setAiLoading(false);
    setAiProgress("");
    showNotice(
      tr(
        language,
        "Анализ медиа остановлен: разрешение отключено",
        "Media analysis stopped: permission disabled",
      ),
    );
  }, [mediaUploadPermitted, language, showNotice]);

  async function copyText(value: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      showNotice(successMessage);
    } catch {
      setError(
        tr(
          language,
          "Chrome не разрешил запись в буфер обмена",
          "Chrome did not allow clipboard access",
        ),
      );
    }
  }

  function exportAnalytics(format: "json" | "videos-csv" | "history-csv"): void {
    if (!data) {
      showNotice(tr(language, "Сначала загрузите аналитику", "Load analytics first"));
      return;
    }
    const stamp = exportStamp();
    if (format === "videos-csv") {
      downloadFile(`channelpilot-videos-${stamp}.csv`, videosCsv(data), "text/csv");
    } else if (format === "history-csv") {
      downloadFile(`channelpilot-history-${stamp}.csv`, historyCsv(data), "text/csv");
    } else {
      downloadFile(
        `channelpilot-analytics-${stamp}.json`,
        JSON.stringify(
          {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            extensionVersion: chrome.runtime.getManifest().version,
            source: "YouTube Data API v3 + YouTube Analytics API",
            dashboard: data,
          },
          null,
          2,
        ),
        "application/json",
      );
    }
    showNotice(tr(language, "Экспорт подготовлен", "Export is ready"));
  }

  function exportAiResult(): void {
    if (!aiResult) {
      showNotice(tr(language, "Сначала выполните AI-анализ", "Run AI analysis first"));
      return;
    }
    downloadFile(
      `channelpilot-ai-${exportStamp()}.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          mediaName: aiMediaFile?.name ?? null,
          topic: aiTopic,
          generationLanguage: settings.generationLanguage,
          result: aiResult,
        },
        null,
        2,
      ),
      "application/json",
    );
    showNotice(tr(language, "AI-результат экспортирован", "AI result exported"));
  }

  function exportSettings(): void {
    const safeSettings = Object.fromEntries(
      Object.entries(settings).filter(([key]) => !SECRET_SETTING_KEYS.has(key)),
    );
    downloadFile(
      `channelpilot-settings-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          secretsIncluded: false,
          settings: safeSettings,
        },
        null,
        2,
      ),
      "application/json",
    );
    showNotice(
      tr(
        language,
        "Настройки экспортированы без API-ключей",
        "Settings exported without API keys",
      ),
    );
  }

  async function importSettings(file: File): Promise<void> {
    try {
      if (file.size > 1_000_000) {
        throw new Error(
          tr(
            language,
            "Файл настроек слишком большой (максимум 1 МБ)",
            "Settings file is too large (1 MB max)",
          ),
        );
      }
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(
          tr(language, "Файл настроек имеет неверный формат", "Invalid settings file"),
        );
      }
      const envelope = parsed as { schemaVersion?: unknown; settings?: unknown };
      if (envelope.schemaVersion !== undefined && envelope.schemaVersion !== 1) {
        throw new Error(
          tr(
            language,
            "Версия файла настроек не поддерживается",
            "Unsupported settings file version",
          ),
        );
      }
      if (
        !envelope.settings ||
        typeof envelope.settings !== "object" ||
        Array.isArray(envelope.settings)
      ) {
        throw new Error(
          tr(language, "Файл настроек имеет неверный формат", "Invalid settings file"),
        );
      }
      const imported = Object.fromEntries(
        Object.entries(envelope.settings).filter(([key]) =>
          IMPORTABLE_SETTING_KEYS.has(key),
        ),
      );
      if (Object.keys(imported).length === 0) {
        throw new Error(
          tr(
            language,
            "В файле нет поддерживаемых настроек",
            "No supported settings in file",
          ),
        );
      }
      const next = normalizeExtensionSettings({
        ...settings,
        ...imported,
      });
      const patch = Object.fromEntries(
        Object.keys(imported).map((key) => [key, next[key as keyof ExtensionSettings]]),
      ) as Partial<ExtensionSettings>;
      const previousClientId = persistedSettingsRef.current.googleClientId;
      const saved = await rpc<ExtensionSettings>({
        type: "SAVE_SETTINGS_TRUSTED_PATCH",
        payload: patch,
      });
      const languageChanged =
        saved.interfaceLanguage !== persistedInterfaceLanguageRef.current;
      persistedSettingsRef.current = saved;
      setPersistedSettings(saved);
      persistedInterfaceLanguageRef.current = saved.interfaceLanguage;
      setSettings(saved);
      await reconcileSavedConnection(saved, previousClientId, languageChanged);
      showNotice(tr(language, "Настройки импортированы", "Settings imported"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tr(language, "Импорт не выполнен", "Import failed"),
      );
    }
  }

  async function clearCaches(): Promise<void> {
    try {
      await rpc({ type: "CLEAR_CACHES" });
      if (signedIn) await load(true);
      showNotice(tr(language, "Кэш API очищен", "API cache cleared"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function resetLocalData(): Promise<void> {
    ++loadRequestIdRef.current;
    setLoading(false);
    resettingDataRef.current = true;
    setResettingData(true);
    window.requestAnimationFrame(() => resetDialogRef.current?.focus());
    try {
      await workspaceSaveQueueRef.current.catch(() => undefined);
      ++workspaceSaveSequenceRef.current;
      await rpc({ type: "RESET_LOCAL_DATA", preserveSettings: true });
      lastSavedWorkspaceRef.current = DEFAULT_WORKSPACE_STATE;
      workspaceRef.current = DEFAULT_WORKSPACE_STATE;
      setWorkspace(DEFAULT_WORKSPACE_STATE);
      setData(null);
      setSignedIn(false);
      setReauthRequired(false);
      setRealtimeStatus(null);
      setAiResult(null);
      setResetDialogOpen(false);
      showNotice(tr(language, "Локальные данные сброшены", "Local data reset"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      resettingDataRef.current = false;
      setResettingData(false);
    }
  }

  function openResetDialog(): void {
    resetFocusReturnRef.current = document.activeElement as HTMLElement | null;
    setResetDialogOpen(true);
  }

  async function load(force = false) {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const loadedSettings = await rpc<ExtensionSettings>({ type: "GET_SETTINGS" });
      if (requestId !== loadRequestIdRef.current) return;
      const previousSettings = persistedSettingsRef.current;
      persistedSettingsRef.current = loadedSettings;
      setPersistedSettings(loadedSettings);
      persistedInterfaceLanguageRef.current = loadedSettings.interfaceLanguage;
      setSettings((current) =>
        normalizeExtensionSettings({
          ...loadedSettings,
          ...diffExtensionSettings(current, previousSettings),
        }),
      );
      const workspaceSequence = workspaceSaveSequenceRef.current;
      await workspaceSaveQueueRef.current.catch(() => undefined);
      if (requestId !== loadRequestIdRef.current) return;
      const loadedWorkspace = await rpc<WorkspaceState>({
        type: "GET_WORKSPACE_STATE",
      });
      if (requestId !== loadRequestIdRef.current) return;
      if (workspaceSequence === workspaceSaveSequenceRef.current) {
        lastSavedWorkspaceRef.current = loadedWorkspace;
        workspaceRef.current = loadedWorkspace;
        setWorkspace(loadedWorkspace);
      }
      const auth = await rpc<GoogleAuthStatus>({ type: "AUTH_STATUS" });
      if (requestId !== loadRequestIdRef.current) return;
      setSignedIn(auth.signedIn);
      setReauthRequired(auth.reauthRequired);
      if (auth.signedIn) {
        try {
          const dashboard = await rpc<DashboardData>({ type: "GET_DASHBOARD", force });
          if (requestId !== loadRequestIdRef.current) return;
          setData(dashboard);
        } catch (dashboardError) {
          if (requestId !== loadRequestIdRef.current) return;
          if (!auth.reauthRequired) throw dashboardError;
          setData(null);
        }
      } else {
        setData(null);
      }
      try {
        const status = await rpc<RealtimeCollectorStatus>({
          type: "GET_REALTIME_STATUS",
        });
        if (requestId === loadRequestIdRef.current) setRealtimeStatus(status);
      } catch {
        if (requestId === loadRequestIdRef.current) setRealtimeStatus(null);
      }
    } catch (caught) {
      if (requestId === loadRequestIdRef.current) {
        setData((current) => (current ? { ...current, stale: true } : null));
        setError(
          caught instanceof Error
            ? caught.message
            : tr(language, "Не удалось получить аналитику", "Could not load analytics"),
        );
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    const requestIdRef = loadRequestIdRef;
    void loadRef.current();
    return () => {
      ++requestIdRef.current;
      window.clearTimeout(noticeTimerRef.current);
      aiAbortRef.current?.abort();
      channelIdeasAbortRef.current?.abort();
    };
  }, []);

  // The cabinet shows "last 60 minutes" counters but used to read them once and
  // then freeze until the user pressed Refresh; only the YouTube panel honoured
  // the "Analytics refresh" setting. A non-forced read is served from the
  // service worker's cache, so this costs no API quota beyond the background
  // collector's own schedule.
  const analyticsRefreshSeconds = persistedSettings.analyticsRefreshSeconds;
  useEffect(() => {
    if (!signedIn) return;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      const loadId = loadRequestIdRef.current;
      const refreshId = languageRefreshIdRef.current;
      try {
        const [dashboard, status] = await Promise.all([
          rpc<DashboardData>({ type: "GET_DASHBOARD" }),
          rpc<RealtimeCollectorStatus>({ type: "GET_REALTIME_STATUS" }),
        ]);
        // A manual load, sign-out or language switch started meanwhile owns
        // the state now; this older answer must not overwrite it.
        if (
          loadId !== loadRequestIdRef.current ||
          refreshId !== languageRefreshIdRef.current
        )
          return;
        setData(dashboard);
        setRealtimeStatus(status);
      } catch {
        // Silent by design: a failed background poll keeps the last snapshot,
        // and the next tick or a manual refresh reports a persistent problem.
      } finally {
        inFlight = false;
      }
    };
    const interval = window.setInterval(
      () => void poll(),
      Math.max(60, analyticsRefreshSeconds) * 1_000,
    );
    const onVisibility = () => void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [signedIn, analyticsRefreshSeconds]);

  async function signIn() {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      if (!isGoogleClientId(settings.googleClientId)) {
        throw new Error(
          tr(
            language,
            "Введите OAuth Client ID типа «Веб-приложение» в разделе «Подключения». Gemini API key сюда не подходит.",
            "Enter a Web application OAuth Client ID under Connections. A Gemini API key cannot be used here.",
          ),
        );
      }
      const draft = settings;
      const saved = await rpc<ExtensionSettings>({
        type: "SAVE_SETTINGS_TRUSTED_PATCH",
        payload: diffExtensionSettings(draft, persistedSettingsRef.current),
      });
      if (requestId !== loadRequestIdRef.current) return;
      persistedSettingsRef.current = saved;
      setPersistedSettings(saved);
      persistedInterfaceLanguageRef.current = saved.interfaceLanguage;
      setSettings((current) => (current === draft ? saved : current));
      const result = await rpc<GoogleSignInResult>({ type: "SIGN_IN" });
      if (requestId !== loadRequestIdRef.current) return;
      setSignedIn(true);
      setReauthRequired(false);
      if (result.warning) setError(result.warning);
      try {
        const dashboard = await rpc<DashboardData>({
          type: "GET_DASHBOARD",
          force: true,
        });
        if (requestId !== loadRequestIdRef.current) return;
        setData(dashboard);
      } catch (dashboardError) {
        if (requestId !== loadRequestIdRef.current) return;
        setData(null);
        if (!result.warning) {
          setError(
            dashboardError instanceof Error
              ? dashboardError.message
              : tr(
                  language,
                  "Google подключён, но аналитика YouTube пока недоступна.",
                  "Google is connected, but YouTube analytics is currently unavailable.",
                ),
          );
        }
      }
      try {
        const status = await rpc<RealtimeCollectorStatus>({
          type: "GET_REALTIME_STATUS",
        });
        if (requestId !== loadRequestIdRef.current) return;
        setRealtimeStatus(status);
      } catch {
        if (requestId !== loadRequestIdRef.current) return;
        setRealtimeStatus(null);
      }
      showNotice(
        result.warning
          ? tr(
              language,
              "Google подключён — проверьте YouTube API",
              "Google connected — check YouTube APIs",
            )
          : tr(language, "YouTube-канал подключён", "YouTube channel connected"),
      );
    } catch (caught) {
      if (requestId === loadRequestIdRef.current)
        setError(
          caught instanceof Error
            ? caught.message
            : tr(language, "Ошибка входа", "Sign-in failed"),
        );
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }

  async function saveWorkspace(
    change: WorkspaceState | ((current: WorkspaceState) => WorkspaceState),
  ): Promise<boolean> {
    if (resettingDataRef.current) return false;
    const next = typeof change === "function" ? change(workspaceRef.current) : change;
    const sequence = ++workspaceSaveSequenceRef.current;
    workspaceRef.current = next;
    setWorkspace(next);

    // Latest wins. The edit is visible at once, but at most one write is in
    // flight and one waits behind it; the waiting write reads the newest state
    // when it starts. Each write carries the whole workspace — AI history
    // included — through the service worker, which re-normalizes it, and the
    // planner saves on every keystroke: a typed sentence used to queue one
    // full write per character.
    let operation = workspaceQueuedSaveRef.current;
    if (!operation) {
      const queued: Promise<void> = workspaceSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          // Edits made from now on need a write of their own.
          if (workspaceQueuedSaveRef.current === queued) {
            workspaceQueuedSaveRef.current = null;
          }
          const payloadSequence = workspaceSaveSequenceRef.current;
          const saved = await rpc<WorkspaceState>({
            type: "SAVE_WORKSPACE_STATE",
            payload: {
              ...workspaceRef.current,
              updatedAt: lastSavedWorkspaceRef.current.updatedAt,
            },
          });
          lastSavedWorkspaceRef.current = saved;
          if (payloadSequence === workspaceSaveSequenceRef.current) {
            workspaceRef.current = saved;
            setWorkspace(saved);
          }
        });
      workspaceQueuedSaveRef.current = queued;
      workspaceSaveQueueRef.current = queued;
      operation = queued;
    }
    workspacePendingSavesRef.current += 1;

    try {
      await operation;
      return true;
    } catch (caught) {
      if (sequence === workspaceSaveSequenceRef.current) {
        workspaceRef.current = lastSavedWorkspaceRef.current;
        setWorkspace(lastSavedWorkspaceRef.current);
        const message = caught instanceof Error ? caught.message : "";
        if (message === "WORKSPACE_CONFLICT") {
          // Pull the version the other window saved, so the retry the message
          // asks for succeeds instead of hitting the same conflict again.
          void rpc<WorkspaceState>({ type: "GET_WORKSPACE_STATE" })
            .then((latest) => {
              if (sequence !== workspaceSaveSequenceRef.current) return;
              lastSavedWorkspaceRef.current = latest;
              workspaceRef.current = latest;
              setWorkspace(latest);
            })
            .catch(() => undefined);
        }
        setError(
          message === "WORKSPACE_CONFLICT"
            ? tr(
                language,
                "Рабочее пространство изменилось в другой вкладке — загружена актуальная версия. Повторите действие.",
                "Workspace changed in another window — the latest version is loaded. Please repeat the action.",
              )
            : message ||
                tr(
                  language,
                  "Не удалось сохранить рабочее пространство",
                  "Could not save workspace",
                ),
        );
      }
      return false;
    } finally {
      workspacePendingSavesRef.current -= 1;
    }
  }

  async function signOut() {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      await rpc({ type: "SIGN_OUT" });
      if (requestId !== loadRequestIdRef.current) return;
      setSignedIn(false);
      setReauthRequired(false);
      setData(null);
      setRealtimeStatus(null);
      showNotice(
        tr(language, "Google-аккаунт отключён", "Google account disconnected"),
      );
    } catch (caught) {
      if (requestId === loadRequestIdRef.current)
        setError(
          caught instanceof Error
            ? caught.message
            : tr(language, "Ошибка выхода", "Sign-out failed"),
        );
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }

  async function refreshTranslatedDashboard(next: SupportedLanguage): Promise<void> {
    const refreshId = ++languageRefreshIdRef.current;
    const loadId = loadRequestIdRef.current;
    setData(null);
    try {
      const dashboard = await rpc<DashboardData>({ type: "GET_DASHBOARD" });
      if (
        refreshId === languageRefreshIdRef.current &&
        loadId === loadRequestIdRef.current
      )
        setData(dashboard);
    } catch (caught) {
      if (
        refreshId === languageRefreshIdRef.current &&
        loadId === loadRequestIdRef.current
      )
        setError(
          caught instanceof Error
            ? caught.message
            : tr(next, "Не удалось обновить аналитику", "Could not refresh analytics"),
        );
    }
  }

  async function reconcileSavedConnection(
    saved: ExtensionSettings,
    previousClientId: string,
    languageChanged: boolean,
  ): Promise<void> {
    if (saved.googleClientId !== previousClientId) {
      setSignedIn(false);
      setReauthRequired(false);
      setData(null);
      setRealtimeStatus(null);
    }
    try {
      const auth = await rpc<GoogleAuthStatus>({ type: "AUTH_STATUS" });
      setSignedIn(auth.signedIn);
      setReauthRequired(auth.reauthRequired);
      if (!auth.signedIn) {
        setData(null);
        setRealtimeStatus(null);
      } else if (languageChanged) {
        await refreshTranslatedDashboard(saved.interfaceLanguage);
      }
    } catch (caught) {
      const message = tr(
        saved.interfaceLanguage,
        "Настройки сохранены, но не удалось проверить подключение Google",
        "Settings saved, but the Google connection could not be checked",
      );
      setError(caught instanceof Error ? `${message}: ${caught.message}` : message);
    }
  }

  async function saveSettings(): Promise<boolean> {
    const draft = settings;
    const previousClientId = persistedSettingsRef.current.googleClientId;
    let saved: ExtensionSettings;
    try {
      saved = await rpc<ExtensionSettings>({
        type: "SAVE_SETTINGS_TRUSTED_PATCH",
        payload: diffExtensionSettings(draft, persistedSettingsRef.current),
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tr(language, "Настройки не сохранены", "Settings were not saved"),
      );
      return false;
    }
    const languageChanged =
      saved.interfaceLanguage !== persistedInterfaceLanguageRef.current;
    persistedSettingsRef.current = saved;
    setPersistedSettings(saved);
    persistedInterfaceLanguageRef.current = saved.interfaceLanguage;
    setSettings((current) => (current === draft ? saved : current));
    await reconcileSavedConnection(saved, previousClientId, languageChanged);
    showNotice(tr(language, "Настройки сохранены", "Settings saved"));
    return true;
  }

  async function saveSettingsFromPanel(): Promise<void> {
    if (savingSettings) return;
    setSavingSettings(true);
    try {
      await saveSettings();
    } finally {
      setSavingSettings(false);
    }
  }

  function changeInterfaceLanguage(next: SupportedLanguage) {
    const nextSettings = { ...settings, interfaceLanguage: next };
    setSettings(nextSettings);
    void rpc<ExtensionSettings>({
      type: "SAVE_SETTINGS_PATCH",
      payload: { interfaceLanguage: next },
    })
      .then(async (saved) => {
        const languageChanged =
          saved.interfaceLanguage !== persistedInterfaceLanguageRef.current;
        persistedSettingsRef.current = saved;
        setPersistedSettings(saved);
        persistedInterfaceLanguageRef.current = saved.interfaceLanguage;
        if (languageChanged && signedIn)
          await refreshTranslatedDashboard(saved.interfaceLanguage);
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : tr(
                next,
                "Не удалось изменить язык интерфейса",
                "Could not update the interface language",
              ),
        );
      });
  }

  async function testKeys() {
    setTesting(true);
    setTestResult(null);
    try {
      if (!(await saveSettings())) return;
      setTestResult(await rpc<TestResult>({ type: "TEST_AI_KEYS" }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tr(language, "Проверка API не выполнена", "API test failed"),
      );
    } finally {
      setTesting(false);
    }
  }

  async function refreshModels() {
    setTesting(true);
    try {
      if (!(await saveSettings())) return;
      const catalog = await rpc<AiModelCatalog>({ type: "LIST_AI_MODELS" });
      setModels(catalog);
      showNotice(
        tr(
          language,
          `Доступно моделей: Gemini ${catalog.gemini.length}, TwelveLabs ${catalog.twelveLabs.length}, Groq ${catalog.groq.length}`,
          `Models available: Gemini ${catalog.gemini.length}, TwelveLabs ${catalog.twelveLabs.length}, Groq ${catalog.groq.length}`,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tr(
              language,
              "Не удалось обновить список моделей",
              "Could not refresh the model list",
            ),
      );
    } finally {
      setTesting(false);
    }
  }

  async function runAi(
    topic = aiTopic,
    media = aiMediaFile,
    video: VideoSummary | null = selectedVideo,
  ) {
    if (media && !mediaUploadPermitted) {
      setError(
        tr(
          language,
          "Сохраните разрешение на отправку медиа перед анализом",
          "Save the media-upload permission before analyzing a file",
        ),
      );
      return;
    }
    if (!topic.trim() && !media) {
      setError(
        tr(
          language,
          "Введите тему или загрузите видео",
          "Enter a topic or upload a video",
        ),
      );
      return;
    }
    const requestId = ++aiRequestIdRef.current;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    aiMediaRequestRef.current = Boolean(media);
    setAiLoading(true);
    setAiProgress(
      media
        ? tr(
            language,
            "Подготавливаем файл и выбираем подходящую модель…",
            "Preparing the file and selecting the right model…",
          )
        : tr(
            language,
            "Анализируем тему и поисковый потенциал…",
            "Analyzing the topic and search potential…",
          ),
    );
    setError("");
    try {
      const formatInstruction =
        contentFormat === "shorts"
          ? "YouTube Shorts 9:16, hook in the first second, concise title and vertical-safe visual concept"
          : "YouTube long-form 16:9, strong promise, retention-focused structure and horizontal thumbnail";
      // A published video (picked from the dashboard or pasted as a link) is
      // watched by Gemini directly; a pasted link is a source, not a topic.
      const linkedVideoId = media ? null : (video?.id ?? youtubeVideoIdFromUrl(topic));
      const topicText = !video && linkedVideoId ? "" : topic;
      const channelContext = buildChannelStyleContext(data, {
        excludeVideoId: linkedVideoId ?? undefined,
      });
      const context: VideoContext = {
        title: topicText,
        description: video && !media ? video.description.slice(0, 5_000) : "",
        tags: video && !media ? video.tags.slice(0, 30) : [],
        topic: topicText
          ? `${topicText}\nContent format: ${formatInstruction}`
          : `Content format: ${formatInstruction}`,
        language: settings.generationLanguage,
        tone: `${aiTone}, specific, no misleading clickbait`,
        titleMode,
        task: "video_optimization" as const,
        ...(channelContext ? { channelContext } : {}),
      };
      let result: AnalysisResult;
      if (media) {
        const mediaSettings = await rpc<ExtensionSettings>({ type: "GET_SETTINGS" });
        if (
          !mediaSettings.allowAiMediaUploads ||
          !persistedSettingsRef.current.allowAiMediaUploads ||
          controller.signal.aborted ||
          requestId !== aiRequestIdRef.current
        ) {
          throw new DOMException("Media analysis permission changed", "AbortError");
        }
        result = await analyzeMediaDirect(
          context,
          media,
          mediaSettings,
          (progress) => {
            if (requestId === aiRequestIdRef.current) {
              setAiProgress(progress.message);
            }
          },
          controller.signal,
        );
      } else if (linkedVideoId) {
        result = await analyzeYouTubeVideoDirect(
          context,
          linkedVideoId,
          settings,
          (progress) => {
            if (requestId === aiRequestIdRef.current) {
              setAiProgress(progress.message);
            }
          },
          controller.signal,
        );
      } else {
        result = await analyzeTextDirect(
          context,
          settings,
          settings.preferredProvider,
          controller.signal,
        );
      }
      if (requestId !== aiRequestIdRef.current) return;
      setAiResult(result);
      await saveWorkspace((current) => ({
        ...current,
        aiHistory: [
          ...current.aiHistory,
          {
            id: `analysis-${Date.now()}`,
            task: "video_optimization" as const,
            topic: topic || media?.name || "",
            result,
            createdAt: new Date().toISOString(),
          },
        ].slice(-30),
      }));
      setAiProgress("");
      showNotice(
        tr(
          language,
          `AI-анализ готов · ${result.provider}`,
          `AI analysis ready · ${result.provider}`,
        ),
      );
    } catch (caught) {
      if (requestId === aiRequestIdRef.current && !controller.signal.aborted) {
        setAiProgress("");
        setError(
          caught instanceof Error
            ? caught.message
            : tr(language, "AI-анализ не выполнен", "AI analysis failed"),
        );
      }
    } finally {
      if (requestId === aiRequestIdRef.current) {
        setAiLoading(false);
        aiMediaRequestRef.current = false;
      }
      if (aiAbortRef.current === controller) aiAbortRef.current = null;
    }
  }

  function cancelAi(): void {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    aiRequestIdRef.current += 1;
    aiMediaRequestRef.current = false;
    setAiLoading(false);
    setAiProgress("");
    showNotice(tr(language, "AI-запрос отменён", "AI request cancelled"));
  }

  function analyzeVideo(video: VideoSummary) {
    aiRequestIdRef.current += 1;
    setSelectedVideo(video);
    setAiMediaFile(null);
    setAiResult(null);
    setAiProgress("");
    setEditorTimestamp(null);
    setAiTopic(video.title);
    setPage("ai");
    scrollDashboardTop();
    void runAi(video.title, null, video);
  }

  async function generateChannelIdeas() {
    if (!data || channelIdeasLoading) return;
    channelIdeasAbortRef.current?.abort();
    const controller = new AbortController();
    channelIdeasAbortRef.current = controller;
    setChannelIdeasLoading(true);
    setChannelIdeasError("");
    try {
      const topSource = data.trafficSources[0];
      const topCountry = data.countries[0];
      const topDevice = data.devices[0];
      const subscribed = data.subscribedStatus.find(
        (item) => item.key === "SUBSCRIBED",
      );
      const { fastest, cooling, bestEngagement } = intelligence;
      const facts = [
        `${tr(language, "Канал", "Channel")}: ${data.channel.title}.`,
        `${tr(language, "Подписчиков", "Subscribers")}: ${data.channel.subscribers}; ${tr(language, "всего просмотров", "total views")}: ${data.channel.views}; ${tr(language, "видео", "videos")}: ${data.channel.videos}.`,
        `28${tr(language, "д", "d")}: ${metrics.total28} ${tr(language, "просмотров", "views")}, ${metrics.watchMinutes} ${tr(language, "минут просмотра", "watch minutes")}, ${tr(language, "удержание", "retention")} ${metrics.retention === null ? tr(language, "недоступно", "unavailable") : `${metrics.retention.toFixed(1)}%`}.`,
        metrics.change7Ready
          ? `${tr(language, "Динамика 7 дней", "7-day change")}: ${metrics.change7}%.`
          : "",
        `${tr(language, "Чистый прирост подписчиков 28д", "Net subscribers 28d")}: ${metrics.subscribersNet} (+${metrics.subscribersGained} / −${metrics.subscribersLost}).`,
        `${tr(language, "Вовлечённость последних видео", "Recent engagement")}: ${metrics.engagement.toFixed(2)}%.`,
        topSource
          ? `${tr(language, "Главный источник трафика", "Top traffic source")}: ${topSource.label} — ${topSource.share.toFixed(1)}%.`
          : "",
        topCountry
          ? `${tr(language, "Главная страна", "Top country")}: ${topCountry.label} — ${topCountry.share.toFixed(1)}%.`
          : "",
        topDevice
          ? `${tr(language, "Главное устройство", "Top device")}: ${topDevice.label} — ${topDevice.share.toFixed(1)}%.`
          : "",
        subscribed
          ? `${tr(language, "Доля подписанных зрителей", "Subscribed viewers share")}: ${subscribed.share.toFixed(1)}%.`
          : "",
        intelligence.cadenceDays
          ? `${tr(language, "Средний интервал публикаций", "Average upload interval")}: ${intelligence.cadenceDays.toFixed(1)} ${tr(language, "дн", "days")}.`
          : "",
        `${tr(language, "Медиана просмотров по видео", "Median views per video")}: ${intelligence.medianViews}.`,
        fastest
          ? `${tr(language, "Быстрее всех растёт", "Fastest growing")}: «${fastest.title}» (~${Math.round(hourlyPace(fastest))}/${tr(language, "ч", "h")}).`
          : "",
        bestEngagement
          ? `${tr(language, "Лучшая вовлечённость", "Best engagement")}: «${bestEngagement.title}».`
          : "",
        cooling
          ? `${tr(language, "Теряет темп", "Losing momentum")}: «${cooling.title}».`
          : "",
      ].filter(Boolean);
      const directive = tr(
        language,
        "Это реальная статистика YouTube-канала. Предложи конкретные идеи по улучшению и росту: какие ролики снимать дальше, как усилить удержание, упаковку (заголовки/превью) и источники трафика. В recommendations дай приоритетные действия. Опирайся только на приведённые цифры, без выдуманных гарантий просмотров.",
        "These are real YouTube channel statistics. Propose concrete improvement and growth ideas: which videos to make next, how to strengthen retention, packaging (titles/thumbnails) and traffic sources. Put prioritized actions in recommendations. Rely only on the numbers given, with no invented view guarantees.",
      );
      const channelContext = buildChannelStyleContext(data);
      const result = await analyzeTextDirect(
        {
          title: data.channel.title,
          description: `${directive}\n\n${facts.join("\n")}`,
          tags: [],
          language: settings.generationLanguage,
          topic: tr(language, "Стратегия роста канала", "Channel growth strategy"),
          task: "idea_generation",
          ...(channelContext ? { channelContext } : {}),
        },
        settings,
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setChannelIdeas(result);
      showNotice(
        tr(
          language,
          `AI-идеи готовы · ${result.provider}`,
          `AI ideas ready · ${result.provider}`,
        ),
      );
    } catch (caught) {
      if (!controller.signal.aborted) {
        setChannelIdeasError(
          caught instanceof Error
            ? caught.message
            : tr(language, "Не удалось получить идеи", "Could not generate ideas"),
        );
      }
    } finally {
      if (channelIdeasAbortRef.current === controller) {
        channelIdeasAbortRef.current = null;
      }
      setChannelIdeasLoading(false);
    }
  }

  const savedIdeaTitles = useMemo(
    () => new Set(workspace.ideas.map((idea) => idea.title)),
    [workspace.ideas],
  );

  /** Keeps the overview's AI ideas: one title, or every one not saved yet. */
  async function saveChannelIdeas(onlyTitle?: string): Promise<void> {
    if (!channelIdeas) return;
    const candidates = contentIdeasFromResult(channelIdeas, "long", "medium").filter(
      (idea) =>
        (onlyTitle === undefined || idea.title === onlyTitle) &&
        !savedIdeaTitles.has(idea.title),
    );
    if (candidates.length === 0) return;
    try {
      let added = 0;
      const saved = await saveWorkspace((current) => {
        const known = new Set(current.ideas.map((idea) => idea.title));
        const additions = candidates.filter((idea) => !known.has(idea.title));
        if (current.ideas.length + additions.length > IDEA_LIMIT) {
          throw new Error(
            tr(
              language,
              "В «Идеях» не хватает места. Удалите ненужные идеи.",
              "Ideas are full. Remove ideas you no longer need.",
            ),
          );
        }
        added = additions.length;
        return { ...current, ideas: [...additions, ...current.ideas] };
      });
      if (!saved) return;
      showNotice(
        added === 1
          ? tr(language, "Идея сохранена в «Идеи»", "Idea saved to Ideas")
          : tr(language, `Сохранено идей: ${added}`, `${added} ideas saved`),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function editThumbnail(video: VideoSummary) {
    setSelectedVideo(video);
    setAiMediaFile(null);
    setEditorFormat("16:9");
    setEditorHeadline(video.title);
    setEditorTimestamp(null);
    setPage("thumbnail");
    scrollDashboardTop();
  }

  function openEditorFromAi(
    title = aiResult?.titles[0] ?? aiTopic,
    timestampSeconds: number | null = null,
  ) {
    setEditorFormat(contentFormat === "shorts" ? "9:16" : "16:9");
    setEditorHeadline(title);
    setEditorTimestamp(timestampSeconds);
    setPage("thumbnail");
    scrollDashboardTop();
  }

  async function repairRealtime() {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      await rpc({ type: "COLLECT_REALTIME" });
      if (requestId !== loadRequestIdRef.current) return;
      const [dashboard, status] = await Promise.all([
        rpc<DashboardData>({ type: "GET_DASHBOARD" }),
        rpc<RealtimeCollectorStatus>({ type: "GET_REALTIME_STATUS" }),
      ]);
      if (requestId !== loadRequestIdRef.current) return;
      setData(dashboard);
      setRealtimeStatus(status);
      showNotice(tr(language, "Снимок просмотров записан", "View snapshot saved"));
    } catch (caught) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : tr(language, "Сбор просмотров не выполнен", "View collection failed"),
      );
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }

  const metrics = useMemo(() => {
    const history = [...(data?.history ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const current7 = sum(history.slice(-7).map((item) => item.views));
    const previous7 = sum(history.slice(-14, -7).map((item) => item.views));
    const historyReady = history.length >= 14;
    const change7Ready = historyReady && previous7 > 0;
    const totalViews = sum(history.map((item) => item.views));
    const weightedRetention =
      totalViews > 0 &&
      data?.historyDetailAvailable !== false &&
      history.every((day) => day.views === 0 || day.averageViewPercentage !== null)
        ? history.reduce(
            (total, item) => total + (item.averageViewPercentage ?? 0) * item.views,
            0,
          ) / totalViews
        : null;
    return {
      views60: data?.channelObservedViewsLastHour ?? 0,
      views24: data?.channelObservedViewsLast24Hours ?? 0,
      views48: data?.channelObservedViewsLast48Hours ?? 0,
      allViews: data?.channel.views ?? 0,
      current7,
      change7: change7Ready ? percentChange(current7, previous7) : 0,
      change7Ready,
      historyReady,
      total28: totalViews,
      retention: weightedRetention,
      watchMinutes: sum(history.map((item) => item.estimatedMinutesWatched)),
      subscribersGained: sum(history.map((item) => item.subscribersGained)),
      subscribersLost: sum(history.map((item) => item.subscribersLost)),
      subscribersNet: sum(
        history.map((item) => item.subscribersGained - item.subscribersLost),
      ),
      engagement: sum((data?.videos ?? []).map((video) => video.views))
        ? (sum((data?.videos ?? []).map((video) => video.likes + video.comments)) /
            sum((data?.videos ?? []).map((video) => video.views))) *
          100
        : 0,
    };
  }, [data]);

  const hourCoverage = realtimeWindowCoverage(data?.channelObservedMinutes ?? 0, 60);
  const dayCoverage = realtimeWindowCoverage(
    data?.channelObservedMinutes24Hours ?? 0,
    24 * 60,
  );
  const realtimeCoverageNote = (coverage: ReturnType<typeof realtimeWindowCoverage>) =>
    coverage.complete
      ? tr(language, "полное окно", "full window")
      : tr(
          language,
          `накоплено ${coverage.observedMinutes} из ${coverage.targetMinutes} мин`,
          `${coverage.observedMinutes} of ${coverage.targetMinutes} min observed`,
        );
  const realtimeSourceNote = (source: RealtimeSource | undefined) =>
    source === "hybrid_video_delta"
      ? tr(language, "Быстрый публичный замер", "Fast public-counter sample")
      : source === "channel_total"
        ? tr(language, "Публичный счётчик", "Public counter")
        : tr(language, "Источник не определён", "Source unavailable");

  const subscriberLeaders = [...(data?.videos ?? [])]
    .filter(
      (video) => video.subscribersGained28Days > 0 || video.subscribersLost28Days > 0,
    )
    .sort(
      (left, right) =>
        right.subscribersGained28Days -
        right.subscribersLost28Days -
        (left.subscribersGained28Days - left.subscribersLost28Days),
    );
  const intelligence = useMemo(() => {
    const videos = data?.videos ?? [];
    const totalHourlyPace = sum(videos.map(hourlyPace));
    const fastest = [...videos]
      .sort(
        (left, right) =>
          hourlyPace(right) - hourlyPace(left) ||
          right.observedViewsLastHour - left.observedViewsLastHour,
      )
      .find((video) => hourlyPace(video) > 0);
    const bestEngagement = [...videos]
      .filter((video) => video.views >= 20)
      .sort((left, right) => engagementPercent(right) - engagementPercent(left))[0];
    const cooling = [...videos]
      .filter(
        (video) =>
          video.observedViewsLastHour > 0 &&
          video.observedMinutesLast15 >= 5 &&
          video.previousObservedMinutes15 >= 5,
      )
      .sort((left, right) => left.velocityTrendPercent - right.velocityTrendPercent)[0];
    const publicationDates = videos
      .map((video) => new Date(video.publishedAt).getTime())
      .filter(Number.isFinite)
      .sort((left, right) => right - left)
      .slice(0, 10);
    const cadenceGaps = publicationDates
      .slice(0, -1)
      .map(
        (date, index) =>
          Math.abs(date - (publicationDates[index + 1] ?? date)) / 86_400_000,
      )
      .filter((gap) => gap > 0);
    return {
      leaderShare:
        totalHourlyPace > 0 && fastest
          ? (hourlyPace(fastest) / totalHourlyPace) * 100
          : 0,
      projected24:
        (data?.channelObservedMinutes ?? 0) >= 15
          ? (metrics.views60 / Math.max(1, data?.channelObservedMinutes ?? 0)) * 60 * 24
          : null,
      medianViews: median(videos.map((video) => video.views)),
      cadenceDays: cadenceGaps.length
        ? cadenceGaps.reduce((total, gap) => total + gap, 0) / cadenceGaps.length
        : 0,
      fastest,
      bestEngagement,
      cooling,
    };
  }, [data, metrics.views60]);

  return (
    <div className="dashboard-shell" aria-busy={loading}>
      <aside className="sidebar" inert={resetDialogOpen}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                d="M20.7 3.3 3.8 10.4c-1.05.44-1 1.96.08 2.28l6.2 1.86 1.86 6.2c.32 1.08 1.84 1.13 2.28.08L20.7 3.3Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <strong>ChannelPilot</strong>
            <span>AI GROWTH COPILOT</span>
          </div>
        </div>
        {/* The card carried a dropdown chevron but was a plain <div>, so it
            promised an account menu and did nothing. The account is managed on
            the Connections page, which is where it now leads. */}
        {data ? (
          <button
            type="button"
            className="channel-card"
            onClick={() => {
              setPage("settings");
              scrollDashboardTop();
            }}
            title={tr(language, "Управление подключением", "Manage connection")}
          >
            {data.channel.avatarUrl ? (
              <img src={data.channel.avatarUrl} alt="" />
            ) : (
              <div className="channel-fallback">{data.channel.title.slice(0, 1)}</div>
            )}
            <div>
              <strong>{data.channel.title}</strong>
              <span>
                {compact(data.channel.subscribers)}{" "}
                {tr(language, "подписчиков", "subscribers")}
              </span>
            </div>
            <i aria-hidden="true">›</i>
          </button>
        ) : (
          <button
            type="button"
            className="channel-card disconnected"
            onClick={() => {
              setPage("settings");
              scrollDashboardTop();
            }}
          >
            <div className="channel-fallback">?</div>
            <div>
              <strong>
                {tr(language, "Канал не подключён", "Channel not connected")}
              </strong>
              <span>
                {tr(language, "Настройте Google OAuth", "Configure Google OAuth")}
              </span>
            </div>
          </button>
        )}
        <DashboardNavigation
          items={NAVIGATION.map(([id, label, icon]) => ({
            id,
            label: label[language],
            icon: <NavIcon name={icon} />,
          }))}
          active={page}
          language={language}
          onChange={(id) => {
            setPage(id as Page);
            scrollDashboardTop();
          }}
        />
        <div className="sidebar-bottom">
          <div className="storage-note">
            <i>✓</i>
            <div>
              <strong>{tr(language, "Локальное хранение", "Local storage")}</strong>
              <span>
                {tr(
                  language,
                  "Ключи сохраняются только в этом профиле",
                  "Keys are stored only in this profile",
                )}
              </span>
            </div>
          </div>
          <span>ChannelPilot {chrome.runtime.getManifest().version} · Chrome MV3</span>
        </div>
      </aside>

      <main className="dashboard-main" inert={resetDialogOpen}>
        <DashboardTopbar
          title={
            NAVIGATION.find(([id]) => id === page)?.[1][language] ?? "ChannelPilot"
          }
          status={
            loading
              ? tr(language, "Синхронизация…", "Syncing…")
              : data
                ? `${data.stale ? tr(language, "Сохранённый снимок", "Saved snapshot") : tr(language, "Обновлено", "Updated")} ${new Date(data.sampledAt).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}`
                : tr(language, "Ожидается подключение", "Waiting for connection")
          }
          language={language}
          loading={loading}
          signedIn={Boolean(signedIn)}
          reauthRequired={reauthRequired}
          hasData={Boolean(data)}
          hasAiResult={Boolean(aiResult)}
          onLanguage={changeInterfaceLanguage}
          onRefresh={() => void load(true)}
          onSignIn={() => void signIn()}
          onSignOut={() => void signOut()}
          onExport={exportAnalytics}
          onExportAi={exportAiResult}
        />

        <div className="dashboard-content">
          {page === "overview" && (
            <>
              <section className="page-intro">
                <div>
                  <span className="eyebrow">
                    <i /> {tr(language, "АНАЛИТИКА КАНАЛА", "CHANNEL INTELLIGENCE")}
                  </span>
                  <h1>
                    {data
                      ? tr(language, "Обзор канала", "Channel overview")
                      : tr(language, "Подключите канал", "Connect your channel")}
                  </h1>
                  <p>
                    {data
                      ? tr(
                          language,
                          "Главные показатели, лидеры роста и действия с наибольшим потенциалом.",
                          "Core metrics, growth leaders and highest-impact actions.",
                        )
                      : tr(
                          language,
                          "После входа здесь появится профессиональная аналитика YouTube.",
                          "Professional YouTube analytics will appear here after sign-in.",
                        )}
                  </p>
                </div>
              </section>
              {!data ? (
                <section className="surface empty-state">
                  <div className="empty-orb">G</div>
                  <h2>
                    {reauthRequired
                      ? tr(
                          language,
                          "Обновите Google-сессию",
                          "Refresh your Google session",
                        )
                      : tr(
                          language,
                          "Подключите YouTube Analytics",
                          "Connect YouTube Analytics",
                        )}
                  </h2>
                  <p>
                    {reauthRequired
                      ? tr(
                          language,
                          "Подключение и настройки сохранены. Google просит повторно подтвердить аккаунт после истечения токена.",
                          "Your connection and settings are preserved. Google needs the account to be confirmed again after the token expired.",
                        )
                      : signedIn
                        ? tr(
                            language,
                            "Google подключён, но данные канала пока недоступны. Проверьте, что у аккаунта есть YouTube-канал и оба YouTube API включены.",
                            "Google is connected, but channel data is currently unavailable. Check that this account has a YouTube channel and both YouTube APIs are enabled.",
                          )
                        : tr(
                            language,
                            "Укажите OAuth Client ID в разделе «Подключения», затем войдите через Google.",
                            "Enter your OAuth Client ID under Connections, then sign in with Google.",
                          )}
                  </p>
                  <div>
                    <button
                      className="secondary-button"
                      onClick={() => setPage("settings")}
                    >
                      {tr(language, "Открыть подключения", "Open connections")}
                    </button>
                    <button
                      className="primary-button"
                      onClick={() =>
                        void (reauthRequired
                          ? signIn()
                          : signedIn
                            ? load(true)
                            : signIn())
                      }
                    >
                      {reauthRequired
                        ? tr(language, "Обновить Google", "Refresh Google")
                        : signedIn
                          ? tr(language, "Повторить синхронизацию", "Retry sync")
                          : tr(language, "Войти через Google", "Sign in with Google")}
                    </button>
                  </div>
                </section>
              ) : (
                <>
                  {(realtimeStatus?.lastError || data.stale || reauthRequired) && (
                    <section
                      className={`realtime-health ${realtimeStatus?.lastError || data.stale || reauthRequired ? "warning" : "healthy"}`}
                    >
                      <span className="realtime-health-dot" />
                      <div>
                        <strong>
                          {reauthRequired
                            ? tr(
                                language,
                                "Google-сессия приостановлена",
                                "Google session is paused",
                              )
                            : data.stale
                              ? tr(
                                  language,
                                  "Показан сохранённый снимок",
                                  "Showing a saved snapshot",
                                )
                              : realtimeStatus?.lastError
                                ? tr(
                                    language,
                                    "Сбор просмотров требует внимания",
                                    "View collection needs attention",
                                  )
                                : tr(
                                    language,
                                    "Realtime-сбор работает",
                                    "Realtime collection is active",
                                  )}
                        </strong>
                        <small>
                          {(reauthRequired
                            ? tr(
                                language,
                                "Подтвердите Google-аккаунт, чтобы продолжить сбор данных",
                                "Confirm your Google account to resume data collection",
                              )
                            : data.stale
                              ? tr(
                                  language,
                                  "Новые данные появятся после восстановления соединения",
                                  "Fresh data will appear after the connection is restored",
                                )
                              : realtimeStatus?.lastError) ||
                            (realtimeStatus?.lastSuccessAt
                              ? `${tr(language, "Последний снимок", "Last snapshot")} ${new Date(realtimeStatus.lastSuccessAt).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}`
                              : tr(
                                  language,
                                  "Создаём первый снимок канала",
                                  "Creating the first channel snapshot",
                                ))}
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          void (reauthRequired ? signIn() : repairRealtime())
                        }
                        disabled={loading}
                      >
                        {reauthRequired
                          ? tr(language, "Обновить Google", "Refresh Google")
                          : tr(language, "Проверить сейчас", "Check now")}
                      </button>
                    </section>
                  )}
                  {Boolean(data.analyticsWarnings?.length) && (
                    <section className="analytics-api-warning" role="status">
                      <span>!</span>
                      <div>
                        <strong>
                          {tr(
                            language,
                            "Часть YouTube Analytics недоступна",
                            "Some YouTube Analytics data is unavailable",
                          )}
                        </strong>
                        {data.analyticsWarnings!.map((warning) => (
                          <small key={warning}>{warning}</small>
                        ))}
                      </div>
                      <button onClick={() => setPage("settings")}>
                        {tr(language, "Проверить API", "Check APIs")}
                      </button>
                    </section>
                  )}
                  <section
                    className="metric-cards"
                    aria-label={tr(language, "Главные показатели", "Key metrics")}
                  >
                    <MetricCard
                      label={tr(language, "ПРОСМОТРЫ · 60 МИНУТ", "VIEWS · 60 MINUTES")}
                      value={
                        hourCoverage.observedMinutes ? compact(metrics.views60) : "—"
                      }
                      note={
                        realtimeSourceNote(data.channelRealtimeSource) +
                        " · " +
                        realtimeCoverageNote(hourCoverage)
                      }
                      tone="#8c72ff"
                    />
                    <MetricCard
                      label={tr(language, "ПРОСМОТРЫ · 24 ЧАСА", "VIEWS · 24 HOURS")}
                      value={
                        dayCoverage.observedMinutes ? compact(metrics.views24) : "—"
                      }
                      note={
                        realtimeSourceNote(data.channelRealtimeSource24Hours) +
                        " · " +
                        realtimeCoverageNote(dayCoverage)
                      }
                      tone="#8c72ff"
                    />
                    <MetricCard
                      label={tr(language, "ПРОСМОТРЫ · ВСЁ ВРЕМЯ", "VIEWS · ALL TIME")}
                      value={compact(metrics.allViews)}
                      note={tr(
                        language,
                        "Все опубликованные видео",
                        "All published videos",
                      )}
                      tone="#8c9bb5"
                    />
                    <MetricCard
                      label={tr(language, "ПОДПИСЧИКИ", "SUBSCRIBERS")}
                      value={compact(data.channel.subscribers)}
                      note={tr(
                        language,
                        "Текущая аудитория канала",
                        "Current channel audience",
                      )}
                      tone="#8c9bb5"
                    />
                  </section>

                  <AnalyticsTrust data={data} language={language} />
                  <section className="overview-grid">
                    <article className="surface main-chart">
                      <div className="section-heading compact-heading">
                        <div>
                          {/* Was "28 ДНЕЙ" — wrong as soon as the chart below
                              switches to 7 or 14 days. */}
                          <span className="eyebrow">
                            {tr(language, "АНАЛИТИКА YOUTUBE", "YOUTUBE ANALYTICS")}
                          </span>
                          <h2>{tr(language, "Динамика канала", "Channel trends")}</h2>
                        </div>
                      </div>
                      <InteractiveChart
                        history={data.history}
                        language={language}
                        accent="var(--purple)"
                      />
                    </article>
                  </section>

                  <PeriodComparison history={data.history} language={language} />
                  <VideoTable
                    videos={data.videos}
                    limit={3}
                    period={period}
                    onPeriod={setPeriod}
                    onAnalyze={analyzeVideo}
                    onEditThumbnail={editThumbnail}
                    onBrowse={() => {
                      setPage("videos");
                      scrollDashboardTop();
                    }}
                    language={language}
                  />
                  <details className="surface analytics-disclosure audience-disclosure">
                    <summary>
                      <strong>
                        {tr(language, "Аудитория и источники", "Audience & sources")}
                      </strong>
                      <span>
                        {tr(
                          language,
                          "Удержание, вовлечённость и трафик",
                          "Retention, engagement & traffic",
                        )}
                      </span>
                    </summary>
                    <section className="secondary-metrics">
                      <article className="surface">
                        <span>
                          {tr(language, "Среднее удержание", "Average retention")}
                        </span>
                        <strong>
                          {metrics.retention !== null
                            ? formatPercent(metrics.retention)
                            : "—"}
                        </strong>
                        {metrics.retention !== null && (
                          <i>
                            <u
                              style={{ width: `${Math.min(100, metrics.retention)}%` }}
                            />
                          </i>
                        )}
                        <p>
                          {metrics.retention === null
                            ? tr(language, "Метрика недоступна", "Metric unavailable")
                            : tr(
                                language,
                                "Средневзвешенно по просмотрам",
                                "View-weighted average",
                              )}
                        </p>
                      </article>
                      <article className="surface">
                        <span>
                          {tr(
                            language,
                            "Вовлечённость последних видео",
                            "Recent video engagement",
                          )}
                        </span>
                        <strong>{formatPercent(metrics.engagement, 2)}</strong>
                        <i>
                          <u
                            style={{
                              width: `${Math.min(100, metrics.engagement * 8)}%`,
                            }}
                          />
                        </i>
                        <p>
                          {tr(
                            language,
                            "Лайки и комментарии / просмотры",
                            "Likes and comments / views",
                          )}
                        </p>
                      </article>
                    </section>

                    <AnalyticsBreakdowns data={data} language={language} />
                  </details>

                  <section className="surface ai-ideas">
                    <div className="section-heading compact-heading">
                      <div>
                        <span className="eyebrow">
                          {tr(language, "AI · РОСТ КАНАЛА", "AI · CHANNEL GROWTH")}
                        </span>
                        <h2>{tr(language, "Следующий шаг", "Your next move")}</h2>
                        <p>
                          {tr(
                            language,
                            "Идеи для контента и рекомендации AI по данным канала за 28 дней.",
                            "Content ideas and AI recommendations based on 28 days of channel data.",
                          )}
                        </p>
                      </div>
                      <button
                        className="primary-button"
                        onClick={() => void generateChannelIdeas()}
                        disabled={channelIdeasLoading}
                      >
                        {channelIdeasLoading
                          ? tr(language, "Анализируем…", "Analyzing…")
                          : channelIdeas
                            ? tr(language, "Обновить идеи", "Refresh ideas")
                            : tr(language, "Сгенерировать идеи", "Generate ideas")}
                      </button>
                    </div>

                    {channelIdeasError && (
                      <div className="ai-ideas-error" role="alert">
                        {channelIdeasError}
                      </div>
                    )}

                    {channelIdeasLoading && (
                      <div className="ai-ideas-loading">
                        <i />
                        <span>
                          {tr(
                            language,
                            "AI изучает вашу статистику…",
                            "The AI is studying your statistics…",
                          )}
                        </span>
                      </div>
                    )}

                    {channelIdeas && (
                      <div className="ai-ideas-body">
                        {channelIdeas.providerNotice && (
                          <p className="ai-ideas-notice">
                            {channelIdeas.providerNotice}
                          </p>
                        )}
                        {channelIdeas.contentInsights.summary && (
                          <p className="ai-ideas-summary">
                            {channelIdeas.contentInsights.summary}
                          </p>
                        )}
                        {channelIdeas.recommendations.length > 0 && (
                          <div className="ai-ideas-actions">
                            <h3>
                              {tr(
                                language,
                                "Приоритетные действия",
                                "Prioritized actions",
                              )}
                            </h3>
                            <ul>
                              {channelIdeas.recommendations.map((item, index) => (
                                <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {channelIdeas.titles.length > 0 && (
                          <div className="ai-ideas-videos">
                            <h3>
                              {tr(language, "Идеи для видео", "Video ideas")}
                              <span className="ai-ideas-provider">
                                {channelIdeas.provider}
                              </span>
                              <button
                                type="button"
                                className="secondary-button ai-ideas-save-all"
                                disabled={channelIdeas.titles
                                  .slice(0, 10)
                                  .every((title) => savedIdeaTitles.has(title))}
                                onClick={() => void saveChannelIdeas()}
                              >
                                {channelIdeas.titles
                                  .slice(0, 10)
                                  .every((title) => savedIdeaTitles.has(title))
                                  ? tr(language, "Все в «Идеях» ✓", "All in Ideas ✓")
                                  : tr(language, "Сохранить в «Идеи»", "Save to Ideas")}
                              </button>
                            </h3>
                            <div className="ai-ideas-grid">
                              {channelIdeas.titles.slice(0, 10).map((title, index) => {
                                const saved = savedIdeaTitles.has(title);
                                return (
                                  <article key={`${index}-${title.slice(0, 24)}`}>
                                    <b>{index + 1}</b>
                                    <p>{title}</p>
                                    <button
                                      type="button"
                                      className={`ai-idea-save${saved ? " saved" : ""}`}
                                      disabled={saved}
                                      aria-label={
                                        saved
                                          ? tr(
                                              language,
                                              "Уже в «Идеях»",
                                              "Already in Ideas",
                                            )
                                          : `${tr(language, "Сохранить в «Идеи»", "Save to Ideas")}: ${title}`
                                      }
                                      title={
                                        saved
                                          ? tr(
                                              language,
                                              "Уже в «Идеях»",
                                              "Already in Ideas",
                                            )
                                          : tr(
                                              language,
                                              "Сохранить в «Идеи»",
                                              "Save to Ideas",
                                            )
                                      }
                                      onClick={() => void saveChannelIdeas(title)}
                                    >
                                      {saved ? "✓" : "+"}
                                    </button>
                                  </article>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <small className="ai-ideas-disclaimer">
                          {tr(
                            language,
                            "AI-оценка на основе ваших данных. Это ориентиры, а не гарантия просмотров.",
                            "AI estimate based on your data. Guidance, not a guarantee of views.",
                          )}
                        </small>
                      </div>
                    )}
                  </section>

                  <details className="surface subscriber-intelligence analytics-disclosure">
                    <summary>
                      <strong>
                        {tr(language, "Подписки по видео", "Subscribers by video")}
                      </strong>
                      <span>
                        {tr(language, "Подробная аналитика", "Detailed analytics")}
                      </span>
                    </summary>
                    <div className="section-heading compact-heading">
                      <div>
                        <span className="eyebrow">
                          {tr(language, "ПОДПИСКИ · 28 ДНЕЙ", "SUBSCRIBERS · 28 DAYS")}
                        </span>
                        <h2>
                          {tr(
                            language,
                            "Откуда приходят подписчики",
                            "Where subscribers come from",
                          )}
                        </h2>
                        <p>
                          {tr(
                            language,
                            "Подписки и отписки, связанные со страницами просмотра конкретных видео.",
                            "Subscriptions and unsubscriptions attributed to individual video watch pages.",
                          )}
                        </p>
                      </div>
                      <span
                        className={`subscriber-net-badge ${metrics.subscribersNet >= 0 ? "positive" : "negative"}`}
                      >
                        {formatSignedMetric(metrics.subscribersNet)}{" "}
                        {tr(language, "чистыми", "net")}
                      </span>
                    </div>
                    <div className="subscriber-summary-grid">
                      <article>
                        <span>
                          {tr(language, "Новые подписки", "Subscribers gained")}
                        </span>
                        <strong className="good">
                          +{compact(metrics.subscribersGained)}
                        </strong>
                        <small>
                          {tr(language, "все источники канала", "all channel sources")}
                        </small>
                      </article>
                      <article>
                        <span>{tr(language, "Отписались", "Subscribers lost")}</span>
                        <strong className="bad">
                          −{compact(metrics.subscribersLost)}
                        </strong>
                        <small>
                          {tr(language, "все источники канала", "all channel sources")}
                        </small>
                      </article>
                      <article>
                        <span>{tr(language, "Чистый прирост", "Net growth")}</span>
                        <strong
                          className={metrics.subscribersNet >= 0 ? "good" : "bad"}
                        >
                          {formatSignedMetric(metrics.subscribersNet)}
                        </strong>
                        <small>
                          {tr(language, "пришло минус отписалось", "gained minus lost")}
                        </small>
                      </article>
                      <article>
                        <span>
                          {tr(language, "Текущая аудитория", "Current audience")}
                        </span>
                        <strong>{compact(data.channel.subscribers)}</strong>
                        <small>
                          {tr(language, "всего подписчиков", "total subscribers")}
                        </small>
                      </article>
                    </div>
                    <div className="subscriber-source-list">
                      {subscriberLeaders.slice(0, 5).map((video, index) => {
                        const net =
                          video.subscribersGained28Days - video.subscribersLost28Days;
                        const perThousand =
                          video.analyticsViews28Days > 0
                            ? (video.subscribersGained28Days /
                                video.analyticsViews28Days) *
                              1_000
                            : 0;
                        return (
                          <article key={video.id}>
                            <em>{index + 1}</em>
                            <img src={video.thumbnailUrl} alt="" />
                            <div>
                              <strong>{video.title}</strong>
                              <span>
                                {compact(video.analyticsViews28Days)}{" "}
                                {tr(language, "просмотров", "views")} ·{" "}
                                {perThousand.toFixed(1)}{" "}
                                {tr(language, "подписки / 1K", "subs / 1K")}
                              </span>
                            </div>
                            <span className="subscriber-flow-values">
                              <b className="good">
                                +{compact(video.subscribersGained28Days)}
                              </b>
                              <b className="bad">
                                −{compact(video.subscribersLost28Days)}
                              </b>
                            </span>
                            <strong className={net >= 0 ? "good" : "bad"}>
                              {formatSignedMetric(net)}
                            </strong>
                            <a
                              href={`https://studio.youtube.com/video/${video.id}/analytics/tab-overview`}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={tr(
                                language,
                                "Открыть аналитику видео в YouTube Studio",
                                "Open video analytics in YouTube Studio",
                              )}
                            >
                              ↗
                            </a>
                          </article>
                        );
                      })}
                      {subscriberLeaders.length === 0 && (
                        <p className="subscriber-empty">
                          {tr(
                            language,
                            "YouTube ещё не вернул привязанные к видео подписки за этот период.",
                            "YouTube has not returned video-attributed subscriptions for this period yet.",
                          )}
                        </p>
                      )}
                    </div>
                  </details>

                  <details className="surface decision-center analytics-disclosure">
                    <summary>
                      <strong>
                        {tr(language, "Дополнительные сигналы", "More growth signals")}
                      </strong>
                      <span>
                        {tr(language, "Подробная аналитика", "Detailed analytics")}
                      </span>
                    </summary>
                    <div className="section-heading compact-heading">
                      <div>
                        <span className="eyebrow">
                          {tr(language, "СИГНАЛЫ РОСТА", "GROWTH SIGNALS")}
                        </span>
                        <h2>{tr(language, "Центр решений", "Decision center")}</h2>
                        <p>
                          {tr(
                            language,
                            "Сигналы скорости, концентрации трафика и эффективности публикаций.",
                            "Velocity, traffic concentration and publishing efficiency signals.",
                          )}
                        </p>
                      </div>
                      <span className="confidence-chip">
                        {data.realtimeWarmup
                          ? tr(language, "Данные накапливаются", "Data warming up")
                          : tr(
                              language,
                              "Высокая полнота окна",
                              "High window coverage",
                            )}
                      </span>
                    </div>
                    <div className="decision-kpis">
                      <article>
                        <span>
                          {tr(
                            language,
                            "Доля лидера в realtime",
                            "Realtime leader share",
                          )}
                        </span>
                        <strong>{formatPercent(intelligence.leaderShare)}</strong>
                        <p>
                          {tr(
                            language,
                            "Показывает зависимость текущего трафика от одного видео",
                            "Shows how much current traffic depends on one video",
                          )}
                        </p>
                      </article>
                      <article>
                        <span>
                          {tr(language, "Темп на следующие 24 часа", "Next 24h pace")}
                        </span>
                        <strong>
                          {intelligence.projected24 === null
                            ? "—"
                            : `≈ ${compact(intelligence.projected24)}`}
                        </strong>
                        <p>
                          {intelligence.projected24 === null
                            ? tr(
                                language,
                                "Нужно минимум 15 минут наблюдений",
                                "At least 15 observed minutes are required",
                              )
                            : tr(
                                language,
                                "Экстраполяция наблюдаемого темпа, не официальный прогноз YouTube",
                                "Observed-pace extrapolation, not an official YouTube forecast",
                              )}
                        </p>
                      </article>
                      <article>
                        <span>
                          {tr(
                            language,
                            "Медиана результата видео",
                            "Median video result",
                          )}
                        </span>
                        <strong>{compact(intelligence.medianViews)}</strong>
                        <p>
                          {tr(
                            language,
                            "Устойчивый ориентир без влияния единичных вирусных роликов",
                            "Stable benchmark without one-off viral outliers",
                          )}
                        </p>
                      </article>
                      <article>
                        <span>
                          {tr(
                            language,
                            "Средний интервал публикаций",
                            "Average publishing interval",
                          )}
                        </span>
                        <strong>
                          {intelligence.cadenceDays
                            ? `${intelligence.cadenceDays.toFixed(1)} ${tr(language, "дн.", "days")}`
                            : "—"}
                        </strong>
                        <p>
                          {tr(
                            language,
                            "Рассчитано по последним десяти видео",
                            "Calculated from the latest ten videos",
                          )}
                        </p>
                      </article>
                    </div>
                    <div className="signal-list">
                      {intelligence.fastest && (
                        <article className="positive">
                          <span>↑</span>
                          <div>
                            <strong>
                              {tr(
                                language,
                                "Главный драйвер сейчас",
                                "Current growth driver",
                              )}
                            </strong>
                            <p>{intelligence.fastest.title}</p>
                          </div>
                          <b>
                            +{compact(intelligence.fastest.observedViewsLastHour)} /{" "}
                            {intelligence.fastest.observedMinutes >= 60
                              ? "60m"
                              : `${intelligence.fastest.observedMinutes}m`}
                          </b>
                          <button onClick={() => analyzeVideo(intelligence.fastest!)}>
                            {tr(language, "Усилить", "Boost")}
                          </button>
                        </article>
                      )}
                      {intelligence.bestEngagement && (
                        <article>
                          <span>◎</span>
                          <div>
                            <strong>
                              {tr(
                                language,
                                "Лучший отклик аудитории",
                                "Best audience response",
                              )}
                            </strong>
                            <p>{intelligence.bestEngagement.title}</p>
                          </div>
                          <b>
                            ER{" "}
                            {formatPercent(
                              engagementPercent(intelligence.bestEngagement),
                              2,
                            )}
                          </b>
                          <button
                            onClick={() => analyzeVideo(intelligence.bestEngagement!)}
                          >
                            {tr(language, "Разобрать", "Analyze")}
                          </button>
                        </article>
                      )}
                      {intelligence.cooling &&
                        intelligence.cooling.velocityTrendPercent < -10 && (
                          <article className="warning">
                            <span>!</span>
                            <div>
                              <strong>
                                {tr(
                                  language,
                                  "Скорость снижается",
                                  "Velocity is cooling",
                                )}
                              </strong>
                              <p>{intelligence.cooling.title}</p>
                            </div>
                            <b>{intelligence.cooling.velocityTrendPercent}%</b>
                            <button onClick={() => analyzeVideo(intelligence.cooling!)}>
                              {tr(language, "Обновить упаковку", "Refresh packaging")}
                            </button>
                          </article>
                        )}
                    </div>
                  </details>
                </>
              )}
            </>
          )}

          {page === "videos" && data && (
            <VideoTable
              videos={data.videos}
              period={period}
              onPeriod={setPeriod}
              onAnalyze={analyzeVideo}
              onEditThumbnail={editThumbnail}
              language={language}
            />
          )}
          {page === "videos" && !data && (
            <section className="surface empty-state">
              <h2>
                {tr(
                  language,
                  "Сначала подключите YouTube-канал",
                  "Connect a YouTube channel first",
                )}
              </h2>
              <button className="primary-button" onClick={() => setPage("settings")}>
                {tr(language, "Открыть подключения", "Open connections")}
              </button>
            </section>
          )}

          {page === "competitors" && (
            <CompetitorsPage
              language={language}
              data={data}
              settings={settings}
              workspace={workspace}
              onWorkspace={saveWorkspace}
              onError={setError}
              onNotice={showNotice}
            />
          )}
          {page === "ideas" && (
            <IdeasPage
              language={language}
              data={data}
              settings={settings}
              workspace={workspace}
              onWorkspace={saveWorkspace}
              onError={setError}
              onNotice={showNotice}
            />
          )}
          {page === "planner" && (
            <PlannerPage
              language={language}
              data={data}
              settings={settings}
              workspace={workspace}
              onWorkspace={saveWorkspace}
              onError={setError}
              onNotice={showNotice}
            />
          )}
          {page === "comments" && (
            <CommentsPage
              language={language}
              data={data}
              settings={settings}
              workspace={workspace}
              onWorkspace={saveWorkspace}
              onError={setError}
              onNotice={showNotice}
              onOpenSettings={() => {
                setPage("settings");
                scrollDashboardTop();
              }}
            />
          )}
          {page === "seo" && <SeoPage language={language} data={data} />}

          {page === "ai" && (
            <section className="ai-page">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">
                    {tr(language, "ТВОРЧЕСКАЯ МАСТЕРСКАЯ", "CREATIVE WORKSPACE")}
                  </span>
                  <h2>AI Studio</h2>
                  <p>
                    {tr(
                      language,
                      "Заголовки, сценарные хуки, описание, ключевые слова, хештеги и стратегия превью.",
                      "Titles, scripted hooks, descriptions, keywords, hashtags and thumbnail strategy.",
                    )}
                  </p>
                </div>
              </div>
              <div className="ai-layout">
                <article className="surface ai-composer">
                  <div className="content-format-switch">
                    <button
                      className={contentFormat === "video" ? "active" : ""}
                      aria-pressed={contentFormat === "video"}
                      onClick={() => setContentFormat("video")}
                    >
                      <i className="landscape-icon" />
                      {tr(language, "Видео 16:9", "Video 16:9")}
                    </button>
                    <button
                      className={contentFormat === "shorts" ? "active" : ""}
                      aria-pressed={contentFormat === "shorts"}
                      onClick={() => setContentFormat("shorts")}
                    >
                      <i className="portrait-icon" />
                      Shorts 9:16
                    </button>
                  </div>
                  <label>
                    {tr(
                      language,
                      "Тема, заголовок или ссылка на YouTube-ролик",
                      "Topic, title or a YouTube video link",
                    )}
                    <textarea
                      value={aiTopic}
                      onChange={(event) => setAiTopic(event.target.value)}
                      placeholder={tr(
                        language,
                        "Например: Я воссоздал вирусную анимацию в Minecraft — или вставьте ссылку youtu.be/…",
                        "Example: I recreated a viral animation in Minecraft — or paste a youtu.be/… link",
                      )}
                    />
                  </label>
                  {!aiMediaFile &&
                    (selectedVideo || youtubeVideoIdFromUrl(aiTopic)) && (
                      <p
                        className={`ai-link-hint ${settings.geminiApiKey ? "" : "muted"}`}
                      >
                        {settings.geminiApiKey
                          ? tr(
                              language,
                              "✦ Gemini посмотрит опубликованный ролик по ссылке: кадры, речь, темп и лучшие моменты. Приватные видео анализируются по тексту.",
                              "✦ Gemini will watch the published video by its link: frames, speech, pacing and best moments. Private videos are analyzed from text.",
                            )
                          : tr(
                              language,
                              "Добавьте Gemini API key, чтобы AI смотрел сам ролик по ссылке. Сейчас анализ идёт по тексту.",
                              "Add a Gemini API key so the AI can watch the video by its link. Text-only analysis for now.",
                            )}
                      </p>
                    )}
                  {mediaUploadPermitted || aiMediaFile ? (
                    <label
                      className={`ai-media-upload ${aiMediaFile ? "has-file" : ""}`}
                    >
                      <span>▣</span>
                      <div>
                        <strong>
                          {aiMediaFile
                            ? aiMediaFile.name
                            : tr(
                                language,
                                "Загрузить видео для глубокого анализа",
                                "Upload a video for deep analysis",
                              )}
                        </strong>
                        <small>
                          {aiMediaFile
                            ? `${(aiMediaFile.size / 1024 / 1024).toFixed(1)} MB · ${tr(language, "анализ начат автоматически", "analysis started automatically")}`
                            : tr(
                                language,
                                "Gemini или TwelveLabs изучит кадры, речь, темп, ключевые моменты и формат",
                                "Gemini or TwelveLabs will inspect frames, speech, pacing, key moments and format",
                              )}
                        </small>
                      </div>
                      {aiMediaFile ? (
                        <button
                          type="button"
                          aria-label={tr(language, "Убрать файл", "Remove file")}
                          onClick={(event) => {
                            event.preventDefault();
                            aiAbortRef.current?.abort();
                            aiAbortRef.current = null;
                            aiRequestIdRef.current += 1;
                            setAiMediaFile(null);
                            setAiLoading(false);
                            setAiProgress("");
                            setEditorTimestamp(null);
                          }}
                        >
                          ×
                        </button>
                      ) : (
                        <b>{tr(language, "Выбрать файл", "Choose file")}</b>
                      )}
                      <input
                        type="file"
                        accept="video/*,audio/*,image/*,.srt,.vtt,.txt"
                        disabled={aiLoading || !mediaUploadPermitted}
                        onChange={(event) => {
                          const selected = event.target.files?.[0] ?? null;
                          if (selected?.size) {
                            setAiMediaFile(selected);
                            setEditorTimestamp(null);
                            setAiResult(null);
                            void runAi(aiTopic, selected);
                          } else if (selected) {
                            setError(
                              tr(
                                language,
                                "Выбранный файл пуст",
                                "The selected file is empty",
                              ),
                            );
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ) : (
                    <div className="ai-media-disabled">
                      <span aria-hidden="true">▣</span>
                      <div>
                        <strong>
                          {tr(
                            language,
                            "Анализ медиа выключен",
                            "Media analysis is off",
                          )}
                        </strong>
                        <small>
                          {tr(
                            language,
                            "Текстовый AI-анализ доступен без файла.",
                            "Text AI analysis is available without a file.",
                          )}
                        </small>
                      </div>
                      <button type="button" onClick={() => setPage("settings")}>
                        {tr(language, "Настроить", "Settings")}
                      </button>
                    </div>
                  )}
                  {selectedVideo && (
                    <div className="selected-video">
                      <img src={selectedVideo.thumbnailUrl} alt="" />
                      <div>
                        <strong>{selectedVideo.title}</strong>
                        <span>
                          {compact(selectedVideo.views)}{" "}
                          {tr(language, "просмотров", "views")} ·{" "}
                          {selectedVideo.analyticsAvailable28Days
                            ? `+${compact(selectedVideo.subscribersGained28Days)}/−${compact(selectedVideo.subscribersLost28Days)} ${tr(language, "подписчиков за 28д", "subscribers over 28d")}`
                            : tr(
                                language,
                                "атрибуция подписок недоступна",
                                "subscriber attribution unavailable",
                              )}
                        </span>
                      </div>
                      <a
                        href={`https://studio.youtube.com/video/${selectedVideo.id}/edit`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {tr(language, "Редактировать в Studio", "Edit in Studio")} ↗
                      </a>
                      <button
                        aria-label={tr(
                          language,
                          "Убрать выбранное видео",
                          "Remove selected video",
                        )}
                        onClick={() => setSelectedVideo(null)}
                      >
                        ×
                      </button>
                    </div>
                  )}
                  <div className="ai-control-grid">
                    <label>
                      {tr(language, "Стратегия заголовка", "Title strategy")}
                      <select
                        value={titleMode}
                        onChange={(event) =>
                          setTitleMode(event.target.value as TitleGenerationMode)
                        }
                      >
                        <option value="seo">SEO</option>
                        <option value="viral">
                          {tr(language, "Вирусный", "Viral")}
                        </option>
                        <option value="curiosity">
                          {tr(language, "Любопытство", "Curiosity")}
                        </option>
                        <option value="clean">{tr(language, "Чистый", "Clean")}</option>
                        <option value="educational">
                          {tr(language, "Обучающий", "Educational")}
                        </option>
                        <option value="story">
                          {tr(language, "История", "Story")}
                        </option>
                        <option value="challenge">
                          {tr(language, "Челлендж", "Challenge")}
                        </option>
                        <option value="versus">
                          {tr(language, "Сравнение", "Versus")}
                        </option>
                        <option value="documentary">
                          {tr(language, "Документальный", "Documentary")}
                        </option>
                      </select>
                    </label>
                    <label>
                      {tr(language, "Тон", "Tone")}
                      <select
                        value={aiTone}
                        onChange={(event) => setAiTone(event.target.value)}
                      >
                        <option value="professional">
                          {tr(language, "Профессиональный", "Professional")}
                        </option>
                        <option value="viral">
                          {tr(language, "Вирусный", "Viral")}
                        </option>
                        <option value="emotional">
                          {tr(language, "Эмоциональный", "Emotional")}
                        </option>
                        <option value="friendly">
                          {tr(language, "Дружелюбный", "Friendly")}
                        </option>
                        <option value="energetic">
                          {tr(language, "Энергичный", "Energetic")}
                        </option>
                        <option value="calm">
                          {tr(language, "Спокойный", "Calm")}
                        </option>
                        <option value="humorous">
                          {tr(language, "Юмористический", "Humorous")}
                        </option>
                        <option value="educational">
                          {tr(language, "Обучающий", "Educational")}
                        </option>
                        <option value="entertaining">
                          {tr(language, "Развлекательный", "Entertaining")}
                        </option>
                        <option value="dramatic">
                          {tr(language, "Драматичный", "Dramatic")}
                        </option>
                        <option value="minimalist">
                          {tr(language, "Минималистичный", "Minimalist")}
                        </option>
                        <option value="provocative">
                          {tr(
                            language,
                            "Провокационный без обмана",
                            "Provocative, not misleading",
                          )}
                        </option>
                        <option value="documentary">
                          {tr(language, "Документальный", "Documentary")}
                        </option>
                      </select>
                    </label>
                  </div>
                  <div className="composer-settings">
                    <span>
                      {tr(language, "Провайдер", "Provider")}:{" "}
                      <b>{providerLabel(settings.preferredProvider, language)}</b> ·{" "}
                      {tr(language, "язык", "language")}:{" "}
                      <b>{settings.generationLanguage.toUpperCase()}</b>
                    </span>
                    <button onClick={() => setPage("settings")}>
                      {tr(language, "Изменить модели", "Change models")}
                    </button>
                  </div>
                  <div className="ai-generate-row">
                    <button
                      className="ai-generate"
                      disabled={aiLoading || (!aiTopic.trim() && !aiMediaFile)}
                      aria-busy={aiLoading}
                      onClick={() => void runAi()}
                    >
                      <span>✦</span>
                      {aiLoading
                        ? tr(
                            language,
                            "Анализируем хук и упаковку…",
                            "Analyzing hook and packaging…",
                          )
                        : tr(
                            language,
                            "Создать профессиональные варианты",
                            "Create professional variants",
                          )}
                      <b>→</b>
                    </button>
                    {aiLoading && (
                      <button className="ai-cancel" onClick={cancelAi}>
                        {tr(language, "Отменить", "Cancel")}
                      </button>
                    )}
                  </div>
                  {aiLoading && (
                    <div
                      className="ai-analysis-progress"
                      role="status"
                      aria-live="polite"
                    >
                      <i />
                      <div>
                        <strong>
                          {tr(
                            language,
                            "Глубокий анализ выполняется",
                            "Deep analysis in progress",
                          )}
                        </strong>
                        <span>
                          {aiProgress ||
                            tr(
                              language,
                              "Подготавливаем запрос…",
                              "Preparing the request…",
                            )}
                        </span>
                      </div>
                    </div>
                  )}
                  {workspace.aiHistory.length > 0 && (
                    <div className="ai-history-strip">
                      <strong>
                        {tr(language, "Недавние результаты", "Recent results")}
                      </strong>
                      {workspace.aiHistory
                        .slice(-5)
                        .reverse()
                        .map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              setAiTopic(item.topic);
                              setAiResult(item.result);
                            }}
                          >
                            {item.topic || tr(language, "Без темы", "Untitled")}
                          </button>
                        ))}
                    </div>
                  )}
                </article>
                <article className={`surface ai-results${aiResult ? "" : " is-empty"}`}>
                  {!aiResult ? (
                    <div className="ai-placeholder">
                      <div>✦</div>
                      <strong>
                        {tr(
                          language,
                          "Результаты появятся здесь",
                          "Results will appear here",
                        )}
                      </strong>
                      <span>
                        {tr(
                          language,
                          "Выберите видео или введите тему",
                          "Choose a video or enter a topic",
                        )}
                      </span>
                    </div>
                  ) : (
                    <>
                      {aiResult.providerNotice && (
                        <div className="provider-notice">
                          <span>⇄</span>
                          <div>
                            <strong>
                              {tr(
                                language,
                                "Автоматическое переключение API",
                                "Automatic API failover",
                              )}
                            </strong>
                            <p>{aiResult.providerNotice}</p>
                          </div>
                        </div>
                      )}
                      <div className="result-heading">
                        <div>
                          <span className="eyebrow">
                            {tr(language, "ЗАГОЛОВКИ", "TITLES")}
                          </span>
                          <h3>
                            {tr(
                              language,
                              "Варианты для тестирования",
                              "Variants to test",
                            )}
                          </h3>
                        </div>
                        <span className="seo-ring">
                          {aiResult.seo.total}
                          <small>SEO</small>
                        </span>
                      </div>
                      <div className="title-results">
                        {aiResult.titles.map((title, index) => {
                          const candidate = aiResult.titleScores[index];
                          return (
                            <article
                              key={title}
                              className={index === 0 ? "recommended-title" : ""}
                            >
                              <span>{index + 1}</span>
                              <div>
                                <div className="candidate-title-line">
                                  <strong>{title}</strong>
                                  {index === 0 && (
                                    <em>{tr(language, "ЛУЧШИЙ", "BEST")}</em>
                                  )}
                                </div>
                                <small>
                                  {title.length}/100{" "}
                                  {tr(language, "символов", "characters")}
                                  {candidate?.strengths[0]
                                    ? ` · ${candidateText(language, candidate.strengths[0])}`
                                    : ""}
                                </small>
                                {candidate?.warning && (
                                  <p>{candidateText(language, candidate.warning)}</p>
                                )}
                              </div>
                              <div
                                className={`title-score ${candidate?.label ?? "medium"}`}
                                title={
                                  candidate
                                    ? `${tr(language, "Длина", "Length")} ${candidate.factors.length}/20 · ${tr(language, "Ключи", "Keywords")} ${candidate.factors.keywords}/25 · ${tr(language, "Хук", "Hook")} ${candidate.factors.hook}/20 · ${tr(language, "Ясность", "Clarity")} ${candidate.factors.clarity}/20`
                                    : ""
                                }
                              >
                                <b>{candidate?.total ?? 0}%</b>
                                <small>SEO</small>
                              </div>
                              <div className="title-result-actions">
                                <button
                                  className={
                                    workspace.favoriteTitles.includes(title)
                                      ? "favorite"
                                      : ""
                                  }
                                  onClick={() =>
                                    void saveWorkspace((current) => ({
                                      ...current,
                                      favoriteTitles: current.favoriteTitles.includes(
                                        title,
                                      )
                                        ? current.favoriteTitles.filter(
                                            (item) => item !== title,
                                          )
                                        : [...current.favoriteTitles, title].slice(
                                            -100,
                                          ),
                                    }))
                                  }
                                >
                                  {workspace.favoriteTitles.includes(title) ? "★" : "☆"}
                                </button>
                                <button onClick={() => openEditorFromAi(title)}>
                                  {tr(language, "В превью", "To editor")}
                                </button>
                                <button
                                  onClick={() =>
                                    void copyText(
                                      title,
                                      tr(
                                        language,
                                        "Заголовок скопирован",
                                        "Title copied",
                                      ),
                                    )
                                  }
                                >
                                  {tr(language, "Копировать", "Copy")}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </>
                  )}
                </article>
              </div>
              {aiResult && (
                <div className="ai-assets">
                  <article className="surface content-insights">
                    <div className="asset-heading">
                      <span>◎</span>
                      <div>
                        <strong>
                          {tr(language, "Понимание видео", "Video understanding")}
                        </strong>
                        <small>
                          {aiResult.contentInsights.detectedFormat ||
                            tr(language, "анализ содержания", "content analysis")}
                        </small>
                      </div>
                      <em>
                        {aiMediaFile
                          ? tr(language, "МЕДИА", "MEDIA")
                          : tr(language, "КОНТЕКСТ", "CONTEXT")}
                      </em>
                    </div>
                    <div className="insight-summary-grid">
                      <div>
                        <span>
                          {tr(language, "О чём видео", "What the video is about")}
                        </span>
                        <p>{aiResult.contentInsights.summary}</p>
                      </div>
                      <div>
                        <span>{tr(language, "Главный хук", "Primary hook")}</span>
                        <p>{aiResult.contentInsights.primaryHook || "—"}</p>
                      </div>
                      <div>
                        <span>{tr(language, "Аудитория", "Audience")}</span>
                        <p>{aiResult.contentInsights.targetAudience || "—"}</p>
                      </div>
                    </div>
                    {aiResult.contentInsights.hookAnalysis && (
                      <div className="hook-analysis">
                        <div
                          className={`hook-score ${aiResult.contentInsights.hookAnalysis.score >= 75 ? "high" : aiResult.contentInsights.hookAnalysis.score >= 50 ? "medium" : "low"}`}
                        >
                          <strong>{aiResult.contentInsights.hookAnalysis.score}</strong>
                          <span>{tr(language, "ХУК", "HOOK")}</span>
                        </div>
                        <article>
                          <span>0–1s</span>
                          <p>
                            {aiResult.contentInsights.hookAnalysis.firstSecond || "—"}
                          </p>
                        </article>
                        <article>
                          <span>0–3s</span>
                          <p>
                            {aiResult.contentInsights.hookAnalysis.firstThreeSeconds ||
                              "—"}
                          </p>
                        </article>
                        <article>
                          <span>0–10s</span>
                          <p>
                            {aiResult.contentInsights.hookAnalysis.firstTenSeconds ||
                              "—"}
                          </p>
                        </article>
                        {aiResult.contentInsights.hookAnalysis.risk && (
                          <div className="hook-risk">
                            <b>!</b>
                            <p>{aiResult.contentInsights.hookAnalysis.risk}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {aiResult.contentInsights.keyMoments.length > 0 && (
                      <div className="insight-moments">
                        <strong>
                          {tr(language, "Ключевые моменты", "Key moments")}
                        </strong>
                        <div>
                          {aiResult.contentInsights.keyMoments.map((moment) => (
                            <span key={moment}>{moment}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {((aiResult.contentInsights.suggestedChapters?.length ?? 0) > 0 ||
                      (aiResult.contentInsights.retentionRisks?.length ?? 0) > 0) && (
                      <div className="timeline-insights">
                        {(aiResult.contentInsights.suggestedChapters?.length ?? 0) >
                          0 && (
                          <section>
                            <strong>
                              {tr(language, "Предлагаемые главы", "Suggested chapters")}
                            </strong>
                            <div>
                              {aiResult.contentInsights.suggestedChapters!.map(
                                (chapter) => (
                                  <span
                                    key={`${chapter.timestampSeconds}-${chapter.title}`}
                                  >
                                    <b>{formatTimestamp(chapter.timestampSeconds)}</b>
                                    {chapter.title}
                                  </span>
                                ),
                              )}
                            </div>
                          </section>
                        )}
                        {(aiResult.contentInsights.retentionRisks?.length ?? 0) > 0 && (
                          <section className="retention-risks">
                            <strong>
                              {tr(language, "Риски удержания", "Retention risks")}
                            </strong>
                            <ul>
                              {aiResult.contentInsights.retentionRisks!.map((risk) => (
                                <li key={risk}>{risk}</li>
                              ))}
                            </ul>
                          </section>
                        )}
                      </div>
                    )}
                    {aiResult.contentInsights.thumbnailMoments.length > 0 && (
                      <div className="thumbnail-moments">
                        <div className="thumbnail-moments-heading">
                          <div>
                            <strong>
                              {tr(
                                language,
                                "Лучшие кадры для превью",
                                "Best thumbnail frames",
                              )}
                            </strong>
                            <span>
                              {tr(
                                language,
                                "AI просмотрел таймлайн и ранжировал выразительные моменты",
                                "AI inspected the timeline and ranked expressive moments",
                              )}
                            </span>
                          </div>
                          {!aiMediaFile && (
                            <em>
                              {tr(
                                language,
                                "Загрузите исходное видео, чтобы открыть кадр",
                                "Upload the source video to open a frame",
                              )}
                            </em>
                          )}
                        </div>
                        <div className="thumbnail-moment-grid">
                          {aiResult.contentInsights.thumbnailMoments.map(
                            (moment, index) => (
                              <article
                                key={`${moment.timestampSeconds}-${index}`}
                                className={index === 0 ? "best" : ""}
                              >
                                <div className="thumbnail-moment-score">
                                  <b>{moment.score}</b>
                                  <small>/100</small>
                                </div>
                                <div>
                                  <strong>
                                    {formatTimestamp(moment.timestampSeconds)}
                                    {index === 0
                                      ? ` · ${tr(language, "лучший кадр", "best frame")}`
                                      : ""}
                                  </strong>
                                  <p>{moment.reason}</p>
                                  {moment.visual && <span>{moment.visual}</span>}
                                </div>
                                <button
                                  disabled={!aiMediaFile}
                                  onClick={() =>
                                    openEditorFromAi(
                                      aiResult.titles[0],
                                      moment.timestampSeconds,
                                    )
                                  }
                                >
                                  {tr(language, "Открыть кадр", "Open frame")} →
                                </button>
                              </article>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                    {[
                      ...aiResult.contentInsights.visualElements,
                      ...aiResult.contentInsights.spokenTopics,
                    ].length > 0 && (
                      <div className="tag-cloud insight-tags">
                        {[
                          ...aiResult.contentInsights.visualElements,
                          ...aiResult.contentInsights.spokenTopics,
                        ]
                          .slice(0, 14)
                          .map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                      </div>
                    )}
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>≡</span>
                      <div>
                        <strong>{tr(language, "Описание", "Description")}</strong>
                        <small>
                          {tr(language, "Готово к вставке", "Ready to paste")}
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          void copyText(
                            aiResult.description,
                            tr(language, "Описание скопировано", "Description copied"),
                          )
                        }
                      >
                        {tr(language, "Копировать", "Copy")}
                      </button>
                    </div>
                    <p>{aiResult.description}</p>
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>↘</span>
                      <div>
                        <strong>
                          {tr(language, "Короткое описание", "Short description")}
                        </strong>
                        <small>
                          {tr(
                            language,
                            "Для анонса и мобильных поверхностей",
                            "For announcements and mobile surfaces",
                          )}
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          void copyText(
                            aiResult.shortDescription,
                            tr(
                              language,
                              "Короткое описание скопировано",
                              "Short description copied",
                            ),
                          )
                        }
                      >
                        {tr(language, "Копировать", "Copy")}
                      </button>
                    </div>
                    <p>{aiResult.shortDescription}</p>
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>●</span>
                      <div>
                        <strong>
                          {tr(language, "Закреплённый комментарий", "Pinned comment")}
                        </strong>
                        <small>
                          {tr(
                            language,
                            "Черновик — публикация вручную",
                            "Draft — publish manually",
                          )}
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          void copyText(
                            aiResult.pinnedComment,
                            tr(language, "Комментарий скопирован", "Comment copied"),
                          )
                        }
                      >
                        {tr(language, "Копировать", "Copy")}
                      </button>
                    </div>
                    <p>{aiResult.pinnedComment || "—"}</p>
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>✎</span>
                      <div>
                        <strong>
                          {tr(language, "Промпт для превью", "Thumbnail prompt")}
                        </strong>
                        <small>
                          {tr(
                            language,
                            "Готов для генератора изображений",
                            "Ready for an image generator",
                          )}
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          void copyText(
                            aiResult.thumbnailPrompt,
                            tr(language, "Промпт скопирован", "Prompt copied"),
                          )
                        }
                      >
                        {tr(language, "Копировать", "Copy")}
                      </button>
                    </div>
                    <p>{aiResult.thumbnailPrompt || "—"}</p>
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>☷</span>
                      <div>
                        <strong>
                          {tr(language, "Структура сценария", "Script outline")}
                        </strong>
                        <small>
                          {aiResult.scriptOutline.length}{" "}
                          {tr(language, "блоков", "sections")}
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          void copyText(
                            aiResult.scriptOutline.join("\n"),
                            tr(language, "Структура скопирована", "Outline copied"),
                          )
                        }
                      >
                        {tr(language, "Копировать", "Copy")}
                      </button>
                    </div>
                    <ol>
                      {aiResult.scriptOutline.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>▯</span>
                      <div>
                        <strong>{tr(language, "Идеи Shorts", "Shorts ideas")}</strong>
                        <small>
                          {tr(
                            language,
                            "Хуки и предлагаемые фрагменты",
                            "Hooks and suggested excerpts",
                          )}
                        </small>
                      </div>
                    </div>
                    <ol>
                      {aiResult.shortsIdeas.map((idea) => (
                        <li key={`${idea.title}-${idea.hook}`}>
                          <b>{idea.title}</b> — {idea.hook}
                          {idea.startSeconds !== undefined
                            ? ` · ${formatTimestamp(idea.startSeconds)}${idea.endSeconds !== undefined ? `–${formatTimestamp(idea.endSeconds)}` : ""}`
                            : ""}
                        </li>
                      ))}
                    </ol>
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>#</span>
                      <div>
                        <strong>
                          {tr(language, "Теги и ключевые слова", "Tags and keywords")}
                        </strong>
                        <small>
                          {aiResult.tags.length + aiResult.keywords.length}{" "}
                          {tr(language, "вариантов", "variants")}
                        </small>
                      </div>
                    </div>
                    <div className="tag-cloud">
                      {[...aiResult.tags, ...aiResult.keywords]
                        .slice(0, 18)
                        .map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                    </div>
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>#</span>
                      <div>
                        <strong>{tr(language, "Хештеги", "Hashtags")}</strong>
                        <small>
                          {tr(
                            language,
                            "Отдельный набор для описания",
                            "Separate set for the description",
                          )}
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          void copyText(
                            aiResult.hashtags.join(" "),
                            tr(language, "Хештеги скопированы", "Hashtags copied"),
                          )
                        }
                      >
                        {tr(language, "Копировать", "Copy")}
                      </button>
                    </div>
                    <div className="tag-cloud">
                      {aiResult.hashtags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>◇</span>
                      <div>
                        <strong>
                          {tr(language, "Идеи превью", "Thumbnail ideas")}
                        </strong>
                        <small>
                          {tr(
                            language,
                            "Основа для редактора",
                            "Foundation for the editor",
                          )}
                        </small>
                      </div>
                      <button onClick={() => openEditorFromAi()}>
                        {tr(language, "Открыть редактор", "Open editor")}
                      </button>
                    </div>
                    <ol>
                      {aiResult.thumbnailIdeas.map((idea) => (
                        <li key={idea}>{idea}</li>
                      ))}
                    </ol>
                  </article>
                  <article className="surface">
                    <div className="asset-heading">
                      <span>✓</span>
                      <div>
                        <strong>
                          {tr(language, "Что улучшить", "What to improve")}
                        </strong>
                        <small>{tr(language, "По приоритету", "By priority")}</small>
                      </div>
                    </div>
                    <ol>
                      {aiResult.recommendations.map((idea) => (
                        <li key={idea}>{idea}</li>
                      ))}
                    </ol>
                  </article>
                </div>
              )}
            </section>
          )}

          {/* Mounted on first visit and then kept: switching to another page
              used to unmount the editor and throw away the loaded video, the
              chosen frame, every slider and the undo history. */}
          {(page === "thumbnail" || editorVisited) && (
            <div hidden={page !== "thumbnail"}>
              <ThumbnailEditor
                sourceVideo={selectedVideo}
                initialMediaFile={aiMediaFile}
                initialTimestampSeconds={editorTimestamp}
                onNotice={showNotice}
                onError={setError}
                language={language}
                initialFormat={editorFormat}
                initialHeadline={editorHeadline}
                allowAiMediaUploads={mediaUploadPermitted}
                settings={settings}
                active={page === "thumbnail"}
                {...(data
                  ? {
                      channelTitle: data.channel.title,
                      channelAvatarUrl: data.channel.avatarUrl,
                    }
                  : {})}
              />
            </div>
          )}
          {page === "settings" && (
            <SettingsPanel
              settings={settings}
              setSettings={setSettings}
              models={models}
              testing={testing}
              testResult={testResult}
              saving={savingSettings}
              dirty={settingsDirty}
              onSave={() => void saveSettingsFromPanel()}
              onDiscard={() => setSettings(persistedSettingsRef.current)}
              onTest={() => void testKeys()}
              onRefreshModels={() => void refreshModels()}
              onCopy={() =>
                void copyText(
                  chrome.identity.getRedirectURL("google"),
                  tr(language, "Redirect URI скопирован", "Redirect URI copied"),
                )
              }
              onConnect={() => void signIn()}
              onExportSettings={exportSettings}
              onImportSettings={(file) => void importSettings(file)}
              onClearCaches={() => void clearCaches()}
              onResetData={openResetDialog}
              signedIn={signedIn}
              reauthRequired={reauthRequired}
              connecting={loading}
              language={language}
            />
          )}
        </div>
      </main>

      {loading && (
        <div
          className="top-progress"
          role="progressbar"
          aria-label={tr(language, "Синхронизация данных", "Syncing data")}
        />
      )}
      {resetDialogOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !resettingData) {
              setResetDialogOpen(false);
            }
          }}
        >
          <section
            ref={resetDialogRef}
            className="glass-modal"
            tabIndex={-1}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-dialog-title"
            aria-describedby="reset-dialog-description"
          >
            <div className="modal-icon danger" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
              </svg>
            </div>
            <div className="modal-copy">
              <span className="eyebrow">
                {tr(language, "ЛОКАЛЬНЫЕ ДАННЫЕ", "LOCAL DATA")}
              </span>
              <h2 id="reset-dialog-title">
                {tr(language, "Сбросить рабочее пространство?", "Reset workspace?")}
              </h2>
              <p id="reset-dialog-description">
                {tr(
                  language,
                  "Будут удалены локальный план, история AI, черновики и кэши. Настройки интерфейса и API сохранятся, но Google потребуется подключить снова.",
                  "This removes the local planner, AI history, drafts and caches. Interface and API settings stay intact, but Google must be connected again.",
                )}
              </p>
            </div>
            <div className="modal-actions">
              <button
                data-dialog-autofocus
                className="secondary-button"
                disabled={resettingData}
                onClick={() => setResetDialogOpen(false)}
              >
                {tr(language, "Отмена", "Cancel")}
              </button>
              <button
                className="danger-button"
                disabled={resettingData}
                onClick={() => void resetLocalData()}
              >
                {resettingData
                  ? tr(language, "Сбрасываем…", "Resetting…")
                  : tr(language, "Сбросить данные", "Reset data")}
              </button>
            </div>
          </section>
        </div>
      )}
      {error && (
        <div className="global-error" role="alert" aria-live="assertive">
          <span>!</span>
          <div>
            <strong>{tr(language, "Требуется внимание", "Attention required")}</strong>
            <p>{error}</p>
          </div>
          <button
            aria-label={tr(
              language,
              "Закрыть сообщение об ошибке",
              "Dismiss error message",
            )}
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status" aria-live="polite">
          <i />
          {notice}
        </div>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Dispose effects and polling before Vite re-evaluates the development entry.
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
