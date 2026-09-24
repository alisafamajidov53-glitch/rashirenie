import type {
  AnalysisRequest,
  DashboardData,
  ExtensionRequest,
  ExtensionResponse,
  ExtensionSettings,
  RealtimeCollectorStatus,
  SupportedLanguage,
} from "@channelpilot/shared";
import {
  buildChannelStyleContext,
  DEFAULT_WORKSPACE_STATE,
  isExtensionRequest,
  normalizeExtensionSettings,
  REALTIME_COLLECTION_PERIOD_MINUTES,
  safeErrorMessage,
  sanitizeContentSettingsPatch,
  toMediaAnalysisSettings,
  toPublicSettings,
} from "@channelpilot/shared";
import {
  analyzeTextDirect,
  getStoredAiProviderCooldowns,
  listAiModels,
  setStoredAiProviderCooldown,
  testAiKeys,
} from "../lib/ai-direct";
import { openDashboardPage } from "../lib/dashboard-link";
import {
  getGoogleToken,
  hasGoogleSession,
  invalidateGoogleToken,
  signOutGoogle,
} from "./google-auth";
import { clearRealtimeSamples } from "./realtime-store";
import { cachedRequest, clearRequestCache } from "./request-cache";
import {
  checkPlannerReminders,
  ensurePlannerReminderAlarm,
  PLANNER_REMINDER_ALARM,
  schedulePlannerReminderCheck,
} from "./reminders";
import {
  clearWorkspaceState,
  getWorkspaceState,
  saveWorkspaceState,
} from "./workspace-store";
import {
  collectRealtime,
  getCompetitorSnapshot,
  getDashboard,
  getVideoComments,
  getVideoAnalyticsDetails,
  type RealtimeDashboardSnapshot,
} from "./youtube";

const DASHBOARD_CACHE_KEY = "dashboardCacheV10";
const DASHBOARD_CACHE_TTL = 15 * 60_000;
// Every realtime collection costs 3 YouTube Data API units (channels.list +
// playlistItems.list + videos.list) against a 10 000 unit/day project quota.
//
// The background alarm used to run once a minute, which spent 4 320 units —
// 43% of the whole day — before the user opened anything. At 5 minutes the
// same background coverage costs 864 units (8.6%), which leaves real room for
// competitor lookups and dashboard reads.
const REALTIME_ALARM_PERIOD_MINUTES = REALTIME_COLLECTION_PERIOD_MINUTES;
// A visible tab still polls `GET_DASHBOARD` every 60 s. These two thresholds
// stop that poll from reintroducing per-minute collection behind the alarm's
// back: a snapshot younger than the alarm period is served from cache, and
// nothing may collect twice inside the gap below. Together they cap the whole
// extension at roughly one collection per alarm period — about 864 units a day
// (8.6% of quota) instead of the 4 320 (43%) the one-minute alarm cost.
const DASHBOARD_REALTIME_FRESH_MS = REALTIME_ALARM_PERIOD_MINUTES * 60_000;
const MIN_REALTIME_COLLECTION_GAP_MS = 2 * 60_000;
const REALTIME_STATUS_KEY = "realtimeCollectorStatus";
const REALTIME_ALARM = "channelpilot-realtime";
const GOOGLE_CONNECTED_KEY = "googleOAuthConnected";
const QUOTA_PAUSED_UNTIL_KEY = "youtubeCollectionPausedUntilV2";
const RATE_LIMIT_PAUSE_MS = 5 * 60_000;
let realtimeCollection: Promise<RealtimeCollectorStatus | null> | null = null;
let dashboardRefresh: Promise<DashboardData> | null = null;
let dashboardCacheQueue: Promise<void> = Promise.resolve();
let realtimeStatusQueue: Promise<void> = Promise.resolve();
let settingsMutationQueue: Promise<void> = Promise.resolve();
let workspaceMutationQueue: Promise<void> = Promise.resolve();
let workspaceResetting = false;
let debugLogging = false;
let authGeneration = 0;
let dashboardLanguageGeneration = 0;
const mediaBridgeSessions = new Map<
  string,
  { tabId: number | undefined; expiresAt: number }
>();
const MEDIA_BRIDGE_URL = `chrome-extension://${chrome.runtime.id}/src/media-bridge/index.html`;

type DashboardCache = {
  at: number;
  data: DashboardData;
  interfaceLanguage?: SupportedLanguage;
};

function queueDashboardCache<T>(operation: () => Promise<T>): Promise<T> {
  const task = dashboardCacheQueue.then(operation);
  dashboardCacheQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function readDashboardCache(): Promise<DashboardCache | undefined> {
  await dashboardCacheQueue;
  const stored = await chrome.storage.local.get(DASHBOARD_CACHE_KEY);
  return stored[DASHBOARD_CACHE_KEY] as DashboardCache | undefined;
}

async function writeDashboardCache(
  cache: DashboardCache,
  generation: number,
  languageGeneration: number,
): Promise<void> {
  await queueDashboardCache(async () => {
    if (
      generation !== authGeneration ||
      languageGeneration !== dashboardLanguageGeneration
    )
      return;
    await chrome.storage.local.set({ [DASHBOARD_CACHE_KEY]: cache });
  });
}

async function clearDashboardCache(): Promise<void> {
  await queueDashboardCache(() => chrome.storage.local.remove(DASHBOARD_CACHE_KEY));
}

async function restrictLocalStorageAccess(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  } catch {
    // Older Chromium builds may not expose setAccessLevel. The extension still
    // works because page scripts cannot access the isolated content world.
  }
}

async function broadcastInterfaceSettings(settings: ExtensionSettings): Promise<void> {
  const payload = {
    interfaceLanguage: settings.interfaceLanguage,
    generationLanguage: settings.generationLanguage,
    showHeaderWidget: settings.showHeaderWidget,
    showLauncher: settings.showLauncher,
    theme: settings.theme,
    accentColor: settings.accentColor,
    panelTransparency: settings.panelTransparency,
    density: settings.density,
    animationMode: settings.animationMode,
    panelLayout: settings.panelLayout,
    widgetSections: settings.widgetSections,
    widgetDockMetrics: settings.widgetDockMetrics,
    analyticsRefreshSeconds: settings.analyticsRefreshSeconds,
    allowAiMediaUploads: settings.allowAiMediaUploads,
  };
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      typeof tab.id === "number"
        ? [
            chrome.tabs.sendMessage(tab.id, {
              type: "SETTINGS_CHANGED",
              payload,
            }),
          ]
        : [],
    ),
  );
}

function mergeRealtimeDashboard(
  current: DashboardData,
  realtime: RealtimeDashboardSnapshot,
): DashboardData {
  const existingVideos = new Map(current.videos.map((video) => [video.id, video]));
  const videos = realtime.videos.map((video) => {
    const existing = existingVideos.get(video.id);
    return existing
      ? {
          ...video,
          analyticsViews28Days: existing.analyticsViews28Days,
          watchMinutes28Days: existing.watchMinutes28Days,
          averageViewPercentage28Days: existing.averageViewPercentage28Days,
          shares28Days: existing.shares28Days,
          subscribersGained28Days: existing.subscribersGained28Days,
          subscribersLost28Days: existing.subscribersLost28Days,
          analyticsAvailable28Days: existing.analyticsAvailable28Days,
          analyticsDetailAvailable28Days:
            existing.analyticsDetailAvailable28Days ??
            existing.analyticsAvailable28Days,
          contentType: existing.contentType ?? "unknown",
        }
      : video;
  });
  return {
    ...current,
    ...realtime,
    videos,
    stale: false,
  };
}

async function patchDashboardRealtime(
  realtime: RealtimeDashboardSnapshot,
  generation: number,
  languageGeneration: number,
  language: SupportedLanguage,
): Promise<void> {
  await queueDashboardCache(async () => {
    if (
      generation !== authGeneration ||
      languageGeneration !== dashboardLanguageGeneration
    )
      return;
    const stored = await chrome.storage.local.get(DASHBOARD_CACHE_KEY);
    if (
      generation !== authGeneration ||
      languageGeneration !== dashboardLanguageGeneration
    )
      return;
    const cached = stored[DASHBOARD_CACHE_KEY] as DashboardCache | undefined;
    if (
      !cached?.data ||
      !Number.isFinite(cached.at) ||
      cached.interfaceLanguage !== language
    )
      return;
    await chrome.storage.local.set({
      [DASHBOARD_CACHE_KEY]: {
        ...cached,
        data: mergeRealtimeDashboard(cached.data, realtime),
      } satisfies DashboardCache,
    });
  });
}

async function hasGoogleConnection(): Promise<boolean> {
  const generation = authGeneration;
  const stored = await chrome.storage.local.get(GOOGLE_CONNECTED_KEY);
  if (generation !== authGeneration) return false;
  if (stored[GOOGLE_CONNECTED_KEY] === true) return true;
  const active = await hasGoogleSession(await getSettings());
  if (generation !== authGeneration) return false;
  if (active) {
    await chrome.storage.local.set({ [GOOGLE_CONNECTED_KEY]: true });
  }
  return active;
}

function initialSyncWarning(error: unknown, settings: ExtensionSettings): string {
  const message = error instanceof Error ? error.message : "YouTube API request failed";
  const english = settings.interfaceLanguage === "en";
  if (
    /accessNotConfigured|SERVICE_DISABLED|has not been used|not enabled/i.test(message)
  ) {
    return english
      ? "Google is connected, but a YouTube API is disabled. Enable YouTube Data API v3 and YouTube Analytics API in the same Google Cloud project."
      : "Google подключён, но один из YouTube API выключен. Включите YouTube Data API v3 и YouTube Analytics API в том же проекте Google Cloud.";
  }
  if (/не найден YouTube-канал|channel.*not found/i.test(message)) {
    return english
      ? "Google is connected, but this account does not have a YouTube channel."
      : "Google подключён, но у выбранного аккаунта нет YouTube-канала.";
  }
  const detail = userFacingError(error, settings.interfaceLanguage).slice(0, 320);
  return english
    ? `Google is connected, but the first analytics sync failed: ${detail}`
    : `Google подключён, но первая синхронизация аналитики не выполнена: ${detail}`;
}

async function writeRealtimeStatus(
  patch: Partial<RealtimeCollectorStatus>,
  generation = authGeneration,
): Promise<RealtimeCollectorStatus> {
  const task = realtimeStatusQueue.then(async () => {
    if (generation !== authGeneration)
      throw new Error("Google session changed during realtime status update");
    const stored = await chrome.storage.local.get(REALTIME_STATUS_KEY);
    if (generation !== authGeneration)
      throw new Error("Google session changed during realtime status update");
    const current = (stored[REALTIME_STATUS_KEY] as
      RealtimeCollectorStatus | undefined) ?? {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: "",
    };
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [REALTIME_STATUS_KEY]: next });
    return next;
  });
  realtimeStatusQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function clearRealtimeStatus(generation = authGeneration): Promise<void> {
  const task = realtimeStatusQueue.then(async () => {
    if (generation !== authGeneration) return;
    await chrome.storage.local.remove(REALTIME_STATUS_KEY);
  });
  realtimeStatusQueue = task.then(
    () => undefined,
    () => undefined,
  );
  await task;
}

async function getRealtimeStatus(): Promise<RealtimeCollectorStatus> {
  await realtimeStatusQueue;
  const stored = await chrome.storage.local.get(REALTIME_STATUS_KEY);
  return (
    (stored[REALTIME_STATUS_KEY] as RealtimeCollectorStatus | undefined) ?? {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: "",
    }
  );
}

async function ensureRealtimeAlarm(): Promise<void> {
  await chrome.alarms.create(REALTIME_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: REALTIME_ALARM_PERIOD_MINUTES,
  });
}

/** Daily exhaustion and short-window throttling need different retry times. */
function youtubeLimitKind(error: unknown): "daily" | "rate" | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/quotaExceeded|dailyLimitExceeded/i.test(message)) return "daily";
  if (
    /rateLimitExceeded|servingLimitExceeded|tooManyRequests|RESOURCE_EXHAUSTED|YouTube API 429\b/i.test(
      message,
    )
  )
    return "rate";
  return null;
}

/** Milliseconds until the next YouTube quota reset (midnight US/Pacific). */
function millisecondsUntilQuotaReset(now = Date.now()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const pacificDay = (timestamp: number) => formatter.format(new Date(timestamp));
  const today = pacificDay(now);
  // A Pacific calendar day can be 23 or 25 hours when daylight saving changes.
  // Find the actual next date boundary instead of adding wall-clock hours.
  let beforeMidnight = now;
  let afterMidnight = now + 27 * 3_600_000;
  while (afterMidnight - beforeMidnight > 1_000) {
    const candidate = Math.floor((beforeMidnight + afterMidnight) / 2);
    if (pacificDay(candidate) === today) beforeMidnight = candidate;
    else afterMidnight = candidate;
  }
  return Math.max(60_000, afterMidnight - now);
}

async function readQuotaPause(): Promise<number> {
  const stored = await chrome.storage.local.get(QUOTA_PAUSED_UNTIL_KEY);
  const until = stored[QUOTA_PAUSED_UNTIL_KEY];
  return typeof until === "number" && Number.isFinite(until) ? until : 0;
}

async function runRealtimeCollection(): Promise<RealtimeCollectorStatus | null> {
  if (realtimeCollection) return realtimeCollection;
  const generation = authGeneration;
  const languageGeneration = dashboardLanguageGeneration;
  // The promise returned by an async IIFE is available synchronously, before
  // its body reaches its first await. Assigning it to `realtimeCollection`
  // right here (rather than after the connection/gap checks below, which
  // themselves await) keeps the single-flight guard atomic: two calls that
  // both observe `realtimeCollection` as null cannot both slip past the
  // check above and start a second, duplicate collection.
  const task = (async (): Promise<RealtimeCollectorStatus | null> => {
    const connected = await hasGoogleConnection();
    if (generation !== authGeneration)
      throw new Error("Google session changed during realtime collection");
    if (!connected) return null;
    // Respect the cooldown for either a daily quota or short-window rate limit.
    const pausedUntil = await readQuotaPause();
    if (generation !== authGeneration)
      throw new Error("Google session changed during realtime collection");
    if (pausedUntil > Date.now()) {
      const status = await getRealtimeStatus();
      if (generation !== authGeneration)
        throw new Error("Google session changed during realtime collection");
      return status;
    }
    const previousStatus = await getRealtimeStatus();
    if (generation !== authGeneration)
      throw new Error("Google session changed during realtime collection");
    const previousSuccessAt = previousStatus.lastSuccessAt
      ? new Date(previousStatus.lastSuccessAt).getTime()
      : Number.NaN;
    const elapsedSinceSuccess = Date.now() - previousSuccessAt;
    // Multiple open YouTube tabs, a Chrome alarm and a manual UI read can arrive
    // almost together. Reuse the just-completed snapshot instead of spending API
    // quota and racing the cache with an equivalent request.
    if (
      Number.isFinite(previousSuccessAt) &&
      elapsedSinceSuccess >= 0 &&
      elapsedSinceSuccess < MIN_REALTIME_COLLECTION_GAP_MS
    ) {
      return previousStatus;
    }
    await writeRealtimeStatus({ lastAttemptAt: new Date().toISOString() }, generation);
    try {
      const settings = await getSettings();
      const realtime = await withGoogleToken(settings, (token) =>
        collectRealtime(token, settings.interfaceLanguage),
      );
      if (generation !== authGeneration) {
        throw new Error("Google session changed during realtime collection");
      }
      await patchDashboardRealtime(
        realtime,
        generation,
        languageGeneration,
        settings.interfaceLanguage,
      );
      await chrome.storage.local.remove(QUOTA_PAUSED_UNTIL_KEY);
      return writeRealtimeStatus(
        {
          lastSuccessAt: new Date().toISOString(),
          lastError: "",
        },
        generation,
      );
    } catch (error) {
      if (generation !== authGeneration) throw error;
      const settings = await getSettings().catch(() => null);
      if (generation !== authGeneration) throw error;
      const english = settings?.interfaceLanguage === "en";
      let message = userFacingError(error, english ? "en" : "ru");
      const limitKind = youtubeLimitKind(error);
      if (limitKind) {
        const resetInMs =
          limitKind === "daily" ? millisecondsUntilQuotaReset() : RATE_LIMIT_PAUSE_MS;
        await chrome.storage.local.set({
          [QUOTA_PAUSED_UNTIL_KEY]: Date.now() + resetInMs,
        });
        if (limitKind === "daily") {
          const hours = Math.max(1, Math.round(resetInMs / 3_600_000));
          message = english
            ? `The daily YouTube API quota for your Google Cloud project is used up. Collection resumes automatically in about ${hours} h.`
            : `Суточная квота YouTube API вашего проекта Google Cloud исчерпана. Сбор возобновится автоматически примерно через ${hours} ч.`;
        } else {
          message = english
            ? "YouTube API is temporarily rate-limiting requests. Collection retries automatically in about 5 min."
            : "YouTube API временно ограничил частоту запросов. Сбор автоматически повторится примерно через 5 мин.";
        }
      }
      await writeRealtimeStatus({ lastError: message }, generation);
      if (isUnauthorizedGoogleError(error)) {
        await invalidateGoogleToken();
      }
      throw error;
    }
  })();
  realtimeCollection = task;
  try {
    return await task;
  } finally {
    // Only clear the slot if it still holds this call's task: a defensive
    // guard against ever nulling out a newer in-flight collection.
    if (realtimeCollection === task) realtimeCollection = null;
  }
}

/**
 * The message a person sees for a failure. A dropped connection surfaced as
 * "Failed to fetch" and a slow one as "signal is aborted without reason";
 * both now say what happened and that nothing needs to be done.
 */
function userFacingError(error: unknown, language: SupportedLanguage): string {
  const english = language === "en";
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return english
      ? "YouTube did not respond in time. The data will refresh on the next attempt."
      : "YouTube не ответил вовремя. Данные обновятся при следующей попытке.";
  }
  if (
    error instanceof TypeError &&
    // Chrome, Firefox and Safari wordings of a fetch that never got a
    // response; a bare "network" also matched unrelated TypeErrors.
    /failed to fetch|networkerror|load failed|network error/i.test(error.message)
  ) {
    return english
      ? "No connection to YouTube. Check your internet connection — the data will refresh on its own."
      : "Нет связи с YouTube. Проверьте интернет — данные обновятся сами.";
  }
  return safeErrorMessage(error, english ? "Unknown error" : "Неизвестная ошибка");
}

function isUnauthorizedGoogleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /YouTube API 401|invalid credentials|invalid_token|UNAUTHENTICATED/i.test(
    message,
  );
}

async function withGoogleToken<T>(
  settings: ExtensionSettings,
  operation: (token: string) => Promise<T>,
): Promise<T> {
  let token = await getGoogleToken(false, settings);
  try {
    return await operation(token);
  } catch (error) {
    if (!isUnauthorizedGoogleError(error)) throw error;
    await invalidateGoogleToken();
    token = await getGoogleToken(false, settings);
    return operation(token);
  }
}

async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get("settings");
  return normalizeExtensionSettings(result.settings);
}

function queueSettingsMutation<T>(operation: () => Promise<T>): Promise<T> {
  const task = settingsMutationQueue.then(operation);
  settingsMutationQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function queueWorkspaceMutation<T>(operation: () => Promise<T>): Promise<T> {
  const task = workspaceMutationQueue.then(operation);
  workspaceMutationQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function fetchAnalysis(
  payload: AnalysisRequest,
): ReturnType<typeof analyzeTextDirect> {
  const settings = await getSettings();
  // Studio requests arrive without channel data; the dashboard cache belongs
  // to the signed-in account (cleared on every sign-in/out) and lets the model
  // write in the channel's own proven style.
  let context = payload.context;
  if (!context.task || context.task === "video_optimization") {
    const cached = await readDashboardCache().catch(() => undefined);
    const channelContext = buildChannelStyleContext(cached?.data, {
      excludeVideoId: context.videoId,
    });
    if (channelContext) context = { ...context, channelContext };
  }
  return analyzeTextDirect(context, settings, payload.provider);
}

async function dashboard(force = false): Promise<DashboardData> {
  // A storage change can reach an extension page before applySettings finishes
  // invalidating the old-language cache. Wait for that mutation before reading.
  await settingsMutationQueue;
  // Captured once up front so a sign-out/sign-in/account-switch racing with
  // this call can be detected later instead of silently handing back another
  // account's cached snapshot, including on the fast cache-return path.
  const initialGeneration = authGeneration;
  const initialLanguageGeneration = dashboardLanguageGeneration;
  const cached = await readDashboardCache();
  const currentLanguage = (await getSettings()).interfaceLanguage;
  if (initialGeneration !== authGeneration)
    throw new Error("Google session changed during dashboard read");
  if (initialLanguageGeneration !== dashboardLanguageGeneration)
    throw new Error("Interface language changed during dashboard read");
  const compatibleCache =
    cached?.interfaceLanguage === currentLanguage ? cached : undefined;
  if (
    !force &&
    compatibleCache &&
    Date.now() - compatibleCache.at < DASHBOARD_CACHE_TTL
  ) {
    const sampledAt = new Date(compatibleCache.data.sampledAt).getTime();
    if (
      Number.isFinite(sampledAt) &&
      Date.now() - sampledAt <= DASHBOARD_REALTIME_FRESH_MS
    ) {
      return { ...compatibleCache.data, stale: false };
    }
    try {
      const status = await runRealtimeCollection();
      if (initialGeneration !== authGeneration)
        throw new Error("Google session changed during realtime collection");
      if (initialLanguageGeneration !== dashboardLanguageGeneration)
        throw new Error("Interface language changed during realtime collection");
      if (!status) return { ...compatibleCache.data, stale: true };
      const patched = await readDashboardCache();
      if (initialGeneration !== authGeneration)
        throw new Error("Google session changed during dashboard read");
      if (initialLanguageGeneration !== dashboardLanguageGeneration)
        throw new Error("Interface language changed during dashboard read");
      if (patched?.data && patched.interfaceLanguage === currentLanguage) {
        const patchedAt = new Date(patched.data.sampledAt).getTime();
        return {
          ...patched.data,
          stale:
            !Number.isFinite(patchedAt) ||
            Date.now() - patchedAt > DASHBOARD_REALTIME_FRESH_MS,
        };
      }
    } catch (error) {
      // A sign-out/account switch mid-request already invalidated `cached`;
      // surface the error instead of handing back the previous account's data.
      if (
        initialGeneration !== authGeneration ||
        initialLanguageGeneration !== dashboardLanguageGeneration
      )
        throw error;
      return { ...compatibleCache.data, stale: true };
    }
  }
  if (dashboardRefresh) return dashboardRefresh;
  const generation = authGeneration;
  const languageGeneration = dashboardLanguageGeneration;
  // As in runRealtimeCollection, the promise is assigned to the module-level
  // single-flight slot synchronously (settings are now fetched inside the
  // IIFE, not before it) so two concurrent callers can never both pass the
  // `if (dashboardRefresh)` check above and kick off duplicate network
  // refreshes.
  const refresh = (async () => {
    try {
      const settings = await getSettings();
      const data = {
        ...(await withGoogleToken(settings, (token) =>
          getDashboard(token, settings.interfaceLanguage),
        )),
        stale: false,
      };
      if (generation !== authGeneration) {
        throw new Error("Google session changed during dashboard refresh");
      }
      if (languageGeneration !== dashboardLanguageGeneration)
        throw new Error("Interface language changed during dashboard refresh");
      await writeDashboardCache(
        {
          at: Date.now(),
          data,
          interfaceLanguage: settings.interfaceLanguage,
        },
        generation,
        languageGeneration,
      );
      if (generation !== authGeneration)
        throw new Error("Google session changed during dashboard refresh");
      if (languageGeneration !== dashboardLanguageGeneration)
        throw new Error("Interface language changed during dashboard refresh");
      return data;
    } catch (error) {
      if (
        generation !== authGeneration ||
        languageGeneration !== dashboardLanguageGeneration
      )
        throw error;
      if (compatibleCache?.data) return { ...compatibleCache.data, stale: true };
      throw error;
    }
  })();
  dashboardRefresh = refresh;
  try {
    return await refresh;
  } finally {
    if (dashboardRefresh === refresh) dashboardRefresh = null;
  }
}

async function applySettings(
  payload: unknown,
  patch = false,
): Promise<ExtensionSettings> {
  return queueSettingsMutation(async () => {
    const previous = await getSettings();
    const settings = normalizeExtensionSettings(
      patch ? { ...previous, ...(payload as Partial<ExtensionSettings>) } : payload,
    );
    await chrome.storage.local.set({ settings });
    debugLogging = settings.debugLogging;
    if (previous.googleClientId !== settings.googleClientId) {
      authGeneration += 1;
      dashboardRefresh = null;
      await signOutGoogle();
      await chrome.alarms.clear(REALTIME_ALARM);
      await realtimeCollection?.catch(() => undefined);
      await clearRealtimeSamples();
      await clearDashboardCache();
      await clearRequestCache();
      await clearRealtimeStatus();
      await chrome.storage.local.remove(GOOGLE_CONNECTED_KEY);
    }
    if (
      previous.googleClientId === settings.googleClientId &&
      previous.interfaceLanguage !== settings.interfaceLanguage
    ) {
      dashboardLanguageGeneration += 1;
      dashboardRefresh = null;
      await clearDashboardCache();
    }
    await broadcastInterfaceSettings(settings);
    return settings;
  });
}

/**
 * Decides whether a message came from a page the extension does not control.
 *
 * The discriminator is the sender's ORIGIN, not `sender.tab`. The options page
 * is opened as a normal tab, so it has a `sender.tab` just like a content
 * script does — keying off that treated the user's own settings page as
 * untrusted, hid the API-key fields from it and rejected every save.
 *
 * A content script reports the host page's origin (https://www.youtube.com);
 * the popup, the options page and any other extension page report
 * chrome-extension://<id>.
 */
export function isUntrustedSender(sender: chrome.runtime.MessageSender): boolean {
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  if (typeof sender.origin === "string") return sender.origin !== extensionOrigin;
  // `sender.origin` predates Chrome 80; `sender.url` is the fallback. A sender
  // with neither is not something we can vouch for, so treat it as untrusted.
  if (typeof sender.url === "string")
    return !sender.url.startsWith(`${extensionOrigin}/`);
  return true;
}

export function isStudioContentSender(sender: chrome.runtime.MessageSender): boolean {
  const studioOrigin = "https://studio.youtube.com";
  if (typeof sender.origin === "string" && sender.origin !== studioOrigin) {
    return false;
  }
  if (typeof sender.url === "string") {
    try {
      return new URL(sender.url).origin === studioOrigin;
    } catch {
      return false;
    }
  }
  return sender.origin === studioOrigin;
}

const CONTENT_SCRIPT_OPERATIONS = new Set<ExtensionRequest["type"]>([
  "ANALYZE_TEXT",
  "AUTH_STATUS",
  "GET_AI_PROVIDER_COOLDOWNS",
  "GET_DASHBOARD",
  "CREATE_MEDIA_BRIDGE_SESSION",
  "GET_SETTINGS",
  "OPEN_OPTIONS_PAGE",
  "SAVE_SETTINGS_PATCH",
  "SET_AI_PROVIDER_COOLDOWN",
  "SIGN_IN",
]);

export function isContentScriptOperationAllowed(
  type: ExtensionRequest["type"],
): boolean {
  return CONTENT_SCRIPT_OPERATIONS.has(type);
}

/** Content scripts get a redacted settings view and only the operations used by YouTube UI. */
async function handleMessage(
  message: ExtensionRequest,
  fromContentScript: boolean,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (fromContentScript && !isContentScriptOperationAllowed(message.type))
    throw new Error("This operation is only available from an extension page.");
  switch (message.type) {
    case "AUTH_STATUS": {
      await settingsMutationQueue;
      const generation = authGeneration;
      const settings = await getSettings();
      const knownConnection = await hasGoogleConnection();
      // Only a known connection is worth a silent token refresh. Without one,
      // the non-interactive OAuth flow loads Google's consent page in a hidden
      // window on every popup open and every YouTube page load, only to fail
      // with `interaction_required` for someone who never signed in.
      const tokenReady = knownConnection
        ? await getGoogleToken(false, settings)
            .then(() => true)
            .catch(() => false)
        : false;
      if (generation !== authGeneration)
        throw new Error("Google session changed during auth check");
      const signedIn = knownConnection || tokenReady;
      if (tokenReady) {
        await chrome.storage.local.set({ [GOOGLE_CONNECTED_KEY]: true });
      }
      return {
        signedIn,
        tokenReady,
        reauthRequired: signedIn && !tokenReady,
      };
    }
    case "SIGN_IN": {
      const generation = ++authGeneration;
      const languageGeneration = dashboardLanguageGeneration;
      dashboardRefresh = null;
      realtimeCollection = null;
      const settings = await getSettings();
      const token = await getGoogleToken(true, settings);
      if (generation !== authGeneration)
        throw new Error("Google session changed during sign-in");
      await clearDashboardCache();
      if (generation !== authGeneration)
        throw new Error("Google session changed during sign-in");
      await clearRealtimeStatus(generation);
      if (generation !== authGeneration)
        throw new Error("Google session changed during sign-in");
      await chrome.storage.local.set({ [GOOGLE_CONNECTED_KEY]: true });
      await ensureRealtimeAlarm();
      const attemptedAt = new Date().toISOString();
      await writeRealtimeStatus({ lastAttemptAt: attemptedAt }, generation);
      try {
        const realtime = await collectRealtime(token, settings.interfaceLanguage);
        if (generation !== authGeneration)
          throw new Error("Google session changed during sign-in");
        await patchDashboardRealtime(
          realtime,
          generation,
          languageGeneration,
          settings.interfaceLanguage,
        );
        if (generation !== authGeneration)
          throw new Error("Google session changed during sign-in");
        await writeRealtimeStatus(
          {
            lastSuccessAt: new Date().toISOString(),
            lastError: "",
          },
          generation,
        );
        return { signedIn: true };
      } catch (error) {
        if (generation !== authGeneration) throw error;
        const warning = initialSyncWarning(error, settings);
        await writeRealtimeStatus({ lastError: warning }, generation);
        return { signedIn: true, warning };
      }
    }
    case "SIGN_OUT":
      authGeneration += 1;
      dashboardRefresh = null;
      await signOutGoogle();
      await chrome.alarms.clear(REALTIME_ALARM);
      await realtimeCollection?.catch(() => undefined);
      await clearRealtimeSamples();
      await clearDashboardCache();
      await clearRequestCache();
      await clearRealtimeStatus();
      await chrome.storage.local.remove([GOOGLE_CONNECTED_KEY, QUOTA_PAUSED_UNTIL_KEY]);
      return { signedIn: false };
    case "GET_DASHBOARD":
      return dashboard(message.force);
    case "GET_VIDEO_ANALYTICS": {
      const settings = await getSettings();
      return cachedRequest(
        `video-analytics:${settings.interfaceLanguage}:${message.videoId}`,
        5 * 60_000,
        message.force === true,
        (signal) =>
          withGoogleToken(settings, (token) =>
            getVideoAnalyticsDetails(
              token,
              message.videoId,
              settings.interfaceLanguage,
              signal,
            ),
          ),
      );
    }
    case "GET_COMPETITOR": {
      const settings = await getSettings();
      const cacheKey = `competitor:${message.query.trim().toLocaleLowerCase()}`;
      return cachedRequest(cacheKey, 10 * 60_000, message.force === true, (signal) =>
        withGoogleToken(settings, (token) =>
          getCompetitorSnapshot(
            token,
            message.query,
            settings.interfaceLanguage,
            signal,
          ),
        ),
      );
    }
    case "GET_COMMENTS": {
      const settings = await getSettings();
      // Comments are read with an API key, not the OAuth token: Google rejects
      // the extension's read-only scopes for commentThreads.list (see
      // getVideoComments). Without a key the request would only fail with a
      // raw 403, so say what is missing instead of spending the request.
      if (!settings.youtubeApiKey) {
        throw new Error(
          settings.interfaceLanguage === "en"
            ? "Reading comments needs a YouTube Data API key: Google does not return comments with read-only access. Add and save the key under Connections."
            : "Для чтения комментариев нужен ключ YouTube Data API: по read-only доступу Google комментарии не отдаёт. Добавьте и сохраните ключ в разделе «Подключения».",
        );
      }
      return cachedRequest(
        `comments:${message.videoId}`,
        2 * 60_000,
        message.force === true,
        (signal) =>
          getVideoComments(
            settings.youtubeApiKey,
            message.videoId,
            settings.interfaceLanguage,
            signal,
          ),
      );
    }
    case "COLLECT_REALTIME": {
      const status = await runRealtimeCollection();
      if (!status) {
        const settings = await getSettings();
        throw new Error(
          settings.interfaceLanguage === "en"
            ? "Connect Google before collecting realtime analytics."
            : "Подключите Google перед сбором аналитики в реальном времени.",
        );
      }
      return status;
    }
    case "GET_REALTIME_STATUS":
      return getRealtimeStatus();
    case "ANALYZE_TEXT":
      return fetchAnalysis(message.payload);
    case "TEST_AI_KEYS":
      return testAiKeys(await getSettings());
    case "LIST_AI_MODELS":
      return listAiModels(await getSettings());
    case "GET_AI_PROVIDER_COOLDOWNS":
      return getStoredAiProviderCooldowns();
    case "SET_AI_PROVIDER_COOLDOWN":
      return setStoredAiProviderCooldown(message.provider, message.until);
    case "GET_SETTINGS": {
      const settings = await getSettings();
      return fromContentScript ? toPublicSettings(settings) : settings;
    }
    case "CREATE_MEDIA_BRIDGE_SESSION": {
      if (!fromContentScript || !isStudioContentSender(sender))
        throw new Error("Media analysis is only available in YouTube Studio");
      const settings = await getSettings();
      if (!settings.allowAiMediaUploads) {
        throw new Error(
          settings.interfaceLanguage === "en"
            ? "Enable “send media to AI” in settings before analysing a video file."
            : "Включите «отправку медиа в AI» в настройках, чтобы анализировать видеофайл.",
        );
      }
      const now = Date.now();
      for (const [token, session] of mediaBridgeSessions)
        if (session.expiresAt <= now) mediaBridgeSessions.delete(token);
      if (mediaBridgeSessions.size >= 32)
        mediaBridgeSessions.delete(mediaBridgeSessions.keys().next().value!);
      const token = crypto.randomUUID();
      mediaBridgeSessions.set(token, {
        tabId: sender.tab?.id,
        expiresAt: now + 45_000,
      });
      return token;
    }
    case "REDEEM_MEDIA_BRIDGE_SESSION": {
      if (fromContentScript || sender.url !== MEDIA_BRIDGE_URL)
        throw new Error("Invalid media bridge sender");
      const session = mediaBridgeSessions.get(message.token);
      mediaBridgeSessions.delete(message.token);
      if (
        !session ||
        session.expiresAt <= Date.now() ||
        (session.tabId !== undefined &&
          sender.tab?.id !== undefined &&
          session.tabId !== sender.tab.id)
      )
        throw new Error("Media bridge session expired");
      const settings = await getSettings();
      if (!settings.allowAiMediaUploads)
        throw new Error("Media upload permission was revoked");
      return toMediaAnalysisSettings(settings);
    }
    case "GET_WORKSPACE_STATE":
      if (workspaceResetting) throw new Error("Workspace reset is in progress");
      return queueWorkspaceMutation(getWorkspaceState);
    case "SAVE_WORKSPACE_STATE": {
      if (workspaceResetting) throw new Error("Workspace reset is in progress");
      return queueWorkspaceMutation(async () => {
        if (workspaceResetting) throw new Error("Workspace reset is in progress");
        const saved = await saveWorkspaceState(message.payload);
        schedulePlannerReminderCheck();
        return saved;
      });
    }
    case "OPEN_OPTIONS_PAGE":
      // Content scripts cannot call `chrome.runtime.openOptionsPage` — it is
      // absent from the content-script API surface, so the call threw and the
      // button silently did nothing. Opening it here works for every caller.
      await openDashboardPage(message.page);
      return { opened: true };
    case "CLEAR_CACHES":
      await clearDashboardCache();
      await clearRequestCache();
      await chrome.storage.local.remove(QUOTA_PAUSED_UNTIL_KEY);
      return { cleared: true };
    case "RESET_LOCAL_DATA":
      if (workspaceResetting) throw new Error("Workspace reset is in progress");
      workspaceResetting = true;
      try {
        return await queueSettingsMutation(() =>
          queueWorkspaceMutation(async () => {
            const settings = message.preserveSettings ? await getSettings() : undefined;
            authGeneration += 1;
            dashboardRefresh = null;
            await signOutGoogle();
            await chrome.alarms.clear(REALTIME_ALARM);
            await realtimeCollection?.catch(() => undefined);
            await clearRequestCache();
            await clearRealtimeSamples();
            await clearDashboardCache();
            await clearWorkspaceState();
            await realtimeStatusQueue;
            await chrome.storage.local.clear();
            await saveWorkspaceState(DEFAULT_WORKSPACE_STATE);
            if (settings) await chrome.storage.local.set({ settings });
            debugLogging = settings?.debugLogging ?? false;
            return { reset: true };
          }),
        );
      } finally {
        workspaceResetting = false;
      }
    case "SAVE_SETTINGS":
      return applySettings(message.payload);
    case "SAVE_SETTINGS_TRUSTED_PATCH":
      return applySettings(message.payload, true);
    case "SAVE_SETTINGS_PATCH": {
      // A patch, not a read-modify-write of the whole object. The content
      // script used to send back every field it had just read, which both
      // clobbered concurrent edits made in the options page and gave a tab a
      // way to rewrite the OAuth client id.
      return queueSettingsMutation(async () => {
        const patch = sanitizeContentSettingsPatch(message.payload);
        const current = await getSettings();
        const settings = normalizeExtensionSettings({ ...current, ...patch });
        await chrome.storage.local.set({ settings });
        debugLogging = settings.debugLogging;
        if (current.interfaceLanguage !== settings.interfaceLanguage) {
          dashboardLanguageGeneration += 1;
          dashboardRefresh = null;
          await clearDashboardCache();
        }
        await broadcastInterfaceSettings(settings);
        return fromContentScript ? toPublicSettings(settings) : settings;
      });
    }
  }
}

// "Debug logs" in settings. Kept in memory so logging costs no storage read per
// message; every settings write goes through this worker and refreshes it.
// Only message types, timings and redacted errors are written, never payloads,
// tokens or keys.
void getSettings()
  .then((settings) => {
    debugLogging = settings.debugLogging;
  })
  .catch(() => undefined);

function debugLog(event: string, details: Record<string, unknown>): void {
  if (debugLogging) console.info(`[ChannelPilot] ${event}`, details);
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (response: ExtensionResponse) => void) => {
    if (sender.id !== chrome.runtime.id || !isExtensionRequest(message)) {
      debugLog("rejected message", { origin: sender.origin ?? sender.url ?? "" });
      sendResponse({
        ok: false,
        error: "Некорректный запрос расширения",
      });
      return false;
    }
    const fromContentScript = isUntrustedSender(sender);
    const startedAt = performance.now();
    const context = fromContentScript ? "content script" : "extension page";
    handleMessage(message, fromContentScript, sender)
      .then((data) => {
        debugLog(message.type, {
          ok: true,
          from: context,
          ms: Math.round(performance.now() - startedAt),
        });
        sendResponse({ ok: true, data });
      })
      .catch(async (error: unknown) => {
        const language = await getSettings()
          .then((settings) => settings.interfaceLanguage)
          .catch((): SupportedLanguage => "ru");
        const safeError = userFacingError(error, language);
        debugLog(message.type, {
          ok: false,
          from: context,
          ms: Math.round(performance.now() - startedAt),
          error: safeErrorMessage(error),
        });
        sendResponse({ ok: false, error: safeError });
      });
    return true;
  },
);

chrome.runtime.onInstalled.addListener(() => {
  void restrictLocalStorageAccess();
  void chrome.storage.local.remove([
    "dashboardCacheV1",
    "dashboardCacheV2",
    "dashboardCacheV3",
    "dashboardCacheV4",
    "dashboardCacheV5",
    "dashboardCacheV6",
    "dashboardCacheV7",
    "dashboardCacheV8",
    "dashboardCacheV9",
    "realtimeSamples",
    "realtimeSamplesChannelIdV1",
    "youtubeQuotaPausedUntil",
  ]);
  void ensurePlannerReminderAlarm();
  resumeRealtimeCollection();
});
chrome.runtime.onStartup.addListener(() => {
  void restrictLocalStorageAccess();
  void ensurePlannerReminderAlarm();
  resumeRealtimeCollection();
});

/**
 * Re-arms the collector for a connected account only. Scheduling it for a
 * signed-out profile woke the worker every few minutes just to find nothing to
 * collect; SIGN_IN creates the alarm when an account appears.
 */
function resumeRealtimeCollection(): void {
  void hasGoogleConnection()
    .then(async (signedIn) => {
      if (!signedIn) {
        await chrome.alarms.clear(REALTIME_ALARM);
        return;
      }
      await ensureRealtimeAlarm();
      await runRealtimeCollection();
    })
    .catch((error: unknown) =>
      debugLog("realtime resume failed", { error: safeErrorMessage(error) }),
    );
}
chrome.alarms.onAlarm.addListener((alarm) => {
  const logFailure = (error: unknown) =>
    debugLog(`${alarm.name} failed`, { error: safeErrorMessage(error) });
  if (alarm.name === REALTIME_ALARM) {
    void runRealtimeCollection()
      .then((status) => debugLog("realtime collection", { collected: Boolean(status) }))
      .catch(logFailure);
  } else if (alarm.name === PLANNER_REMINDER_ALARM) {
    void checkPlannerReminders().catch(logFailure);
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("channelpilot-planner-")) return;
  void chrome.notifications.clear(notificationId);
  // A publishing reminder is about the planner; it used to land on Overview.
  void openDashboardPage("planner").catch(() => undefined);
});

void restrictLocalStorageAccess();
