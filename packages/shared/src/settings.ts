import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_TWELVELABS_MODEL,
  normalizeGeminiModel,
  normalizeGroqModel,
  normalizeTwelveLabsModel,
} from "./models.js";
import type {
  AccentColor,
  AiAnalysisSettings,
  AiProvider,
  AnimationMode,
  ContentSettingsPatch,
  ExtensionSettings,
  InterfaceDensity,
  PanelLayoutSettings,
  PublicExtensionSettings,
  SupportedLanguage,
  ThemeMode,
} from "./types.js";
import {
  DEFAULT_DOCK_METRICS,
  DEFAULT_WIDGET_SECTIONS,
  normalizeDockMetrics,
  normalizeWidgetSections,
} from "./widget.js";

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  googleClientId: "",
  youtubeApiKey: "",
  geminiApiKey: "",
  groqApiKey: "",
  twelveLabsApiKey: "",
  geminiModel: DEFAULT_GEMINI_MODEL,
  groqModel: DEFAULT_GROQ_MODEL,
  twelveLabsModel: DEFAULT_TWELVELABS_MODEL,
  preferredProvider: "auto",
  interfaceLanguage: "ru",
  generationLanguage: "ru",
  showHeaderWidget: true,
  showLauncher: true,
  theme: "auto",
  accentColor: "violet",
  panelTransparency: 88,
  density: "comfortable",
  animationMode: "system",
  panelLayout: {
    width: 440,
    height: 760,
    x: null,
    y: null,
  },
  widgetSections: [...DEFAULT_WIDGET_SECTIONS],
  widgetDockMetrics: [...DEFAULT_DOCK_METRICS],
  analyticsRefreshSeconds: 60,
  notificationsEnabled: true,
  // Sending the video file itself to a third-party model is opt-in. README,
  // USER_FLOWS and the audit notes all state this is off by default; keep the
  // code as the single source of truth for that privacy claim.
  allowAiMediaUploads: false,
  debugLogging: false,
};

/**
 * Bounds of the panel glass opacity. Exported so the settings slider and the
 * normalizer cannot disagree: the slider used to offer 55–100 while values were
 * clamped to 68–98, so a saved 60% silently came back as 68%.
 */
export const PANEL_TRANSPARENCY_RANGE = { min: 68, max: 98 } as const;

export function diffExtensionSettings(
  draft: ExtensionSettings,
  baseline: ExtensionSettings,
): Partial<ExtensionSettings> {
  return Object.fromEntries(
    (Object.keys(DEFAULT_EXTENSION_SETTINGS) as (keyof ExtensionSettings)[])
      .filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(baseline[key]))
      .map((key) => [key, draft[key]]),
  );
}

const PROVIDERS = new Set<AiProvider>(["auto", "gemini", "groq", "twelvelabs", "both"]);
const LANGUAGES = new Set<SupportedLanguage>(["ru", "en"]);
const THEMES = new Set<ThemeMode>(["auto", "dark", "light"]);
const ACCENTS = new Set<AccentColor>(["violet", "cyan", "emerald", "coral"]);
const DENSITIES = new Set<InterfaceDensity>(["comfortable", "compact"]);
const ANIMATION_MODES = new Set<AnimationMode>(["system", "full", "reduced"]);

function stringValue(value: unknown, maximumLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.round(number)))
    : fallback;
}

function nullableCoordinate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number)
    ? Math.max(-10_000, Math.min(10_000, Math.round(number)))
    : null;
}

function panelLayoutValue(value: unknown): PanelLayoutSettings {
  const source =
    value && typeof value === "object"
      ? (value as Partial<Record<keyof PanelLayoutSettings, unknown>>)
      : {};
  return {
    width: numberValue(
      source.width,
      DEFAULT_EXTENSION_SETTINGS.panelLayout.width,
      340,
      760,
    ),
    height: numberValue(
      source.height,
      DEFAULT_EXTENSION_SETTINGS.panelLayout.height,
      420,
      1_400,
    ),
    x: nullableCoordinate(source.x),
    y: nullableCoordinate(source.y),
  };
}

/**
 * Strips every secret out of the settings object and replaces it with a
 * boolean "is this provider configured" flag.
 *
 * A content script runs inside the youtube.com renderer process. Its normal
 * UI and text operations never need a provider key. The opted-in Studio media
 * path has a separate projection below. Keeping these boundaries in shared
 * code makes secret handling explicit across extension surfaces.
 */
export function toPublicSettings(settings: ExtensionSettings): PublicExtensionSettings {
  return {
    preferredProvider: settings.preferredProvider,
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
    geminiReady: settings.geminiApiKey.length > 0,
    groqReady: settings.groqApiKey.length > 0,
    twelveLabsReady: settings.twelveLabsApiKey.length > 0,
    googleClientIdReady: settings.googleClientId.length > 0,
  };
}

/** Limits the opted-in Studio media path to the keys its selected mode can use. */
export function toMediaAnalysisSettings(
  settings: ExtensionSettings,
): AiAnalysisSettings {
  const mode = settings.preferredProvider;
  return {
    interfaceLanguage: settings.interfaceLanguage,
    preferredProvider: mode,
    geminiModel: settings.geminiModel,
    groqModel: settings.groqModel,
    twelveLabsModel: settings.twelveLabsModel,
    geminiApiKey:
      mode === "auto" || mode === "gemini" || mode === "both"
        ? settings.geminiApiKey
        : "",
    groqApiKey:
      mode === "auto" || mode === "groq" || mode === "both" ? settings.groqApiKey : "",
    twelveLabsApiKey:
      mode === "auto" || mode === "twelvelabs" ? settings.twelveLabsApiKey : "",
  };
}

/**
 * Fields a content script may change. Everything outside this list — provider
 * keys, the OAuth client id, debug logging — is reachable only from an
 * extension page the user opened themselves.
 */
export const CONTENT_SETTABLE_SETTING_KEYS = [
  "generationLanguage",
  "interfaceLanguage",
  "showHeaderWidget",
  "showLauncher",
  "panelLayout",
  "preferredProvider",
  // The widget is edited in place, on the page, so the content script is the
  // one writing its composition back.
  "widgetSections",
  "widgetDockMetrics",
] as const satisfies readonly (keyof ExtensionSettings)[];

/** Drops any key outside {@link CONTENT_SETTABLE_SETTING_KEYS}. */
export function sanitizeContentSettingsPatch(input: unknown): ContentSettingsPatch {
  const source =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const patch: Record<string, unknown> = {};
  for (const key of CONTENT_SETTABLE_SETTING_KEYS) {
    if (source[key] !== undefined) patch[key] = source[key];
  }
  // Run the patch through the full normalizer so a malicious tab cannot smuggle
  // an out-of-range panel size or an unknown provider past the whitelist.
  const normalized = normalizeExtensionSettings({
    ...DEFAULT_EXTENSION_SETTINGS,
    ...patch,
  });
  const result: ContentSettingsPatch = {};
  for (const key of CONTENT_SETTABLE_SETTING_KEYS) {
    if (patch[key] === undefined) continue;
    // Each branch is written out so the assignment stays type-checked per field
    // instead of being widened away by an index signature.
    switch (key) {
      case "generationLanguage":
        result.generationLanguage = normalized.generationLanguage;
        break;
      case "interfaceLanguage":
        result.interfaceLanguage = normalized.interfaceLanguage;
        break;
      case "showHeaderWidget":
        result.showHeaderWidget = normalized.showHeaderWidget;
        break;
      case "showLauncher":
        result.showLauncher = normalized.showLauncher;
        break;
      case "panelLayout":
        result.panelLayout = normalized.panelLayout;
        break;
      case "preferredProvider":
        result.preferredProvider = normalized.preferredProvider;
        break;
      case "widgetSections":
        result.widgetSections = normalized.widgetSections;
        break;
      case "widgetDockMetrics":
        result.widgetDockMetrics = normalized.widgetDockMetrics;
        break;
    }
  }
  return result;
}

export function normalizeGoogleClientId(value: unknown): string {
  const raw = stringValue(value, 2_048);
  const extracted = raw.match(
    /[a-z0-9][a-z0-9._-]*\.apps\.googleusercontent\.com/i,
  )?.[0];
  return (extracted ?? raw).slice(0, 256);
}

export function isGoogleClientId(value: unknown): value is string {
  return /^[a-z0-9][a-z0-9._-]*\.apps\.googleusercontent\.com$/i.test(
    normalizeGoogleClientId(value),
  );
}

export function normalizeExtensionSettings(input: unknown): ExtensionSettings {
  const source =
    input && typeof input === "object"
      ? (input as Partial<Record<keyof ExtensionSettings, unknown>>)
      : {};
  const preferredProvider = stringValue(source.preferredProvider, 24) as AiProvider;
  const interfaceLanguage = stringValue(
    source.interfaceLanguage,
    8,
  ) as SupportedLanguage;
  const generationLanguage = stringValue(
    source.generationLanguage,
    8,
  ) as SupportedLanguage;
  const theme = stringValue(source.theme, 16) as ThemeMode;
  const accentColor = stringValue(source.accentColor, 16) as AccentColor;
  const density = stringValue(source.density, 16) as InterfaceDensity;
  const animationMode = stringValue(source.animationMode, 16) as AnimationMode;

  return {
    googleClientId: normalizeGoogleClientId(source.googleClientId),
    youtubeApiKey: stringValue(source.youtubeApiKey, 512),
    geminiApiKey: stringValue(source.geminiApiKey, 512),
    groqApiKey: stringValue(source.groqApiKey, 512),
    twelveLabsApiKey: stringValue(source.twelveLabsApiKey, 512),
    geminiModel: normalizeGeminiModel(stringValue(source.geminiModel, 128)),
    groqModel: normalizeGroqModel(stringValue(source.groqModel, 128)),
    twelveLabsModel: normalizeTwelveLabsModel(stringValue(source.twelveLabsModel, 128)),
    preferredProvider: PROVIDERS.has(preferredProvider)
      ? preferredProvider
      : DEFAULT_EXTENSION_SETTINGS.preferredProvider,
    interfaceLanguage: LANGUAGES.has(interfaceLanguage)
      ? interfaceLanguage
      : DEFAULT_EXTENSION_SETTINGS.interfaceLanguage,
    generationLanguage: LANGUAGES.has(generationLanguage)
      ? generationLanguage
      : DEFAULT_EXTENSION_SETTINGS.generationLanguage,
    showHeaderWidget: booleanValue(
      source.showHeaderWidget,
      DEFAULT_EXTENSION_SETTINGS.showHeaderWidget,
    ),
    showLauncher: booleanValue(
      source.showLauncher,
      DEFAULT_EXTENSION_SETTINGS.showLauncher,
    ),
    theme: THEMES.has(theme) ? theme : DEFAULT_EXTENSION_SETTINGS.theme,
    accentColor: ACCENTS.has(accentColor)
      ? accentColor
      : DEFAULT_EXTENSION_SETTINGS.accentColor,
    panelTransparency: numberValue(
      source.panelTransparency,
      DEFAULT_EXTENSION_SETTINGS.panelTransparency,
      PANEL_TRANSPARENCY_RANGE.min,
      PANEL_TRANSPARENCY_RANGE.max,
    ),
    density: DENSITIES.has(density) ? density : DEFAULT_EXTENSION_SETTINGS.density,
    animationMode: ANIMATION_MODES.has(animationMode)
      ? animationMode
      : DEFAULT_EXTENSION_SETTINGS.animationMode,
    panelLayout: panelLayoutValue(source.panelLayout),
    widgetSections: normalizeWidgetSections(source.widgetSections),
    widgetDockMetrics: normalizeDockMetrics(source.widgetDockMetrics),
    analyticsRefreshSeconds: numberValue(
      source.analyticsRefreshSeconds,
      DEFAULT_EXTENSION_SETTINGS.analyticsRefreshSeconds,
      30,
      300,
    ),
    notificationsEnabled: booleanValue(
      source.notificationsEnabled,
      DEFAULT_EXTENSION_SETTINGS.notificationsEnabled,
    ),
    allowAiMediaUploads: booleanValue(
      source.allowAiMediaUploads,
      DEFAULT_EXTENSION_SETTINGS.allowAiMediaUploads,
    ),
    debugLogging: booleanValue(
      source.debugLogging,
      DEFAULT_EXTENSION_SETTINGS.debugLogging,
    ),
  };
}
