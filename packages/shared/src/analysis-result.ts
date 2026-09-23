import { calculateSeoScore, calculateTitleCandidateScore } from "./seo.js";
import type {
  AiProvider,
  AnalysisResult,
  ContentInsights,
  HookAnalysis,
  SeoFactor,
  SeoScore,
  ShortsIdea,
  SuggestedChapter,
  ThumbnailMoment,
  TitleCandidateScore,
} from "./types.js";

const PROVIDERS = new Set<Exclude<AiProvider, "auto">>([
  "gemini",
  "groq",
  "twelvelabs",
  "both",
  "local-fallback",
]);
const SCORE_LABELS = new Set(["low", "medium", "high"]);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      )
    : [];
}

function objects<T>(value: unknown, map: (item: UnknownRecord) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = record(item);
    const mapped = source ? map(source) : undefined;
    return mapped === undefined ? [] : [mapped];
  });
}

function hookAnalysis(value: unknown): HookAnalysis | undefined {
  const source = record(value);
  if (!source || typeof source.score !== "number" || !Number.isFinite(source.score))
    return undefined;
  return {
    score: source.score,
    firstSecond: text(source.firstSecond),
    firstThreeSeconds: text(source.firstThreeSeconds),
    firstTenSeconds: text(source.firstTenSeconds),
    risk: text(source.risk),
  };
}

function contentInsights(value: unknown, description: string): ContentInsights {
  const source = record(value) ?? {};
  const insights: ContentInsights = {
    summary: text(source.summary) || description.slice(0, 320),
    detectedFormat: text(source.detectedFormat),
    targetAudience: text(source.targetAudience),
    primaryHook: text(source.primaryHook),
    hookAnalysis: hookAnalysis(source.hookAnalysis),
    keyMoments: strings(source.keyMoments),
    thumbnailMoments: objects<ThumbnailMoment>(source.thumbnailMoments, (item) =>
      typeof item.timestampSeconds === "number" &&
      Number.isFinite(item.timestampSeconds)
        ? {
            timestampSeconds: item.timestampSeconds,
            score: finite(item.score),
            reason: text(item.reason),
            visual: text(item.visual),
          }
        : undefined,
    ),
    visualElements: strings(source.visualElements),
    spokenTopics: strings(source.spokenTopics),
  };
  if (Array.isArray(source.suggestedChapters)) {
    insights.suggestedChapters = objects<SuggestedChapter>(
      source.suggestedChapters,
      (item) =>
        typeof item.timestampSeconds === "number" &&
        Number.isFinite(item.timestampSeconds) &&
        typeof item.title === "string"
          ? { timestampSeconds: item.timestampSeconds, title: item.title }
          : undefined,
    );
  }
  if (Array.isArray(source.retentionRisks)) {
    insights.retentionRisks = strings(source.retentionRisks);
  }
  return insights;
}

function storedTitleScores(
  value: unknown,
  titles: string[],
): TitleCandidateScore[] | null {
  if (!Array.isArray(value) || value.length !== titles.length) return null;
  const scores = objects<TitleCandidateScore>(value, (item) => {
    const factors = record(item.factors);
    if (
      typeof item.title !== "string" ||
      typeof item.total !== "number" ||
      !SCORE_LABELS.has(item.label as string) ||
      !factors
    )
      return undefined;
    return {
      title: item.title,
      total: item.total,
      label: item.label as TitleCandidateScore["label"],
      factors: {
        length: finite(factors.length),
        keywords: finite(factors.keywords),
        hook: finite(factors.hook),
        clarity: finite(factors.clarity),
        mobile: finite(factors.mobile),
      },
      strengths: strings(item.strengths),
      warning: text(item.warning),
    };
  });
  return scores.length === titles.length ? scores : null;
}

function storedSeo(value: unknown): SeoScore | null {
  const source = record(value);
  if (
    !source ||
    typeof source.total !== "number" ||
    !SCORE_LABELS.has(source.label as string) ||
    !Array.isArray(source.factors)
  )
    return null;
  return {
    total: source.total,
    label: source.label as SeoScore["label"],
    factors: objects<SeoFactor>(source.factors, (item) =>
      typeof item.label === "string"
        ? {
            id: text(item.id) || item.label,
            label: item.label,
            score: finite(item.score),
            max: finite(item.max, 1),
            hint: text(item.hint),
          }
        : undefined,
    ),
  };
}

/**
 * Brings a stored AI result up to the current shape.
 *
 * AI history keeps results produced by older builds, which lack fields added
 * since (`titleScores`, `scriptOutline`, `contentInsights.thumbnailMoments`, …).
 * Opening such an item handed the raw object to the renderer and crashed the
 * whole dashboard with "Cannot read properties of undefined". Missing lists
 * become empty, and scores are recomputed from the stored text.
 *
 * Returns null when there is nothing usable (no titles).
 */
export function normalizeAnalysisResult(input: unknown): AnalysisResult | null {
  const source = record(input);
  if (!source) return null;
  const titles = strings(source.titles);
  if (titles.length === 0) return null;
  const description = text(source.description);
  const tags = strings(source.tags);
  const keywords = strings(source.keywords);
  const provider = PROVIDERS.has(source.provider as Exclude<AiProvider, "auto">)
    ? (source.provider as Exclude<AiProvider, "auto">)
    : "local-fallback";
  const result: AnalysisResult = {
    titles,
    titleScores:
      storedTitleScores(source.titleScores, titles) ??
      titles.map((title) => calculateTitleCandidateScore(title, keywords)),
    description,
    shortDescription: text(source.shortDescription) || description.slice(0, 220),
    tags,
    hashtags: strings(source.hashtags),
    keywords,
    pinnedComment: text(source.pinnedComment),
    thumbnailPrompt: text(source.thumbnailPrompt),
    scriptOutline: strings(source.scriptOutline),
    shortsIdeas: objects<ShortsIdea>(source.shortsIdeas, (item) =>
      typeof item.title === "string"
        ? {
            title: item.title,
            hook: text(item.hook),
            ...(typeof item.startSeconds === "number"
              ? { startSeconds: item.startSeconds }
              : {}),
            ...(typeof item.endSeconds === "number"
              ? { endSeconds: item.endSeconds }
              : {}),
          }
        : undefined,
    ),
    thumbnailIdeas: strings(source.thumbnailIdeas),
    recommendations: strings(source.recommendations),
    contentInsights: contentInsights(source.contentInsights, description),
    seo:
      storedSeo(source.seo) ??
      calculateSeoScore(
        { title: titles[0] ?? "", description, tags, language: "en" },
        keywords,
      ),
    provider,
    generatedAt: text(source.generatedAt) || new Date(0).toISOString(),
  };
  if (typeof source.providerNotice === "string" && source.providerNotice) {
    result.providerNotice = source.providerNotice;
  }
  return result;
}
