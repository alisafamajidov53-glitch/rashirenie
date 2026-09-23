import { describe, expect, it } from "vitest";
import { calculateTitleCandidateScore } from "../src/seo.js";

describe("calculateTitleCandidateScore", () => {
  it("recognizes Cyrillic hook words (JS \\b is ASCII-only)", () => {
    const hooked = calculateTitleCandidateScore("Почему я проверил 5 ошибок новичков");
    const flat = calculateTitleCandidateScore("Обзор нового рабочего стола и техники");
    expect(hooked.factors.hook).toBeGreaterThanOrEqual(16);
    expect(hooked.factors.hook).toBeGreaterThan(flat.factors.hook);
    // Digits are not "shouting" caps words.
    expect(calculateTitleCandidateScore("2026 год 1000 идей").factors.clarity).toBe(20);
  });

  it("rewards a clear title with an early keyword and concrete hook", () => {
    const strong = calculateTitleCandidateScore(
      "Minecraft Animation: I Recreated the Impossible Scene",
      ["minecraft animation", "minecraft"],
      { topic: "Minecraft animation" },
    );
    const weak = calculateTitleCandidateScore(
      "WOW!!! YOU WILL NOT BELIEVE THIS AMAZING THING!!!",
      ["minecraft animation", "minecraft"],
      { topic: "Minecraft animation" },
    );

    expect(strong.total).toBeGreaterThan(weak.total);
    expect(strong.factors.keywords).toBeGreaterThan(weak.factors.keywords);
    expect(strong.label).toBe("high");
  });

  it("always returns a percentage within the valid range", () => {
    const score = calculateTitleCandidateScore("", [], {});
    expect(score.total).toBe(0);
    expect(score.label).toBe("low");
    expect(score.total).toBeLessThanOrEqual(100);
  });
});
