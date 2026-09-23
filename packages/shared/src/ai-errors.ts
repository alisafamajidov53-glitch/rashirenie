import type { SupportedLanguage } from "./types.js";

export type AiProviderId = "gemini" | "groq" | "twelvelabs";
export type AiFailureKind =
  "rate-limit" | "authentication" | "model" | "server" | "timeout" | "unknown";

const MAX_RETRY_DELAY_MS = 5 * 60_000;

function finiteDelay(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.ceil(value), MAX_RETRY_DELAY_MS);
}

function durationMs(value: string): number | undefined {
  const match = value.trim().match(/^([\d.]+)\s*(ms|s|m)?$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2]?.toLowerCase() ?? "s";
  return finiteDelay(amount * (unit === "ms" ? 1 : unit === "m" ? 60_000 : 1_000));
}

function retryDelayFromDetails(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = retryDelayFromDetails(item);
      if (parsed) return parsed;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["retryDelay", "retry_delay", "retryAfter"]) {
    if (typeof record[key] === "string") {
      const parsed = durationMs(record[key]);
      if (parsed) return parsed;
    }
    if (typeof record[key] === "number") {
      const parsed = finiteDelay(record[key] * 1_000);
      if (parsed) return parsed;
    }
  }
  for (const nested of Object.values(record)) {
    const parsed = retryDelayFromDetails(nested);
    if (parsed) return parsed;
  }
  return undefined;
}

export function parseRetryAfterMs(
  retryAfterHeader: string | null | undefined,
  message = "",
  details?: unknown,
  now = Date.now(),
): number | undefined {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds)) {
      const parsed = finiteDelay(seconds * 1_000);
      if (parsed) return parsed;
    }
    const date = Date.parse(retryAfterHeader);
    if (Number.isFinite(date)) {
      const parsed = finiteDelay(date - now);
      if (parsed) return parsed;
    }
  }

  const detailDelay = retryDelayFromDetails(details);
  if (detailDelay) return detailDelay;

  const messageMatch = message.match(
    /(?:retry|повтор(?:ите|ная попытка)?)(?:\s+\w+){0,3}\s+(?:in|через)\s+([\d.]+)\s*(ms|s|sec(?:onds?)?|m|min(?:utes?)?)/i,
  );
  if (!messageMatch) return undefined;
  const unit = (messageMatch[2] ?? "s").toLowerCase();
  return durationMs(
    `${messageMatch[1]}${unit.startsWith("m") && unit !== "ms" ? "m" : unit === "ms" ? "ms" : "s"}`,
  );
}

export function classifyAiFailure(
  status: number | undefined,
  message: string,
): AiFailureKind {
  const normalized = message.toLowerCase();
  if (
    status === 429 ||
    /resource_exhausted|quota exceeded|rate.?limit|too many requests|лимит.*исчерпан/.test(
      normalized,
    )
  ) {
    return "rate-limit";
  }
  if (
    status === 404 ||
    /model.*(?:not found|not available|deprecat|blocked|not permitted|not enabled)|unsupported model|model_permission_blocked|(?:no access|(?:do|does) not have access) to (?:the )?model/.test(
      normalized,
    )
  ) {
    return "model";
  }
  if (
    status === 401 ||
    status === 403 ||
    /api key.*(?:invalid|expired)|permission_denied|unauthori[sz]ed|authentication/.test(
      normalized,
    )
  ) {
    return "authentication";
  }
  if (
    status === 408 ||
    /deadline_exceeded|timed? ?out|timeout|время ожидания/.test(normalized)
  ) {
    return "timeout";
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /unavailable|overloaded|internal server/.test(normalized)
  ) {
    return "server";
  }
  return "unknown";
}

export function aiFailureMessage(
  provider: AiProviderId,
  kind: AiFailureKind,
  retryAfterMs: number | undefined,
  language: SupportedLanguage,
): string {
  const name =
    provider === "gemini" ? "Gemini" : provider === "groq" ? "Groq" : "TwelveLabs";
  const seconds = retryAfterMs
    ? Math.max(1, Math.ceil(retryAfterMs / 1_000))
    : undefined;
  if (language === "en") {
    if (kind === "rate-limit") {
      return seconds
        ? `${name} free quota is temporarily exhausted. Retry in about ${seconds}s or use Auto mode with the other API.`
        : `${name} quota is exhausted. Retry later or use Auto mode with the other API.`;
    }
    if (kind === "authentication") {
      return `${name} rejected the API key. Check the key and its project permissions.`;
    }
    if (kind === "model") {
      return `${name} model is unavailable for this API key. Refresh the model list and select another model.`;
    }
    if (kind === "server") {
      return `${name} is temporarily unavailable. ChannelPilot will retry once or use the other API in Auto mode.`;
    }
    if (kind === "timeout") return `${name} did not respond in time. Please retry.`;
    return `${name} request failed. Check the selected model and API settings.`;
  }
  if (kind === "rate-limit") {
    return seconds
      ? `Бесплатный лимит ${name} временно исчерпан. Повторите примерно через ${seconds} сек. или используйте режим «Авто» со вторым API.`
      : `Лимит ${name} исчерпан. Повторите позже или используйте режим «Авто» со вторым API.`;
  }
  if (kind === "authentication") {
    return `${name} отклонил API-ключ. Проверьте ключ и права его проекта.`;
  }
  if (kind === "model") {
    return `Модель ${name} недоступна для этого API-ключа. Обновите список и выберите другую модель.`;
  }
  if (kind === "server") {
    return `${name} временно недоступен. ChannelPilot повторит запрос один раз или использует второй API в режиме «Авто».`;
  }
  if (kind === "timeout") return `${name} не ответил вовремя. Повторите запрос.`;
  return `Запрос к ${name} не выполнен. Проверьте выбранную модель и настройки API.`;
}

export class AiProviderError extends Error {
  readonly provider: AiProviderId;
  readonly kind: AiFailureKind;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly originalMessage: string;

  constructor(options: {
    provider: AiProviderId;
    kind: AiFailureKind;
    message: string;
    originalMessage: string;
    status?: number | undefined;
    retryAfterMs?: number | undefined;
  }) {
    super(options.message);
    this.name = "AiProviderError";
    this.provider = options.provider;
    this.kind = options.kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.originalMessage = options.originalMessage;
  }
}

export function isRetryableAiError(error: unknown): error is AiProviderError {
  return (
    error instanceof AiProviderError &&
    (error.kind === "rate-limit" || error.kind === "server" || error.kind === "timeout")
  );
}
