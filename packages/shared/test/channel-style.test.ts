import { describe, expect, it } from "vitest";
import {
  buildChannelStyleContext,
  CHANNEL_CONTEXT_MAX_LENGTH,
} from "../src/channel-style.js";
import { youtubeVideoIdFromUrl } from "../src/youtube-url.js";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function video(
  id: string,
  title: string,
  views: number,
  age = 30,
  tags: string[] = [],
) {
  return { id, title, views, publishedAt: daysAgo(age), tags };
}

describe("buildChannelStyleContext", () => {
  const source = {
    channel: { title: "Rail Lab", subscribers: 1_200 },
    videos: [
      video("a", "Я построил ГИГАНТСКИЙ вокзал 🚂", 90_000, 40, [
        "minecraft",
        "railway",
      ]),
      video("b", "10 ошибок в Minecraft", 40_000, 60, ["minecraft", "railway"]),
      video("c", "Почему поезда ломаются?", 30_000, 20),
      video("d", "Обычная стройка", 20_000, 50),
      video("e", "Стрим", 15_000, 45),
      video("f", "Скучный влог", 900, 30),
      video("g", "Ещё один влог", 700, 25),
      video("h", "Новый ролик", 50, 1),
    ],
  };

  it("summarizes the best and weakest titles and the title habits", () => {
    const text = buildChannelStyleContext(source, { now: NOW });
    expect(text).toContain('Channel: "Rail Lab"');
    expect(text.indexOf("ГИГАНТСКИЙ")).toBeLessThan(text.indexOf("10 ошибок"));
    const weak = text.split("Weakest titles")[1] ?? "";
    expect(weak).toContain("Скучный влог");
    // A one-day-old upload has not had time to perform; it is never "weak".
    expect(weak).not.toContain("Новый ролик");
    expect(text).toContain("Tags repeated on top videos: minecraft, railway.");
    expect(text).toMatch(/emoji in 13%/);
    expect(text.length).toBeLessThanOrEqual(CHANNEL_CONTEXT_MAX_LENGTH);
  });

  it("excludes the video being edited and needs a real sample", () => {
    expect(
      buildChannelStyleContext(source, { excludeVideoId: "a", now: NOW }),
    ).not.toContain("ГИГАНТСКИЙ");
    expect(
      buildChannelStyleContext({ ...source, videos: source.videos.slice(0, 2) }),
    ).toBe("");
    expect(buildChannelStyleContext(null)).toBe("");
  });
});

describe("youtubeVideoIdFromUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://studio.youtube.com/video/dQw4w9WgXcQ/edit", "dQw4w9WgXcQ"],
  ])("reads %s", (url, id) => {
    expect(youtubeVideoIdFromUrl(url)).toBe(id);
  });

  it.each([
    "dQw4w9WgXcQ",
    "Я построил вокзал",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/@channel",
  ])("ignores %s", (value) => {
    expect(youtubeVideoIdFromUrl(value)).toBeNull();
  });
});
