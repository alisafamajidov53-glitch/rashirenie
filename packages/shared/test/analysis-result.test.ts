import { describe, expect, it } from "vitest";
import { normalizeAnalysisResult, normalizeWorkspaceState } from "../src/index.js";

// Shape written by an earlier build: no titleScores, seo without factors'
// current fields, contentInsights without thumbnailMoments, no scriptOutline.
const legacyResult = {
  titles: ["Old title one", "Old title two"],
  description: "Old description",
  tags: ["old"],
  keywords: ["old"],
  thumbnailIdeas: ["idea"],
  recommendations: ["rec"],
  contentInsights: { summary: "s", keyMoments: [] },
  provider: "gemini",
};

describe("normalizeAnalysisResult", () => {
  it("fills every list the UI reads and recomputes scores", () => {
    const result = normalizeAnalysisResult(legacyResult)!;
    expect(result.titleScores).toHaveLength(2);
    expect(result.titleScores[0]?.title).toBe("Old title one");
    expect(result.seo.factors.length).toBeGreaterThan(0);
    expect(result.scriptOutline).toEqual([]);
    expect(result.shortsIdeas).toEqual([]);
    expect(result.hashtags).toEqual([]);
    expect(result.contentInsights.thumbnailMoments).toEqual([]);
    expect(result.contentInsights.visualElements).toEqual([]);
    expect(result.provider).toBe("gemini");
  });

  it("rejects results without usable titles", () => {
    expect(normalizeAnalysisResult({ titles: [] })).toBeNull();
    expect(normalizeAnalysisResult("nope")).toBeNull();
  });

  it("repairs legacy AI history when the workspace is loaded", () => {
    const workspace = normalizeWorkspaceState({
      aiHistory: [
        {
          id: "analysis-1",
          task: "video_optimization",
          topic: "t",
          createdAt: "2026-08-01T10:00:00.000Z",
          result: legacyResult,
        },
      ],
    });
    expect(workspace.aiHistory).toHaveLength(1);
    expect(workspace.aiHistory[0]?.result.contentInsights.thumbnailMoments).toEqual([]);
    expect(workspace.aiHistory[0]?.result.titleScores).toHaveLength(2);
  });
});
