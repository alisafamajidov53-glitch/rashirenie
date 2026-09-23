import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
import { GoogleGenAI, type Content } from "@google/genai";
import { config } from "../config.js";
import { buildAnalysisPrompt, buildMediaPrompt } from "../prompt.js";
import { finalizeResult } from "./provider-utils.js";

function client(): GoogleGenAI {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey: config.geminiApiKey });
}

function language(context: VideoContext): SupportedLanguage {
  return context.language === "en" ? "en" : "ru";
}

function normalizeGeminiError(
  reason: unknown,
  outputLanguage: SupportedLanguage,
): AiProviderError {
  if (reason instanceof AiProviderError) return reason;
  const value =
    reason && typeof reason === "object"
      ? (reason as {
          status?: number;
          code?: number;
          message?: string;
          details?: unknown;
          error?: { code?: number; message?: string; details?: unknown };
        })
      : {};
  const status =
    typeof value.status === "number"
      ? value.status
      : typeof value.code === "number"
        ? value.code
        : value.error?.code;
  const originalMessage =
    value.message ||
    value.error?.message ||
    (reason instanceof Error ? reason.message : String(reason));
  const kind = classifyAiFailure(status, originalMessage);
  const retryAfterMs = parseRetryAfterMs(
    null,
    originalMessage,
    value.details ?? value.error?.details,
  );
  return new AiProviderError({
    provider: "gemini",
    kind,
    status,
    retryAfterMs,
    originalMessage,
    message: aiFailureMessage("gemini", kind, retryAfterMs, outputLanguage),
  });
}

async function withGeminiRetry<T>(
  operation: () => Promise<T>,
  outputLanguage: SupportedLanguage,
  enabled: boolean,
): Promise<T> {
  try {
    return await operation();
  } catch (reason) {
    const error = normalizeGeminiError(reason, outputLanguage);
    if (!enabled || !isRetryableAiError(error)) throw error;
    const fallbackDelay = error.kind === "rate-limit" ? 30_000 : 1_500;
    const delay = Math.max(error.retryAfterMs ?? fallbackDelay, 750) + 250;
    if (delay > 65_000) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await operation();
    } catch (retryReason) {
      throw normalizeGeminiError(retryReason, outputLanguage);
    }
  }
}

export async function analyzeWithGemini(
  context: VideoContext,
  retryTransient = true,
): Promise<AnalysisResult> {
  const ai = client();
  const response = await withGeminiRetry(
    () =>
      ai.models.generateContent({
        model: config.geminiModel,
        contents: buildAnalysisPrompt(context),
        config: {
          responseMimeType: "application/json",
          temperature: 0.65,
        },
      }),
    language(context),
    retryTransient,
  );
  if (!response.text) throw new Error("Gemini returned an empty response");
  return finalizeResult(response.text, context, "gemini");
}

export async function analyzeMediaWithGemini(
  context: VideoContext,
  bytes: Buffer,
  filename: string,
  mimeType: string,
  retryTransient = true,
): Promise<AnalysisResult> {
  const ai = client();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "channelpilot-"));
  const safeName = basename(filename).replace(/[^\p{L}\p{N}._-]/gu, "_");
  const temporaryPath = join(temporaryDirectory, safeName || "media.bin");
  let remoteName: string | undefined;

  try {
    await writeFile(temporaryPath, bytes, { mode: 0o600 });
    let uploaded = await ai.files.upload({
      file: temporaryPath,
      config: { mimeType, displayName: safeName },
    });
    remoteName = uploaded.name;
    const deadline = Date.now() + 5 * 60_000;

    while (String(uploaded.state) === "PROCESSING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      if (!uploaded.name) throw new Error("Gemini file has no resource name");
      uploaded = await ai.files.get({ name: uploaded.name });
    }
    if (String(uploaded.state) !== "ACTIVE" || !uploaded.uri) {
      throw new Error(`Gemini could not process the file (${String(uploaded.state)})`);
    }

    const contents: Content[] = [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: uploaded.uri, mimeType } },
          { text: buildMediaPrompt(context) },
        ],
      },
    ];
    const response = await withGeminiRetry(
      () =>
        ai.models.generateContent({
          model: config.geminiModel,
          contents,
          config: {
            responseMimeType: "application/json",
            temperature: 0.6,
          },
        }),
      language(context),
      retryTransient,
    );
    if (!response.text) throw new Error("Gemini returned an empty media analysis");
    return finalizeResult(response.text, context, "gemini");
  } finally {
    if (remoteName) {
      await ai.files.delete({ name: remoteName }).catch(() => undefined);
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
