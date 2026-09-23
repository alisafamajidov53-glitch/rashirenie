import { describe, expect, it } from "vitest";
import { calculateSeoScore } from "../src/seo.js";

describe("calculateSeoScore", () => {
  it("rewards complete, keyword-focused metadata", () => {
    const result = calculateSeoScore(
      {
        title: "Как настроить YouTube SEO: понятный план для нового канала",
        description:
          "YouTube SEO помогает зрителям найти ролик. В этом подробном руководстве разберём исследование темы, заголовок, описание, теги и проверку результата. ".repeat(
            4,
          ),
        tags: ["youtube seo", "seo", "youtube", "продвижение", "видеомаркетинг"],
        topic: "YouTube SEO",
        language: "ru",
      },
      ["youtube seo", "заголовок", "описание"],
    );

    expect(result.total).toBeGreaterThanOrEqual(75);
    expect(result.label).toBe("high");
  });

  it("keeps an empty draft in the low band", () => {
    const result = calculateSeoScore({
      title: "",
      description: "",
      tags: [],
      language: "ru",
    });

    expect(result.total).toBeLessThan(50);
    expect(result.label).toBe("low");
  });
});
