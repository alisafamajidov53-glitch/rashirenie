import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  calculateVideoPerformanceScore,
  cohortBenchmark,
  compareAnalyticsPeriods,
  formatExactMetric,
  realtimeWindowCoverage,
  type AnalyticsDay,
  type ContentCohort,
  type DashboardData,
  type SupportedLanguage,
  type VideoAnalyticsDetails,
  type VideoPerformanceScore,
  type VideoSummary,
} from "@channelpilot/shared";
import { rpc } from "../lib/rpc";
import {
  performanceCoverageLabel,
  performanceFactorName,
  performanceFactorStatus,
  performanceFactorValue,
  performanceScoreNote,
  performanceScoreValue,
} from "./analytics-presentation";

const tr = (language: SupportedLanguage, ru: string, en: string) =>
  language === "ru" ? ru : en;
const number = (value: number | null, language: SupportedLanguage, digits = 0) =>
  value === null ? "—" : formatExactMetric(value, language, digits);
function date(value: string | undefined, language: SupportedLanguage) {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(language, { day: "numeric", month: "short" })
    : "—";
}

export function AnalyticsTrust({
  data,
  language,
}: {
  data: DashboardData;
  language: SupportedLanguage;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const age = (stamp: string | undefined) => {
    const parsed = Date.parse(stamp ?? "");
    if (!Number.isFinite(parsed) || parsed > now + 60_000)
      return tr(language, "время неизвестно", "time unknown");
    const minutes = Math.max(0, Math.floor((now - parsed) / 60_000));
    return minutes < 1
      ? tr(language, "только что", "just now")
      : `${minutes} ${tr(language, "мин назад", "min ago")}`;
  };
  const history = [...data.history].sort((a, b) => a.date.localeCompare(b.date));
  const coverage = realtimeWindowCoverage(data.channelObservedMinutes, 60);
  return (
    <details
      className="surface analytics-trust"
      aria-label={tr(language, "Качество данных", "Data quality")}
    >
      <summary className="trust-summary">
        <strong>
          {tr(language, "Источники и качество данных", "Sources & data quality")}
        </strong>
        {(data.stale || !coverage.complete) && (
          <span className="trust-badge warning">
            {data.stale
              ? tr(language, "Сохранённый снимок", "Saved snapshot")
              : tr(language, "Неполный час", "Partial hour")}
          </span>
        )}
      </summary>
      <div className="trust-grid">
        <article>
          <span>{tr(language, "Публичные счётчики", "Public counters")}</span>
          <strong>{age(data.sampledAt)}</strong>
          <p>
            {tr(
              language,
              "Наблюдаемый прирост, не realtime-отчёт YouTube Analytics.",
              "Observed changes, not a YouTube Analytics realtime report.",
            )}
          </p>
        </article>
        <article>
          <span>YouTube Analytics</span>
          <strong>
            {history.length
              ? `${date(history[0]?.date, language)} — ${date(history.at(-1)?.date, language)}`
              : tr(language, "Нет истории", "No history")}
          </strong>
          <p>
            {tr(language, "Загружено", "Fetched")}: {age(data.analyticsSampledAt)}.{" "}
            {tr(
              language,
              "Последние дни могут ещё обрабатываться.",
              "Recent days may still be processing.",
            )}
          </p>
        </article>
        <article>
          <span>{tr(language, "Покрытие окна 60 минут", "60-minute coverage")}</span>
          <strong>
            {coverage.observedMinutes} / 60 {tr(language, "мин", "min")}
          </strong>
          <progress
            max={60}
            value={coverage.observedMinutes}
            aria-label={tr(language, "Покрытие наблюдений", "Observation coverage")}
          />
          <p>
            {coverage.complete
              ? tr(language, "Полное окно наблюдений.", "Full observation window.")
              : tr(
                  language,
                  "Неполное окно: не сравнивайте его с полным часом.",
                  "Partial window: do not compare it with a full hour.",
                )}
          </p>
        </article>
      </div>
      <p className="data-method-note">
        {tr(language, "За 48 часов", "Over 48 hours")}:{" "}
        {number(data.channelObservedViewsLast48Hours, language)} ·{" "}
        {Math.round(data.channelObservedMinutes48Hours / 60)} / 48{" "}
        {tr(language, "ч наблюдений", "hours observed")}.{" "}
        {tr(
          language,
          "Прирост публичных счётчиков — наблюдение, а не официальный realtime-отчёт. Разбивка на новых и вернувшихся зрителей через API недоступна.",
          "Public counter changes are observations, not an official realtime report. The API does not provide a new/returning viewer split.",
        )}
      </p>
    </details>
  );
}

export function PeriodComparison({
  history,
  language,
}: {
  history: AnalyticsDay[];
  language: SupportedLanguage;
}) {
  const [days, setDays] = useState<7 | 14>(7);
  const comparison = compareAnalyticsPeriods(history, days);
  const labels = {
    views: tr(language, "Просмотры", "Views"),
    watch: tr(language, "Минуты просмотра", "Watch minutes"),
    subscribers: tr(language, "Чистые подписки", "Net subscribers"),
  };
  return (
    <section
      className="surface period-comparison"
      aria-label={tr(language, "Сравнение периодов", "Period comparison")}
    >
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">
            {tr(language, "СРАВНЕНИЕ ПЕРИОДОВ", "PERIOD COMPARISON")}
          </span>
          <h2>{tr(language, "Что изменилось", "What changed")}</h2>
          <p>
            {tr(
              language,
              "Равные календарные окна до последнего доступного дня.",
              "Equal calendar windows ending on the latest available day.",
            )}
          </p>
        </div>
        <div
          className="analytics-range"
          role="group"
          aria-label={tr(language, "Длина сравнения", "Comparison length")}
        >
          {([7, 14] as const).map((period) => (
            <button
              key={period}
              aria-pressed={days === period}
              onClick={() => setDays(period)}
            >
              {period}
              {tr(language, "д", "d")}
            </button>
          ))}
        </div>
      </div>
      <p className="comparison-dates">
        {date(comparison.currentStart, language)} —{" "}
        {date(comparison.currentEnd, language)} <span>vs</span>{" "}
        {date(comparison.previousStart, language)} —{" "}
        {date(comparison.previousEnd, language)}
      </p>
      {!comparison.ready && (
        <p className="analytics-inline-note" role="status">
          {tr(
            language,
            `Нужно ${days * 2} последовательных дней. Неполные периоды не сравниваются.`,
            `${days * 2} consecutive days required. Incomplete periods are not compared.`,
          )}
        </p>
      )}
      <div className="comparison-grid">
        {comparison.metrics.map((metric) => (
          <article key={metric.key}>
            <span>{labels[metric.key]}</span>
            <strong>{number(metric.current, language)}</strong>
            <small>
              {tr(language, "Ранее", "Previously")}: {number(metric.previous, language)}
            </small>
            <p
              className={
                metric.delta === null
                  ? ""
                  : metric.delta > 0
                    ? "good"
                    : metric.delta < 0
                      ? "bad"
                      : ""
              }
            >
              {metric.delta === null
                ? "—"
                : metric.delta === 0
                  ? tr(language, "Без изменений", "No change")
                  : `${metric.delta > 0 ? "+" : ""}${number(metric.delta, language)}`}{" "}
              <span>
                {metric.delta === 0
                  ? ""
                  : metric.percent !== null
                    ? `(${metric.percent > 0 ? "+" : ""}${number(metric.percent, language, 1)}%)`
                    : metric.delta !== null
                      ? tr(
                          language,
                          "· без процентной базы",
                          "· no percentage baseline",
                        )
                      : ""}
              </span>
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ContentFormatFilter({
  value,
  onChange,
  language,
}: {
  value: ContentCohort;
  onChange: (value: ContentCohort) => void;
  language: SupportedLanguage;
}) {
  const labels: Record<ContentCohort, string> = {
    all: tr(language, "Все форматы", "All formats"),
    shorts: "Shorts",
    video: tr(language, "Обычные видео", "Videos"),
    unknown: tr(language, "Другие", "Other"),
  };
  return (
    <div className="cohort-controls">
      <div
        className="filter-tabs"
        role="group"
        aria-label={tr(language, "Формат аналитики", "Analytics format")}
      >
        {(Object.keys(labels) as ContentCohort[]).map((key) => (
          <button
            key={key}
            className={value === key ? "active" : ""}
            aria-pressed={value === key}
            onClick={() => onChange(key)}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      {value === "unknown" && (
        <p>
          {tr(
            language,
            "Другие форматы и видео, тип которых ещё не подтверждён YouTube.",
            "Other formats and videos whose type YouTube has not confirmed yet.",
          )}
        </p>
      )}
    </div>
  );
}

export function AnalyticsBreakdowns({
  data,
  language,
}: {
  data: DashboardData;
  language: SupportedLanguage;
}) {
  const groups = [
    [tr(language, "Источники трафика", "Traffic sources"), data.trafficSources],
    [tr(language, "Страны", "Countries"), data.countries],
    [tr(language, "Устройства", "Devices"), data.devices],
    [tr(language, "Статус подписки", "Subscription status"), data.subscribedStatus],
  ] as const;
  const available = groups.filter(([, items]) => items.length);
  const missing = groups.filter(([, items]) => !items.length).map(([label]) => label);
  return (
    <section aria-label={tr(language, "Аудитория и источники", "Audience & sources")}>
      {available.length ? (
        <div className="analytics-breakdowns">
          {available.map(([title, items]) => (
            <article className="surface" key={title}>
              <header>
                <strong>{title}</strong>
                <span>{tr(language, "28 дней", "28 days")}</span>
              </header>
              {items.slice(0, 5).map((item) => (
                <div key={item.key}>
                  <span>{item.label}</span>
                  <i>
                    <u
                      style={{ width: `${Math.max(0, Math.min(100, item.share))}%` }}
                    />
                  </i>
                  <b>{number(item.share, language, 1)}%</b>
                  <small>{number(item.views, language)}</small>
                </div>
              ))}
              {items[0]?.shareBasis !== "all_views" && (
                <p className="share-basis-note">
                  {tr(
                    language,
                    "Доли только среди категорий, возвращённых YouTube.",
                    "Shares are among categories returned by YouTube only.",
                  )}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="analytics-empty-note">
          {tr(
            language,
            "YouTube пока не предоставил разбивку аудитории и источников. Это не означает отсутствие просмотров.",
            "YouTube has not provided audience and traffic breakdowns yet. This does not mean there are no views.",
          )}
        </p>
      )}
      {available.length > 0 && missing.length > 0 && (
        <p className="data-method-note">
          {tr(language, "Пока недоступно", "Not available yet")}: {missing.join(" · ")}
        </p>
      )}
    </section>
  );
}

export function VideoDetailsDialog({
  video,
  videos,
  language,
  onClose,
  onAnalyze,
  onEditThumbnail,
  renderChart,
  performance,
  initialPerformanceOpen = false,
}: {
  video: VideoSummary;
  videos: VideoSummary[];
  language: SupportedLanguage;
  onClose: () => void;
  onAnalyze: (video: VideoSummary) => void;
  onEditThumbnail?: (video: VideoSummary) => void;
  renderChart: (history: AnalyticsDay[]) => ReactNode;
  performance?: VideoPerformanceScore;
  initialPerformanceOpen?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const performanceDetails = useRef<HTMLDetailsElement>(null);
  const [details, setDetails] = useState<VideoAnalyticsDetails | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    if (initialPerformanceOpen && performanceDetails.current) {
      performanceDetails.current.open = true;
    }
    return () => {
      element?.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [initialPerformanceOpen]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setDetails(null);
    void rpc<VideoAnalyticsDetails>({
      type: "GET_VIDEO_ANALYTICS",
      videoId: video.id,
      force: attempt > 0,
    })
      .then((result) => {
        if (active) setDetails(result);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [video.id, attempt, language]);
  const benchmark = cohortBenchmark(video, videos);
  const score = performance ?? calculateVideoPerformanceScore(video, videos);
  const detailed =
    video.analyticsAvailable28Days && video.analyticsDetailAvailable28Days !== false;
  return (
    <dialog
      className="video-details-dialog"
      ref={dialog}
      aria-labelledby="video-details-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="video-details-inner">
        <header>
          <span className="eyebrow">
            {tr(language, "ДЕТАЛЬНАЯ АНАЛИТИКА", "VIDEO DEEP DIVE")}
          </span>
          <button
            className="secondary-button"
            autoFocus
            onClick={onClose}
            aria-label={tr(
              language,
              "Закрыть аналитику видео",
              "Close video analytics",
            )}
          >
            ✕
          </button>
        </header>
        <div className="video-details-hero">
          <img src={video.thumbnailUrl} alt="" />
          <div>
            <h2 id="video-details-title">{video.title}</h2>
            <p>
              {date(video.publishedAt, language)} ·{" "}
              {video.contentType === "shorts"
                ? "Shorts"
                : video.contentType === "video"
                  ? tr(language, "Обычное видео", "Video")
                  : tr(language, "Формат не подтверждён", "Unconfirmed format")}
            </p>
            <a
              href={`https://studio.youtube.com/video/${video.id}/analytics/tab-overview`}
              target="_blank"
              rel="noreferrer"
            >
              {tr(language, "Открыть в YouTube Studio", "Open in YouTube Studio")} ↗
            </a>
          </div>
        </div>
        <div className="comparison-grid video-detail-kpis">
          {[
            [
              tr(language, "Просмотры · 28д", "Views · 28d"),
              video.analyticsAvailable28Days ? video.analyticsViews28Days : null,
            ],
            [
              tr(language, "Подписки · 28д", "Net subs · 28d"),
              video.analyticsAvailable28Days
                ? video.subscribersGained28Days - video.subscribersLost28Days
                : null,
            ],
            [
              tr(language, "Удержание · %", "Retention · %"),
              detailed && video.analyticsViews28Days > 0
                ? video.averageViewPercentage28Days
                : null,
            ],
            [
              tr(language, "Время · мин", "Watch time · min"),
              detailed ? video.watchMinutes28Days : null,
            ],
          ].map(([label, value]) => (
            <article key={String(label)}>
              <span>{label}</span>
              <strong>{number(value as number | null, language, 1)}</strong>
            </article>
          ))}
        </div>
        <details className="performance-details" ref={performanceDetails}>
          <summary>
            <span>{tr(language, "Индекс эффективности", "Performance score")}</span>
            <strong>{performanceScoreValue(score)}</strong>
            <small>
              {tr(language, "Полнота", "Coverage")}: {score.availableWeight}/100 ·{" "}
              {performanceCoverageLabel(score, language)}
            </small>
          </summary>
          <p>{performanceScoreNote(score, language)}</p>
          <div className="performance-factors">
            {score.factors.map((factor) => (
              <div key={factor.id} className={!factor.available ? "unavailable" : ""}>
                <span>{performanceFactorName(factor, language)}</span>
                <strong>
                  {factor.available ? `${factor.score}/${factor.max}` : "—"}
                </strong>
                <small>
                  {factor.available
                    ? performanceFactorValue(factor, language)
                    : performanceFactorStatus(factor, language)}
                </small>
                {factor.available && (
                  <progress
                    value={factor.score}
                    max={factor.max}
                    aria-label={performanceFactorName(factor, language)}
                  />
                )}
              </div>
            ))}
          </div>
        </details>
        <section className="analytics-inline-note">
          <strong>
            {tr(language, "Сравнение с видео того же формата", "Same-format benchmark")}
          </strong>
          <p>
            {benchmark
              ? tr(
                  language,
                  `${number(benchmark.ratio, language, 1)}× медианы ${benchmark.count} других видео за последние 28 дней. Медиана: ${number(benchmark.median, language)} просмотров. Это не сравнение одинакового возраста публикаций.`,
                  `${number(benchmark.ratio, language, 1)}× the median of ${benchmark.count} other videos over 28 days. Median: ${number(benchmark.median, language)} views. This does not compare videos at the same age.`,
                )
              : tr(
                  language,
                  "Нужно минимум 3 других видео с подтверждённым форматом и Analytics, а также ненулевая медиана. Смешанные или неполные группы не сравниваются.",
                  "At least 3 other videos with confirmed matching format and Analytics, and a nonzero median, are required. Mixed or incomplete groups are not compared.",
                )}
          </p>
        </section>
        <section aria-busy={loading} className="video-details-history">
          <h3>{tr(language, "Динамика этого видео", "This video’s trend")}</h3>
          {loading ? (
            <div className="analytics-detail-loading" role="status">
              {tr(
                language,
                "Загружаем историю и источники…",
                "Loading history and sources…",
              )}
            </div>
          ) : error ? (
            <div role="alert" className="analytics-inline-note">
              {error}
              <button
                className="secondary-button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {tr(language, "Повторить", "Retry")}
              </button>
            </div>
          ) : details ? (
            <>
              {details.warnings.map((warning) => (
                <p className="analytics-inline-note" key={warning}>
                  {warning}
                </p>
              ))}
              {renderChart(details.history)}
              <h3>
                {tr(
                  language,
                  "Источники трафика · 28 дней",
                  "Traffic sources · 28 days",
                )}
              </h3>
              {details.trafficSources.length ? (
                <>
                  <div className="detail-traffic">
                    {details.trafficSources.map((source) => (
                      <article key={source.key}>
                        <span>{source.label}</span>
                        <strong>{number(source.views, language)}</strong>
                        <progress
                          max={100}
                          value={source.share}
                          aria-label={source.label}
                        />
                        <small>{number(source.share, language, 1)}%</small>
                      </article>
                    ))}
                  </div>
                  {details.trafficSources[0]?.shareBasis !== "all_views" && (
                    <p className="share-basis-note">
                      {tr(
                        language,
                        "Доли только среди категорий, возвращённых YouTube.",
                        "Shares are among categories returned by YouTube only.",
                      )}
                    </p>
                  )}
                </>
              ) : (
                <p className="analytics-inline-note">
                  {tr(
                    language,
                    "Нет доступной разбивки. Это не означает нулевой трафик.",
                    "No breakdown available. This does not mean zero traffic.",
                  )}
                </p>
              )}
            </>
          ) : null}
        </section>
        <footer>
          <p>
            {tr(
              language,
              "Данные Analytics могут поступать с задержкой.",
              "Analytics data may arrive with a delay.",
            )}
          </p>
          <div className="video-details-actions">
            {/* Between 721 and 1459px the table folds its row actions away, and
                the dialog is then the only way to send this video's thumbnail
                to the editor. */}
            {onEditThumbnail && (
              <button
                className="secondary-button"
                onClick={() => {
                  onClose();
                  onEditThumbnail(video);
                }}
              >
                {tr(language, "Открыть в редакторе превью", "Open in thumbnail editor")}
              </button>
            )}
            <button
              className="primary-button"
              onClick={() => {
                onClose();
                onAnalyze(video);
              }}
            >
              {tr(language, "Перейти к AI-анализу", "Continue to AI analysis")}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
