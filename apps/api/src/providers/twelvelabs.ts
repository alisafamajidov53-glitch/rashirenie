import {
  AiProviderError,
  aiFailureMessage,
  classifyAiFailure,
  isRetryableAiError,
  parseRetryAfterMs,
  type AnalysisResult,
  type SupportedLanguage,
  type VideoContext,
} from "@channelpilot/shared";
import { config } from "../config.js";
import { buildMediaPrompt } from "../prompt.js";
import { finalizeResult } from "./provider-utils.js";

interface TwelveLabsErrorBody {
  error?: string | { message?: string; details?: unknown };
  message?: string;
}

interface TwelveLabsAsset extends TwelveLabsErrorBody {
  _id?: string;
  status?: "processing" | "ready" | "failed";
}

interface TwelveLabsAnalysis extends TwelveLabsErrorBody {
  data?: string | Record<string, unknown>;
  finish_reason?: string;
}

const API_ROOT = "https://api.twelvelabs.io/v1.3";
const MAX_DIRECT_UPLOAD_BYTES = 200 * 1024 * 1024;
const PROCESSING_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 2_000;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    titles: { type: "array", items: { type: "string" } },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
    thumbnailIdeas: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    contentInsights: {
      type: "object",
      properties: {
        summary: { type: "string" },
        detectedFormat: { type: "string" },
        targetAudience: { type: "string" },
        primaryHook: { type: "string" },
        hookAnalysis: {
          type: "object",
          properties: {
            score: { type: "number" },
            firstSecond: { type: "string" },
            firstThreeSeconds: { type: "string" },
            firstTenSeconds: { type: "string" },
            risk: { type: "string" },
          },
          required: [
            "score",
            "firstSecond",
            "firstThreeSeconds",
            "firstTenSeconds",
            "risk",
          ],
        },
        keyMoments: { type: "array", items: { type: "string" } },
        suggestedChapters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              timestampSeconds: { type: "number" },
              title: { type: "string" },
            },
            required: ["timestampSeconds", "title"],
          },
        },
        retentionRisks: { type: "array", items: { type: "string" } },
        thumbnailMoments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              timestampSeconds: { type: "number" },
              score: { type: "number" },
              reason: { type: "string" },
              visual: { type: "string" },
            },
            required: ["timestampSeconds", "score", "reason", "visual"],
          },
        },
        visualElements: { type: "array", items: { type: "string" } },
        spokenTopics: { type: "array", items: { type: "string" } },
      },
      required: [
        "summary",
        "detectedFormat",
        "targetAudience",
        "primaryHook",
        "hookAnalysis",
        "keyMoments",
        "suggestedChapters",
        "retentionRisks",
        "thumbnailMoments",
        "visualElements",
        "spokenTopics",
      ],
    },
  },
  required: [
    "titles",
    "description",
    "tags",
    "keywords",
    "thumbnailIdeas",
    "recommendations",
    "contentInsights",
  ],
} as const;

function language(context: VideoContext): SupportedLanguage {
  return context.language === "en" ? "en" : "ru";
}

function errorMessage(body: TwelveLabsErrorBody): string | undefined {
  return typeof body.error === "string"
    ? body.error
    : (body.error?.message ?? body.message);
}

function httpError(
  response: Response,
  body: TwelveLabsErrorBody,
  outputLanguage: SupportedLanguage,
): AiProviderError {
  const originalMessage =
    errorMessage(body) || `TwelveLabs request failed: ${response.status}`;
  const kind = classifyAiFailure(response.status, originalMessage);
  const retryAfterMs = parseRetryAfterMs(
    response.headers.get("retry-after"),
    originalMessage,
    typeof body.error === "object" ? body.error.details : undefined,
  );
  return new AiProviderError({
    provider: "twelvelabs",
    kind,
    status: response.status,
    retryAfterMs,
    originalMessage,
    message: aiFailureMessage("twelvelabs", kind, retryAfterMs, outputLanguage),
  });
}

function transportError(
  reason: unknown,
  outputLanguage: SupportedLanguage,
): AiProviderError {
  if (reason instanceof AiProviderError) return reason;
  const originalMessage = reason instanceof Error ? reason.message : String(reason);
  const timeout =
    reason instanceof DOMException &&
    (reason.name === "AbortError" || reason.name === "TimeoutError");
  const kind = timeout ? "timeout" : classifyAiFailure(undefined, originalMessage);
  const retryAfterMs = parseRetryAfterMs(null, originalMessage);
  return new AiProviderError({
    provider: "twelvelabs",
    kind,
    retryAfterMs,
    originalMessage,
    message: aiFailureMessage("twelvelabs", kind, retryAfterMs, outputLanguage),
  });
}

async function request(
  path: string,
  init: RequestInit,
  outputLanguage: SupportedLanguage,
): Promise<Response> {
  try {
    return await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        "x-api-key": config.twelveLabsApiKey,
        ...init.headers,
      },
    });
  } catch (reason) {
    throw transportError(reason, outputLanguage);
  }
}

async function readBody<T extends TwelveLabsErrorBody>(
  response: Response,
  outputLanguage: SupportedLanguage,
): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) throw httpError(response, body, outputLanguage);
  return body;
}

async function deleteAsset(assetId: string): Promise<void> {
  await fetch(`${API_ROOT}/assets/${encodeURIComponent(assetId)}`, {
    method: "DELETE",
    headers: { "x-api-key": config.twelveLabsApiKey },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
}

async function uploadAndWait(
  bytes: Buffer,
  filename: string,
  mimeType: string,
  outputLanguage: SupportedLanguage,
): Promise<string> {
  const form = new FormData();
  form.append("method", "direct");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  const uploadResponse = await request(
    "/assets",
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(PROCESSING_TIMEOUT_MS),
    },
    outputLanguage,
  );
  let asset = await readBody<TwelveLabsAsset>(uploadResponse, outputLanguage);
  if (!asset._id) {
    throw new Error(
      outputLanguage === "en"
        ? "TwelveLabs did not return an asset ID."
        : "TwelveLabs не вернул идентификатор загруженного файла.",
    );
  }

  const assetId = asset._id;
  try {
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (asset.status === "ready") return assetId;
      if (asset.status === "failed") {
        throw new Error(
          errorMessage(asset) ??
            (outputLanguage === "en"
              ? "TwelveLabs could not process the uploaded video."
              : "TwelveLabs не смог обработать загруженное видео."),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const pollResponse = await request(
        `/assets/${encodeURIComponent(assetId)}`,
        { signal: AbortSignal.timeout(25_000) },
        outputLanguage,
      );
      asset = await readBody<TwelveLabsAsset>(pollResponse, outputLanguage);
    }
    throw transportError(
      new DOMException("TwelveLabs asset processing timed out", "TimeoutError"),
      outputLanguage,
    );
  } catch (reason) {
    await deleteAsset(assetId);
    throw reason;
  }
}

async function analyzeAsset(
  assetId: string,
  context: VideoContext,
  retryTransient: boolean,
): Promise<AnalysisResult> {
  const outputLanguage = language(context);
  const operation = async () => {
    const response = await request(
      "/analyze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_name: config.twelveLabsModel,
          video: { asset_id: assetId },
          prompt_v2: { input_text: buildMediaPrompt(context) },
          temperature: 0.45,
          stream: false,
          response_format: {
            type: "json_schema",
            json_schema: RESPONSE_SCHEMA,
          },
          // Pegasus 1.5 allows up to 98 304 output tokens; 6 000 truncated
          // full metadata packs into invalid JSON.
          max_tokens: 16_000,
        }),
        signal: AbortSignal.timeout(PROCESSING_TIMEOUT_MS),
      },
      outputLanguage,
    );
    const body = await readBody<TwelveLabsAnalysis>(response, outputLanguage);
    const text =
      typeof body.data === "string"
        ? body.data
        : body.data
          ? JSON.stringify(body.data)
          : "";
    if (!text) {
      throw new Error(
        outputLanguage === "en"
          ? "TwelveLabs returned an empty analysis."
          : "TwelveLabs вернул пустой результат анализа.",
      );
    }
    return finalizeResult(text, context, "twelvelabs");
  };

  try {
    return await operation();
  } catch (reason) {
    const error = transportError(reason, outputLanguage);
    if (!retryTransient || !isRetryableAiError(error)) throw error;
    const fallbackDelay = error.kind === "rate-limit" ? 30_000 : 1_500;
    const delay = Math.max(error.retryAfterMs ?? fallbackDelay, 750) + 250;
    if (delay > 65_000) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return operation();
  }
}

export async function analyzeMediaWithTwelveLabs(
  context: VideoContext,
  bytes: Buffer,
  filename: string,
  mimeType: string,
  retryTransient = true,
): Promise<AnalysisResult> {
  if (!config.twelveLabsApiKey) {
    throw new Error("TWELVELABS_API_KEY is not configured");
  }
  const isVideo =
    mimeType.startsWith("video/") ||
    /(?:\.mp4|\.m4v|\.mov|\.webm|\.mkv|\.avi|\.mpeg|\.mpg|\.ts)$/i.test(filename);
  if (!isVideo) {
    throw new Error(
      context.language === "en"
        ? "TwelveLabs requires a video file."
        : "TwelveLabs нужен видеофайл.",
    );
  }
  if (bytes.byteLength > MAX_DIRECT_UPLOAD_BYTES) {
    throw new Error(
      context.language === "en"
        ? "TwelveLabs direct upload is limited to 200 MB."
        : "Прямая загрузка TwelveLabs ограничена 200 МБ.",
    );
  }

  const assetId = await uploadAndWait(bytes, filename, mimeType, language(context));
  try {
    return await analyzeAsset(assetId, context, retryTransient);
  } finally {
    await deleteAsset(assetId);
  }
}
