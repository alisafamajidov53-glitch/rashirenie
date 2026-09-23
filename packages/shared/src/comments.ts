import type { YouTubeComment } from "./types.js";

const NEGATIVE_WORDS = [
  "bad",
  "boring",
  "hate",
  "awful",
  "terrible",
  "worst",
  "плохо",
  "скучно",
  "ненавиж",
  "ужас",
  "худш",
  "обман",
];
const POSITIVE_WORDS = [
  "great",
  "love",
  "awesome",
  "amazing",
  "thanks",
  "спасибо",
  "круто",
  "люблю",
  "супер",
  "отлич",
];
const SPAM_PATTERNS = [
  /(?:https?:\/\/|www\.)\S+/iu,
  /\b(?:telegram|whatsapp|crypto|forex|giveaway)\b/iu,
  /(?:подпишись|заработок|инвестици|розыгрыш)/iu,
];

function hits(text: string, values: string[]): number {
  const normalized = text.toLocaleLowerCase();
  return values.reduce(
    (total, value) => total + (normalized.includes(value) ? 1 : 0),
    0,
  );
}

export function classifyCommentText(
  text: string,
): Pick<YouTubeComment, "isQuestion" | "isLikelySpam" | "sentiment"> {
  const compact = text.trim().slice(0, 10_000);
  const negative = hits(compact, NEGATIVE_WORDS);
  const positive = hits(compact, POSITIVE_WORDS);
  const links = (compact.match(/(?:https?:\/\/|www\.)\S+/giu) ?? []).length;
  const spamSignals = SPAM_PATTERNS.reduce(
    (total, pattern) => total + (pattern.test(compact) ? 1 : 0),
    0,
  );
  const repeated =
    /(.)\1{8,}/u.test(compact) || /\b(\p{L}{3,})\b(?:\s+\1\b){3,}/giu.test(compact);
  return {
    isQuestion:
      compact.includes("?") ||
      /^(?:как|почему|когда|где|what|why|how|when|where)\b/iu.test(compact),
    isLikelySpam:
      links >= 2 || spamSignals >= 2 || (links >= 1 && compact.length < 80) || repeated,
    sentiment:
      negative > positive ? "negative" : positive > negative ? "positive" : "neutral",
  };
}
