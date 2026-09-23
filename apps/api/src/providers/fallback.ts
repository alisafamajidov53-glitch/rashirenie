import {
  calculateTitleCandidateScore,
  calculateSeoScore,
  inferKeywords,
  type AnalysisResult,
  type VideoContext,
} from "@channelpilot/shared";

export function analyzeLocally(context: VideoContext): AnalysisResult {
  const english = context.language === "en";
  const topic =
    context.topic?.trim() ||
    context.title.trim() ||
    (english ? "your topic" : "ваша тема");
  const keywords = inferKeywords(context);
  const firstKeyword = keywords[0] ?? topic;
  const titles = (
    english
      ? [
          `${topic}: The Complete No-Fluff Breakdown`,
          `How to Master ${topic}: A Step-by-Step Plan`,
          `${topic}: 7 Mistakes Blocking Your Results`,
          `What You Need to Know About ${topic} This Year`,
          `${topic} in Practice: From First Step to Result`,
          `${topic} vs Reality: What Actually Works`,
          `I Tested ${topic} — Here Is the Result`,
          `The Hidden Problem With ${topic}`,
          `${topic}: The Complete Story`,
          `Can ${topic} Really Work?`,
        ]
      : [
          `${topic}: полный разбор без лишней воды`,
          `Как разобраться в теме «${topic}» — пошаговый план`,
          `${topic}: 7 ошибок, которые мешают получить результат`,
          `Что важно знать про ${topic} в этом году`,
          `${topic} на практике: от первого шага до результата`,
          `${topic} против реальности: что работает`,
          `Я проверил ${topic} — вот результат`,
          `Скрытая проблема ${topic}`,
          `${topic}: полная история`,
          `Может ли ${topic} действительно сработать?`,
        ]
  ).map((title) => title.slice(0, 75));
  const description = english
    ? `${titles[0]}

This video breaks down ${topic}: the core principles, practical steps, and common mistakes. Watch to the end for a clear action plan.

In this video:
— where to start;
— what deserves your attention;
— how to verify the result.

Share your experience in the comments and subscribe if this breakdown helped.`
    : `${titles[0]}

В этом видео разбираем ${topic}: основные принципы, практические шаги и типичные ошибки. Смотрите до конца, чтобы получить понятный план действий.

Что будет в видео:
— с чего начать;
— на что обратить внимание;
— как проверить результат.

Поделитесь опытом в комментариях и подпишитесь, если разбор был полезен.`;
  const tags = [...new Set([firstKeyword, topic, ...context.tags, ...keywords])].slice(
    0,
    15,
  );
  const titleScores = titles
    .map((title) => calculateTitleCandidateScore(title, keywords, context))
    .sort((left, right) => right.total - left.total);
  const rankedTitles = titleScores.map((candidate) => candidate.title);

  return {
    titles: rankedTitles,
    titleScores,
    description,
    shortDescription: description.replace(/\s+/g, " ").slice(0, 220),
    tags,
    hashtags: keywords.slice(0, 5).map((keyword) => `#${keyword.replace(/\s+/g, "")}`),
    keywords: keywords.length ? keywords : [topic],
    pinnedComment: english
      ? `What part of ${topic} should I cover next?`
      : `Какую часть темы «${topic}» разобрать следующей?`,
    thumbnailPrompt: english
      ? `A truthful, high-contrast YouTube thumbnail about ${topic}; one clear subject, strong separation, no text or logos.`
      : `Честное контрастное превью YouTube о теме «${topic}»: один главный объект, ясная композиция, без текста и логотипов.`,
    scriptOutline: english
      ? [
          "0–5s: show the result and state the promise",
          "Define the challenge and stakes",
          "Walk through the core steps",
          "Reveal the main obstacle",
          "Show the final result",
          "Close with one relevant question",
        ]
      : [
          "0–5с: показать результат и сформулировать обещание",
          "Объяснить задачу и ставки",
          "Показать основные шаги",
          "Раскрыть главное препятствие",
          "Показать финальный результат",
          "Завершить одним уместным вопросом",
        ],
    shortsIdeas: [],
    thumbnailIdeas: english
      ? [
          `Large focal subject, contrasting background, and “${topic}” in no more than four words`,
          "A before/after composition with one measurable result",
          "A clear facial emotion, one visual conflict, and minimal detail",
        ]
      : [
          `Крупный главный объект, контрастный фон и текст «${topic}» до 4 слов`,
          "Композиция «до / после» с одним измеримым результатом",
          "Лицо с понятной эмоцией, один визуальный конфликт и минимум деталей",
        ],
    recommendations: english
      ? [
          "Place the primary search phrase in the first half of the title.",
          "Turn the first two description lines into a strong standalone lead.",
          "Verify thumbnail readability at mobile recommendation size.",
          "Add chapters after the final edit.",
          "Compare CTR and retention 24–48 hours after publication.",
        ]
      : [
          "Поставьте главную поисковую фразу в первую половину заголовка.",
          "Первые две строки описания превратите в самостоятельный сильный лид.",
          "Проверьте читаемость обложки в размере мобильной рекомендации.",
          "Добавьте главы после финального монтажа.",
          "Сравните CTR и удержание через 24–48 часов после публикации.",
        ],
    contentInsights: {
      summary: english
        ? `A draft analysis about ${topic}. Connect Gemini for visual evidence and timestamped moments.`
        : `Черновой анализ о теме «${topic}». Подключите Gemini для визуальных фактов и моментов с таймкодами.`,
      detectedFormat: "YouTube video",
      targetAudience: context.audience ?? "",
      primaryHook: topic,
      hookAnalysis: {
        score: 0,
        firstSecond: "",
        firstThreeSeconds: "",
        firstTenSeconds: "",
        risk: english
          ? "No video evidence is available in local fallback mode."
          : "В локальном резервном режиме нет визуальных доказательств из видео.",
      },
      keyMoments: [],
      suggestedChapters: [],
      retentionRisks: [],
      thumbnailMoments: [],
      visualElements: [],
      spokenTopics: context.transcript ? keywords.slice(0, 6) : [],
    },
    seo: calculateSeoScore(
      { ...context, title: rankedTitles[0] ?? context.title, description, tags },
      keywords,
    ),
    provider: "local-fallback",
    generatedAt: new Date().toISOString(),
  };
}
