export interface AiModelOption {
  id: string;
  label: string;
  description: string;
  stability: "stable" | "preview" | "dynamic";
  recommended?: boolean;
}

export interface AiModelCatalog {
  gemini: AiModelOption[];
  groq: AiModelOption[];
  twelveLabs: AiModelOption[];
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_TWELVELABS_MODEL = "pegasus1.5";

export const GEMINI_MODEL_OPTIONS: AiModelOption[] = [
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    description: "Самая умная Flash: лучшее понимание видео, звука и текста в кадре",
    stability: "stable",
    recommended: true,
  },
  {
    id: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    description: "Стабильная мультимодальная модель, агентный разбор длинных видео",
    stability: "stable",
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    description: "Стабильная: качество, скорость и мультимодальность",
    stability: "stable",
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Предыдущее поколение, стабильный reasoning",
    stability: "stable",
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    description: "Максимальное качество для сложного анализа, preview",
    stability: "preview",
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    description: "Актуальная быстрая и экономичная стабильная модель",
    stability: "stable",
  },
  {
    id: "gemini-flash-latest",
    label: "Gemini Flash Latest",
    description: "Автоматически переключается на самый новый Flash-релиз",
    stability: "dynamic",
  },
];

export const GROQ_MODEL_OPTIONS: AiModelOption[] = [
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "Флагманская production-модель Groq для максимального качества",
    stability: "stable",
    recommended: true,
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    description: "Быстрый и экономичный production reasoning",
    stability: "stable",
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile",
    description: "Стабильная универсальная большая модель",
    stability: "stable",
  },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    description: "Минимальная задержка и стоимость",
    stability: "stable",
  },
];

export const TWELVELABS_MODEL_OPTIONS: AiModelOption[] = [
  {
    id: "pegasus1.5",
    label: "Pegasus 1.5",
    description:
      "Нативное понимание видео, звука, текста в кадре и временной структуры",
    stability: "stable",
    recommended: true,
  },
];

export function normalizeGeminiModel(model: string): string {
  const normalized = model.trim().replace(/^models\//, "");
  // Gemini 1.x/2.x are shut down or access-limited; move stored choices forward.
  if (!normalized || /^gemini-(1|2)(\.|-)/i.test(normalized)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return normalized;
}

export function normalizeGroqModel(model: string): string {
  const normalized = model.trim();
  return normalized || DEFAULT_GROQ_MODEL;
}

export function normalizeTwelveLabsModel(model: string): string {
  // Pegasus 1.2 was removed by TwelveLabs on 2026-08-18, so it maps to 1.5 too.
  const normalized = model.trim().toLowerCase();
  return TWELVELABS_MODEL_OPTIONS.some((option) => option.id === normalized)
    ? normalized
    : DEFAULT_TWELVELABS_MODEL;
}
