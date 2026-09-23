import {
  formatExactMetric,
  type SupportedLanguage,
  type VideoPerformanceFactor,
  type VideoPerformanceScore,
  type VideoSummary,
} from "@channelpilot/shared";

const tr = (language: SupportedLanguage, ru: string, en: string) =>
  language === "ru" ? ru : en;

export type VideoMomentum =
  "warming" | "collecting" | "hot" | "growing" | "stable" | "cooling";

/** A trend needs both observed 15-minute windows, not just a positive hour. */
export function videoMomentum(video: VideoSummary): VideoMomentum {
  const hasCurrentWindow = video.observedMinutesLast15 >= 5;
  const hasPreviousWindow = video.previousObservedMinutes15 >= 5;
  if (!hasCurrentWindow || !hasPreviousWindow) {
    return video.observedMinutes >= 5 || video.observedMinutes24Hours >= 15
      ? "collecting"
      : "warming";
  }
  const trend = video.velocityTrendPercent;
  const speed = video.viewsPerMinuteLast15;
  if (!Number.isFinite(trend) || !Number.isFinite(speed)) return "collecting";
  if (trend >= 20 && speed > 0) return "hot";
  if (trend <= -20) return "cooling";
  if (trend >= 5 && speed > 0) return "growing";
  return "stable";
}

export function videoMomentumLabel(
  momentum: VideoMomentum,
  language: SupportedLanguage,
): string {
  switch (momentum) {
    case "warming":
      return tr(language, "Сбор данных", "Warming up");
    case "collecting":
      return tr(language, "Сбор тренда", "Collecting trend");
    case "hot":
      return tr(language, "Ускоряется", "Accelerating");
    case "growing":
      return tr(language, "Набирает", "Growing");
    case "cooling":
      return tr(language, "Замедляется", "Slowing");
    case "stable":
      return tr(language, "Стабильно", "Stable");
  }
}

const FACTOR_NAMES: Record<VideoPerformanceFactor["id"], [string, string]> = {
  "realtime-velocity": ["Наблюдаемая скорость", "Observed velocity"],
  engagement: ["Вовлечённость", "Engagement"],
  retention: ["Среднее удержание", "Average retention"],
  "subscriber-conversion": ["Конверсия в подписку", "Subscriber conversion"],
  "lifetime-pace": ["Темп за срок жизни", "Lifetime pace"],
  "watch-time": ["Время просмотра на просмотр", "Watch time per view"],
};

const FACTOR_EXPLANATIONS: Record<VideoPerformanceFactor["id"], [string, string]> = {
  "realtime-velocity": [
    "Темп за наблюдаемый час относительно видео того же формата; нужно от 5 минут наблюдений.",
    "Observed hourly pace versus same-format videos; needs at least 5 minutes of observations.",
  ],
  engagement: [
    "Лайки и комментарии относительно публичных просмотров.",
    "Likes and comments relative to public views.",
  ],
  retention: [
    "Средняя доля просмотра за 28 дней; 70% даёт максимум этого фактора.",
    "Average percentage viewed over 28 days; 70% earns the maximum for this factor.",
  ],
  "subscriber-conversion": [
    "Чистый прирост подписчиков на 1 000 просмотров Analytics.",
    "Net subscribers per 1,000 Analytics views.",
  ],
  "lifetime-pace": [
    "Публичные просмотры в день с момента публикации относительно видео того же формата.",
    "Public views per day since publication versus same-format videos.",
  ],
  "watch-time": [
    "Среднее время просмотра на один просмотр Analytics.",
    "Average watch time per Analytics view.",
  ],
};

export function performanceFactorName(
  factor: VideoPerformanceFactor,
  language: SupportedLanguage,
): string {
  const [ru, en] = FACTOR_NAMES[factor.id];
  return tr(language, ru, en);
}

export function performanceFactorExplanation(
  factor: VideoPerformanceFactor,
  language: SupportedLanguage,
): string {
  return tr(language, ...FACTOR_EXPLANATIONS[factor.id]);
}

export function performanceCoverageLabel(
  score: VideoPerformanceScore,
  language: SupportedLanguage,
): string {
  if (score.confidence === "high") return tr(language, "высокая", "high");
  if (score.confidence === "medium") return tr(language, "средняя", "medium");
  return tr(language, "низкая", "low");
}

export function performanceFactorValue(
  factor: VideoPerformanceFactor,
  language: SupportedLanguage,
): string | null {
  if (factor.unavailableReason === "missing_data" || !Number.isFinite(factor.value))
    return null;
  const digits =
    factor.id === "engagement" || factor.id === "watch-time"
      ? 2
      : factor.id === "lifetime-pace"
        ? 0
        : 1;
  const unit: Record<VideoPerformanceFactor["id"], [string, string]> = {
    "realtime-velocity": ["просм./ч", "views/h"],
    engagement: ["%", "%"],
    retention: ["%", "%"],
    "subscriber-conversion": ["подп./1K", "subs/1K"],
    "lifetime-pace": ["просм./день", "views/day"],
    "watch-time": ["мин/просм.", "min/view"],
  };
  return `${formatExactMetric(factor.value, language, digits)} ${tr(language, ...unit[factor.id])}`;
}

export function performanceFactorStatus(
  factor: VideoPerformanceFactor,
  language: SupportedLanguage,
): string {
  if (factor.available) return `${factor.score}/${factor.max}`;
  if (factor.unavailableReason === "insufficient_peers") {
    return tr(
      language,
      `Нужно 3 видео того же формата · есть ${factor.peerCount}`,
      `Needs 3 same-format peers · ${factor.peerCount} available`,
    );
  }
  if (factor.unavailableReason === "unsupported_format") {
    return tr(
      language,
      "Сравнение доступно для Shorts и обычных видео",
      "Comparison needs a confirmed Shorts or video format",
    );
  }
  return tr(language, "Нет данных", "No data");
}

export function performanceScoreValue(score: VideoPerformanceScore): string {
  return score.total === null ? "—" : `${score.total}/100`;
}

export function performanceScoreNote(
  score: VideoPerformanceScore,
  language: SupportedLanguage,
): string {
  if (score.total !== null) {
    return tr(
      language,
      "Оценка использует только доступные факторы. Разную полноту нельзя сравнивать напрямую.",
      "Only available factors are scored. Scores with different coverage are not directly comparable.",
    );
  }
  if (
    score.factors.some((factor) => factor.unavailableReason === "unsupported_format")
  ) {
    return tr(
      language,
      "Формат видео не подтверждён. Сравнение доступно для Shorts и обычных видео.",
      "The video format is not confirmed. Comparisons support Shorts and regular videos.",
    );
  }
  if (score.sameFormatPeers < 3) {
    return tr(
      language,
      `Для сравнения найдено ${score.sameFormatPeers}/3 других видео того же формата. Индекс появится при полноте от 70/100.`,
      `${score.sameFormatPeers}/3 other same-format videos found. The score appears when coverage reaches 70/100.`,
    );
  }
  return tr(
    language,
    `Полнота данных ${score.availableWeight}/100. Для индекса нужно минимум 70/100; недоступные факторы не оцениваются.`,
    `Data coverage is ${score.availableWeight}/100. The score needs at least 70/100; unavailable factors are not scored.`,
  );
}

export function performanceScoreTooltip(
  score: VideoPerformanceScore,
  language: SupportedLanguage,
): string {
  return [
    `${tr(language, "Индекс эффективности", "Performance score")}: ${performanceScoreValue(score)} · ${tr(language, "полнота данных", "data coverage")}: ${score.availableWeight}/100 (${performanceCoverageLabel(score, language)})`,
    performanceScoreNote(score, language),
    ...score.factors.map(
      (factor) =>
        `${performanceFactorName(factor, language)}: ${performanceFactorStatus(factor, language)}${performanceFactorValue(factor, language) ? ` · ${performanceFactorValue(factor, language)}` : ""}`,
    ),
  ].join("\n");
}
