import React, { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  bucketAverage,
  DEFAULT_EXTENSION_SETTINGS,
  diffExtensionSettings,
  formatMetric,
  formatSignedMetric,
  GEMINI_MODEL_OPTIONS,
  GROQ_MODEL_OPTIONS,
  TWELVELABS_MODEL_OPTIONS,
  hourlyPace,
  isGoogleClientId,
  normalizeExtensionSettings,
  realtimeWindowCoverage,
  smoothTrendPath,
  type AiProvider,
  type DashboardData,
  type ExtensionSettings,
  type GoogleAuthStatus,
  type GoogleSignInResult,
  type SupportedLanguage,
} from "@channelpilot/shared";
import { openDashboardPage } from "../lib/dashboard-link";
import { rpc } from "../lib/rpc";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useInterfacePreferences } from "../hooks/useInterfacePreferences";
import "./popup.css";

function compact(value: number): string {
  return formatMetric(value);
}

function tr(language: SupportedLanguage, ru: string, en: string): string {
  return language === "ru" ? ru : en;
}

/**
 * The 28-day trend, drawn like the on-page widget's chart: smoothed, on a zero
 * baseline, with the latest day marked. The popup used to draw its own jagged
 * polyline with a different scale.
 */
function Sparkline({
  values,
  language,
}: {
  values: number[];
  language: SupportedLanguage;
}) {
  const gradientId = `popup-trend-${useId()}`;
  if (values.length < 2)
    return (
      <div className="empty-chart">
        {tr(language, "Недостаточно данных", "Not enough data")}
      </div>
    );
  const { line, area, last } = smoothTrendPath(bucketAverage(values, 48), 330, 68);
  return (
    <svg
      className="sparkline"
      viewBox="0 0 330 68"
      preserveAspectRatio="none"
      aria-label={tr(language, "Просмотры за 28 дней", "Views over the last 28 days")}
      role="img"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop className="spark-stop" offset="0%" stopOpacity=".3" />
          <stop className="spark-stop" offset="100%" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        className="spark-line"
        strokeWidth="2.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <line
        className="spark-now"
        x1={last.x}
        x2={last.x}
        y1={last.y}
        y2={68}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings>(
    DEFAULT_EXTENSION_SETTINGS,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  // Signing out deletes the collected realtime history (up to 50 hours of
  // samples) and it was one click away from "Open dashboard".
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const loadRequestIdRef = useRef(0);
  const persistedSettingsRef = useRef<ExtensionSettings>(DEFAULT_EXTENSION_SETTINGS);
  const persistedInterfaceLanguageRef = useRef<SupportedLanguage>(
    DEFAULT_EXTENSION_SETTINGS.interfaceLanguage,
  );
  const loadRef = useRef(load);
  loadRef.current = load;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const previousSignedInRef = useRef<boolean | null>(null);
  const settingsDirty =
    Object.keys(diffExtensionSettings(settings, persistedSettingsRef.current)).length >
    0;
  useInterfacePreferences(settings);

  useEffect(() => {
    if (signedIn === null) return;
    if (
      previousSignedInRef.current !== null &&
      previousSignedInRef.current !== signedIn
    ) {
      let element: HTMLElement | null = mainRef.current;
      while (element) {
        element.scrollTop = 0;
        element = element.parentElement;
      }
      document.scrollingElement?.scrollTo(0, 0);
    }
    previousSignedInRef.current = signedIn;
  }, [signedIn]);

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

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
      setSettings((current) =>
        normalizeExtensionSettings({
          ...next,
          ...diffExtensionSettings(current, previous),
        }),
      );
      if (
        (languageChanged &&
          next.interfaceLanguage !== settingsRef.current.interfaceLanguage) ||
        (connectionChanged &&
          next.googleClientId !== settingsRef.current.googleClientId)
      )
        void loadRef.current();
    };
    chrome.storage.onChanged.addListener(syncSettings);
    return () => chrome.storage.onChanged.removeListener(syncSettings);
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.interfaceLanguage;
  }, [settings.interfaceLanguage]);

  async function load(force = false) {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const loadedSettings = await rpc<ExtensionSettings>({
        type: "GET_SETTINGS",
      });
      if (requestId !== loadRequestIdRef.current) return;
      const previousSettings = persistedSettingsRef.current;
      persistedSettingsRef.current = loadedSettings;
      persistedInterfaceLanguageRef.current = loadedSettings.interfaceLanguage;
      setSettings((current) =>
        normalizeExtensionSettings({
          ...loadedSettings,
          ...diffExtensionSettings(current, previousSettings),
        }),
      );
      const status = await rpc<GoogleAuthStatus>({ type: "AUTH_STATUS" });
      if (requestId !== loadRequestIdRef.current) return;
      setSignedIn(status.signedIn);
      setReauthRequired(status.reauthRequired);
      if (status.signedIn) {
        try {
          const dashboard = await rpc<DashboardData>({
            type: "GET_DASHBOARD",
            force,
          });
          if (requestId !== loadRequestIdRef.current) return;
          setData(dashboard);
        } catch (dashboardError) {
          if (requestId !== loadRequestIdRef.current) return;
          if (!status.reauthRequired) throw dashboardError;
          setData(null);
        }
      } else {
        setData(null);
      }
    } catch (caught) {
      if (requestId === loadRequestIdRef.current) {
        setData((current) => (current ? { ...current, stale: true } : null));
        setError(
          caught instanceof Error
            ? caught.message
            : tr(language, "Не удалось загрузить данные", "Could not load data"),
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
    };
  }, []);

  async function signIn() {
    if (loading || savingPreferences || visibilitySaving) return;
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      if (!isGoogleClientId(settings.googleClientId)) {
        throw new Error(
          tr(
            language,
            "Введите OAuth Client ID типа «Веб-приложение» — не Gemini API key.",
            "Enter a Web application OAuth Client ID — not a Gemini API key.",
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
                  "Google подключён, но аналитика пока недоступна.",
                  "Google is connected, but analytics is currently unavailable.",
                ),
          );
        }
      }
    } catch (caught) {
      if (requestId === loadRequestIdRef.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : tr(language, "Ошибка входа", "Sign-in failed"),
        );
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }

  async function savePreferences() {
    if (savingPreferences || loading || visibilitySaving) return;
    const draft = settings;
    setSavingPreferences(true);
    setPreferencesSaved(false);
    setError("");
    try {
      const saved = await rpc<ExtensionSettings>({
        type: "SAVE_SETTINGS_TRUSTED_PATCH",
        payload: diffExtensionSettings(draft, persistedSettingsRef.current),
      });
      const languageChanged =
        saved.interfaceLanguage !== persistedInterfaceLanguageRef.current;
      persistedSettingsRef.current = saved;
      persistedInterfaceLanguageRef.current = saved.interfaceLanguage;
      setSettings((current) => (current === draft ? saved : current));
      setPreferencesSaved(true);
      if (languageChanged) await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tr(language, "Настройки не сохранены", "Settings were not saved"),
      );
    } finally {
      setSavingPreferences(false);
    }
  }

  async function signOut() {
    if (loading || visibilitySaving) return;
    setConfirmingSignOut(false);
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      await rpc({ type: "SIGN_OUT" });
      if (requestId !== loadRequestIdRef.current) return;
      setSignedIn(false);
      setReauthRequired(false);
      setData(null);
    } catch (caught) {
      if (requestId === loadRequestIdRef.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : tr(language, "Ошибка выхода", "Sign-out failed"),
        );
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }

  const redirectUri = chrome.identity.getRedirectURL("google");
  async function copyRedirectUri() {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(
        tr(
          settings.interfaceLanguage,
          "Не удалось скопировать. Выделите адрес вручную.",
          "Copy failed. Select the address manually.",
        ),
      );
    }
  }

  async function toggleVisibility(key: "showHeaderWidget" | "showLauncher") {
    // Serialize toggles: two quick clicks (e.g. both switches) used to race,
    // since both handlers closed over the same pre-click `settings` snapshot
    // and the second setSettings() call could silently discard the first.
    if (visibilitySaving || loading || savingPreferences) return;
    setVisibilitySaving(true);
    const nextValue = !settings[key];
    setSettings((previous) => ({ ...previous, [key]: nextValue }));
    try {
      const saved = await rpc<ExtensionSettings>({
        type: "SAVE_SETTINGS_PATCH",
        payload:
          key === "showHeaderWidget"
            ? { showHeaderWidget: nextValue }
            : { showLauncher: nextValue },
      });
      persistedSettingsRef.current = saved;
      setSettings((previous) => ({ ...previous, [key]: saved[key] }));
    } catch (caught) {
      setSettings((previous) => ({ ...previous, [key]: !nextValue }));
      setError(
        caught instanceof Error
          ? caught.message
          : tr(
              language,
              "Не удалось изменить видимость",
              "Could not change visibility",
            ),
      );
    } finally {
      setVisibilitySaving(false);
    }
  }

  const total28 = data?.history.reduce((sum, day) => sum + day.views, 0) ?? 0;
  const live60 = data?.channelObservedViewsLastHour ?? 0;
  const live24 = data?.channelObservedViewsLast24Hours ?? 0;
  const subscribersGained28 =
    data?.history.reduce((sum, day) => sum + day.subscribersGained, 0) ?? 0;
  const subscribersLost28 =
    data?.history.reduce((sum, day) => sum + day.subscribersLost, 0) ?? 0;
  const subscribersNet28 = subscribersGained28 - subscribersLost28;
  // "Growing now" lists only videos that actually gained views in the window,
  // as the on-page widget does; it used to fill up with "+0" rows.
  const leaders = [...(data?.videos ?? [])]
    .filter((video) => (video.observedViewsLastHour ?? 0) > 0)
    .sort(
      (left, right) =>
        hourlyPace(right) - hourlyPace(left) ||
        (right.observedViewsLastHour ?? 0) - (left.observedViewsLastHour ?? 0),
    );
  const language = settings.interfaceLanguage;
  const hourCoverage = realtimeWindowCoverage(data?.channelObservedMinutes ?? 0, 60);
  const dayCoverage = realtimeWindowCoverage(
    data?.channelObservedMinutes24Hours ?? 0,
    24 * 60,
  );
  const hourWindowLabel = hourCoverage.complete
    ? tr(language, "60 мин", "60 min")
    : `${hourCoverage.observedMinutes}/60 ${tr(language, "мин", "min")}`;
  const observedDayHours = dayCoverage.observedMinutes / 60;
  const observedDayHoursLabel =
    observedDayHours >= 10 || Number.isInteger(observedDayHours)
      ? observedDayHours.toFixed(0)
      : observedDayHours.toFixed(1);
  const dayWindowLabel = dayCoverage.complete
    ? tr(language, "24 часа", "24 hours")
    : `${observedDayHoursLabel}/24 ${tr(language, "ч", "h")}`;
  const coverageNote = (observedMinutes: number, targetMinutes: number) =>
    observedMinutes >= targetMinutes
      ? tr(language, "полное окно", "full window")
      : tr(
          language,
          `накоплено ${observedMinutes} из ${targetMinutes} мин`,
          `${observedMinutes} of ${targetMinutes} min observed`,
        );

  return (
    <main ref={mainRef} aria-busy={loading || savingPreferences || undefined}>
      <header>
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M20.7 3.3 3.8 10.4c-1.05.44-1 1.96.08 2.28l6.2 1.86 1.86 6.2c.32 1.08 1.84 1.13 2.28.08L20.7 3.3Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <div>
          <h1>ChannelPilot</h1>
          <p>AI growth copilot</p>
        </div>
        <button
          className={`icon-button${loading ? " spinning" : ""}`}
          onClick={() => void load(true)}
          aria-label={tr(language, "Обновить", "Refresh")}
          disabled={loading || savingPreferences || visibilitySaving}
        >
          ↻
        </button>
      </header>
      <section className="visibility-quick">
        <button
          className={settings.showHeaderWidget ? "active" : ""}
          onClick={() => void toggleVisibility("showHeaderWidget")}
          aria-pressed={settings.showHeaderWidget}
          disabled={visibilitySaving || loading || savingPreferences}
        >
          <i aria-hidden="true">{settings.showHeaderWidget ? "●" : "○"}</i>
          <span>
            <b>{tr(language, "Верхний виджет", "Top widget")}</b>
            <small>
              {settings.showHeaderWidget
                ? tr(language, "показывается", "visible")
                : tr(language, "скрыт", "hidden")}
            </small>
          </span>
        </button>
        <button
          className={settings.showLauncher ? "active" : ""}
          onClick={() => void toggleVisibility("showLauncher")}
          aria-pressed={settings.showLauncher}
          disabled={visibilitySaving || loading || savingPreferences}
        >
          <i aria-hidden="true">{settings.showLauncher ? "●" : "○"}</i>
          <span>
            <b>ChannelPilot AI</b>
            <small>
              {settings.showLauncher
                ? tr(language, "кнопка видна", "button visible")
                : tr(language, "кнопка скрыта", "button hidden")}
            </small>
          </span>
        </button>
      </section>

      {reauthRequired && !data ? (
        <section className="signin reconnect">
          <div className="glow" />
          <span className="eyebrow">
            {tr(language, "ПОДКЛЮЧЕНИЕ СОХРАНЕНО", "CONNECTION PRESERVED")}
          </span>
          <h2>
            {tr(language, "Обновите Google-сессию", "Refresh your Google session")}
          </h2>
          <p>
            {tr(
              language,
              "Токен доступа истёк, но канал, ключи и настройки не потеряны. Подтвердите тот же аккаунт, чтобы продолжить сбор аналитики.",
              "The access token expired, but your channel, keys and settings are intact. Confirm the same account to resume analytics.",
            )}
          </p>
          <button
            className="primary"
            onClick={() => void signIn()}
            disabled={loading || visibilitySaving}
          >
            <span className="google-dot">G</span>
            {loading
              ? tr(language, "Обновляем…", "Refreshing…")
              : tr(language, "Обновить Google-сессию", "Refresh Google session")}
          </button>
          <button
            className="setup-link"
            onClick={() => void openDashboardPage("settings")}
          >
            {tr(language, "Открыть подключения", "Open connections")}
          </button>
        </section>
      ) : signedIn === false ? (
        <section className="signin">
          <div className="glow" />
          <span className="eyebrow">
            {tr(language, "РАБОЧЕЕ ПРОСТРАНСТВО YOUTUBE", "YOUTUBE WORKSPACE")}
          </span>
          <h2>
            {tr(
              language,
              "Решения по видео — прямо в Studio",
              "Video decisions — directly in Studio",
            )}
          </h2>
          <p>
            {tr(
              language,
              "Укажите Google OAuth Client ID и ключи AI. Они хранятся локально и отправляются только выбранному AI-провайдеру.",
              "Enter your Google OAuth Client ID and AI keys. They are stored locally and sent only to the selected AI provider.",
            )}
          </p>
          <div className="quick-settings">
            <div className="key-grid">
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
                {tr(language, "Язык генерации", "Generation language")}
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
            <label>
              Google OAuth Client ID
              <input
                value={settings.googleClientId}
                onChange={(event) =>
                  setSettings({ ...settings, googleClientId: event.target.value })
                }
                placeholder="…apps.googleusercontent.com"
              />
            </label>
            <div className="key-grid">
              <label>
                Gemini API key
                <input
                  type="password"
                  value={settings.geminiApiKey}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      geminiApiKey: event.target.value.trim(),
                    })
                  }
                  placeholder="AIza…"
                />
              </label>
              <label>
                Groq API key
                <input
                  type="password"
                  value={settings.groqApiKey}
                  onChange={(event) =>
                    setSettings({ ...settings, groqApiKey: event.target.value.trim() })
                  }
                  placeholder="gsk_…"
                />
              </label>
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
              />
            </label>
            <details className="popup-advanced">
              <summary>
                {tr(language, "Режим и модели AI", "AI mode and models")}
              </summary>
              <div className="popup-advanced-fields">
                <label>
                  {tr(language, "Режим AI", "AI mode")}
                  <select
                    value={settings.preferredProvider}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        preferredProvider: event.target.value as AiProvider,
                      })
                    }
                  >
                    <option value="auto">
                      {tr(
                        language,
                        "Авто — Gemini → TwelveLabs → Groq",
                        "Auto — Gemini → TwelveLabs → Groq",
                      )}
                    </option>
                    <option value="gemini">
                      {tr(language, "Только Gemini", "Gemini only")}
                    </option>
                    <option value="twelvelabs">
                      {tr(language, "Только TwelveLabs", "TwelveLabs only")}
                    </option>
                    <option value="groq">
                      {tr(language, "Только Groq", "Groq only")}
                    </option>
                    <option value="both">
                      {tr(
                        language,
                        "Gemini + Groq одновременно",
                        "Gemini + Groq together",
                      )}
                    </option>
                  </select>
                </label>
                <div className="key-grid">
                  <label>
                    {tr(language, "Модель Gemini", "Gemini model")}
                    <select
                      value={settings.geminiModel}
                      onChange={(event) =>
                        setSettings({ ...settings, geminiModel: event.target.value })
                      }
                    >
                      {!GEMINI_MODEL_OPTIONS.some(
                        (model) => model.id === settings.geminiModel,
                      ) && (
                        <option value={settings.geminiModel}>
                          {settings.geminiModel}
                        </option>
                      )}
                      {GEMINI_MODEL_OPTIONS.map((model) => (
                        <option value={model.id} key={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {tr(language, "Модель Groq", "Groq model")}
                    <select
                      value={settings.groqModel}
                      onChange={(event) =>
                        setSettings({ ...settings, groqModel: event.target.value })
                      }
                    >
                      {!GROQ_MODEL_OPTIONS.some(
                        (model) => model.id === settings.groqModel,
                      ) && (
                        <option value={settings.groqModel}>{settings.groqModel}</option>
                      )}
                      {GROQ_MODEL_OPTIONS.map((model) => (
                        <option value={model.id} key={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  {tr(language, "Модель TwelveLabs", "TwelveLabs model")}
                  <select
                    value={settings.twelveLabsModel}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        twelveLabsModel: event.target.value,
                      })
                    }
                  >
                    {TWELVELABS_MODEL_OPTIONS.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
          </div>
          <button
            className="primary"
            onClick={() => void signIn()}
            disabled={loading || savingPreferences || visibilitySaving}
          >
            <span className="google-dot">G</span>
            {loading
              ? tr(language, "Подключаем…", "Connecting…")
              : tr(language, "Войти через Google", "Sign in with Google")}
          </button>
          <button
            className="save-setup"
            onClick={() => void savePreferences()}
            disabled={
              loading || savingPreferences || visibilitySaving || !settingsDirty
            }
          >
            {savingPreferences
              ? tr(language, "Сохраняем…", "Saving…")
              : tr(language, "Сохранить без входа", "Save without Google")}
          </button>
          {preferencesSaved && !settingsDirty && (
            <span className="setup-saved" role="status">
              {tr(language, "Настройки сохранены", "Settings saved")}
            </span>
          )}
          <div className="redirect-uri">
            <span className="redirect-uri-label">
              {tr(
                language,
                "Redirect URI для Google Cloud",
                "Redirect URI for Google Cloud",
              )}
            </span>
            <div className="redirect-uri-row">
              <code title={redirectUri}>{redirectUri}</code>
              <button
                type="button"
                className={`redirect-copy${copied ? " copied" : ""}`}
                onClick={() => void copyRedirectUri()}
                aria-label={tr(
                  language,
                  "Скопировать Redirect URI",
                  "Copy Redirect URI",
                )}
              >
                {copied
                  ? tr(language, "Готово", "Copied")
                  : tr(language, "Копировать", "Copy")}
              </button>
            </div>
          </div>
          <button
            className="setup-link"
            onClick={() => void openDashboardPage("settings")}
          >
            {tr(
              language,
              "Подробная настройка и проверка ключей",
              "Advanced settings and key test",
            )}
          </button>
        </section>
      ) : data ? (
        <>
          {reauthRequired && (
            <section className="session-banner">
              <div>
                <strong>
                  {tr(
                    language,
                    "Показан сохранённый снимок",
                    "Showing a saved snapshot",
                  )}
                </strong>
                <span>
                  {tr(
                    language,
                    "Обновите Google-сессию для новых данных",
                    "Refresh Google to resume live data",
                  )}
                </span>
              </div>
              <button
                onClick={() => void signIn()}
                disabled={loading || visibilitySaving}
              >
                {tr(language, "Обновить", "Refresh")}
              </button>
            </section>
          )}
          {Boolean(data.analyticsWarnings?.length) && (
            <section className="session-banner">
              <div>
                <strong>
                  {tr(
                    language,
                    "Часть Analytics недоступна",
                    "Some Analytics data is unavailable",
                  )}
                </strong>
                <span>{data.analyticsWarnings![0]}</span>
              </div>
              <button onClick={() => void openDashboardPage()}>
                {tr(language, "Проверить", "Check")}
              </button>
            </section>
          )}
          <section className="channel-row">
            {data.channel.avatarUrl ? (
              <img src={data.channel.avatarUrl} alt="" />
            ) : (
              <div className="avatar-fallback">
                {(data.channel.title || "?").slice(0, 1)}
              </div>
            )}
            <div className="channel-copy">
              <strong>{data.channel.title}</strong>
              <span>
                {compact(data.channel.subscribers)}{" "}
                {tr(language, "подписчиков", "subscribers")}
              </span>
            </div>
            <span
              className={`live-pill ${reauthRequired || data.stale || data.realtimeWarmup ? "paused" : ""}`}
            >
              <i />{" "}
              {reauthRequired || data.stale
                ? tr(language, "СНИМОК", "SNAPSHOT")
                : data.realtimeWarmup
                  ? tr(language, "СБОР", "WARMUP")
                  : "LIVE"}
            </span>
          </section>

          {/* "Просмотры · 60 мин" in a third of a 430px popup broke as
              "Просмотры · 60 / мин". The shared word is a caption now and each
              card names only its window, which fits on one line. */}
          <section className="metric-grid">
            <span className="metric-grid-caption">
              {tr(language, "Просмотры канала", "Channel views")}
            </span>
            <article>
              <span>{hourWindowLabel}</span>
              <b>{compact(live60)}</b>
              <em>
                {coverageNote(hourCoverage.observedMinutes, hourCoverage.targetMinutes)}
              </em>
            </article>
            <article>
              <span>{dayWindowLabel}</span>
              <b>{compact(live24)}</b>
              <em>
                {coverageNote(dayCoverage.observedMinutes, dayCoverage.targetMinutes)}
              </em>
            </article>
            <article>
              <span>{tr(language, "Всё время", "All time")}</span>
              <b>{compact(data.channel.views)}</b>
              <em>
                {compact(total28)} {tr(language, "за 28 дней", "in 28 days")}
              </em>
            </article>
          </section>
          {/* One row instead of three cards: in a third of the popup the labels
              "Подписались · 28д" / "Чистый прирост" were cut to "Подписалис…". */}
          <section
            className="subscriber-flow"
            aria-label={tr(language, "Подписчики за 28 дней", "Subscribers, 28 days")}
          >
            <span className="subscriber-flow-title">
              {tr(language, "Подписчики · 28 дней", "Subscribers · 28 days")}
            </span>
            <span className="subscriber-flow-stat">
              <b className="up">+{compact(subscribersGained28)}</b>
              <small>{tr(language, "пришли", "gained")}</small>
            </span>
            <span className="subscriber-flow-stat">
              <b className="down">−{compact(subscribersLost28)}</b>
              <small>{tr(language, "ушли", "lost")}</small>
            </span>
            <span className="subscriber-flow-stat net">
              <b className={subscribersNet28 >= 0 ? "up" : "down"}>
                {formatSignedMetric(subscribersNet28)}
              </b>
              <small>{tr(language, "итог", "net")}</small>
            </span>
          </section>

          <section className="chart-card">
            <div className="section-title">
              <div>
                <span>{tr(language, "Динамика просмотров", "View trend")}</span>
                <strong>{tr(language, "Последние 28 дней", "Last 28 days")}</strong>
              </div>
              <span className={data.stale ? "status-warning" : "status-good"}>
                ●{" "}
                {data.stale
                  ? tr(language, "сохранённый снимок", "saved snapshot")
                  : tr(language, "синхронизировано", "synced")}
              </span>
            </div>
            <Sparkline
              values={data.history.map((day) => day.views)}
              language={language}
            />
          </section>

          <section className="videos">
            <div className="section-title">
              <div>
                <strong>{tr(language, "Набирают сейчас", "Growing now")}</strong>
                <span>
                  {tr(
                    language,
                    `Рейтинг за ${hourWindowLabel}`,
                    `Ranking over ${hourWindowLabel}`,
                  )}
                </span>
              </div>
              <span>{leaders.length}</span>
            </div>
            {leaders.length === 0 && (
              <div className="videos-empty">
                {tr(
                  language,
                  "За это окно прирост просмотров не зафиксирован. Ролики появятся здесь, как только счётчики начнут расти.",
                  "No view growth in this window yet. Videos appear here as soon as their counters move.",
                )}
              </div>
            )}
            {leaders.slice(0, 5).map((video, index) => {
              const trendReady =
                video.observedMinutesLast15 >= 5 &&
                video.previousObservedMinutes15 >= 5;
              return (
                <a
                  className="video-row"
                  href={`https://studio.youtube.com/video/${video.id}/analytics/tab-overview`}
                  target="_blank"
                  rel="noreferrer"
                  key={video.id}
                >
                  <i className="video-rank">{index + 1}</i>
                  <img src={video.thumbnailUrl} alt="" />
                  <div>
                    <strong>{video.title}</strong>
                    <span>
                      {compact(video.views)} {tr(language, "всего", "total")} · +
                      {compact(video.viewsLast15Minutes ?? 0)}{" "}
                      {tr(
                        language,
                        `за ${video.observedMinutesLast15} мин`,
                        `in ${video.observedMinutesLast15} min`,
                      )}{" "}
                      ·{" "}
                      {video.analyticsAvailable28Days
                        ? `+${compact(video.subscribersGained28Days)}/−${compact(video.subscribersLost28Days)} ${tr(language, "подп.", "subs")}`
                        : tr(language, "подписки н/д", "subs n/a")}
                    </span>
                  </div>
                  <b>
                    +{compact(video.observedViewsLastHour)}
                    <small
                      className={
                        trendReady
                          ? (video.velocityTrendPercent ?? 0) >= 0
                            ? "up"
                            : "down"
                          : ""
                      }
                    >
                      {trendReady
                        ? `${(video.velocityTrendPercent ?? 0) >= 0 ? "↑" : "↓"} ${Math.abs(video.velocityTrendPercent ?? 0)}%`
                        : `${video.observedMinutesLast15}/15m`}
                    </small>
                  </b>
                </a>
              );
            })}
          </section>
        </>
      ) : loading ? (
        // The first dashboard read can take a few seconds. Showing the "waiting
        // for YouTube data — check your APIs" card during it made every normal
        // popup open look like a setup problem.
        <section className="popup-skeleton" aria-hidden="true">
          <i className="skeleton-row" />
          <div className="skeleton-grid">
            <i />
            <i />
            <i />
          </div>
          <i className="skeleton-row thin" />
          <i className="skeleton-block" />
        </section>
      ) : signedIn ? (
        <section className="signin">
          <span className="eyebrow">
            {tr(language, "GOOGLE ПОДКЛЮЧЁН", "GOOGLE CONNECTED")}
          </span>
          <h2>{tr(language, "Ожидаем данные YouTube", "Waiting for YouTube data")}</h2>
          <p>
            {tr(
              language,
              "Авторизация завершена. Откройте кабинет, чтобы проверить включение YouTube Data API v3 и YouTube Analytics API.",
              "Authorization is complete. Open the dashboard to check YouTube Data API v3 and YouTube Analytics API setup.",
            )}
          </p>
          <button
            className="primary"
            onClick={() => void load(true)}
            disabled={loading || visibilitySaving}
          >
            {tr(language, "Повторить синхронизацию", "Retry sync")}
          </button>
        </section>
      ) : null}

      {loading && signedIn !== false && (
        <div className="loading-line" aria-hidden="true" />
      )}
      <span className="sr-only" role="status">
        {loading ? tr(language, "Загрузка…", "Loading…") : ""}
      </span>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <footer className={signedIn && data ? "popup-footer sticky" : "popup-footer"}>
        {confirmingSignOut ? (
          <div
            className="signout-confirm"
            role="alertdialog"
            aria-labelledby="signout-confirm-text"
            onKeyDown={(event) => {
              if (event.key === "Escape") setConfirmingSignOut(false);
            }}
          >
            <span id="signout-confirm-text">
              {tr(
                language,
                "Выйти из Google? Накопленная статистика просмотров будет удалена.",
                "Sign out of Google? Collected view statistics will be deleted.",
              )}
            </span>
            <button autoFocus onClick={() => setConfirmingSignOut(false)}>
              {tr(language, "Отмена", "Cancel")}
            </button>
            <button
              className="danger"
              onClick={() => void signOut()}
              disabled={loading || visibilitySaving}
            >
              {tr(language, "Выйти", "Sign out")}
            </button>
          </div>
        ) : (
          <>
            <button className="dashboard-link" onClick={() => void openDashboardPage()}>
              {tr(language, "Открыть кабинет", "Open dashboard")}
            </button>
            {signedIn && (
              <button
                onClick={() => setConfirmingSignOut(true)}
                disabled={loading || visibilitySaving}
              >
                {tr(language, "Выйти", "Sign out")}
              </button>
            )}
            <span>
              {tr(language, "Данные обновлены", "Data updated")}{" "}
              {data
                ? new Date(data.sampledAt).toLocaleTimeString(language, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </span>
          </>
        )}
      </footer>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <ErrorBoundary compact>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
