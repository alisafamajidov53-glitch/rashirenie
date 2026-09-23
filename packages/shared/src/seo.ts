import type {
  SeoFactor,
  SeoScore,
  TitleCandidateScore,
  VideoContext,
} from "./types.js";

function words(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function overlapScore(haystack: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const normalized = haystack.toLocaleLowerCase();
  const hits = keywords.filter((keyword) =>
    normalized.includes(keyword.toLocaleLowerCase()),
  ).length;
  return Math.round((hits / keywords.length) * 10);
}

// JavaScript's \b only knows ASCII word characters, so it never matches around
// Cyrillic words. These lookarounds are Unicode-aware word boundaries.
const WORD_START = "(?<![\\p{L}\\p{N}])";
const WORD_END = "(?![\\p{L}\\p{N}])";
function wordPattern(alternatives: string): RegExp {
  return new RegExp(`${WORD_START}(?:${alternatives})${WORD_END}`, "iu");
}
const TRANSFORMATION_PATTERN = wordPattern(
  "до|после|против|vs|воссоздал\\p{L}*|превратил\\p{L}*|проверил\\p{L}*|попробовал\\p{L}*|tested|turned|recreated|tried|before|after",
);
const CURIOSITY_PATTERN = wordPattern(
  "как|почему|зачем|что если|секрет\\p{L}*|ошибк\\p{L}*|невозмож\\p{L}*|правд\\p{L}*|how|why|what if|secrets?|mistakes?|impossible|truth",
);
const SEO_HOOK_PATTERN = wordPattern(
  "как|почему|секрет\\p{L}*|ошибк\\p{L}*|how|why|secrets?|mistakes?",
);

function titleTokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function calculateTitleCandidateScore(
  title: string,
  explicitKeywords: string[] = [],
  context?: Partial<VideoContext>,
): TitleCandidateScore {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return {
      title: "",
      total: 0,
      label: "low",
      factors: {
        length: 0,
        keywords: 0,
        hook: 0,
        clarity: 0,
        mobile: 0,
      },
      strengths: [],
      warning: "Добавьте конкретный заголовок",
    };
  }
  const tokens = titleTokens(normalized);
  const keywords = explicitKeywords
    .map((keyword) => keyword.trim().toLocaleLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  const length = normalized.length;
  const lengthScore =
    length >= 42 && length <= 65
      ? 20
      : length >= 32 && length <= 75
        ? 15
        : length >= 24 && length <= 85
          ? 9
          : 4;

  const normalizedLower = normalized.toLocaleLowerCase();
  const matchedKeywords = keywords.filter((keyword) =>
    normalizedLower.includes(keyword),
  );
  const leadingKeyword = matchedKeywords.some(
    (keyword) =>
      normalizedLower.indexOf(keyword) >= 0 && normalizedLower.indexOf(keyword) <= 28,
  );
  const keywordScore =
    keywords.length === 0
      ? 12
      : Math.min(
          25,
          Math.round((matchedKeywords.length / Math.min(4, keywords.length)) * 19) +
            (leadingKeyword ? 6 : 0),
        );

  const hasConcreteNumber = /(?<!\p{N})\p{N}{1,4}(?!\p{N})/u.test(normalized);
  const hasQuestion = /[?？]/u.test(normalized);
  const hasTransformation = TRANSFORMATION_PATTERN.test(normalized);
  const hasCuriosity = CURIOSITY_PATTERN.test(normalized);
  const hookScore = Math.min(
    20,
    7 +
      (hasConcreteNumber ? 4 : 0) +
      (hasQuestion ? 3 : 0) +
      (hasTransformation ? 5 : 0) +
      (hasCuriosity ? 4 : 0),
  );

  const duplicates = tokens.length - new Set(tokens).size;
  const punctuationClusters = (normalized.match(/[!?]{2,}|\.{3,}/gu) ?? []).length;
  const allCapsWords = normalized
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 3 &&
        word === word.toLocaleUpperCase() &&
        word !== word.toLocaleLowerCase(),
    ).length;
  const clarityScore = Math.max(
    4,
    Math.min(
      20,
      20 -
        duplicates * 3 -
        punctuationClusters * 3 -
        Math.max(0, allCapsWords - 1) * 2 -
        (tokens.length > 14 ? 4 : 0),
    ),
  );

  const firstHalf = normalized.slice(0, 45).toLocaleLowerCase();
  const topicWords = titleTokens(
    `${context?.topic ?? ""} ${context?.title ?? ""}`,
  ).slice(0, 8);
  const promiseEarly =
    matchedKeywords.some((keyword) => firstHalf.includes(keyword)) ||
    topicWords.some((word) => word.length > 3 && firstHalf.includes(word));
  const mobileScore = length <= 65 ? (promiseEarly ? 15 : 11) : promiseEarly ? 9 : 6;

  const total = Math.max(
    0,
    Math.min(100, lengthScore + keywordScore + hookScore + clarityScore + mobileScore),
  );
  const strengths: string[] = [];
  if (lengthScore >= 15) strengths.push("Оптимальная длина");
  if (keywordScore >= 18) strengths.push("Сильная поисковая релевантность");
  if (hookScore >= 15) strengths.push("Выраженный зрительский хук");
  if (clarityScore >= 17) strengths.push("Легко читается");
  if (mobileScore >= 14) strengths.push("Смысл виден на мобильном");
  const warning =
    keywordScore < 12
      ? "Добавьте главную поисковую фразу ближе к началу"
      : hookScore < 12
        ? "Сделайте результат или конфликт конкретнее"
        : clarityScore < 14
          ? "Упростите формулировку и пунктуацию"
          : length > 70
            ? "Сократите заголовок для мобильной выдачи"
            : "";
  return {
    title: normalized,
    total,
    label: total >= 78 ? "high" : total >= 58 ? "medium" : "low",
    factors: {
      length: lengthScore,
      keywords: keywordScore,
      hook: hookScore,
      clarity: clarityScore,
      mobile: mobileScore,
    },
    strengths,
    warning,
  };
}

export function inferKeywords(context: VideoContext): string[] {
  const counts = new Map<string, number>();
  for (const word of words(
    `${context.topic ?? ""} ${context.title} ${context.description} ${context.tags.join(" ")}`,
  )) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

export function calculateSeoScore(
  context: VideoContext,
  explicitKeywords: string[] = [],
): SeoScore {
  const keywords =
    explicitKeywords.length > 0 ? explicitKeywords.slice(0, 8) : inferKeywords(context);
  const titleLength = context.title.trim().length;
  const descriptionLength = context.description.trim().length;
  const tagCount = new Set(context.tags.map((tag) => tag.toLocaleLowerCase())).size;
  const titleKeywordScore = overlapScore(context.title, keywords);
  const descriptionKeywordScore = overlapScore(context.description, keywords);
  const hasHook = /[?!]/u.test(context.title) || SEO_HOOK_PATTERN.test(context.title);
  const duplicateWords =
    words(context.title).length - new Set(words(context.title)).size;

  const factors: SeoFactor[] = [
    {
      id: "title-length",
      label: "Длина заголовка",
      score:
        titleLength >= 42 && titleLength <= 65
          ? 20
          : titleLength >= 30 && titleLength <= 75
            ? 14
            : Math.min(10, Math.round(titleLength / 4)),
      max: 20,
      hint: "Оптимальный ориентир — 42–65 символов без обрезания смысла.",
    },
    {
      id: "description",
      label: "Полнота описания",
      score:
        descriptionLength >= 500
          ? 20
          : descriptionLength >= 250
            ? 15
            : descriptionLength >= 100
              ? 9
              : 3,
      max: 20,
      hint: "Добавьте краткий лид, структуру, полезные ссылки и естественные ключевые фразы.",
    },
    {
      id: "title-keywords",
      label: "Ключи в заголовке",
      score: Math.min(20, titleKeywordScore * 2),
      max: 20,
      hint: "Главная поисковая фраза должна естественно появляться ближе к началу.",
    },
    {
      id: "description-keywords",
      label: "Ключи в описании",
      score: Math.min(15, Math.round(descriptionKeywordScore * 1.5)),
      max: 15,
      hint: "Раскройте тему, не повторяя ключевые слова механически.",
    },
    {
      id: "tags",
      label: "Теги",
      score: tagCount >= 5 && tagCount <= 15 ? 15 : tagCount > 0 ? 8 : 0,
      max: 15,
      hint: "Используйте 5–15 релевантных тегов: точные, широкие и брендовые.",
    },
    {
      id: "hook",
      label: "Ясность и интрига",
      score: Math.max(2, 10 - duplicateWords * 2 - (hasHook ? 0 : 3)),
      max: 10,
      hint: "Обещайте конкретную пользу или создайте честный вопрос без кликбейта.",
    },
  ];

  const total = Math.min(
    100,
    factors.reduce((sum, factor) => sum + factor.score, 0),
  );
  return {
    total,
    label: total >= 75 ? "high" : total >= 50 ? "medium" : "low",
    factors,
  };
}
