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
import { buildAnalysisPrompt } from "../prompt.js";
import { finalizeResult } from "./provider-utils.js";

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; details?: unknown };
}

function outputLanguage(context?: VideoContext): SupportedLanguage {
  return context?.language === "en" ? "en" : "ru";
}

function groqHttpError(
  response: Response,
  body: { error?: { message?: string; details?: unknown } },
  language: SupportedLanguage,
): AiProviderError {
  const originalMessage =
    body.error?.message || `Groq request failed: ${response.status}`;
  const kind = classifyAiFailure(response.status, originalMessage);
  const retryAfterMs = parseRetryAfterMs(
    response.headers.get("retry-after"),
    originalMessage,
    body.error?.details,
  );
  return new AiProviderError({
    provider: "groq",
    kind,
    status: response.status,
    retryAfterMs,
    originalMessage,
    message: aiFailureMessage("groq", kind, retryAfterMs, language),
  });
}

async function withGroqRetry<T>(
  operation: () => Promise<T>,
  enabled: boolean,
): Promise<T> {
  try {
    return await operation();
  } catch (reason) {
    if (!(reason instanceof AiProviderError)) throw reason;
    if (!enabled || !isRetryableAiError(reason)) throw reason;
    const fallbackDelay = reason.kind === "rate-limit" ? 30_000 : 1_500;
    const delay = Math.max(reason.retryAfterMs ?? fallbackDelay, 750) + 250;
    if (delay > 65_000) throw reason;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return operation();
  }
}

export async function analyzeWithGroq(
  context: VideoContext,
  retryTransient = true,
): Promise<AnalysisResult> {
  if (!config.groqApiKey) throw new Error("GROQ_API_KEY is not configured");

  const text = await withGroqRetry(async () => {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.groqModel,
        temperature: 0.65,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Return precise YouTube metadata as one valid JSON object.",
          },
          { role: "user", content: buildAnalysisPrompt(context) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await response.json().catch(() => ({}))) as GroqChatResponse;
    if (!response.ok) {
      throw groqHttpError(response, body, outputLanguage(context));
    }
    return body.choices?.[0]?.message?.content;
  }, retryTransient);
  if (!text) throw new Error("Groq returned an empty response");
  return finalizeResult(text, context, "groq");
}

export async function transcribeWithGroq(
  bytes: Buffer,
  filename: string,
  mimeType: string,
  retryTransient = true,
  context?: VideoContext,
): Promise<string> {
  if (!config.groqApiKey) throw new Error("GROQ_API_KEY is not configured");

  return withGroqRetry(async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      filename,
    );
    form.append("model", config.groqTranscriptionModel);
    form.append("response_format", "json");

    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.groqApiKey}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      text?: string;
      error?: { message?: string; details?: unknown };
    };
    if (!response.ok) {
      throw groqHttpError(response, body, outputLanguage(context));
    }
    if (!body.text) throw new Error("Groq transcription returned no text");
    return body.text;
  }, retryTransient);
}
