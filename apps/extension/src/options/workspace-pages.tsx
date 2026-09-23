import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  type AnalysisResult,
  buildChannelStyleContext,
  calculateSeoChecklist,
  calculateVideoPerformanceScore,
  formatMetric,
  normalizeWorkspaceState,
  parsePlannerCsv,
  serializePlannerCsv,
  type ChannelGoal,
  type CompetitorSnapshot,
  type CommentDraft,
  type ContentIdea,
  type DashboardData,
  type ExtensionSettings,
  type PlannerItem,
  type PlannerStatus,
  type SupportedLanguage,
  type WorkspaceState,
  type YouTubeComment,
} from "@channelpilot/shared";
import { analyzeTextDirect } from "../lib/ai-direct";
import { rpc } from "../lib/rpc";
import {
  performanceCoverageLabel,
  performanceFactorExplanation,
  performanceFactorName,
  performanceFactorStatus,
  performanceFactorValue,
  performanceScoreNote,
} from "./analytics-presentation";

function tr(language: SupportedLanguage, ru: string, en: string): string {
  return language === "ru" ? ru : en;
}

// The rest of the dashboard prints "9 000" and "48.2K"; this page used its own
// Intl compact notation and showed the same channel as "9K" next to "9 000".
function compact(value: number): string {
  return formatMetric(value);
}

function duration(value: number): string {
  const minutes = Math.floor(Math.max(0, value) / 60);
  const seconds = Math.round(Math.max(0, value) % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const TOPIC_STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "your",
  "about",
  "video",
  "shorts",
  "youtube",
  "как",
  "что",
  "это",
  "для",
  "или",
  "про",
  "видео",
  "ролик",
  "мой",
  "моя",
  "все",
  "без",
]);

function frequentTerms(values: string[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const terms = value.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
    for (const term of new Set(terms)) {
      if (TOPIC_STOP_WORDS.has(term) || /^\d+$/u.test(term)) continue;
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Idea-bank capacity; normalizeWorkspaceState trims anything beyond it. */
export const IDEA_LIMIT = 300;

/**
 * AI titles as idea-bank entries. Shared by the Ideas page and the overview's
 * channel-growth ideas, which used to be shown once and lost on reload.
 */
export function contentIdeasFromResult(
  result: AnalysisResult,
  format: ContentIdea["format"],
  difficulty: ContentIdea["difficulty"],
  createdAt = new Date().toISOString(),
): ContentIdea[] {
  return result.titles.slice(0, 10).map((title, index) => ({
    id: uid("idea"),
    title,
    angle:
      result.shortsIdeas[index]?.hook ??
      result.recommendations[index % Math.max(1, result.recommendations.length)] ??
      result.contentInsights.primaryHook,
    format,
    difficulty,
    // A packaging-quality estimate from the AI title score, not search demand;
    // the label in the UI makes that distinction explicit.
    interest: result.titleScores[index]?.total ?? 50,
    source: "ai",
    createdAt,
  }));
}

function download(filename: string, value: string, type: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

interface PageProps {
  language: SupportedLanguage;
  data: DashboardData | null;
  settings: ExtensionSettings;
  workspace: WorkspaceState;
  onWorkspace: (
    next: WorkspaceState | ((current: WorkspaceState) => WorkspaceState),
  ) => Promise<boolean>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** Opens the Connections page, for a missing credential. */
  onOpenSettings?: () => void;
}

export function CompetitorsPage({
  language,
  data,
  workspace,
  onWorkspace,
  onError,
  onNotice,
}: PageProps) {
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<CompetitorSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const searchIdRef = useRef(0);

  async function search(force = false, target = query): Promise<void> {
    const searchQuery = target.trim();
    if (!searchQuery) {
      onError(
        tr(
          language,
          "Введите название, @handle или URL канала",
          "Enter a channel name, @handle or URL",
        ),
      );
      return;
    }
    const requestId = ++searchIdRef.current;
    setLoading(true);
    try {
      const result = await rpc<CompetitorSnapshot>({
        type: "GET_COMPETITOR",
        query: searchQuery,
        force,
      });
      if (requestId === searchIdRef.current) setSnapshot(result);
    } catch (error) {
      if (requestId === searchIdRef.current) {
        onError(
          error instanceof Error
            ? error.message
            : tr(language, "Канал не найден", "Channel was not found"),
        );
      }
    } finally {
      if (requestId === searchIdRef.current) setLoading(false);
    }
  }

  const saved = snapshot
    ? workspace.competitors.some((item) => item.channelId === snapshot.channel.id)
    : false;
  const competitorInsights = useMemo(() => {
    if (!snapshot) {
      return {
        averageDuration: 0,
        averageTitleLength: 0,
        strongVideos: [] as CompetitorSnapshot["recentVideos"],
        themes: [] as string[],
        gaps: [] as string[],
      };
    }
    const videos = snapshot.recentVideos;
    const strongVideos = [...videos]
      .sort((left, right) => right.views - left.views)
      .slice(0, 5);
    const themes = frequentTerms(strongVideos.map((video) => video.title));
    const ownTerms = new Set(
      frequentTerms(
        (data?.videos ?? []).map((video) => video.title),
        80,
      ),
    );
    return {
      averageDuration: videos.length
        ? videos.reduce((total, video) => total + video.durationSeconds, 0) /
          videos.length
        : 0,
      averageTitleLength: videos.length
        ? videos.reduce((total, video) => total + video.title.length, 0) / videos.length
        : 0,
      strongVideos,
      themes,
      gaps: themes.filter((term) => !ownTerms.has(term)).slice(0, 6),
    };
  }, [data?.videos, snapshot]);

  async function toggleBookmark(): Promise<void> {
    if (!snapshot) return;
    if (!saved && workspace.competitors.length >= 25) {
      onError(
        tr(language, "Достигнут лимит: 25 каналов", "Limit reached: 25 channels"),
      );
      return;
    }
    const selected = snapshot.channel;
    try {
      let removed = false;
      const didSave = await onWorkspace((current) => {
        removed = current.competitors.some((item) => item.channelId === selected.id);
        if (!removed && current.competitors.length >= 25) {
          throw new Error(
            tr(language, "Достигнут лимит: 25 каналов", "Limit reached: 25 channels"),
          );
        }
        return {
          ...current,
          competitors: removed
            ? current.competitors.filter((item) => item.channelId !== selected.id)
            : [
                ...current.competitors,
                {
                  channelId: selected.id,
                  title: selected.title,
                  avatarUrl: selected.avatarUrl,
                  addedAt: new Date().toISOString(),
                },
              ],
        };
      });
      if (!didSave) return;
      onNotice(
        removed
          ? tr(language, "Канал удалён из списка", "Channel removed")
          : tr(language, "Канал сохранён", "Channel saved"),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  const own = data?.channel;
  return (
    <section className="workspace-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {tr(language, "ПУБЛИЧНЫЕ ДАННЫЕ YOUTUBE", "YOUTUBE PUBLIC DATA")}
          </span>
          <h2>{tr(language, "Конкуренты", "Competitors")}</h2>
          <p>
            {tr(
              language,
              "Публичные метрики канала и последних 20 роликов. Без скрейпинга и вымышленных прогнозов.",
              "Public channel metrics and the latest 20 videos. No scraping or fabricated forecasts.",
            )}
          </p>
        </div>
      </div>
      <article className="surface workspace-toolbar">
        <label>
          {tr(language, "Канал YouTube", "YouTube channel")}
          <input
            value={query}
            onChange={(event) => {
              ++searchIdRef.current;
              setQuery(event.target.value);
              setSnapshot(null);
              setLoading(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
            placeholder={tr(
              language,
              "@handle, название или youtube.com/@…",
              "@handle, name or youtube.com/@…",
            )}
          />
        </label>
        <button
          className="primary-button"
          disabled={loading}
          onClick={() => void search()}
        >
          {loading
            ? tr(language, "Загружаем…", "Loading…")
            : tr(language, "Сравнить", "Compare")}
        </button>
      </article>

      {workspace.competitors.length > 0 && (
        <div className="bookmark-row">
          {workspace.competitors.map((item) => (
            <button
              key={item.channelId}
              onClick={() => {
                setQuery(item.title);
                setSnapshot(null);
                void search(false, item.channelId);
              }}
            >
              {item.avatarUrl && <img src={item.avatarUrl} alt="" />}
              {item.title}
            </button>
          ))}
        </div>
      )}

      {loading && !snapshot && (
        <div className="surface workspace-loading" role="status">
          {tr(language, "Загружаем данные канала…", "Loading channel data…")}
        </div>
      )}
      {!loading && !snapshot && (
        <div className="surface workspace-empty competitor-first-run">
          <strong>
            {tr(
              language,
              "Сравните канал на реальных данных",
              "Compare a channel using real data",
            )}
          </strong>
          <p>
            {workspace.competitors.length
              ? tr(
                  language,
                  "Укажите @handle, название или ссылку YouTube. Сохранённые каналы доступны выше.",
                  "Enter a YouTube @handle, name, or link. Saved channels appear above.",
                )
              : tr(
                  language,
                  "Укажите @handle, название или ссылку YouTube. После сравнения канал можно сохранить.",
                  "Enter a YouTube @handle, name, or link. You can save a channel after comparing it.",
                )}
          </p>
        </div>
      )}

      {snapshot && (
        <>
          <article className="surface competitor-hero">
            {snapshot.channel.avatarUrl ? (
              <img src={snapshot.channel.avatarUrl} alt="" />
            ) : (
              <span className="competitor-avatar-fallback" aria-hidden="true">
                {snapshot.channel.title.slice(0, 1)}
              </span>
            )}
            <div>
              <span className="eyebrow">
                {tr(language, "ПРОВЕРЕНО API", "API VERIFIED")}
              </span>
              <h3>{snapshot.channel.title}</h3>
              <p>
                {tr(language, "Снимок", "Snapshot")}:{" "}
                {new Date(snapshot.fetchedAt).toLocaleString(language)}
              </p>
            </div>
            <button onClick={() => void toggleBookmark()}>
              {saved ? "★ " : "☆ "}
              {saved
                ? tr(language, "Сохранён", "Saved")
                : tr(language, "Сохранить", "Save")}
            </button>
          </article>
          <div className="comparison-grid">
            {(
              [
                [
                  tr(language, "Подписчики", "Subscribers"),
                  own?.subscribers,
                  snapshot.channel.subscribers,
                ],
                [
                  tr(language, "Просмотры канала", "Channel views"),
                  own?.views,
                  snapshot.channel.views,
                ],
                [tr(language, "Видео", "Videos"), own?.videos, snapshot.channel.videos],
                [
                  tr(language, "Среднее последних роликов", "Recent average"),
                  undefined,
                  snapshot.averageViews,
                ],
                [
                  tr(language, "Медиана последних роликов", "Recent median"),
                  undefined,
                  snapshot.medianViews,
                ],
                [
                  tr(language, "Публикаций за 30 дней", "Uploads in 30 days"),
                  undefined,
                  snapshot.uploadsLast30Days,
                ],
              ] as Array<[string, number | undefined, number]>
            ).map(([label, mine, competitor]) => (
              <article className="surface" key={label}>
                <span>{label}</span>
                <strong>{compact(competitor)}</strong>
                {mine !== undefined && (
                  <small>
                    {tr(language, "Ваш канал", "Your channel")}: {compact(mine)}
                    {mine > 0
                      ? ` · ${competitor >= mine ? "+" : ""}${Math.round((competitor / mine - 1) * 100)}%`
                      : ""}
                  </small>
                )}
              </article>
            ))}
          </div>
          <article className="surface competitor-insights">
            <header>
              <div>
                <span className="eyebrow">
                  {tr(language, "ВЫВОДЫ ИЗ ПУБЛИЧНЫХ ДАННЫХ", "PUBLIC-DATA INSIGHTS")}
                </span>
                <h3>{tr(language, "Темы и упаковка", "Topics & packaging")}</h3>
              </div>
              <small>
                {tr(
                  language,
                  "Это сравнение заголовков, длительности и фактических просмотров — не прогноз спроса.",
                  "This compares titles, duration and actual views; it is not a demand forecast.",
                )}
              </small>
            </header>
            <div className="insight-stat-row">
              <span>
                {tr(language, "Средняя длительность", "Average duration")}
                <b>{duration(competitorInsights.averageDuration)}</b>
              </span>
              <span>
                {tr(language, "Средняя длина заголовка", "Average title length")}
                <b>{Math.round(competitorInsights.averageTitleLength)}</b>
              </span>
              <span>
                {tr(language, "Сильнее медианы", "Above median")}
                <b>
                  {
                    snapshot.recentVideos.filter(
                      (video) => video.views > snapshot.medianViews,
                    ).length
                  }
                </b>
              </span>
            </div>
            <div className="topic-insights">
              <div>
                <strong>
                  {tr(language, "Частые темы лидеров", "Top-video themes")}
                </strong>
                <p>
                  {competitorInsights.themes.length
                    ? competitorInsights.themes.map((term) => (
                        <span key={term}>{term}</span>
                      ))
                    : tr(language, "Недостаточно заголовков", "Not enough titles")}
                </p>
              </div>
              <div>
                <strong>
                  {tr(language, "Возможные content gaps", "Possible content gaps")}
                </strong>
                <p>
                  {competitorInsights.gaps.length
                    ? competitorInsights.gaps.map((term) => (
                        <span key={term}>{term}</span>
                      ))
                    : tr(
                        language,
                        "Явных различий в частых словах не найдено",
                        "No clear frequent-term gaps found",
                      )}
                </p>
              </div>
            </div>
          </article>
          <div className="surface competitor-videos">
            <div className="section-heading compact-heading">
              <div>
                <h3>{tr(language, "Последние ролики", "Recent videos")}</h3>
                <p>
                  {tr(
                    language,
                    "Фактические публичные счётчики",
                    "Actual public counters",
                  )}
                </p>
              </div>
              <button onClick={() => void search(true)}>
                {tr(language, "Обновить", "Refresh")}
              </button>
            </div>
            <div className="workspace-video-grid">
              {snapshot.recentVideos.map((video) => (
                <a
                  key={video.id}
                  href={`https://www.youtube.com/watch?v=${video.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img src={video.thumbnailUrl} alt="" />
                  <strong>{video.title}</strong>
                  <span>
                    {compact(video.views)} {tr(language, "просмотров", "views")} ·{" "}
                    {compact(video.likes)} ♥
                  </span>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function IdeasPage({
  language,
  data,
  settings,
  workspace,
  onWorkspace,
  onError,
  onNotice,
}: PageProps) {
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<"long" | "shorts">("long");
  const [ideaStyle, setIdeaStyle] = useState<
    | "mixed"
    | "versus"
    | "challenge"
    | "experiment"
    | "documentary"
    | "trend"
    | "evergreen"
    | "series"
  >("mixed");
  const [loading, setLoading] = useState(false);
  const topicRef = useRef<HTMLTextAreaElement>(null);

  async function generate(): Promise<void> {
    if (!topic.trim()) {
      onError(
        tr(language, "Введите тему для исследования", "Enter a topic to explore"),
      );
      return;
    }
    if (workspace.ideas.length > IDEA_LIMIT - 10) {
      onError(
        tr(
          language,
          "Для новой подборки нужно 10 свободных мест. Удалите ненужные идеи.",
          "A new set needs 10 free slots. Remove ideas you no longer need.",
        ),
      );
      return;
    }
    setLoading(true);
    try {
      const strongest = [...(data?.videos ?? [])]
        .sort((left, right) => right.views - left.views)
        .slice(0, 5)
        .map((video) => `${video.title} (${video.views} views)`)
        .join("\n");
      const styleInstruction =
        ideaStyle === "mixed"
          ? "mixed formats: versus, challenges, experiments, documentary, trend-aware, evergreen and series"
          : ideaStyle;
      const channelContext = buildChannelStyleContext(data);
      const result = await analyzeTextDirect(
        {
          title: `${topic} · ${styleInstruction}`,
          description: strongest
            ? `Channel: ${data?.channel.title ?? ""}\nStrong recent videos from real public data:\n${strongest}`
            : "",
          tags: [],
          topic,
          language: settings.generationLanguage,
          tone: `specific, useful, original, no misleading clickbait; create ${styleInstruction} concepts`,
          task: "idea_generation",
          ...(channelContext ? { channelContext } : {}),
          titleMode:
            ideaStyle === "versus"
              ? "versus"
              : ideaStyle === "challenge"
                ? "challenge"
                : ideaStyle === "documentary"
                  ? "documentary"
                  : format === "shorts" || ideaStyle === "trend"
                    ? "viral"
                    : "educational",
        },
        settings,
        settings.preferredProvider,
      );
      const createdAt = new Date().toISOString();
      const additions = contentIdeasFromResult(
        result,
        format,
        ideaStyle === "documentary" ||
          ideaStyle === "experiment" ||
          ideaStyle === "challenge"
          ? "hard"
          : format === "shorts"
            ? "easy"
            : "medium",
        createdAt,
      );
      if (additions.length === 0) {
        throw new Error(
          tr(
            language,
            "AI не вернул идеи. Попробуйте другую тему.",
            "AI returned no ideas. Try another topic.",
          ),
        );
      }
      if (
        !(await onWorkspace((current) => {
          if (current.ideas.length + additions.length > IDEA_LIMIT) {
            throw new Error(
              tr(
                language,
                "Для новой подборки недостаточно места. Удалите ненужные идеи.",
                "Not enough room for this idea set. Remove ideas you no longer need.",
              ),
            );
          }
          return {
            ...current,
            ideas: [...additions, ...current.ideas],
            aiHistory: [
              ...current.aiHistory,
              {
                id: uid("history"),
                task: "idea_generation" as const,
                topic,
                result,
                createdAt,
              },
            ].slice(-30),
          };
        }))
      ) {
        return;
      }
      onNotice(
        tr(
          language,
          `${additions.length} идей сохранено`,
          `${additions.length} ideas saved`,
        ),
      );
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : tr(language, "Не удалось создать идеи", "Could not generate ideas"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function moveToPlanner(idea: ContentIdea): Promise<void> {
    if (workspace.planner.length >= 500) {
      onError(
        tr(language, "План заполнен (500 карточек)", "Planner is full (500 cards)"),
      );
      return;
    }
    const now = new Date().toISOString();
    try {
      if (
        !(await onWorkspace((current) => {
          if (current.planner.length >= 500) {
            throw new Error(
              tr(
                language,
                "План заполнен (500 карточек)",
                "Planner is full (500 cards)",
              ),
            );
          }
          const planner: PlannerItem[] = [
            {
              id: uid("plan"),
              title: idea.title,
              status: "idea",
              publishAt: "",
              notes: idea.angle,
              tags: [idea.format],
              createdAt: now,
              updatedAt: now,
            },
            ...current.planner,
          ];
          return { ...current, planner };
        }))
      )
        return;
      onNotice(tr(language, "Добавлено в план", "Added to planner"));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="workspace-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {tr(language, "МАСТЕРСКАЯ ИДЕЙ AI", "AI IDEA LAB")}
          </span>
          <h2>{tr(language, "Идеи контента", "Content ideas")}</h2>
          <p>
            {tr(
              language,
              "AI предлагает углы и упаковку. Оценка отражает качество идеи, а не недоступный прогноз спроса.",
              "AI suggests angles and packaging. The score reflects idea quality, not an unavailable demand forecast.",
            )}
          </p>
        </div>
      </div>
      <article className="surface idea-composer">
        <label>
          {tr(language, "Тема или ниша", "Topic or niche")}
          <textarea
            ref={topicRef}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder={tr(
              language,
              "Например: ремонт старых игровых консолей",
              "Example: restoring old game consoles",
            )}
          />
        </label>
        <div>
          <select
            value={ideaStyle}
            aria-label={tr(language, "Формат идей", "Idea style")}
            onChange={(event) => setIdeaStyle(event.target.value as typeof ideaStyle)}
          >
            <option value="mixed">{tr(language, "Смешанная подборка", "Mixed")}</option>
            <option value="versus">X vs Y</option>
            <option value="challenge">{tr(language, "Челленджи", "Challenges")}</option>
            <option value="experiment">
              {tr(language, "Эксперименты", "Experiments")}
            </option>
            <option value="documentary">
              {tr(language, "Документальные", "Documentary")}
            </option>
            <option value="trend">{tr(language, "Трендовые", "Trend-aware")}</option>
            <option value="evergreen">Evergreen</option>
            <option value="series">{tr(language, "Серии", "Series")}</option>
          </select>
          <div
            className="filter-tabs idea-format"
            role="group"
            aria-label={tr(language, "Формат роликов", "Video format")}
          >
            <button
              className={format === "long" ? "active" : ""}
              aria-pressed={format === "long"}
              onClick={() => setFormat("long")}
            >
              {tr(language, "Видео 16:9", "Video 16:9")}
            </button>
            <button
              className={format === "shorts" ? "active" : ""}
              aria-pressed={format === "shorts"}
              onClick={() => setFormat("shorts")}
            >
              Shorts 9:16
            </button>
          </div>
          <button
            className="primary-button"
            disabled={loading}
            onClick={() => void generate()}
          >
            {loading
              ? tr(language, "Генерируем…", "Generating…")
              : tr(language, "Создать 10 идей", "Generate 10 ideas")}
          </button>
        </div>
      </article>
      <div className="idea-grid">
        {workspace.ideas.map((idea) => (
          <article className="surface" key={idea.id}>
            <div>
              <span>
                {idea.source === "ai" ? "AI" : tr(language, "ВРУЧНУЮ", "MANUAL")}
              </span>
              <em>{idea.format === "shorts" ? "Shorts" : "Long"}</em>
            </div>
            <h3>{idea.title}</h3>
            <p>
              {idea.angle ||
                tr(
                  language,
                  "Угол можно уточнить в планере",
                  "Refine the angle in the planner",
                )}
            </p>
            <footer>
              <span
                title={tr(
                  language,
                  "AI-оценка качества упаковки, не спрос",
                  "AI packaging-quality estimate, not demand",
                )}
              >
                {tr(language, "Качество идеи", "Idea quality")} {idea.interest}/100
              </span>
              <button onClick={() => void moveToPlanner(idea)}>
                {tr(language, "В план", "Plan")} →
              </button>
              <button
                aria-label={tr(language, "Удалить идею", "Delete idea")}
                onClick={() =>
                  void onWorkspace((current) => ({
                    ...current,
                    ideas: current.ideas.filter((item) => item.id !== idea.id),
                  }))
                }
              >
                ×
              </button>
            </footer>
          </article>
        ))}
        {workspace.ideas.length === 0 && (
          <div className="surface workspace-empty idea-first-run">
            <span aria-hidden="true">✦</span>
            <strong>
              {tr(
                language,
                "От темы к сильным концепциям",
                "From topic to strong concepts",
              )}
            </strong>
            <p>
              {tr(
                language,
                "Опишите нишу или тему — идеи появятся здесь и сохранятся локально.",
                "Describe a niche or topic — ideas will appear here and stay saved locally.",
              )}
            </p>
            <button
              className="secondary-button"
              onClick={() => topicRef.current?.focus()}
            >
              {tr(language, "Указать тему", "Enter a topic")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

const PLANNER_COLUMNS: Array<[PlannerStatus, string, string]> = [
  ["idea", "Идеи", "Ideas"],
  ["draft", "В работе", "Drafting"],
  ["scheduled", "Запланировано", "Scheduled"],
  ["ready", "Готово", "Ready"],
  ["published", "Опубликовано", "Published"],
];

function localDateTimeValue(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function PlannerPage({
  language,
  data,
  workspace,
  onWorkspace,
  onError,
  onNotice,
}: PageProps) {
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [goalLabel, setGoalLabel] = useState("");
  const [goalTarget, setGoalTarget] = useState("1000");
  const [goalUnit, setGoalUnit] = useState<"subscribers" | "views" | "videos">(
    "subscribers",
  );
  const newTitleRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [dropTarget, setDropTarget] = useState<PlannerStatus | null>(null);
  // Deleting a card used to be instant and final, notes included. The card is
  // held here for a few seconds so the removal can be undone.
  const [removed, setRemoved] = useState<{ item: PlannerItem; index: number } | null>(
    null,
  );
  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [removed]);
  const filtered = useMemo(
    () =>
      workspace.planner.filter((item) =>
        `${item.title} ${item.notes} ${item.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ),
    [query, workspace.planner],
  );

  async function removeItem(item: PlannerItem): Promise<void> {
    const index = workspace.planner.findIndex((candidate) => candidate.id === item.id);
    const saved = await onWorkspace((current) => ({
      ...current,
      planner: current.planner.filter((candidate) => candidate.id !== item.id),
    }));
    if (saved) setRemoved({ item, index });
  }

  async function undoRemove(): Promise<void> {
    if (!removed) return;
    if (workspace.planner.length >= 500) {
      onError(
        tr(language, "План заполнен (500 карточек)", "Planner is full (500 cards)"),
      );
      return;
    }
    try {
      const saved = await onWorkspace((current) => {
        if (current.planner.length >= 500) {
          throw new Error(
            tr(language, "План заполнен (500 карточек)", "Planner is full (500 cards)"),
          );
        }
        const planner = [...current.planner];
        planner.splice(Math.min(removed.index, planner.length), 0, removed.item);
        return { ...current, planner };
      });
      if (saved) setRemoved(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }
  // "Upcoming" means from today on. The calendar used to sort every dated card
  // ascending, so a few old published cards filled all twelve slots and pushed
  // the next real publication out of view.
  const { calendarItems, hasDatedCards } = useMemo(() => {
    const dated = filtered.filter(
      (item) => item.publishAt && Number.isFinite(Date.parse(item.publishAt)),
    );
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return {
      hasDatedCards: dated.length > 0,
      calendarItems: dated
        .filter((item) => Date.parse(item.publishAt) >= startOfToday.getTime())
        .sort((left, right) => Date.parse(left.publishAt) - Date.parse(right.publishAt))
        .slice(0, 12),
    };
  }, [filtered]);

  async function addItem(): Promise<void> {
    if (!newTitle.trim()) return;
    if (workspace.planner.length >= 500) {
      onError(
        tr(language, "План заполнен (500 карточек)", "Planner is full (500 cards)"),
      );
      return;
    }
    const now = new Date().toISOString();
    try {
      const saved = await onWorkspace((current) => {
        if (current.planner.length >= 500) {
          throw new Error(
            tr(language, "План заполнен (500 карточек)", "Planner is full (500 cards)"),
          );
        }
        return {
          ...current,
          planner: [
            {
              id: uid("plan"),
              title: newTitle.trim(),
              status: "idea",
              publishAt: "",
              notes: "",
              tags: [],
              createdAt: now,
              updatedAt: now,
            },
            ...current.planner,
          ],
        };
      });
      if (saved) setNewTitle("");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function patchItem(id: string, patch: Partial<PlannerItem>): Promise<void> {
    await onWorkspace((current) => ({
      ...current,
      planner: current.planner.map((item) =>
        item.id === id
          ? { ...item, ...patch, updatedAt: new Date().toISOString() }
          : item,
      ),
    }));
  }

  // Every goal unit is something the channel itself reports. Progress used to
  // be typed in by hand even with the channel connected; it now follows the
  // channel, and the manual field remains only while there is no data.
  function liveGoalValue(unit: ChannelGoal["unit"]): number | null {
    if (!data) return null;
    return unit === "subscribers"
      ? data.channel.subscribers
      : unit === "views"
        ? data.channel.views
        : data.channel.videos;
  }

  async function addGoal(): Promise<void> {
    if (!goalLabel.trim() || workspace.goals.length >= 20) return;
    const target = Number(goalTarget);
    if (!Number.isSafeInteger(target) || target < 1 || target > 1_000_000_000_000) {
      onError(
        tr(
          language,
          "Укажите цель от 1 до 1 трлн",
          "Enter a target from 1 to 1 trillion",
        ),
      );
      return;
    }
    try {
      const saved = await onWorkspace((current) => {
        if (current.goals.length >= 20) {
          throw new Error(
            tr(language, "Достигнут лимит: 20 целей", "Limit reached: 20 goals"),
          );
        }
        return {
          ...current,
          goals: [
            ...current.goals,
            {
              id: uid("goal"),
              label: goalLabel.trim(),
              target,
              current: 0,
              unit: goalUnit,
              deadline: "",
            },
          ],
        };
      });
      if (saved) setGoalLabel("");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  function exportPlannerJson(): void {
    download(
      `channelpilot-plan-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          planner: workspace.planner,
        },
        null,
        2,
      ),
      "application/json",
    );
    onNotice(tr(language, "План экспортирован", "Planner exported"));
  }

  function exportPlannerCsv(): void {
    download(
      `channelpilot-plan-${new Date().toISOString().slice(0, 10)}.csv`,
      serializePlannerCsv(workspace.planner),
      "text/csv",
    );
    onNotice(tr(language, "CSV-план экспортирован", "Planner CSV exported"));
  }

  async function importPlanner(file: File): Promise<void> {
    try {
      if (file.size > 4_000_000) {
        throw new Error(
          tr(
            language,
            "Файл плана слишком большой (максимум 4 МБ)",
            "Planner file is too large (4 MB max)",
          ),
        );
      }
      const source = await file.text();
      let imported: PlannerItem[];
      // Locale-invariant: a Turkish locale lowercases "I" to "ı", which would
      // break extension matching against ASCII literals.
      if (file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv") {
        if (source.length > 2_000_000) {
          throw new Error(
            tr(
              language,
              "CSV-план слишком большой (максимум 2 МБ)",
              "Planner CSV is too large (2 MB max)",
            ),
          );
        }
        imported = parsePlannerCsv(source);
        if (imported.length === 0) {
          throw new Error(
            tr(
              language,
              "CSV-план пуст или повреждён",
              "Planner CSV is empty or invalid",
            ),
          );
        }
      } else {
        const parsed = JSON.parse(source) as { planner?: unknown };
        if (!Array.isArray(parsed?.planner)) {
          throw new Error(
            tr(language, "Файл плана повреждён", "Planner file is invalid"),
          );
        }
        if (parsed.planner.length > 500) {
          throw new Error(
            tr(
              language,
              "В файле больше 500 карточек",
              "File contains more than 500 cards",
            ),
          );
        }
        imported = normalizeWorkspaceState({ planner: parsed.planner }).planner;
      }
      if (imported.length === 0) {
        throw new Error(
          tr(
            language,
            "В файле нет карточек для импорта",
            "File has no cards to import",
          ),
        );
      }
      const knownIds = new Set(workspace.planner.map((item) => item.id));
      const unique = imported.filter((item) => {
        if (knownIds.has(item.id)) return false;
        knownIds.add(item.id);
        return true;
      });
      if (unique.length === 0) {
        throw new Error(
          tr(
            language,
            "Все карточки уже импортированы",
            "All cards are already imported",
          ),
        );
      }
      if (unique.length > 500 - workspace.planner.length) {
        throw new Error(
          tr(
            language,
            "Недостаточно места для импорта. Экспортируйте и удалите старые карточки или выберите меньший файл.",
            "Not enough room to import. Export and remove old cards, or choose a smaller file.",
          ),
        );
      }
      if (
        !(await onWorkspace((current) => {
          const ids = new Set(current.planner.map((item) => item.id));
          const additions = unique.filter((item) => !ids.has(item.id));
          if (additions.length === 0) {
            throw new Error(
              tr(
                language,
                "Все карточки уже импортированы",
                "All cards are already imported",
              ),
            );
          }
          if (additions.length > 500 - current.planner.length) {
            throw new Error(
              tr(
                language,
                "Недостаточно места для импорта. Выберите меньший файл.",
                "Not enough room to import. Choose a smaller file.",
              ),
            );
          }
          return { ...current, planner: [...additions, ...current.planner] };
        }))
      ) {
        return;
      }
      onNotice(tr(language, "План импортирован", "Planner imported"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      onError(
        message === "Planner CSV has more than 500 rows"
          ? tr(
              language,
              "В CSV больше 500 строк с карточками",
              "CSV contains more than 500 card rows",
            )
          : message === "Planner CSV is too large"
            ? tr(
                language,
                "CSV-план слишком большой (максимум 2 МБ)",
                "Planner CSV is too large (2 MB max)",
              )
            : message || tr(language, "Импорт не выполнен", "Import failed"),
      );
    }
  }

  return (
    <section className="workspace-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {tr(language, "КОНТЕНТ-ПРОЦЕССЫ", "CONTENT OPERATIONS")}
          </span>
          <h2>{tr(language, "Контент-планер", "Content planner")}</h2>
          <p>
            {tr(
              language,
              "Сохраняемые статусы, даты, заметки и перенос карточек между этапами.",
              "Persistent statuses, dates, notes, and drag-and-drop workflow.",
            )}
          </p>
        </div>
        <div className="planner-actions">
          <button
            onClick={exportPlannerJson}
            disabled={workspace.planner.length === 0}
            title={
              workspace.planner.length === 0
                ? tr(language, "План пока пуст", "The plan is empty")
                : undefined
            }
          >
            {tr(language, "Экспорт JSON", "Export JSON")}
          </button>
          <button
            onClick={exportPlannerCsv}
            disabled={workspace.planner.length === 0}
            title={
              workspace.planner.length === 0
                ? tr(language, "План пока пуст", "The plan is empty")
                : undefined
            }
          >
            {tr(language, "Экспорт CSV", "Export CSV")}
          </button>
          <button onClick={() => importRef.current?.click()}>
            {tr(language, "Импорт", "Import")}
          </button>
          <input
            ref={importRef}
            hidden
            type="file"
            accept="application/json,text/csv,.json,.csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPlanner(file);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>
      <article className="surface planner-toolbar">
        <input
          ref={newTitleRef}
          aria-label={tr(language, "Тема новой карточки", "New card topic")}
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addItem();
          }}
          placeholder={tr(language, "Добавить тему ролика…", "Add a video topic…")}
        />
        {/* Clicking with an empty topic used to do nothing at all. */}
        <button
          className="primary-button"
          disabled={!newTitle.trim()}
          title={
            newTitle.trim()
              ? undefined
              : tr(language, "Сначала введите тему ролика", "Enter a video topic first")
          }
          onClick={() => void addItem()}
        >
          + {tr(language, "Карточка", "Card")}
        </button>
        <input
          aria-label={tr(language, "Поиск по плану", "Search planner")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr(language, "Поиск по плану", "Search planner")}
        />
      </article>
      {/* With no cards at all the first-run card below already explains the
          next step; a second, empty calendar card only repeated it. */}
      {workspace.planner.length > 0 && (
        <section className="surface planner-calendar">
          <header>
            <strong>
              {tr(language, "Календарь публикаций", "Publishing calendar")}
            </strong>
            <span>
              {tr(
                language,
                "Ближайшие карточки с назначенной датой",
                "Upcoming cards with a scheduled date",
              )}
            </span>
          </header>
          <div>
            {calendarItems.length ? (
              calendarItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setQuery(item.title)}
                  title={item.notes}
                >
                  <time dateTime={item.publishAt}>
                    {new Date(item.publishAt).toLocaleDateString(language, {
                      day: "2-digit",
                      month: "short",
                    })}
                    <b>
                      {new Date(item.publishAt).toLocaleTimeString(language, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </b>
                  </time>
                  <span>{item.title}</span>
                  <em>
                    {tr(
                      language,
                      PLANNER_COLUMNS.find(([status]) => status === item.status)?.[1] ??
                        item.status,
                      PLANNER_COLUMNS.find(([status]) => status === item.status)?.[2] ??
                        item.status,
                    )}
                  </em>
                </button>
              ))
            ) : (
              <p>
                {hasDatedCards
                  ? tr(
                      language,
                      "Предстоящих публикаций нет — назначьте карточке новую дату.",
                      "No upcoming publications — give a card a new date.",
                    )
                  : tr(
                      language,
                      "Назначьте дату любой карточке — она появится здесь.",
                      "Set a date on any card and it will appear here.",
                    )}
              </p>
            )}
          </div>
        </section>
      )}
      {removed && (
        <div className="planner-undo" role="status">
          <span>
            {tr(
              language,
              `Карточка «${removed.item.title}» удалена`,
              `Card “${removed.item.title}” deleted`,
            )}
          </span>
          <button onClick={() => void undoRemove()}>
            {tr(language, "Вернуть", "Undo")}
          </button>
        </div>
      )}
      {query && filtered.length === 0 && (
        <p className="surface planner-search-empty" role="status">
          {tr(
            language,
            "По запросу ничего не найдено. Попробуйте другое название или тег.",
            "No cards match. Try another title or tag.",
          )}
        </p>
      )}
      {!query && workspace.planner.length === 0 && (
        <section className="surface planner-first-run">
          <span className="planner-first-run-mark" aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>
              {tr(
                language,
                "План начинается с одной идеи",
                "A plan starts with one idea",
              )}
            </strong>
            <p>
              {tr(
                language,
                "Добавьте тему ролика, затем назначьте этап и дату публикации.",
                "Add a video topic, then choose its stage and publish date.",
              )}
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => newTitleRef.current?.focus()}
          >
            {tr(language, "Добавить тему", "Add a topic")}
          </button>
        </section>
      )}
      {workspace.planner.length > 0 && (!query || filtered.length > 0) && (
        <div className="planner-board">
          {PLANNER_COLUMNS.map(([status, ru, en]) => {
            const columnItems = filtered.filter((item) => item.status === status);
            return (
              <section
                className={`planner-column${dropTarget === status ? " drop-target" : ""}`}
                key={status}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dropTarget !== status) setDropTarget(status);
                }}
                onDragLeave={(event) => {
                  // Leaving for a card inside the same column is not leaving.
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node | null)
                  ) {
                    setDropTarget(null);
                  }
                }}
                onDrop={(event) => {
                  setDropTarget(null);
                  const id = event.dataTransfer.getData("text/channelpilot-plan");
                  if (id) void patchItem(id, { status });
                }}
              >
                <header>
                  <strong>{tr(language, ru, en)}</strong>
                  <span>{columnItems.length}</span>
                </header>
                {columnItems.length === 0 && (
                  <p className="planner-empty">
                    {workspace.planner.length === 0
                      ? status === "idea"
                        ? tr(
                            language,
                            "Новая карточка появится здесь",
                            "New cards appear here",
                          )
                        : tr(language, "Пока пусто", "Empty for now")
                      : tr(language, "Перетащите карточку сюда", "Drop a card here")}
                  </p>
                )}
                {columnItems.map((item) => (
                  <article
                    draggable
                    key={item.id}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/channelpilot-plan", item.id)
                    }
                  >
                    <input
                      value={item.title}
                      onChange={(event) =>
                        void patchItem(item.id, { title: event.target.value })
                      }
                      aria-label={tr(language, "Название", "Title")}
                    />
                    <textarea
                      value={item.notes}
                      onChange={(event) =>
                        void patchItem(item.id, { notes: event.target.value })
                      }
                      placeholder={tr(language, "Заметки и хук", "Notes and hook")}
                    />
                    <label>
                      {tr(language, "Дата", "Date")}
                      <input
                        type="datetime-local"
                        value={localDateTimeValue(item.publishAt)}
                        onChange={(event) =>
                          void patchItem(item.id, {
                            publishAt: event.target.value
                              ? new Date(event.target.value).toISOString()
                              : "",
                          })
                        }
                      />
                    </label>
                    <footer>
                      <select
                        value={item.status}
                        onChange={(event) =>
                          void patchItem(item.id, {
                            status: event.target.value as PlannerStatus,
                          })
                        }
                      >
                        {PLANNER_COLUMNS.map(([id, labelRu, labelEn]) => (
                          <option key={id} value={id}>
                            {tr(language, labelRu, labelEn)}
                          </option>
                        ))}
                      </select>
                      <button
                        aria-label={tr(language, "Удалить карточку", "Delete card")}
                        onClick={() => void removeItem(item)}
                      >
                        ×
                      </button>
                    </footer>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
      <section className="surface goals-panel">
        <div className="section-heading compact-heading">
          <div>
            <h3>{tr(language, "Цели канала", "Channel goals")}</h3>
            <p>
              {data
                ? tr(
                    language,
                    "Прогресс считается по статистике канала и обновляется сам",
                    "Progress follows your channel statistics automatically",
                  )
                : tr(
                    language,
                    "Пока канал не подключён, прогресс вводится вручную",
                    "Enter progress manually until a channel is connected",
                  )}
            </p>
          </div>
        </div>
        <div className="goal-composer">
          <input
            aria-label={tr(language, "Название цели", "Goal name")}
            value={goalLabel}
            onChange={(event) => setGoalLabel(event.target.value)}
            placeholder={tr(
              language,
              "Например: 10K подписчиков",
              "Example: 10K subscribers",
            )}
          />
          <input
            aria-label={tr(language, "Целевое значение", "Target value")}
            type="number"
            min="1"
            max="1000000000000"
            step="1"
            value={goalTarget}
            onChange={(event) => setGoalTarget(event.target.value)}
          />
          <select
            aria-label={tr(language, "Тип цели", "Goal type")}
            value={goalUnit}
            onChange={(event) => setGoalUnit(event.target.value as typeof goalUnit)}
          >
            <option value="subscribers">
              {tr(language, "Подписчики", "Subscribers")}
            </option>
            <option value="views">{tr(language, "Просмотры", "Views")}</option>
            <option value="videos">{tr(language, "Видео", "Videos")}</option>
          </select>
          <button
            className="primary-button"
            disabled={workspace.goals.length >= 20 || !goalLabel.trim()}
            title={
              goalLabel.trim()
                ? undefined
                : tr(language, "Сначала назовите цель", "Name the goal first")
            }
            onClick={() => void addGoal()}
          >
            {tr(language, "Добавить цель", "Add goal")}
          </button>
        </div>
        {workspace.goals.length >= 20 && (
          <p className="goal-limit-note">
            {tr(language, "Достигнут лимит: 20 целей.", "Limit reached: 20 goals.")}
          </p>
        )}
        <div className="goal-list">
          {workspace.goals.map((goal) => {
            const live = liveGoalValue(goal.unit);
            const current = live ?? goal.current;
            const progress =
              goal.target > 0 ? Math.min(100, (current / goal.target) * 100) : 0;
            const reached = goal.target > 0 && current >= goal.target;
            return (
              <article key={goal.id} className={reached ? "reached" : undefined}>
                <div>
                  <strong>{goal.label}</strong>
                  <span>
                    {compact(current)} / {compact(goal.target)} ·{" "}
                    {tr(
                      language,
                      goal.unit === "subscribers"
                        ? "подписчики"
                        : goal.unit === "views"
                          ? "просмотры"
                          : "видео",
                      goal.unit,
                    )}{" "}
                    ·{" "}
                    {reached
                      ? tr(language, "цель достигнута ✓", "goal reached ✓")
                      : `${Math.floor(progress)}%`}
                  </span>
                </div>
                <i
                  role="progressbar"
                  aria-label={goal.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.floor(progress)}
                >
                  <u style={{ width: `${progress}%` }} />
                </i>
                {live === null ? (
                  <input
                    type="number"
                    min="0"
                    value={goal.current}
                    aria-label={tr(language, "Текущий прогресс", "Current progress")}
                    onChange={(event) => {
                      const value = Math.max(0, Number(event.target.value) || 0);
                      void onWorkspace((current) => ({
                        ...current,
                        goals: current.goals.map((item) =>
                          item.id === goal.id ? { ...item, current: value } : item,
                        ),
                      }));
                    }}
                  />
                ) : (
                  <em
                    className="goal-live"
                    title={tr(
                      language,
                      "Значение берётся из статистики канала",
                      "Taken from your channel statistics",
                    )}
                  >
                    {tr(language, "из канала", "from channel")}
                  </em>
                )}
                <button
                  aria-label={tr(language, "Удалить цель", "Delete goal")}
                  onClick={() =>
                    void onWorkspace((current) => ({
                      ...current,
                      goals: current.goals.filter((item) => item.id !== goal.id),
                    }))
                  }
                >
                  ×
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

type CommentFilter = "all" | "questions" | "negative" | "spam";

export function CommentsPage({
  language,
  data,
  settings,
  workspace,
  onWorkspace,
  onError,
  onNotice,
  onOpenSettings,
}: PageProps) {
  // commentThreads.list does not accept the read-only OAuth grant, so without
  // this key every request ended in a raw 403. Say so before the first click.
  const keyMissing = !settings.youtubeApiKey;
  const [videoId, setVideoId] = useState("");
  const [comments, setComments] = useState<YouTubeComment[]>([]);
  const [loadedVideoId, setLoadedVideoId] = useState("");
  const [filter, setFilter] = useState<CommentFilter>("all");
  const [loading, setLoading] = useState(false);
  const [draftingId, setDraftingId] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const loadIdRef = useRef(0);
  const draftBusyRef = useRef(false);
  const [replyTone, setReplyTone] = useState<
    "professional" | "friendly" | "warm" | "concise" | "witty"
  >("friendly");

  async function loadComments(force = false): Promise<void> {
    if (!videoId) return;
    const requestId = ++loadIdRef.current;
    setLoading(true);
    try {
      const result = await rpc<YouTubeComment[]>({
        type: "GET_COMMENTS",
        videoId,
        force,
      });
      if (requestId === loadIdRef.current) {
        setComments(result);
        setLoadedVideoId(videoId);
      }
    } catch (error) {
      if (requestId === loadIdRef.current) {
        onError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestId === loadIdRef.current) setLoading(false);
    }
  }

  async function requestReply(comment: YouTubeComment): Promise<CommentDraft> {
    const result = await analyzeTextDirect(
      {
        title: `Reply to YouTube comment by ${comment.authorDisplayName}`,
        description: comment.text,
        tags: [],
        topic: comment.text,
        language: settings.generationLanguage,
        tone: `${replyTone}, concise, specific, respectful`,
        task: "comment_reply",
      },
      settings,
      settings.preferredProvider,
    );
    const text = (
      result.pinnedComment ||
      result.shortDescription ||
      result.description.slice(0, 1_000)
    ).trim();
    if (!text) {
      throw new Error(
        tr(language, "AI не вернул текст ответа", "AI returned an empty reply"),
      );
    }
    return {
      commentId: comment.id,
      videoId: comment.videoId,
      text,
      tone: replyTone,
      createdAt: new Date().toISOString(),
    };
  }

  async function createReply(comment: YouTubeComment): Promise<void> {
    if (draftBusyRef.current) return;
    if (
      workspace.commentDrafts.length >= 300 &&
      !workspace.commentDrafts.some((draft) => draft.commentId === comment.id)
    ) {
      onError(tr(language, "Лимит: 300 черновиков", "Limit: 300 drafts"));
      return;
    }
    draftBusyRef.current = true;
    setDraftingId(comment.id);
    try {
      const draft = await requestReply(comment);
      if (
        !(await onWorkspace((current) => {
          const previous = current.commentDrafts.filter(
            (item) => item.commentId !== comment.id,
          );
          if (previous.length >= 300) {
            throw new Error(tr(language, "Лимит: 300 черновиков", "Limit: 300 drafts"));
          }
          return { ...current, commentDrafts: [draft, ...previous] };
        }))
      ) {
        return;
      }
      onNotice(tr(language, "Черновик ответа готов", "Reply draft ready"));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      draftBusyRef.current = false;
      setDraftingId("");
    }
  }

  async function createBulkReplies(): Promise<void> {
    if (draftBusyRef.current) return;
    const freeSlots = 300 - workspace.commentDrafts.length;
    if (freeSlots <= 0) {
      onError(tr(language, "Лимит: 300 черновиков", "Limit: 300 drafts"));
      return;
    }
    const targets = visible
      .filter(
        (comment) =>
          !workspace.commentDrafts.some((draft) => draft.commentId === comment.id),
      )
      .slice(0, Math.min(10, freeSlots));
    if (targets.length === 0) {
      onNotice(
        tr(
          language,
          "Для видимых комментариев уже есть черновики",
          "Visible comments already have drafts",
        ),
      );
      return;
    }
    draftBusyRef.current = true;
    setBulkLoading(true);
    const drafts: CommentDraft[] = [];
    let failed = 0;
    for (const comment of targets) {
      setDraftingId(comment.id);
      try {
        drafts.push(await requestReply(comment));
      } catch {
        failed += 1;
      }
    }
    try {
      if (drafts.length) {
        const ids = new Set(drafts.map((draft) => draft.commentId));
        const saved = await onWorkspace((current) => {
          const previous = current.commentDrafts.filter(
            (draft) => !ids.has(draft.commentId),
          );
          if (previous.length + drafts.length > 300) {
            throw new Error(tr(language, "Лимит: 300 черновиков", "Limit: 300 drafts"));
          }
          return { ...current, commentDrafts: [...drafts, ...previous] };
        });
        if (!saved) return;
      }
      onNotice(
        tr(
          language,
          `Подготовлено: ${drafts.length}${failed ? ` · ошибок: ${failed}` : ""}`,
          `Prepared: ${drafts.length}${failed ? ` · failed: ${failed}` : ""}`,
        ),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      draftBusyRef.current = false;
      setDraftingId("");
      setBulkLoading(false);
    }
  }

  const visible = comments.filter((comment) =>
    filter === "questions"
      ? comment.isQuestion
      : filter === "negative"
        ? comment.sentiment === "negative"
        : filter === "spam"
          ? comment.isLikelySpam
          : true,
  );
  const topics = useMemo(
    () =>
      frequentTerms(
        comments.map((comment) => comment.text),
        8,
      ),
    [comments],
  );

  return (
    <section className="workspace-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {tr(language, "КОММЕНТАРИИ YOUTUBE", "YOUTUBE COMMENTS")}
          </span>
          <h2>{tr(language, "Ассистент комментариев", "Comment assistant")}</h2>
          <p>
            {tr(
              language,
              "Реальные комментарии и AI-черновики. Публикация всегда остаётся ручным действием в YouTube.",
              "Real comments and AI drafts. Publishing always remains a manual action in YouTube.",
            )}
          </p>
        </div>
      </div>
      <article className="surface comment-toolbar">
        <select
          aria-label={tr(language, "Выбрать видео", "Choose video")}
          value={videoId}
          onChange={(event) => {
            ++loadIdRef.current;
            setVideoId(event.target.value);
            setComments([]);
            setLoadedVideoId("");
            setFilter("all");
            setLoading(false);
          }}
        >
          <option value="">
            {tr(language, "Выберите своё видео", "Choose your video")}
          </option>
          {(data?.videos ?? []).map((video) => (
            <option value={video.id} key={video.id}>
              {video.title}
            </option>
          ))}
        </select>
        <button
          className="primary-button"
          disabled={!videoId || loading || keyMissing}
          title={
            keyMissing
              ? tr(
                  language,
                  "Сначала добавьте ключ YouTube Data API",
                  "Add a YouTube Data API key first",
                )
              : undefined
          }
          onClick={() => void loadComments()}
        >
          {loading
            ? tr(language, "Загружаем…", "Loading…")
            : tr(language, "Получить комментарии", "Load comments")}
        </button>
        {loadedVideoId === videoId && videoId && (
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => void loadComments(true)}
          >
            {tr(language, "Обновить", "Refresh")}
          </button>
        )}
        {comments.length > 0 && (
          <>
            <select
              value={replyTone}
              aria-label={tr(language, "Тон ответа", "Reply tone")}
              onChange={(event) => setReplyTone(event.target.value as typeof replyTone)}
            >
              <option value="professional">
                {tr(language, "Профессиональный", "Professional")}
              </option>
              <option value="friendly">
                {tr(language, "Дружелюбный", "Friendly")}
              </option>
              <option value="warm">{tr(language, "Тёплый", "Warm")}</option>
              <option value="concise">{tr(language, "Краткий", "Concise")}</option>
              <option value="witty">{tr(language, "Остроумный", "Witty")}</option>
            </select>
            <button
              className="secondary-button"
              disabled={
                loading || bulkLoading || Boolean(draftingId) || visible.length === 0
              }
              onClick={() => void createBulkReplies()}
            >
              {bulkLoading
                ? tr(language, "Готовим пачку…", "Drafting batch…")
                : tr(language, "Черновики для видимых", "Draft visible")}
            </button>
          </>
        )}
      </article>
      {keyMissing && (
        <article className="surface comments-key-required" role="status">
          <span className="comments-key-mark" aria-hidden="true">
            ⚿
          </span>
          <div>
            <strong>
              {tr(
                language,
                "Для чтения комментариев нужен ключ YouTube Data API",
                "Reading comments needs a YouTube Data API key",
              )}
            </strong>
            <p>
              {tr(
                language,
                "Google не отдаёт комментарии по read-only доступу, которым пользуется ChannelPilot, а права на изменение канала ради чтения мы не запрашиваем. Бесплатный ключ API из того же проекта Google Cloud читает только публичные комментарии.",
                "Google does not return comments with the read-only access ChannelPilot uses, and we do not ask for permission to change your channel just to read them. A free API key from the same Google Cloud project reads public comments only.",
              )}
            </p>
          </div>
          <div className="comments-key-actions">
            <a
              className="secondary-button"
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
            >
              {tr(language, "Создать ключ", "Create a key")} ↗
            </a>
            {onOpenSettings && (
              <button className="primary-button" onClick={onOpenSettings}>
                {tr(language, "Добавить ключ", "Add the key")}
              </button>
            )}
          </div>
        </article>
      )}
      {topics.length > 0 && (
        <article className="surface comment-topics">
          <strong>
            {tr(language, "Частые темы и слова", "Frequent topics & words")}
          </strong>
          <div>
            {topics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
          </div>
          <small>
            {tr(
              language,
              "Сводка рассчитывается локально. Для AI-черновика выбранный комментарий отправляется в Gemini и/или Groq согласно настройкам.",
              "This summary is calculated locally. Creating an AI draft sends the selected comment to Gemini and/or Groq according to your settings.",
            )}
          </small>
        </article>
      )}
      {comments.length > 0 && (
        <div className="filter-tabs">
          {(
            [
              ["all", tr(language, "Все", "All")],
              ["questions", tr(language, "Вопросы", "Questions")],
              ["negative", tr(language, "Негативные", "Negative")],
              ["spam", tr(language, "Возможный спам", "Likely spam")],
            ] as Array<[CommentFilter, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "active" : ""}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="comment-list">
        {loading && comments.length === 0 && (
          <div className="surface workspace-loading" role="status">
            {tr(language, "Загружаем комментарии…", "Loading comments…")}
          </div>
        )}
        {visible.map((comment) => {
          const draft = workspace.commentDrafts.find(
            (item) => item.commentId === comment.id,
          );
          return (
            <article className="surface" key={comment.id}>
              <header>
                {comment.authorProfileImageUrl && (
                  <img src={comment.authorProfileImageUrl} alt="" />
                )}
                <div>
                  <strong>{comment.authorDisplayName}</strong>
                  <span>
                    {/* The API can omit publishedAt; "Invalid Date" is not a date. */}
                    {Number.isFinite(Date.parse(comment.publishedAt))
                      ? `${new Date(comment.publishedAt).toLocaleString(language)} · `
                      : ""}
                    {comment.likeCount} ♥
                  </span>
                </div>
                <div className="comment-labels">
                  {comment.isQuestion && <em>?</em>}
                  {comment.sentiment === "negative" && <em>−</em>}
                  {comment.isLikelySpam && <em>spam?</em>}
                </div>
              </header>
              <p>{comment.text}</p>
              {draft && (
                <textarea
                  aria-label={tr(language, "Черновик ответа", "Reply draft")}
                  disabled={bulkLoading || Boolean(draftingId)}
                  value={draft.text}
                  onChange={(event) => {
                    const text = event.target.value;
                    void onWorkspace((current) => ({
                      ...current,
                      commentDrafts: current.commentDrafts.map((item) =>
                        item.commentId === comment.id ? { ...item, text } : item,
                      ),
                    }));
                  }}
                />
              )}
              <footer>
                <button
                  disabled={bulkLoading || Boolean(draftingId)}
                  onClick={() => void createReply(comment)}
                >
                  {draftingId === comment.id
                    ? tr(language, "Готовим…", "Drafting…")
                    : tr(language, "AI-черновик", "AI draft")}
                </button>
                {draft && (
                  <button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(draft.text)
                        .then(() =>
                          onNotice(tr(language, "Черновик скопирован", "Draft copied")),
                        )
                        .catch(() =>
                          onError(
                            tr(
                              language,
                              "Не удалось скопировать черновик",
                              "Could not copy the draft",
                            ),
                          ),
                        )
                    }
                  >
                    {tr(language, "Копировать", "Copy")}
                  </button>
                )}
                <a
                  href={`https://www.youtube.com/watch?v=${comment.videoId}&lc=${comment.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr(language, "Ответить в YouTube", "Reply in YouTube")} ↗
                </a>
              </footer>
            </article>
          );
        })}
        {comments.length > 0 && visible.length === 0 && (
          <div className="surface workspace-empty comment-empty">
            <strong>
              {tr(
                language,
                "Нет комментариев в этом фильтре",
                "No comments in this filter",
              )}
            </strong>
            <button onClick={() => setFilter("all")}>
              {tr(language, "Показать все", "Show all")}
            </button>
          </div>
        )}
        {comments.length === 0 && !loading && !keyMissing && (
          <div className="surface workspace-empty">
            {loadedVideoId === videoId && videoId ? (
              <>
                <strong>
                  {tr(
                    language,
                    "У этого видео пока нет комментариев",
                    "This video has no comments yet",
                  )}
                </strong>
                <p>
                  {tr(
                    language,
                    "Загляните позже или выберите другое видео.",
                    "Check back later or choose another video.",
                  )}
                </p>
              </>
            ) : (
              <>
                <strong>
                  {tr(
                    language,
                    "Комментарии появятся здесь",
                    "Comments will appear here",
                  )}
                </strong>
                <p>
                  {tr(
                    language,
                    "Выберите видео и нажмите «Получить комментарии». Ответы публикуются только вручную в YouTube.",
                    "Choose a video and press “Load comments”. Replies are posted manually in YouTube.",
                  )}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function SeoPage({ language, data }: Pick<PageProps, "language" | "data">) {
  const [videoId, setVideoId] = useState("");
  const video =
    data?.videos.find((candidate) => candidate.id === videoId) ??
    data?.videos[0] ??
    null;
  const seo = video ? calculateSeoChecklist(video, language) : null;
  const checklist = seo?.items ?? [];
  const actionable = [
    ...checklist.filter((item) => item.status === "warning"),
    ...checklist.filter((item) => item.status === "pass"),
  ];
  const unavailable = checklist.filter((item) => item.status === "unknown");
  const performance = video
    ? calculateVideoPerformanceScore(video, data?.videos ?? [])
    : null;
  const passed = seo?.passed ?? 0;
  const measurable = seo?.checked ?? 0;
  const scoredFactors =
    performance?.factors.filter((factor) => factor.available).length ?? 0;

  return (
    <section className="workspace-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {tr(language, "ПОМОЩНИК ПУБЛИКАЦИИ", "UPLOAD ASSISTANT")}
          </span>
          <h2>
            {tr(language, "SEO-чеклист и оценка видео", "SEO checklist & video score")}
          </h2>
          <p>
            {tr(
              language,
              "Проверки основаны на метаданных API; недоступные поля честно отмечены как неизвестные.",
              "Checks use API metadata; unavailable fields are explicitly marked unknown.",
            )}
          </p>
        </div>
        {/* An empty picker with nothing to pick was shown before sign-in. */}
        {Boolean(data?.videos.length) && (
          <select
            aria-label={tr(
              language,
              "Выбрать видео для проверки",
              "Choose a video to inspect",
            )}
            value={video?.id ?? ""}
            onChange={(event) => setVideoId(event.target.value)}
          >
            {(data?.videos ?? []).map((item) => (
              <option value={item.id} key={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {!video || !performance ? (
        <div className="surface workspace-empty">
          <strong>
            {tr(language, "Пока нечего проверять", "Nothing to inspect yet")}
          </strong>
          <p>
            {tr(
              language,
              "Подключите канал в разделе «Подключения» — здесь появятся проверки каждого ролика.",
              "Connect a channel under Connections — checks for every video will appear here.",
            )}
          </p>
        </div>
      ) : (
        <div className="seo-workspace">
          <div className="seo-primary-stack">
            <article className="surface performance-score-card">
              <div
                className={`score-orbit${performance.total === null ? " pending" : ""}`}
                style={
                  { "--score-progress": `${performance.total ?? 0}%` } as CSSProperties
                }
              >
                <strong>{performance.total ?? "—"}</strong>
                <span>/100</span>
              </div>
              <div className="performance-score-intro">
                <span className="eyebrow">
                  {tr(language, "ПРОЗРАЧНАЯ ФОРМУЛА", "TRANSPARENT FORMULA")}
                </span>
                <h3>{tr(language, "Оценка эффективности", "Performance score")}</h3>
                <p>
                  {tr(language, "Полнота данных", "Data coverage")}:{" "}
                  {performance.availableWeight}/100 ·{" "}
                  {performanceCoverageLabel(performance, language)}
                </p>
                <small>{performanceScoreNote(performance, language)}</small>
              </div>
              <details className="seo-score-details">
                <summary>
                  {tr(language, "Как рассчитан индекс", "How this score is calculated")}
                  <span>
                    {scoredFactors}/{performance.factors.length}
                  </span>
                </summary>
                <div className="score-factors">
                  {performance.factors.map((factor) => (
                    <div
                      key={factor.id}
                      className={!factor.available ? "unavailable" : ""}
                    >
                      <span>{performanceFactorName(factor, language)}</span>
                      <b>{factor.available ? `${factor.score}/${factor.max}` : "—"}</b>
                      <progress
                        value={factor.available ? factor.score : 0}
                        max={factor.max}
                        aria-label={performanceFactorName(factor, language)}
                      />
                      <small>
                        {factor.available
                          ? `${performanceFactorValue(factor, language) ?? "—"} · ${performanceFactorExplanation(factor, language)}`
                          : performanceFactorStatus(factor, language)}
                      </small>
                    </div>
                  ))}
                </div>
              </details>
            </article>
            <details className="surface api-limit-card">
              <summary>
                <span>API</span>
                <strong>
                  {tr(
                    language,
                    "Показы и CTR недоступны",
                    "Impressions & CTR unavailable",
                  )}
                </strong>
              </summary>
              <p>
                {tr(
                  language,
                  "В текущем точечном YouTube Analytics API эти метрики недоступны. Они требуют отдельного bulk-отчёта YouTube Reporting API, поэтому здесь нет подставных значений.",
                  "These metrics are unavailable in the current targeted YouTube Analytics API flow. They require a separate bulk YouTube Reporting API report, so no placeholder values are shown.",
                )}
              </p>
            </details>
          </div>
          <article className="surface seo-checklist-card">
            <header>
              <div>
                <h3>{tr(language, "Чеклист оформления", "Video setup checklist")}</h3>
                <p>
                  {passed}/{measurable}{" "}
                  {tr(
                    language,
                    "доступных проверок пройдено",
                    "available checks passed",
                  )}
                </p>
              </div>
              <strong>
                {measurable ? Math.round((passed / measurable) * 100) : 0}%
              </strong>
            </header>
            <div className="seo-check-list" role="list">
              {actionable.map((item) => (
                <div
                  className={`seo-check ${item.status}`}
                  key={item.id}
                  role="listitem"
                  aria-label={`${item.status === "pass" ? tr(language, "Готово", "Ready") : tr(language, "Проверить", "Review")}: ${item.label}. ${item.evidence}`}
                >
                  <span aria-hidden="true">{item.status === "pass" ? "✓" : "!"}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.evidence}</small>
                  </div>
                </div>
              ))}
            </div>
            {unavailable.length > 0 && (
              <details className="seo-unavailable">
                <summary>
                  {tr(language, "Недоступно для проверки", "Cannot be checked here")}
                  <span>{unavailable.length}</span>
                </summary>
                <div role="list">
                  {unavailable.map((item) => (
                    <div className="seo-check unknown" key={item.id} role="listitem">
                      <span aria-hidden="true">?</span>
                      <div>
                        <strong>{item.label}</strong>
                        <small>{item.evidence}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
