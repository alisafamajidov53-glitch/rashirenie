import type { DashboardPage } from "./dashboard-page.js";
import type { DockMetricId, WidgetSectionId } from "./widget.js";

export type AiProvider =
  "auto" | "gemini" | "groq" | "twelvelabs" | "both" | "local-fallback";

export type SupportedLanguage = "ru" | "en";

export type ThemeMode = "auto" | "dark" | "light";
export type AccentColor = "violet" | "cyan" | "emerald" | "coral";
export type InterfaceDensity = "comfortable" | "compact";
export type AnimationMode = "system" | "full" | "reduced";
export type TitleGenerationMode =
  | "seo"
  | "viral"
  | "curiosity"
  | "clean"
  | "educational"
  | "story"
  | "challenge"
  | "versus"
  | "documentary";
export type AiTask = "video_optimization" | "idea_generation" | "comment_reply";

export interface PanelLayoutSettings {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

export interface VideoContext {
  title: string;
  description: string;
  tags: string[];
  transcript?: string;
  topic?: string;
  language: string;
  audience?: string;
  tone?: string;
  videoId?: string;
  titleMode?: TitleGenerationMode;
  task?: AiTask;
  /** Creator's own channel style and best/weakest titles (buildChannelStyleContext). */
  channelContext?: string;
}

export interface AnalysisRequest {
  context: VideoContext;
  provider: AiProvider;
}

export interface SeoFactor {
  id: string;
  label: string;
  score: number;
  max: number;
  hint: string;
}

export interface SeoScore {
  total: number;
  label: "low" | "medium" | "high";
  factors: SeoFactor[];
}

export interface TitleCandidateScore {
  title: string;
  total: number;
  label: "low" | "medium" | "high";
  factors: {
    length: number;
    keywords: number;
    hook: number;
    clarity: number;
    mobile: number;
  };
  strengths: string[];
  warning: string;
}

export interface ContentInsights {
  summary: string;
  detectedFormat: string;
  targetAudience: string;
  primaryHook: string;
  hookAnalysis?: HookAnalysis | undefined;
  keyMoments: string[];
  suggestedChapters?: SuggestedChapter[];
  retentionRisks?: string[];
  thumbnailMoments: ThumbnailMoment[];
  visualElements: string[];
  spokenTopics: string[];
}

export interface HookAnalysis {
  score: number;
  firstSecond: string;
  firstThreeSeconds: string;
  firstTenSeconds: string;
  risk: string;
}

export interface SuggestedChapter {
  timestampSeconds: number;
  title: string;
}

export interface ThumbnailMoment {
  timestampSeconds: number;
  score: number;
  reason: string;
  visual: string;
}

export interface AnalysisResult {
  titles: string[];
  titleScores: TitleCandidateScore[];
  description: string;
  shortDescription: string;
  tags: string[];
  hashtags: string[];
  keywords: string[];
  pinnedComment: string;
  thumbnailPrompt: string;
  scriptOutline: string[];
  shortsIdeas: ShortsIdea[];
  thumbnailIdeas: string[];
  recommendations: string[];
  contentInsights: ContentInsights;
  seo: SeoScore;
  provider: Exclude<AiProvider, "auto">;
  providerNotice?: string;
  generatedAt: string;
}

export interface ShortsIdea {
  title: string;
  hook: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface ChannelSummary {
  id: string;
  title: string;
  avatarUrl: string;
  subscribers: number;
  views: number;
  videos: number;
}

export interface RealtimePoint {
  capturedAt: number;
  views: number;
  /**
   * Counter returned by YouTube before monotonic correction.
   * YouTube may briefly return a lower total after reconciliation; keeping the
   * raw value lets the next real increment remain visible instead of freezing
   * the rolling counter at the old maximum.
   */
  rawViews?: number;
}

export type RealtimeSource = "channel_total" | "hybrid_video_delta";

export interface VideoSummary {
  /** Confirmed by Analytics, never inferred from length or title. */
  contentType?: "shorts" | "video" | "other" | "unknown";
  analyticsDetailAvailable28Days?: boolean;
  id: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl: string;
  publishedAt: string;
  durationSeconds: number;
  categoryId: string;
  defaultLanguage: string;
  captionsAvailable: boolean;
  views: number;
  likes: number;
  comments: number;
  observedViewsLastHour: number;
  observedMinutes: number;
  observedViewsLast24Hours: number;
  observedMinutes24Hours: number;
  observedViewsLast48Hours: number;
  observedMinutes48Hours: number;
  viewsLast15Minutes: number;
  observedMinutesLast15: number;
  viewsPerMinuteLast15: number;
  previous15MinutesViews: number;
  previousObservedMinutes15: number;
  previousViewsPerMinute15: number;
  velocityTrendPercent: number;
  analyticsViews28Days: number;
  watchMinutes28Days: number;
  averageViewPercentage28Days: number;
  shares28Days: number;
  subscribersGained28Days: number;
  subscribersLost28Days: number;
  analyticsAvailable28Days: boolean;
}

export interface AnalyticsBreakdownItem {
  key: string;
  label: string;
  views: number;
  estimatedMinutesWatched: number;
  share: number;
  shareBasis?: "all_views" | "reported_rows";
}

export interface AnalyticsDay {
  date: string;
  views: number;
  engagedViews: number | null;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  averageViewPercentage: number | null;
  likes: number;
  comments: number;
  shares: number | null;
  subscribersGained: number;
  subscribersLost: number;
}

export interface DashboardData {
  /** Separate from the public-counter snapshot time. */
  analyticsSampledAt?: string;
  /** False when YouTube only returned the reduced report without retention and shares. */
  historyDetailAvailable?: boolean;
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
  history: AnalyticsDay[];
  realtimeSeries: RealtimePoint[];
  trafficSources: AnalyticsBreakdownItem[];
  countries: AnalyticsBreakdownItem[];
  devices: AnalyticsBreakdownItem[];
  subscribedStatus: AnalyticsBreakdownItem[];
  sampledAt: string;
  realtimeWarmup: boolean;
  analyticsWarnings?: string[];
  stale?: boolean;
}

export interface VideoAnalyticsDetails {
  videoId: string;
  historyDetailAvailable?: boolean;
  history: AnalyticsDay[];
  trafficSources: AnalyticsBreakdownItem[];
  warnings: string[];
  sampledAt: string;
}

export interface ExtensionSettings {
  googleClientId: string;
  /**
   * Google API key used only to read public comments. commentThreads.list
   * rejects the read-only OAuth scopes the extension asks for (it wants the
   * read-write youtube.force-ssl scope), while unauthenticated requests with an
   * API key may read public comments.
   */
  youtubeApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  twelveLabsApiKey: string;
  geminiModel: string;
  groqModel: string;
  twelveLabsModel: string;
  preferredProvider: AiProvider;
  interfaceLanguage: SupportedLanguage;
  generationLanguage: SupportedLanguage;
  showHeaderWidget: boolean;
  showLauncher: boolean;
  theme: ThemeMode;
  accentColor: AccentColor;
  panelTransparency: number;
  density: InterfaceDensity;
  animationMode: AnimationMode;
  panelLayout: PanelLayoutSettings;
  /** Blocks of the expanded widget, in the order the user arranged them. */
  widgetSections: WidgetSectionId[];
  /** Metrics of the collapsed strip in YouTube's masthead. */
  widgetDockMetrics: DockMetricId[];
  analyticsRefreshSeconds: number;
  notificationsEnabled: boolean;
  allowAiMediaUploads: boolean;
  debugLogging: boolean;
}

/** Only the provider configuration needed for an opted-in media analysis. */
export type AiAnalysisSettings = Pick<
  ExtensionSettings,
  | "geminiApiKey"
  | "groqApiKey"
  | "twelveLabsApiKey"
  | "geminiModel"
  | "groqModel"
  | "twelveLabsModel"
  | "preferredProvider"
  | "interfaceLanguage"
>;

/**
 * The projection of {@link ExtensionSettings} that is safe to hand to a
 * content script for normal UI and text operations. Provider keys are replaced
 * by readiness flags. Opted-in Studio media analysis uses a separate, narrower
 * provider projection.
 */
export type PublicExtensionSettings = Pick<
  ExtensionSettings,
  | "preferredProvider"
  | "interfaceLanguage"
  | "generationLanguage"
  | "showHeaderWidget"
  | "showLauncher"
  | "theme"
  | "accentColor"
  | "panelTransparency"
  | "density"
  | "animationMode"
  | "panelLayout"
  | "widgetSections"
  | "widgetDockMetrics"
  | "analyticsRefreshSeconds"
  | "allowAiMediaUploads"
> & {
  geminiReady: boolean;
  groqReady: boolean;
  twelveLabsReady: boolean;
  googleClientIdReady: boolean;
};

/** Settings fields a content script is allowed to change. */
export type ContentSettingsPatch = Partial<
  Pick<
    ExtensionSettings,
    | "generationLanguage"
    | "interfaceLanguage"
    | "showHeaderWidget"
    | "showLauncher"
    | "panelLayout"
    | "preferredProvider"
    | "widgetSections"
    | "widgetDockMetrics"
  >
>;

export interface RealtimeCollectorStatus {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string;
}

export interface GoogleSignInResult {
  signedIn: true;
  warning?: string;
}

export interface GoogleAuthStatus {
  signedIn: boolean;
  tokenReady: boolean;
  reauthRequired: boolean;
}

export type AiProviderCooldowns = Partial<
  Record<"gemini" | "groq" | "twelvelabs", number>
>;

export interface CompetitorVideo {
  id: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  likes: number;
  comments: number;
}

export interface CompetitorSnapshot {
  channel: ChannelSummary;
  recentVideos: CompetitorVideo[];
  averageViews: number;
  medianViews: number;
  uploadsLast30Days: number;
  fetchedAt: string;
  source: "youtube_public_api";
}

export interface YouTubeComment {
  id: string;
  videoId: string;
  authorDisplayName: string;
  authorProfileImageUrl: string;
  text: string;
  publishedAt: string;
  likeCount: number;
  replyCount: number;
  isQuestion: boolean;
  isLikelySpam: boolean;
  sentiment: "positive" | "neutral" | "negative";
}

export type PlannerStatus = "idea" | "draft" | "scheduled" | "ready" | "published";

export interface ContentIdea {
  id: string;
  title: string;
  angle: string;
  format: "long" | "shorts";
  difficulty: "easy" | "medium" | "hard";
  interest: number;
  source: "manual" | "ai";
  createdAt: string;
}

export interface PlannerItem {
  id: string;
  title: string;
  status: PlannerStatus;
  publishAt: string;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorBookmark {
  channelId: string;
  title: string;
  avatarUrl: string;
  addedAt: string;
}

export interface CommentDraft {
  commentId: string;
  videoId: string;
  text: string;
  tone: string;
  createdAt: string;
}

export interface AiHistoryItem {
  id: string;
  task: AiTask;
  topic: string;
  result: AnalysisResult;
  createdAt: string;
}

export interface ChannelGoal {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: "subscribers" | "views" | "videos";
  deadline: string;
}

export interface WorkspaceState {
  schemaVersion: 1;
  competitors: CompetitorBookmark[];
  ideas: ContentIdea[];
  planner: PlannerItem[];
  commentDrafts: CommentDraft[];
  aiHistory: AiHistoryItem[];
  favoriteTitles: string[];
  goals: ChannelGoal[];
  updatedAt: string;
}

export type ExtensionRequest =
  | { type: "AUTH_STATUS" }
  | { type: "SIGN_IN" }
  | { type: "SIGN_OUT" }
  | { type: "GET_DASHBOARD"; force?: boolean }
  | { type: "GET_VIDEO_ANALYTICS"; videoId: string; force?: boolean }
  | { type: "GET_COMPETITOR"; query: string; force?: boolean }
  | { type: "GET_COMMENTS"; videoId: string; force?: boolean }
  | { type: "COLLECT_REALTIME" }
  | { type: "GET_REALTIME_STATUS" }
  | { type: "ANALYZE_TEXT"; payload: AnalysisRequest }
  | { type: "TEST_AI_KEYS" }
  | { type: "LIST_AI_MODELS" }
  | { type: "GET_AI_PROVIDER_COOLDOWNS" }
  | {
      type: "SET_AI_PROVIDER_COOLDOWN";
      provider: "gemini" | "groq" | "twelvelabs";
      until: number;
    }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; payload: ExtensionSettings }
  | { type: "SAVE_SETTINGS_PATCH"; payload: ContentSettingsPatch }
  | { type: "SAVE_SETTINGS_TRUSTED_PATCH"; payload: Partial<ExtensionSettings> }
  | { type: "CREATE_MEDIA_BRIDGE_SESSION" }
  | { type: "REDEEM_MEDIA_BRIDGE_SESSION"; token: string }
  | { type: "GET_WORKSPACE_STATE" }
  | { type: "SAVE_WORKSPACE_STATE"; payload: WorkspaceState }
  | { type: "CLEAR_CACHES" }
  /**
   * `chrome.runtime.openOptionsPage` is not part of the API surface exposed to
   * content scripts — calling it there throws `is not a function`. Content
   * scripts ask the service worker to open the dashboard instead, optionally
   * on a specific section.
   */
  | { type: "OPEN_OPTIONS_PAGE"; page?: DashboardPage }
  | { type: "RESET_LOCAL_DATA"; preserveSettings?: boolean };

export type ExtensionResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string };
