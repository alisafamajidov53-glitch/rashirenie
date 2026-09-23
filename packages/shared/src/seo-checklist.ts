import type { SupportedLanguage, VideoSummary } from "./types.js";

const tr = (language: SupportedLanguage, ru: string, en: string) =>
  language === "ru" ? ru : en;

export type SeoChecklistStatus = "pass" | "warning" | "unknown";

export interface SeoChecklistItem {
  id: string;
  label: string;
  status: SeoChecklistStatus;
  evidence: string;
  source: "youtube_data_api" | "derived" | "not_available";
}

export interface SeoChecklist {
  score: number;
  checked: number;
  passed: number;
  items: SeoChecklistItem[];
}

/** Assignable YouTube video categories (videoCategories.list, stable IDs). */
const YOUTUBE_CATEGORIES: Record<string, Record<SupportedLanguage, string>> = {
  "1": { ru: "Фильмы и анимация", en: "Film & Animation" },
  "2": { ru: "Транспорт", en: "Autos & Vehicles" },
  "10": { ru: "Музыка", en: "Music" },
  "15": { ru: "Животные", en: "Pets & Animals" },
  "17": { ru: "Спорт", en: "Sports" },
  "19": { ru: "Путешествия", en: "Travel & Events" },
  "20": { ru: "Видеоигры", en: "Gaming" },
  "22": { ru: "Люди и блоги", en: "People & Blogs" },
  "23": { ru: "Юмор", en: "Comedy" },
  "24": { ru: "Развлечения", en: "Entertainment" },
  "25": { ru: "Новости и политика", en: "News & Politics" },
  "26": { ru: "Хобби и стиль", en: "Howto & Style" },
  "27": { ru: "Образование", en: "Education" },
  "28": { ru: "Наука и техника", en: "Science & Technology" },
  "29": { ru: "Некоммерческие организации", en: "Nonprofits & Activism" },
};

/** "Видеоигры · ID 20" rather than a bare number the creator has to look up. */
export function youtubeCategoryLabel(
  categoryId: string,
  language: SupportedLanguage,
): string {
  const name = YOUTUBE_CATEGORIES[categoryId]?.[language];
  return name ? `${name} · ID ${categoryId}` : `ID ${categoryId}`;
}

/** "Английский · en" for a BCP 47 tag the API reports, the tag itself if unknown. */
export function languageTagLabel(tag: string, language: SupportedLanguage): string {
  try {
    const name = new Intl.DisplayNames([language], { type: "language" }).of(tag);
    if (name && name.toLocaleLowerCase() !== tag.toLocaleLowerCase()) {
      return `${name.charAt(0).toLocaleUpperCase(language)}${name.slice(1)} · ${tag}`;
    }
  } catch {
    // A malformed tag throws a RangeError; show it as YouTube returned it.
  }
  return tag;
}

export function calculateSeoChecklist(
  video: VideoSummary,
  language: SupportedLanguage = "ru",
): SeoChecklist {
  const titleLength = video.title.trim().length;
  const description = video.description.trim();
  const chapters =
    description.match(/(?:^|\n)(?:\d{1,2}:)?\d{1,2}:\d{2}\s+\S+/gu) ?? [];
  const hashtags = description.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  const uniqueTags = new Set(
    video.tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean),
  );
  const known: SeoChecklistItem[] = [
    {
      id: "title",
      label: tr(language, "Заголовок", "Title"),
      status: titleLength >= 35 && titleLength <= 70 ? "pass" : "warning",
      evidence: tr(
        language,
        `${titleLength}/100 символов · цель 35–70`,
        `${titleLength}/100 characters · aim for 35–70`,
      ),
      source: "youtube_data_api",
    },
    {
      id: "description",
      label: tr(language, "Описание", "Description"),
      status: description.length >= 200 ? "pass" : "warning",
      evidence: tr(
        language,
        `${description.length} символов · цель от 200`,
        `${description.length} characters · aim for 200+`,
      ),
      source: "youtube_data_api",
    },
    {
      id: "keywords",
      label: tr(language, "Ключевые слова / теги", "Keywords / tags"),
      status: uniqueTags.size >= 5 ? "pass" : "warning",
      evidence: tr(
        language,
        `${uniqueTags.size} уникальных тегов`,
        `${uniqueTags.size} unique tags`,
      ),
      source: "youtube_data_api",
    },
    {
      id: "chapters",
      label: tr(language, "Главы", "Chapters"),
      status:
        video.contentType === "shorts"
          ? "unknown"
          : chapters.length >= 3 && /^0{1,2}:00\s/mu.test(description)
            ? "pass"
            : "warning",
      evidence:
        video.contentType === "shorts"
          ? tr(language, "Не применяется к Shorts", "Not applicable to Shorts")
          : chapters.length
            ? tr(
                language,
                `${chapters.length} таймкодов`,
                `${chapters.length} timestamps`,
              )
            : tr(language, "Таймкоды не найдены", "No timestamps found"),
      source: "derived",
    },
    {
      id: "hashtags",
      label: tr(language, "Хештеги", "Hashtags"),
      status: hashtags.length >= 1 && hashtags.length <= 5 ? "pass" : "warning",
      evidence: tr(
        language,
        `${hashtags.length} хештегов`,
        `${hashtags.length} hashtags`,
      ),
      source: "derived",
    },
    {
      id: "thumbnail",
      label: tr(language, "Превью", "Thumbnail"),
      status: video.thumbnailUrl ? "pass" : "warning",
      evidence: video.thumbnailUrl
        ? tr(language, "Публичное превью доступно", "Public thumbnail available")
        : tr(language, "Превью не найдено", "No thumbnail found"),
      source: "youtube_data_api",
    },
    {
      id: "captions",
      label: tr(language, "Субтитры", "Captions"),
      status: video.captionsAvailable ? "pass" : "warning",
      evidence: video.captionsAvailable
        ? tr(language, "YouTube сообщает о субтитрах", "YouTube reports captions")
        : tr(language, "Субтитры не обнаружены", "No captions detected"),
      source: "youtube_data_api",
    },
    {
      id: "language",
      label: tr(language, "Язык", "Language"),
      status: video.defaultLanguage ? "pass" : "warning",
      evidence: video.defaultLanguage
        ? languageTagLabel(video.defaultLanguage, language)
        : tr(language, "Язык не указан", "Language not set"),
      source: "youtube_data_api",
    },
    {
      id: "category",
      label: tr(language, "Категория", "Category"),
      status: video.categoryId ? "pass" : "warning",
      evidence: video.categoryId
        ? youtubeCategoryLabel(video.categoryId, language)
        : tr(language, "Категория не указана", "Category not set"),
      source: "youtube_data_api",
    },
  ];
  const unavailable: SeoChecklistItem[] = [
    "playlist",
    "end-screens",
    "cards",
    "pinned-comment",
  ].map((id) => ({
    id,
    label:
      id === "playlist"
        ? tr(language, "Плейлист", "Playlist")
        : id === "end-screens"
          ? tr(language, "Конечные заставки", "End screens")
          : id === "cards"
            ? tr(language, "Подсказки", "Cards")
            : tr(language, "Закреплённый комментарий", "Pinned comment"),
    status: "unknown",
    evidence: tr(
      language,
      "Не предоставляется текущим публичным API",
      "Not available from the current public API",
    ),
    source: "not_available",
  }));
  const checked = known.filter((item) => item.status !== "unknown").length;
  const passed = known.filter((item) => item.status === "pass").length;
  return {
    score: checked > 0 ? Math.round((passed / checked) * 100) : 0,
    checked,
    passed,
    items: [...known, ...unavailable],
  };
}
