import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WORKSPACE_STATE,
  toMediaAnalysisSettings,
  type AnalyticsDay,
  type DashboardData,
  type ExtensionRequest,
  type ExtensionSettings,
  type VideoSummary,
  type WorkspaceState,
} from "@channelpilot/shared";

export function historyFixture(count = 28): AnalyticsDay[] {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10),
    views: index < 14 ? 100 : 200,
    engagedViews: 100,
    estimatedMinutesWatched: index < 14 ? 40 : 80,
    averageViewDuration: 24,
    averageViewPercentage: 40,
    likes: 5,
    comments: 2,
    shares: 1,
    subscribersGained: 3,
    subscribersLost: 1,
  }));
}

function dailyPart(total: number, index: number, days: number): number {
  const rounded = Math.max(0, Math.round(total));
  return Math.floor(rounded / days) + (index >= days - (rounded % days) ? 1 : 0);
}

export function videoHistoryFixture(
  video: VideoSummary,
  days: AnalyticsDay[] = historyFixture(),
): AnalyticsDay[] {
  const publishedDate = video.publishedAt.slice(0, 10);
  const availableDays = days.filter((day) => day.date >= publishedDate).length;
  let availableIndex = 0;
  return days.map((day) => {
    const published = day.date >= publishedDate;
    const index = published ? availableIndex++ : -1;
    const part = (total: number) =>
      published && availableDays > 0 ? dailyPart(total, index, availableDays) : 0;
    const views = part(video.analyticsViews28Days);
    const minutes = part(video.watchMinutes28Days);
    return {
      ...day,
      views,
      engagedViews: 0,
      estimatedMinutesWatched: minutes,
      averageViewDuration: views ? Math.round((minutes * 60) / views) : 0,
      averageViewPercentage: video.averageViewPercentage28Days,
      likes: 0,
      comments: 0,
      shares: 0,
      subscribersGained: part(video.subscribersGained28Days),
      subscribersLost: part(video.subscribersLost28Days),
    };
  });
}

export function videoFixture(
  id = "abcdefghijk",
  contentType: VideoSummary["contentType"] = "video",
): VideoSummary {
  return {
    id,
    contentType,
    title: `Test video ${id}`,
    description: "",
    tags: [],
    thumbnailUrl:
      "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27320%27 height=%27180%27%3E%3Crect width=%27320%27 height=%27180%27 fill=%27%23433668%27/%3E%3C/svg%3E",
    publishedAt: "2026-09-01T12:00:00Z",
    durationSeconds: 120,
    categoryId: "20",
    defaultLanguage: "en",
    captionsAvailable: false,
    views: 12000,
    likes: 500,
    comments: 20,
    observedViewsLastHour: 30,
    observedMinutes: 60,
    observedViewsLast24Hours: 300,
    observedMinutes24Hours: 1440,
    observedViewsLast48Hours: 600,
    observedMinutes48Hours: 2880,
    viewsLast15Minutes: 8,
    observedMinutesLast15: 15,
    viewsPerMinuteLast15: 0.53,
    previous15MinutesViews: 5,
    previousObservedMinutes15: 15,
    previousViewsPerMinute15: 0.33,
    velocityTrendPercent: 60,
    analyticsViews28Days: 4000,
    watchMinutes28Days: 1600,
    averageViewPercentage28Days: 40,
    shares28Days: 5,
    subscribersGained28Days: 60,
    subscribersLost28Days: 8,
    analyticsAvailable28Days: true,
    analyticsDetailAvailable28Days: true,
  };
}
export function dashboardFixture(): DashboardData {
  return {
    channel: {
      id: "test-channel",
      title: "Demo · ChannelPilot",
      avatarUrl: "",
      subscribers: 12000,
      views: 400000,
      videos: 6,
    },
    channelObservedViewsLastHour: 80,
    channelObservedMinutes: 60,
    channelRealtimeSource: "channel_total",
    channelObservedViewsLast24Hours: 1700,
    channelObservedMinutes24Hours: 1440,
    channelRealtimeSource24Hours: "channel_total",
    channelObservedViewsLast48Hours: 3400,
    channelObservedMinutes48Hours: 2880,
    channelRealtimeSource48Hours: "channel_total",
    videos: [
      videoFixture(),
      videoFixture("shorts00001", "shorts"),
      videoFixture("unknown0001", "unknown"),
      videoFixture("video000002"),
      videoFixture("video000003"),
      videoFixture("video000004"),
    ],
    history: historyFixture(),
    realtimeSeries: [],
    trafficSources: [],
    countries: [],
    devices: [],
    subscribedStatus: [],
    sampledAt: new Date().toISOString(),
    analyticsSampledAt: new Date().toISOString(),
    realtimeWarmup: false,
  };
}

export function createChromeFixture() {
  // Typed as the full settings object rather than inferred, so a consumer (the
  // widget preview) can switch language or theme without the literal types
  // narrowing the field to a single value.
  const settings: ExtensionSettings = {
    ...DEFAULT_EXTENSION_SETTINGS,
    interfaceLanguage: "en",
    showHeaderWidget: true,
    showLauncher: true,
  };
  const dashboard = dashboardFixture();
  const listeners = new Set<(message: unknown) => void>();
  const storageListeners = new Set<(...args: unknown[]) => void>();
  let signedIn = true;
  let offline = false;
  let workspace: WorkspaceState = DEFAULT_WORKSPACE_STATE;
  const sessionStore: Record<string, unknown> = {};
  return {
    settings,
    dashboard,
    setOffline(value: boolean) {
      offline = value;
    },
    emitSettings(showHeaderWidget: boolean) {
      settings.showHeaderWidget = showHeaderWidget;
      listeners.forEach((listener) =>
        listener({ type: "SETTINGS_CHANGED", payload: { ...settings } }),
      );
    },
    emitStoredSettings() {
      storageListeners.forEach((listener) =>
        listener({ settings: { newValue: { ...settings } } }, "local"),
      );
    },
    chrome: {
      runtime: {
        id: "test-extension",
        getManifest: () => ({ version: "test" }),
        getURL: (path: string) => path,
        // Extension pages (popup, options) have this; a content script does not
        // — see apps/extension/test/content-chrome-api.test.ts, which is what
        // keeps the widget from calling it.
        openOptionsPage: async () => {},
        onMessage: {
          addListener: (listener: (message: unknown) => void) =>
            listeners.add(listener),
          removeListener: (listener: (message: unknown) => void) =>
            listeners.delete(listener),
        },
        async sendMessage(message: ExtensionRequest) {
          if (
            offline &&
            (message.type === "GET_DASHBOARD" || message.type === "GET_VIDEO_ANALYTICS")
          )
            return { ok: false, error: "Offline test" };
          let data: unknown = null;
          switch (message.type) {
            case "GET_SETTINGS":
              data = { ...settings };
              break;
            case "SAVE_SETTINGS":
            case "SAVE_SETTINGS_PATCH":
            case "SAVE_SETTINGS_TRUSTED_PATCH":
              Object.assign(settings, message.payload);
              data = { ...settings };
              break;
            case "REDEEM_MEDIA_BRIDGE_SESSION":
              data = toMediaAnalysisSettings(settings);
              break;
            case "CREATE_MEDIA_BRIDGE_SESSION":
              data = crypto.randomUUID();
              break;
            case "OPEN_OPTIONS_PAGE":
              // What the widget's "Открыть кабинет" delegates to the service
              // worker, because a content script cannot open it itself.
              data = { opened: true };
              break;
            case "GET_WORKSPACE_STATE":
              data = workspace;
              break;
            case "SAVE_WORKSPACE_STATE":
              // Kept in memory so the planner, ideas and goals can be
              // exercised in the preview instead of silently failing to save.
              workspace = { ...message.payload, updatedAt: new Date().toISOString() };
              data = workspace;
              break;
            case "AUTH_STATUS":
              data = { signedIn, tokenReady: signedIn, reauthRequired: false };
              break;
            case "SIGN_IN":
              signedIn = true;
              data = { signedIn: true };
              break;
            case "SIGN_OUT":
              signedIn = false;
              data = { signedIn: false };
              break;
            case "GET_DASHBOARD":
              data = dashboard;
              break;
            case "GET_REALTIME_STATUS":
              data = {
                lastSuccessAt: dashboard.sampledAt,
                lastAttemptAt: dashboard.sampledAt,
                lastError: "",
              };
              break;
            case "GET_VIDEO_ANALYTICS":
              {
                const video = dashboard.videos.find(
                  (item) => item.id === message.videoId,
                );
                const views = video?.analyticsViews28Days ?? 0;
                data = {
                  videoId: message.videoId,
                  history: video?.analyticsAvailable28Days
                    ? videoHistoryFixture(video, dashboard.history)
                    : [],
                  trafficSources:
                    video?.analyticsAvailable28Days && views > 0
                      ? [
                          {
                            key: "YT_SEARCH",
                            label: "YouTube Search",
                            views,
                            estimatedMinutesWatched: video.watchMinutes28Days,
                            share: 100,
                          },
                        ]
                      : [],
                  warnings: [],
                  sampledAt: dashboard.sampledAt,
                };
              }
              break;
          }
          return { ok: true, data };
        },
      },
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        // Enough of chrome.storage.session for the dashboard's deep links.
        session: {
          get: async (key: string) =>
            key in sessionStore ? { [key]: sessionStore[key] } : {},
          set: async (values: Record<string, unknown>) => {
            Object.assign(sessionStore, values);
            const changes = Object.fromEntries(
              Object.entries(values).map(([key, newValue]) => [key, { newValue }]),
            );
            storageListeners.forEach((listener) => listener(changes, "session"));
          },
          remove: async (key: string) => {
            delete sessionStore[key];
          },
        },
        onChanged: {
          addListener: (listener: (...args: unknown[]) => void) =>
            storageListeners.add(listener),
          removeListener: (listener: (...args: unknown[]) => void) =>
            storageListeners.delete(listener),
        },
      },
      identity: { getRedirectURL: () => "https://test.chromiumapp.org/" },
    },
  };
}
