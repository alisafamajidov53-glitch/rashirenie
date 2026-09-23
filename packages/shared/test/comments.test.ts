import { describe, expect, it } from "vitest";
import { classifyCommentText } from "../src/comments.js";

describe("comment classification", () => {
  it("classifies the same spam text deterministically across calls", () => {
    const text = "Telegram giveaway https://spam.example https://spam2.example";
    const first = classifyCommentText(text);
    const second = classifyCommentText(text);

    expect(first).toEqual(second);
    expect(first.isLikelySpam).toBe(true);
  });

  it("detects questions and simple sentiment without publishing decisions", () => {
    expect(classifyCommentText("Как вы сняли этот отличный кадр?")).toMatchObject({
      isQuestion: true,
      sentiment: "positive",
      isLikelySpam: false,
    });
    expect(classifyCommentText("This was boring and terrible")).toMatchObject({
      isQuestion: false,
      sentiment: "negative",
    });
  });
});
