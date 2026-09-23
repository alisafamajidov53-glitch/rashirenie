import type { SupportedLanguage, TitleGenerationMode } from "./types.js";

export interface LabelledOption<T extends string> {
  id: T;
  label: Record<SupportedLanguage, string>;
}

/**
 * Title strategies offered by the YouTube panel and AI Studio. Both used to
 * keep their own copy of this list.
 */
export const TITLE_MODE_OPTIONS: ReadonlyArray<LabelledOption<TitleGenerationMode>> = [
  { id: "seo", label: { ru: "SEO", en: "SEO" } },
  { id: "viral", label: { ru: "Вирусный", en: "Viral" } },
  { id: "curiosity", label: { ru: "Любопытство", en: "Curiosity" } },
  { id: "clean", label: { ru: "Чистый", en: "Clean" } },
  { id: "educational", label: { ru: "Обучающий", en: "Educational" } },
  { id: "story", label: { ru: "История", en: "Story" } },
  { id: "challenge", label: { ru: "Челлендж", en: "Challenge" } },
  { id: "versus", label: { ru: "Сравнение", en: "Versus" } },
  { id: "documentary", label: { ru: "Документальный", en: "Documentary" } },
];

/**
 * Writing tones. The two copies had drifted: the same value was "Экспертный"
 * in one and "Профессиональный" in the other, and the panel offered both
 * "minimal" and "minimalist".
 */
export const TONE_OPTIONS: ReadonlyArray<LabelledOption<string>> = [
  { id: "professional", label: { ru: "Экспертный", en: "Expert" } },
  { id: "friendly", label: { ru: "Дружелюбный", en: "Friendly" } },
  { id: "viral", label: { ru: "Вирусный", en: "Viral" } },
  { id: "emotional", label: { ru: "Эмоциональный", en: "Emotional" } },
  { id: "energetic", label: { ru: "Энергичный", en: "Energetic" } },
  { id: "calm", label: { ru: "Спокойный", en: "Calm" } },
  { id: "humorous", label: { ru: "Юмористический", en: "Humorous" } },
  { id: "educational", label: { ru: "Обучающий", en: "Educational" } },
  { id: "entertaining", label: { ru: "Развлекательный", en: "Entertaining" } },
  { id: "dramatic", label: { ru: "Драматичный", en: "Dramatic" } },
  { id: "minimalist", label: { ru: "Лаконичный", en: "Concise" } },
  { id: "documentary", label: { ru: "Документальный", en: "Documentary" } },
  {
    id: "provocative",
    label: { ru: "Провокационный без обмана", en: "Provocative, not misleading" },
  },
];
