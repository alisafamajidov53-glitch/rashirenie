import {
  calculateTitleCandidateScore,
  calculateSeoScore,
  type AiProvider,
  type AnalysisResult,
  type ThumbnailMoment,
  type VideoContext,
} from "@channelpilot/shared";
import { z } from "zod";

const uniqueStrings = (maximumItems: number, maximumLength: number) =>
  z
    .array(z.string().max(maximumLength))
    .max(maximumItems)
    .transform((values) => {
      const unique = new Map<string, string>();
      for (const value of values) {
        const cleaned = value.replace(/\u0000/g, "").trim();
        const key = cleaned.toLocaleLowerCase();
        if (cleaned && !unique.has(key)) unique.set(key, cleaned);
      }
      return [...unique.values()];
    });

const rawResultSchema = z.object({
  titles: uniqueStrings(12, 120).refine((values) => values.length > 0),
  description: z
    .string()
    .max(10_000)
    .transform((value) => value.trim())
    .refine(Boolean),
  shortDescription: z.string().max(500).optional().default(""),
  tags: uniqueStrings(30, 120),
  hashtags: uniqueStrings(8, 80).optional().default([]),
  keywords: uniqueStrings(20, 180),
  pinnedComment: z.string().max(2_000).optional().default(""),
  thumbnailPrompt: z.string().max(2_000).optional().default(""),
  scriptOutline: uniqueStrings(16, 1_000).optional().default([]),
  shortsIdeas: z
    .array(
      z.object({
        title: z
          .string()
          .max(180)
          .transform((value) => value.trim()),
        hook: z
          .string()
          .max(500)
          .transform((value) => value.trim()),
        startSeconds: z.coerce.number().finite().nonnegative().optional(),
        endSeconds: z.coerce.number().finite().nonnegative().optional(),
      }),
    )
    .max(8)
    .optional()
    .default([]),
  thumbnailIdeas: uniqueStrings(10, 800),
  recommendations: uniqueStrings(12, 800),
  contentInsights: z
    .object({
      summary: z.string().max(1_200),
      detectedFormat: z.string().max(160),
      targetAudience: z.string().max(500),
      primaryHook: z.string().max(500),
      hookAnalysis: z
        .object({
          score: z.coerce.number().finite().min(0).max(100),
          firstSecond: z.string().max(500),
          firstThreeSeconds: z.string().max(500),
          firstTenSeconds: z.string().max(500),
          risk: z.string().max(500),
        })
        .optional(),
      keyMoments: uniqueStrings(8, 500),
      suggestedChapters: z
        .array(
          z.object({
            timestampSeconds: z.coerce.number().finite().nonnegative(),
            title: z
              .string()
              .max(160)
              .transform((value) => value.trim()),
          }),
        )
        .max(12)
        .optional()
        .default([]),
      retentionRisks: uniqueStrings(6, 500).optional().default([]),
      thumbnailMoments: z
        .array(
          z.object({
            timestampSeconds: z.coerce.number().finite().nonnegative(),
            score: z.coerce.number().finite().min(0).max(100),
            reason: z
              .string()
              .max(500)
              .transform((value) => value.trim()),
            visual: z
              .string()
              .max(500)
              .transform((value) => value.trim()),
          }),
        )
        .max(6)
        .optional()
        .default([])
        .transform((moments) => {
          const unique: ThumbnailMoment[] = [];
          for (const moment of moments) {
            if (
              !unique.some(
                (current) =>
                  Math.abs(current.timestampSeconds - moment.timestampSeconds) < 0.25,
              )
            ) {
              unique.push(moment);
            }
          }
          return unique;
        }),
      visualElements: uniqueStrings(12, 300),
      spokenTopics: uniqueStrings(12, 300),
    })
    .optional(),
});

function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI provider returned no JSON object");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export function finalizeResult(
  text: string,
  context: VideoContext,
  provider: Exclude<AiProvider, "auto">,
): AnalysisResult {
  const raw = rawResultSchema.parse(extractJson(text));
  const seed =
    context.topic?.trim() ||
    context.title.trim() ||
    raw.titles[0] ||
    (context.language === "en" ? "This Video" : "Это видео");
  const localVariants =
    context.language === "en"
      ? [
          `${seed}: The Complete Story`,
          `I Tested ${seed} — Here’s the Result`,
          `${seed} vs Reality`,
          `How ${seed} Changed Everything`,
          `The Hidden Problem With ${seed}`,
          `${seed}: From First Step to Final Reveal`,
          `Can ${seed} Really Work?`,
          `What Nobody Tells You About ${seed}`,
          `${seed} Without the Hype`,
          `The ${seed} Challenge`,
        ]
      : [
          `${seed}: полная история`,
          `Я проверил ${seed} — вот результат`,
          `${seed} против реальности`,
          `Как ${seed} изменило всё`,
          `Скрытая проблема ${seed}`,
          `${seed}: от первого шага до финала`,
          `Может ли ${seed} сработать?`,
          `Что никто не говорит про ${seed}`,
          `${seed} без лишнего хайпа`,
          `Челлендж: ${seed}`,
        ];
  const titleVariants = [
    ...new Map(
      [...raw.titles, ...localVariants].map((title) => [
        title.trim().toLocaleLowerCase(),
        title.trim().slice(0, 100),
      ]),
    ).values(),
  ]
    .filter(Boolean)
    .slice(0, 12);
  const titleScores = titleVariants
    .map((title) => calculateTitleCandidateScore(title, raw.keywords, context))
    .sort((left, right) => right.total - left.total);
  const titles = titleScores.map((candidate) => candidate.title);
  const scoreContext: VideoContext = {
    ...context,
    title: titles[0] ?? context.title,
    description: raw.description,
    tags: raw.tags,
  };
  return {
    ...raw,
    shortDescription:
      raw.shortDescription || raw.description.replace(/\s+/g, " ").slice(0, 220),
    hashtags: raw.hashtags.map((tag) =>
      tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`,
    ),
    shortsIdeas: raw.shortsIdeas.map((idea) => ({
      title: idea.title,
      hook: idea.hook,
      ...(idea.startSeconds === undefined ? {} : { startSeconds: idea.startSeconds }),
      ...(idea.endSeconds === undefined ? {} : { endSeconds: idea.endSeconds }),
    })),
    titles,
    titleScores,
    contentInsights: raw.contentInsights ?? {
      summary: raw.description.slice(0, 320),
      detectedFormat: "YouTube video",
      targetAudience: "",
      primaryHook: "",
      keyMoments: [],
      thumbnailMoments: [],
      visualElements: [],
      spokenTopics: [],
    },
    seo: calculateSeoScore(scoreContext, raw.keywords),
    provider,
    generatedAt: new Date().toISOString(),
  };
}
