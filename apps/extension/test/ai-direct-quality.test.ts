import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXTENSION_SETTINGS,
  type ExtensionSettings,
} from "@channelpilot/shared";
import {
  analyzeTextDirect,
  analyzeYouTubeVideoDirect,
  youtubeChapterBlock,
} from "../src/lib/ai-direct";

const settings: ExtensionSettings = {
  ...DEFAULT_EXTENSION_SETTINGS,
  geminiApiKey: "test-gemini-key",
  preferredProvider: "gemini",
};

const longTags = Array.from(
  { length: 40 },
  (_, index) => `minecraft railway build ${index}`,
);

function modelPayload(overrides: Record<string, unknown> = {}) {
  return {
    titles: [
      '1. "Я построил самую длинную железную дорогу."',
      "Поезд <через> весь мир Minecraft",
      "Как я проложил 10 000 блоков рельсов",
    ],
    description: "Строю железную дорогу через весь мир.",
    shortDescription: "Строю железную дорогу.",
    tags: ["#minecraft", "Minecraft", ...longTags],
    hashtags: ["minecraft", "#Minecraft", "#железная дорога", "#a", "#b", "#c", "#d"],
    keywords: ["minecraft", "железная дорога"],
    pinnedComment: "Какой маршрут построить дальше?",
    thumbnailPrompt: "",
    scriptOutline: [],
    shortsIdeas: [],
    thumbnailIdeas: [],
    recommendations: [],
    contentInsights: {
      summary: "Строительство железной дороги.",
      suggestedChapters: [
        { timestampSeconds: 0, title: "Вступление" },
        { timestampSeconds: 35, title: "Стройка" },
        { timestampSeconds: 125, title: "Финал" },
      ],
    },
    ...overrides,
  };
}

function geminiReply(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

type GeminiRequest = {
  contents: Array<{
    parts: Array<{ text?: string; fileData?: { fileUri: string } }>;
  }>;
};

const requestBody = (call: unknown[]): GeminiRequest =>
  JSON.parse(String((call[1] as RequestInit).body)) as GeminiRequest;
const promptOf = (call: unknown[]): string =>
  requestBody(call)
    .contents[0]!.parts.map((part) => part.text ?? "")
    .join("");

beforeEach(() => {
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: vi.fn(async () => ({ ok: true, data: {} })) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI prompt context", () => {
  it("keeps the task, title mode and channel style instead of dropping them", async () => {
    const fetchMock = vi.fn(async () => geminiReply(modelPayload()));
    vi.stubGlobal("fetch", fetchMock);
    await analyzeTextDirect(
      {
        title: "Ответ",
        description: "Классное видео, а сколько времени ушло?",
        tags: [],
        language: "ru",
        task: "comment_reply",
        titleMode: "story",
      },
      settings,
    );
    await analyzeTextDirect(
      {
        title: "Железная дорога в Minecraft",
        description: "",
        tags: [],
        language: "ru",
        titleMode: "story",
        channelContext: 'Channel: "Rail Lab", 1200 subscribers',
      },
      settings,
    );
    const replyPrompt = promptOf(fetchMock.mock.calls[0]!);
    expect(replyPrompt).toContain("подготовить ответ зрителю");
    const videoPrompt = promptOf(fetchMock.mock.calls[1]!);
    expect(videoPrompt).toContain("Режим заголовков: story");
    expect(videoPrompt).toContain('Channel: "Rail Lab"');
    expect(videoPrompt).toContain("Правила YouTube");
  });
});

describe("YouTube post-processing", () => {
  it("cleans titles, fits tag and hashtag limits and adds chapters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => geminiReply(modelPayload())),
    );
    const result = await analyzeTextDirect(
      { title: "Железная дорога", description: "", tags: [], language: "ru" },
      settings,
    );
    expect(result.titles).toContain("Я построил самую длинную железную дорогу");
    expect(result.titles.every((title) => !/[<>]/.test(title))).toBe(true);
    // Real model titles only need padding up to 10 variants.
    expect(result.titles).toHaveLength(10);

    const tagCost = result.tags.reduce(
      (sum, tag, index) =>
        sum + tag.length + (tag.includes(" ") ? 2 : 0) + (index ? 1 : 0),
      0,
    );
    expect(tagCost).toBeLessThanOrEqual(500);
    expect(result.tags[0]).toBe("minecraft");
    expect(result.tags.filter((tag) => tag.toLowerCase() === "minecraft")).toHaveLength(
      1,
    );

    expect(result.hashtags.length).toBeLessThanOrEqual(5);
    expect(result.hashtags).toContain("#железнаядорога");
    expect(result.hashtags.filter((tag) => /^#minecraft$/i.test(tag))).toHaveLength(1);

    expect(result.description).toContain(
      "Таймкоды:\n0:00 Вступление\n0:35 Стройка\n2:05 Финал",
    );
  });

  it("does not duplicate chapters that the description already lists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiReply(modelPayload({ description: "Лид.\n\n0:00 Старт\n1:00 Итог" })),
      ),
    );
    const result = await analyzeTextDirect(
      { title: "Железная дорога", description: "", tags: [], language: "ru" },
      settings,
    );
    expect(result.description).not.toContain("Таймкоды:");
  });

  it("only builds chapter blocks YouTube will accept", () => {
    const chapter = (timestampSeconds: number, title = "Часть") => ({
      timestampSeconds,
      title,
    });
    expect(youtubeChapterBlock([chapter(5), chapter(40), chapter(90)], "ru")).toBe("");
    expect(youtubeChapterBlock([chapter(0), chapter(40)], "ru")).toBe("");
    // A chapter shorter than 10 seconds is dropped, leaving too few.
    expect(youtubeChapterBlock([chapter(0), chapter(4), chapter(30)], "ru")).toBe("");
    expect(
      youtubeChapterBlock(
        [chapter(0, "Intro"), chapter(600, "Build"), chapter(3_725, "End")],
        "en",
      ),
    ).toBe("Chapters:\n0:00:00 Intro\n0:10:00 Build\n1:02:05 End");
  });
});

describe("analysis of a published video by link", () => {
  it("lets Gemini watch the public YouTube URL", async () => {
    const fetchMock = vi.fn(async () => geminiReply(modelPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeYouTubeVideoDirect(
      { title: "", description: "", tags: [], language: "ru" },
      "dQw4w9WgXcQ",
      settings,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = requestBody(fetchMock.mock.calls[0]!);
    expect(body.contents[0]!.parts[0]!.fileData?.fileUri).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(result.provider).toBe("gemini");
    expect(result.providerNotice).toBeUndefined();
  });

  it("falls back to text analysis when the video cannot be opened", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Video is private" } }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(geminiReply(modelPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeYouTubeVideoDirect(
      { title: "Железная дорога", description: "", tags: [], language: "ru" },
      "dQw4w9WgXcQ",
      settings,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      requestBody(fetchMock.mock.calls[1]!).contents[0]!.parts[0]!.fileData,
    ).toBeUndefined();
    expect(result.providerNotice).toContain("публичные");
  });
});
