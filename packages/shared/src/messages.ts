import { CONTENT_SETTABLE_SETTING_KEYS } from "./settings.js";
import type { ExtensionRequest } from "./types.js";

/**
 * Per-field type gate for settings payloads.
 *
 * `normalizeExtensionSettings` already coerces every value into range, so this
 * check is not about correctness — it is about rejecting a payload that is
 * structurally wrong (an array where a string belongs, a nested object smuggled
 * into a boolean field) before it reaches the normalizer at all. The previous
 * `object(payload) + size` check accepted literally any shape.
 */
const SETTINGS_FIELD_TYPES: Record<
  string,
  "string" | "number" | "boolean" | "object" | "string-array"
> = {
  googleClientId: "string",
  youtubeApiKey: "string",
  geminiApiKey: "string",
  groqApiKey: "string",
  twelveLabsApiKey: "string",
  geminiModel: "string",
  groqModel: "string",
  twelveLabsModel: "string",
  preferredProvider: "string",
  interfaceLanguage: "string",
  generationLanguage: "string",
  showHeaderWidget: "boolean",
  showLauncher: "boolean",
  theme: "string",
  accentColor: "string",
  panelTransparency: "number",
  density: "string",
  animationMode: "string",
  panelLayout: "object",
  widgetSections: "string-array",
  widgetDockMetrics: "string-array",
  analyticsRefreshSeconds: "number",
  notificationsEnabled: "boolean",
  allowAiMediaUploads: "boolean",
  debugLogging: "boolean",
};

function isSettingsShape(payload: Record<string, unknown>): boolean {
  for (const [key, raw] of Object.entries(payload)) {
    const expected = SETTINGS_FIELD_TYPES[key];
    if (!expected) return false;
    if (raw === undefined) continue;
    if (expected === "object") {
      if (!object(raw)) return false;
      continue;
    }
    if (expected === "string-array") {
      // Bounded on both axes: the widget lists are short id lists, and the ids
      // themselves are normalized against a known set further down the line.
      if (!Array.isArray(raw) || raw.length > 32) return false;
      if (raw.some((entry) => typeof entry !== "string" || entry.length > 64)) {
        return false;
      }
      continue;
    }
    if (typeof raw !== expected) return false;
    if (expected === "number" && !Number.isFinite(raw)) return false;
    if (expected === "string" && (raw as string).length > 4_096) return false;
  }
  return true;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}

function optionalBoundedString(value: unknown, maximum: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= maximum);
}

function serializedSizeBelow(value: unknown, maximum: number): boolean {
  try {
    return JSON.stringify(value).length <= maximum;
  } catch {
    return false;
  }
}

export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!object(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "AUTH_STATUS":
    case "SIGN_IN":
    case "SIGN_OUT":
    case "COLLECT_REALTIME":
    case "GET_REALTIME_STATUS":
    case "TEST_AI_KEYS":
    case "LIST_AI_MODELS":
    case "GET_AI_PROVIDER_COOLDOWNS":
    case "GET_SETTINGS":
    case "GET_WORKSPACE_STATE":
    case "CLEAR_CACHES":
    case "OPEN_OPTIONS_PAGE":
    case "CREATE_MEDIA_BRIDGE_SESSION":
      return true;
    case "GET_DASHBOARD":
      return optionalBoolean(value.force);
    case "GET_COMPETITOR":
      return boundedString(value.query, 1, 300) && optionalBoolean(value.force);
    case "GET_COMMENTS":
      return boundedString(value.videoId, 6, 32) && optionalBoolean(value.force);
    case "GET_VIDEO_ANALYTICS":
      return (
        typeof value.videoId === "string" &&
        /^[\w-]{11}$/.test(value.videoId) &&
        optionalBoolean(value.force)
      );
    case "ANALYZE_TEXT":
      if (!object(value.payload) || !object(value.payload.context)) return false;
      {
        const context = value.payload.context;
        const provider = value.payload.provider;
        return (
          typeof context.title === "string" &&
          context.title.length <= 500 &&
          typeof context.description === "string" &&
          context.description.length <= 20_000 &&
          Array.isArray(context.tags) &&
          context.tags.length <= 100 &&
          context.tags.every((tag) => typeof tag === "string" && tag.length <= 200) &&
          optionalBoundedString(context.transcript, 250_000) &&
          optionalBoundedString(context.topic, 5_000) &&
          optionalBoundedString(context.audience, 1_000) &&
          optionalBoundedString(context.tone, 300) &&
          optionalBoundedString(context.videoId, 64) &&
          optionalBoundedString(context.channelContext, 4_000) &&
          typeof context.language === "string" &&
          context.language.length <= 20 &&
          (provider === "auto" ||
            provider === "gemini" ||
            provider === "groq" ||
            provider === "twelvelabs" ||
            provider === "both" ||
            provider === "local-fallback") &&
          serializedSizeBelow(value.payload, 320_000)
        );
      }
    case "SET_AI_PROVIDER_COOLDOWN":
      return (
        (value.provider === "gemini" ||
          value.provider === "groq" ||
          value.provider === "twelvelabs") &&
        typeof value.until === "number" &&
        Number.isFinite(value.until)
      );
    case "SAVE_SETTINGS":
      return (
        object(value.payload) &&
        isSettingsShape(value.payload) &&
        serializedSizeBelow(value.payload, 100_000)
      );
    case "SAVE_SETTINGS_PATCH":
      return (
        object(value.payload) &&
        isSettingsShape(value.payload) &&
        Object.keys(value.payload).every((key) =>
          CONTENT_SETTABLE_SETTING_KEYS.includes(
            key as (typeof CONTENT_SETTABLE_SETTING_KEYS)[number],
          ),
        ) &&
        serializedSizeBelow(value.payload, 20_000)
      );
    case "SAVE_SETTINGS_TRUSTED_PATCH":
      return (
        object(value.payload) &&
        isSettingsShape(value.payload) &&
        serializedSizeBelow(value.payload, 100_000)
      );
    case "REDEEM_MEDIA_BRIDGE_SESSION":
      return (
        typeof value.token === "string" &&
        /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(value.token)
      );
    case "SAVE_WORKSPACE_STATE":
      return object(value.payload) && serializedSizeBelow(value.payload, 5_000_000);
    case "RESET_LOCAL_DATA":
      return optionalBoolean(value.preserveSettings);
    default:
      return false;
  }
}
