import { describe, expect, it } from "vitest";
import { calculateSeoChecklist, type VideoSummary } from "../src/index.js";

const video: VideoSummary = {
  id: "abc",
  title: "I Built a Complete Minecraft City in 7 Days",
  description:
    "A complete build diary with every major step and result.\n\n0:00 Start\n0:35 Foundation\n2:10 Final reveal\n\n#minecraft #build",
  tags: ["minecraft", "city", "build", "challenge", "survival"],
  thumbnailUrl: "https://i.ytimg.com/example.jpg",
  publishedAt: "2026-07-20T00:00:00.000Z",
  durationSeconds: 360,
  categoryId: "20",
  defaultLanguage: "en",
  captionsAvailable: true,
  views: 100,
  likes: 10,
  comments: 2,
  observedViewsLastHour: 0,
  observedMinutes: 0,
  observedViewsLast24Hours: 0,
  observedMinutes24Hours: 0,
  observedViewsLast48Hours: 0,
  observedMinutes48Hours: 0,
  viewsLast15Minutes: 0,
  observedMinutesLast15: 0,
  viewsPerMinuteLast15: 0,
  previous15MinutesViews: 0,
  previousObservedMinutes15: 0,
  previousViewsPerMinute15: 0,
  velocityTrendPercent: 0,
  analyticsViews28Days: 0,
  watchMinutes28Days: 0,
  averageViewPercentage28Days: 0,
  shares28Days: 0,
  subscribersGained28Days: 0,
  subscribersLost28Days: 0,
  analyticsAvailable28Days: false,
};

describe("SEO checklist", () => {
  it("checks available metadata and labels private Studio-only fields unknown", () => {
    const result = calculateSeoChecklist(video);
    expect(result.items.find((item) => item.id === "title")?.status).toBe("pass");
    expect(result.items.find((item) => item.id === "chapters")?.status).toBe("pass");
    expect(result.items.find((item) => item.id === "end-screens")?.status).toBe(
      "unknown",
    );
    expect(result.checked).toBe(9);
  });

  it("localizes the checklist and excludes Shorts-only non-applicable chapters", () => {
    const result = calculateSeoChecklist({ ...video, contentType: "shorts" }, "en");
    expect(result.items.find((item) => item.id === "title")?.label).toBe("Title");
    expect(result.items.find((item) => item.id === "chapters")).toMatchObject({
      status: "unknown",
      evidence: "Not applicable to Shorts",
    });
    expect(result.items.find((item) => item.id === "playlist")?.evidence).toBe(
      "Not available from the current public API",
    );
    expect(result.checked).toBe(8);
    expect(result.passed).toBeLessThanOrEqual(result.checked);
  });

  it("names the category and language instead of showing raw API codes", () => {
    const ru = calculateSeoChecklist(video, "ru");
    expect(ru.items.find((item) => item.id === "category")?.evidence).toBe(
      "Видеоигры · ID 20",
    );
    expect(ru.items.find((item) => item.id === "language")?.evidence).toBe(
      "Английский · en",
    );
    const en = calculateSeoChecklist({ ...video, categoryId: "999" }, "en");
    expect(en.items.find((item) => item.id === "category")?.evidence).toBe("ID 999");
    expect(en.items.find((item) => item.id === "language")?.evidence).toBe(
      "English · en",
    );
  });
});
