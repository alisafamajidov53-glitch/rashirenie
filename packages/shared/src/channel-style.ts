import { median } from "./analytics.js";
import type { ChannelSummary, VideoSummary } from "./types.js";

export const CHANNEL_CONTEXT_MAX_LENGTH = 4_000;

export interface ChannelStyleSource {
  channel: Pick<ChannelSummary, "title" | "subscribers">;
  videos: Array<
    Pick<VideoSummary, "id" | "title" | "views" | "publishedAt" | "tags"> &
      Partial<Pick<VideoSummary, "contentType">>
  >;
}

const DAY_MS = 86_400_000;
const EMOJI = /\p{Extended_Pictographic}/u;
const CAPS_WORD = /(?<![\p{L}\p{N}])\p{Lu}{3,}(?![\p{L}\p{N}])/u;

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Compact, provider-neutral description of what already works on the creator's
 * channel: best and weakest titles relative to the channel median, title style
 * habits and tags that recur on top videos. It lets the model match the
 * channel's voice instead of producing generic titles. Titles are public data.
 */
export function buildChannelStyleContext(
  source: ChannelStyleSource | null | undefined,
  options: { excludeVideoId?: string | undefined; now?: number } = {},
): string {
  const now = options.now ?? Date.now();
  const videos = (source?.videos ?? []).filter(
    (video) =>
      video &&
      typeof video.title === "string" &&
      video.title.trim() &&
      Number.isFinite(video.views) &&
      video.id !== options.excludeVideoId,
  );
  if (!source || videos.length < 3) return "";
  const medianViews = Math.max(1, median(videos.map((video) => video.views)));
  const ratio = (views: number) => views / medianViews;
  const describe = (video: (typeof videos)[number]) => {
    const format = video.contentType === "shorts" ? ", Shorts" : "";
    return `- "${video.title.trim().slice(0, 110)}" — ${video.views} views (×${ratio(video.views).toFixed(1)} median${format})`;
  };
  const byViews = [...videos].sort((left, right) => right.views - left.views);
  const top = byViews.slice(0, Math.min(6, Math.ceil(videos.length / 2)));
  // New uploads have not had time to collect views; never call them weak.
  const matured = byViews.filter((video) => {
    const published = Date.parse(video.publishedAt);
    return !Number.isFinite(published) || now - published > 7 * DAY_MS;
  });
  const weak =
    videos.length >= 8
      ? matured
          .slice(-3)
          .filter((video) => !top.includes(video) && ratio(video.views) < 0.6)
      : [];

  const titles = videos.map((video) => video.title.trim());
  const share = (predicate: (title: string) => boolean) =>
    percent(titles.filter(predicate).length, titles.length);
  const averageLength = Math.round(
    titles.reduce((sum, title) => sum + [...title].length, 0) / titles.length,
  );
  const topAverageLength = Math.round(
    top.reduce((sum, video) => sum + [...video.title.trim()].length, 0) / top.length,
  );
  const shorts = videos.filter((video) => video.contentType === "shorts").length;

  const tagCounts = new Map<string, { label: string; count: number }>();
  for (const video of top) {
    for (const tag of new Set(
      (video.tags ?? []).map((value) => value.trim()).filter(Boolean),
    )) {
      const key = tag.toLocaleLowerCase();
      const entry = tagCounts.get(key) ?? { label: tag, count: 0 };
      entry.count += 1;
      tagCounts.set(key, entry);
    }
  }
  const recurringTags = [...tagCounts.values()]
    .filter((entry) => entry.count >= 2)
    .sort((left, right) => right.count - left.count)
    .slice(0, 12)
    .map((entry) => entry.label);

  const lines = [
    `Channel: "${source.channel.title.trim().slice(0, 100)}", ${source.channel.subscribers} subscribers; median views per recent video: ${Math.round(medianViews)} (sample of ${videos.length}).`,
    `Title habits: average ${averageLength} chars (top videos ${topAverageLength}); emoji in ${share((title) => EMOJI.test(title))}%, numbers in ${share((title) => /\p{N}/u.test(title))}%, questions in ${share((title) => /[?？]/u.test(title))}%, CAPS words in ${share((title) => CAPS_WORD.test(title))}%, brackets or "|" in ${share((title) => /[[\](|]/u.test(title))}%.`,
    shorts ? `Shorts among recent uploads: ${percent(shorts, videos.length)}%.` : "",
    "Best performing titles:",
    ...top.map(describe),
    ...(weak.length
      ? ["Weakest titles (avoid these patterns):", ...weak.map(describe)]
      : []),
    recurringTags.length
      ? `Tags repeated on top videos: ${recurringTags.join(", ")}.`
      : "",
  ].filter(Boolean);

  let text = "";
  for (const line of lines) {
    if (text.length + line.length + 1 > CHANNEL_CONTEXT_MAX_LENGTH) break;
    text += `${text ? "\n" : ""}${line}`;
  }
  return text;
}
