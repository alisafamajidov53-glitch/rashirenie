import type {
  AiProvider,
  AnalysisRequest,
  AnalysisResult,
  VideoContext,
} from "@channelpilot/shared";
import {
  AiProviderError,
  calculateSeoScore,
  calculateTitleCandidateScore,
} from "@channelpilot/shared";
import { config } from "./config.js";
import { analyzeLocally } from "./providers/fallback.js";
import { analyzeMediaWithGemini, analyzeWithGemini } from "./providers/gemini.js";
import { analyzeWithGroq, transcribeWithGroq } from "./providers/groq.js";
import { analyzeMediaWithTwelveLabs } from "./providers/twelvelabs.js";

function isTextMedia(filename: string, mimeType: string): boolean {
  return (
    /^(text\/|application\/(?:x-subrip|vtt))/.test(mimeType) ||
    /\.(?:srt|vtt|txt)$/i.test(filename)
  );
}

function isAudioOrVideoMedia(filename: string, mimeType: string): boolean {
  return (
    /^(audio|video)\//.test(mimeType) ||
    /\.(?:mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(
      filename,
    )
  );
}

export async function analyzeText(request: AnalysisRequest): Promise<AnalysisResult> {
  if (request.provider === "auto") {
    return analyzeTextAutomatically(request.context);
  }
  if (request.provider === "twelvelabs") {
    throw new Error(
      request.context.language === "en"
        ? "TwelveLabs requires a video file. Use Gemini or Groq for text-only analysis."
        : "TwelveLabs нужен видеофайл. Для текстового анализа используйте Gemini или Groq.",
    );
  }
  const provider = selectProvider(request.provider, false);
  if (provider === "gemini") return analyzeWithGemini(request.context, true);
  if (provider === "groq") return analyzeWithGroq(request.context, true);
  if (provider === "both") {
    return combineProviderResults(
      analyzeWithGemini(request.context, false),
      analyzeWithGroq(request.context, false),
      request.context,
    );
  }
  return analyzeLocally(request.context);
}

export async function analyzeMedia(
  context: VideoContext,
  providerPreference: AiProvider,
  bytes: Buffer,
  filename: string,
  mimeType: string,
): Promise<AnalysisResult> {
  if (providerPreference === "auto") {
    return analyzeMediaAutomatically(context, bytes, filename, mimeType);
  }
  const provider = selectProvider(providerPreference, true);
  if (provider === "gemini") {
    return analyzeMediaWithGemini(context, bytes, filename, mimeType, true);
  }
  if (provider === "twelvelabs") {
    return analyzeMediaWithTwelveLabs(context, bytes, filename, mimeType, true);
  }
  if (provider === "groq" && isAudioOrVideoMedia(filename, mimeType)) {
    if (bytes.byteLength > 24 * 1024 * 1024) {
      throw new Error(
        context.language === "en"
          ? "Groq audio and video uploads are limited to 24 MB."
          : "Загрузка аудио и видео в Groq ограничена 24 МБ.",
      );
    }
    const transcript = await transcribeWithGroq(
      bytes,
      filename,
      mimeType,
      true,
      context,
    );
    return analyzeWithGroq({ ...context, transcript }, true);
  }
  if (provider === "groq" && !isTextMedia(filename, mimeType)) {
    throw new Error(
      context.language === "en"
        ? "Groq cannot inspect images directly. Select Gemini or both providers."
        : "Groq не анализирует изображения напрямую. Выберите Gemini или оба провайдера.",
    );
  }
  if (provider === "both") {
    const groqRequest = (
      isAudioOrVideoMedia(filename, mimeType) && bytes.byteLength <= 24 * 1024 * 1024
        ? transcribeWithGroq(bytes, filename, mimeType, false, context)
        : isTextMedia(filename, mimeType)
          ? Promise.resolve(bytes.toString("utf8"))
          : Promise.reject(
              new Error(
                context.language === "en"
                  ? "Groq cannot inspect this media type directly."
                  : "Groq не может напрямую проанализировать этот тип файла.",
              ),
            )
    ).then((transcript) => analyzeWithGroq({ ...context, transcript }, false));
    return combineProviderResults(
      analyzeMediaWithGemini(context, bytes, filename, mimeType, false),
      groqRequest,
      context,
    );
  }
  if (isTextMedia(filename, mimeType)) {
    return analyzeText({
      context: { ...context, transcript: bytes.toString("utf8") },
      provider: providerPreference,
    });
  }
  return analyzeLocally(context);
}

function addProviderNotice(result: AnalysisResult, notice: string): AnalysisResult {
  return {
    ...result,
    providerNotice: notice,
    recommendations: [notice, ...result.recommendations].slice(0, 8),
  };
}

function fallbackNotice(
  reason: unknown,
  context: VideoContext,
  media: boolean,
): string {
  const english = context.language === "en";
  const seconds =
    reason instanceof AiProviderError && reason.retryAfterMs
      ? Math.max(1, Math.ceil(reason.retryAfterMs / 1_000))
      : undefined;
  const quota = reason instanceof AiProviderError && reason.kind === "rate-limit";
  if (english) {
    const cause = quota
      ? `Gemini quota is temporarily exhausted${seconds ? ` (about ${seconds}s)` : ""}`
      : "Gemini is currently unavailable";
    return media
      ? `${cause}; ChannelPilot used Groq automatically. The fallback analyzed speech and audio, so visual-only details may be less complete.`
      : `${cause}; ChannelPilot used Groq automatically.`;
  }
  const cause = quota
    ? `Лимит Gemini временно исчерпан${seconds ? ` (около ${seconds} сек.)` : ""}`
    : "Gemini сейчас недоступен";
  return media
    ? `${cause}; ChannelPilot автоматически использовал Groq. Резервный анализ учитывает речь и звук, поэтому чисто визуальные детали могут быть менее полными.`
    : `${cause}; ChannelPilot автоматически использовал Groq.`;
}

async function analyzeTextAutomatically(
  context: VideoContext,
): Promise<AnalysisResult> {
  if (config.geminiApiKey) {
    try {
      return await analyzeWithGemini(context, !config.groqApiKey);
    } catch (geminiError) {
      if (!config.groqApiKey) throw geminiError;
      try {
        const result = await analyzeWithGroq(context, true);
        return addProviderNotice(result, fallbackNotice(geminiError, context, false));
      } catch (groqError) {
        throw new Error(
          context.language === "ru"
            ? `Оба AI-провайдера не ответили. Gemini: ${providerError(geminiError)}. Groq: ${providerError(groqError)}`
            : `Both AI providers failed. Gemini: ${providerError(geminiError)}. Groq: ${providerError(groqError)}`,
        );
      }
    }
  }
  if (config.groqApiKey) return analyzeWithGroq(context, true);
  return analyzeLocally(context);
}

async function groqMediaResult(
  context: VideoContext,
  bytes: Buffer,
  filename: string,
  mimeType: string,
  retryTransient: boolean,
): Promise<AnalysisResult> {
  const transcript = isAudioOrVideoMedia(filename, mimeType)
    ? await transcribeWithGroq(bytes, filename, mimeType, retryTransient, context)
    : bytes.toString("utf8");
  return analyzeWithGroq({ ...context, transcript }, retryTransient);
}

async function analyzeMediaAutomatically(
  context: VideoContext,
  bytes: Buffer,
  filename: string,
  mimeType: string,
): Promise<AnalysisResult> {
  const textLike = isTextMedia(filename, mimeType);
  const canUseGroq =
    Boolean(config.groqApiKey) &&
    (textLike ||
      (isAudioOrVideoMedia(filename, mimeType) &&
        bytes.byteLength <= 24 * 1024 * 1024));
  const canUseTwelveLabs =
    Boolean(config.twelveLabsApiKey) &&
    (mimeType.startsWith("video/") ||
      /(?:\.mp4|\.m4v|\.mov|\.webm|\.mkv|\.avi|\.mpeg|\.mpg|\.ts)$/i.test(filename)) &&
    bytes.byteLength <= 200 * 1024 * 1024;
  const candidates: Array<{
    provider: "Gemini" | "TwelveLabs" | "Groq";
    run: (retryTransient: boolean) => Promise<AnalysisResult>;
  }> = [];
  if (config.geminiApiKey) {
    candidates.push({
      provider: "Gemini",
      run: (retryTransient) =>
        analyzeMediaWithGemini(context, bytes, filename, mimeType, retryTransient),
    });
  }
  if (canUseTwelveLabs) {
    candidates.push({
      provider: "TwelveLabs",
      run: (retryTransient) =>
        analyzeMediaWithTwelveLabs(context, bytes, filename, mimeType, retryTransient),
    });
  }
  if (canUseGroq) {
    candidates.push({
      provider: "Groq",
      run: (retryTransient) =>
        groqMediaResult(context, bytes, filename, mimeType, retryTransient),
    });
  }

  const failures: Array<{ provider: string; reason: unknown }> = [];
  for (const [index, candidate] of candidates.entries()) {
    const hasFallback = index < candidates.length - 1;
    try {
      const result = await candidate.run(!hasFallback);
      if (failures.length === 0) return result;
      const failed = failures
        .map(({ provider, reason }) => `${provider}: ${providerError(reason)}`)
        .join("; ");
      const notice =
        context.language === "en"
          ? `${failed}. ChannelPilot continued automatically with ${candidate.provider}.`
          : `${failed}. ChannelPilot автоматически продолжил через ${candidate.provider}.`;
      return addProviderNotice(result, notice);
    } catch (reason) {
      failures.push({ provider: candidate.provider, reason });
    }
  }

  if (failures.length > 0) {
    const details = failures
      .map(({ provider, reason }) => `${provider}: ${providerError(reason)}`)
      .join("; ");
    throw new Error(
      context.language === "en"
        ? `All available video AI providers failed. ${details}`
        : `Все доступные AI-провайдеры видео не ответили. ${details}`,
    );
  }
  if (textLike) {
    return analyzeText({
      context: { ...context, transcript: bytes.toString("utf8") },
      provider: "auto",
    });
  }
  return analyzeLocally(context);
}

function providerError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function settledProviderError(result: PromiseSettledResult<AnalysisResult>): string {
  return result.status === "rejected" ? providerError(result.reason) : "unknown error";
}

async function combineProviderResults(
  geminiRequest: Promise<AnalysisResult>,
  groqRequest: Promise<AnalysisResult>,
  context: VideoContext,
): Promise<AnalysisResult> {
  const [gemini, groq] = await Promise.allSettled([geminiRequest, groqRequest]);
  if (gemini.status === "fulfilled" && groq.status === "fulfilled") {
    return mergeResults(gemini.value, groq.value, context);
  }
  if (gemini.status === "fulfilled") {
    const message =
      context.language === "ru"
        ? `Groq не ответил; результат Gemini сохранён: ${settledProviderError(groq)}`
        : `Groq failed; Gemini result was preserved: ${settledProviderError(groq)}`;
    return addProviderNotice(gemini.value, message);
  }
  if (groq.status === "fulfilled") {
    const message =
      context.language === "ru"
        ? `Gemini не ответил; результат Groq сохранён: ${settledProviderError(gemini)}`
        : `Gemini failed; Groq result was preserved: ${settledProviderError(gemini)}`;
    return addProviderNotice(groq.value, message);
  }
  throw new Error(
    context.language === "ru"
      ? `Оба AI-провайдера не ответили. Gemini: ${settledProviderError(gemini)}. Groq: ${settledProviderError(groq)}`
      : `Both AI providers failed. Gemini: ${settledProviderError(gemini)}. Groq: ${settledProviderError(groq)}`,
  );
}

function selectProvider(
  preference: AiProvider,
  media: boolean,
): Exclude<AiProvider, "auto"> {
  if (preference === "gemini" && !config.geminiApiKey) {
    throw new Error("Gemini was selected, but GEMINI_API_KEY is not configured");
  }
  if (preference === "groq" && !config.groqApiKey) {
    throw new Error("Groq was selected, but GROQ_API_KEY is not configured");
  }
  if (preference === "twelvelabs" && !config.twelveLabsApiKey) {
    throw new Error(
      "TwelveLabs was selected, but TWELVELABS_API_KEY is not configured",
    );
  }
  if (preference === "gemini" && config.geminiApiKey) return "gemini";
  if (preference === "groq" && config.groqApiKey) return "groq";
  if (preference === "twelvelabs" && config.twelveLabsApiKey) {
    if (!media) {
      throw new Error("TwelveLabs requires a video file");
    }
    return "twelvelabs";
  }
  if (preference === "both") {
    if (!config.geminiApiKey || !config.groqApiKey) {
      throw new Error("Both mode requires GEMINI_API_KEY and GROQ_API_KEY");
    }
    return "both";
  }
  if (preference === "local-fallback") return "local-fallback";
  if (config.geminiApiKey) return "gemini";
  if (config.twelveLabsApiKey && media) return "twelvelabs";
  if (config.groqApiKey && !media) return "groq";
  if (config.groqApiKey && media) return "groq";
  return "local-fallback";
}

function mergeResults(
  gemini: AnalysisResult,
  groq: AnalysisResult,
  context: VideoContext,
): AnalysisResult {
  const unique = (values: string[], max: number) => {
    const result = new Map<string, string>();
    for (const value of values) {
      const cleaned = value.trim();
      if (cleaned && !result.has(cleaned.toLocaleLowerCase())) {
        result.set(cleaned.toLocaleLowerCase(), cleaned);
      }
    }
    return [...result.values()].slice(0, max);
  };
  const titles = unique([...gemini.titles.slice(0, 3), ...groq.titles.slice(0, 3)], 6);
  const description =
    gemini.description.length >= groq.description.length
      ? gemini.description
      : groq.description;
  const tags = unique([...gemini.tags, ...groq.tags], 20);
  const keywords = unique([...gemini.keywords, ...groq.keywords], 15);
  const geminiInsight = gemini.contentInsights;
  const groqInsight = groq.contentInsights;
  const primaryInsight =
    geminiInsight.thumbnailMoments.length * 3 + geminiInsight.visualElements.length >=
    groqInsight.thumbnailMoments.length * 3 + groqInsight.visualElements.length
      ? geminiInsight
      : groqInsight;
  const secondaryInsight =
    primaryInsight === geminiInsight ? groqInsight : geminiInsight;
  const thumbnailMoments = [
    ...geminiInsight.thumbnailMoments,
    ...groqInsight.thumbnailMoments,
  ]
    .sort((left, right) => right.score - left.score)
    .filter(
      (moment, index, values) =>
        values.findIndex(
          (candidate) =>
            Math.abs(candidate.timestampSeconds - moment.timestampSeconds) < 0.25,
        ) === index,
    )
    .slice(0, 6);
  const suggestedChapters = [
    ...(geminiInsight.suggestedChapters ?? []),
    ...(groqInsight.suggestedChapters ?? []),
  ]
    .sort((left, right) => left.timestampSeconds - right.timestampSeconds)
    .filter(
      (chapter, index, values) =>
        values.findIndex(
          (candidate) =>
            Math.abs(candidate.timestampSeconds - chapter.timestampSeconds) < 0.5,
        ) === index,
    )
    .slice(0, 12);
  const titleScores = titles
    .map((title) => calculateTitleCandidateScore(title, keywords, context))
    .sort((left, right) => right.total - left.total);
  const rankedTitles = titleScores.map((candidate) => candidate.title);
  return {
    titles: rankedTitles,
    titleScores,
    description,
    shortDescription:
      gemini.shortDescription.length >= groq.shortDescription.length
        ? gemini.shortDescription
        : groq.shortDescription,
    tags,
    hashtags: unique([...gemini.hashtags, ...groq.hashtags], 8),
    keywords,
    pinnedComment:
      gemini.pinnedComment.length >= groq.pinnedComment.length
        ? gemini.pinnedComment
        : groq.pinnedComment,
    thumbnailPrompt:
      gemini.thumbnailPrompt.length >= groq.thumbnailPrompt.length
        ? gemini.thumbnailPrompt
        : groq.thumbnailPrompt,
    scriptOutline: unique([...gemini.scriptOutline, ...groq.scriptOutline], 16),
    shortsIdeas: [...gemini.shortsIdeas, ...groq.shortsIdeas]
      .filter(
        (idea, index, values) =>
          values.findIndex(
            (candidate) =>
              candidate.title.toLocaleLowerCase() === idea.title.toLocaleLowerCase(),
          ) === index,
      )
      .slice(0, 8),
    thumbnailIdeas: unique([...gemini.thumbnailIdeas, ...groq.thumbnailIdeas], 6),
    recommendations: unique([...gemini.recommendations, ...groq.recommendations], 8),
    contentInsights: {
      summary:
        geminiInsight.summary.length >= groqInsight.summary.length
          ? geminiInsight.summary
          : groqInsight.summary,
      detectedFormat: primaryInsight.detectedFormat || secondaryInsight.detectedFormat,
      targetAudience: primaryInsight.targetAudience || secondaryInsight.targetAudience,
      primaryHook: primaryInsight.primaryHook || secondaryInsight.primaryHook,
      hookAnalysis:
        (geminiInsight.hookAnalysis?.score ?? 0) >=
        (groqInsight.hookAnalysis?.score ?? 0)
          ? geminiInsight.hookAnalysis
          : groqInsight.hookAnalysis,
      keyMoments: unique([...geminiInsight.keyMoments, ...groqInsight.keyMoments], 8),
      suggestedChapters,
      retentionRisks: unique(
        [
          ...(geminiInsight.retentionRisks ?? []),
          ...(groqInsight.retentionRisks ?? []),
        ],
        6,
      ),
      thumbnailMoments,
      visualElements: unique(
        [...geminiInsight.visualElements, ...groqInsight.visualElements],
        12,
      ),
      spokenTopics: unique(
        [...geminiInsight.spokenTopics, ...groqInsight.spokenTopics],
        12,
      ),
    },
    seo: calculateSeoScore(
      {
        ...context,
        title: rankedTitles[0] ?? context.title,
        description,
        tags,
      },
      keywords,
    ),
    provider: "both",
    generatedAt: new Date().toISOString(),
  };
}
