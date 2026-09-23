import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_STATE,
  classifyCommentText,
  normalizeWorkspaceState,
  parsePlannerCsv,
  serializePlannerCsv,
} from "../src/index.js";

describe("workspace storage", () => {
  it("normalizes imported planner data and rejects malformed rows", () => {
    const result = normalizeWorkspaceState({
      planner: [
        {
          id: " item-1 ",
          title: "  Publish tutorial ",
          status: "scheduled",
          publishAt: "2026-08-01T12:00:00Z",
          notes: "Ready",
          tags: ["guide", "guide", "=unsafe"],
          createdAt: "2026-07-28T00:00:00Z",
          updatedAt: "bad",
        },
        { title: "" },
      ],
      favoriteTitles: ["One", "One", "Two"],
    });
    expect(result.planner).toHaveLength(1);
    expect(result.planner[0]).toMatchObject({
      id: "item-1",
      title: "Publish tutorial",
      status: "scheduled",
    });
    expect(result.favoriteTitles).toEqual(["One", "Two"]);
  });

  it("returns a complete empty state for untrusted input", () => {
    expect(normalizeWorkspaceState(null)).toEqual(DEFAULT_WORKSPACE_STATE);
  });

  it("round-trips planner CSV with quotes, newlines and safe spreadsheet cells", () => {
    const [item] = normalizeWorkspaceState({
      planner: [
        {
          id: "plan-1",
          title: "=SUM(1,2)",
          status: "scheduled",
          publishAt: "2026-08-01T12:00:00Z",
          notes: 'Line one\nLine "two"',
          tags: ["guide", "launch"],
          createdAt: "2026-07-28T00:00:00Z",
          updatedAt: "2026-07-28T01:00:00Z",
        },
      ],
    }).planner;
    expect(item).toBeDefined();
    const csv = serializePlannerCsv(item ? [item] : []);
    expect(csv).toContain(`"\t=SUM(1,2)"`);
    expect(parsePlannerCsv(csv)).toEqual(item ? [item] : []);
  });

  it("rejects CSV without a title column", () => {
    expect(parsePlannerCsv("id,status\none,draft")).toEqual([]);
  });

  it("rejects CSV that would otherwise be silently truncated", () => {
    expect(() =>
      parsePlannerCsv(
        `title\n${Array.from({ length: 501 }, (_, index) => `Video ${index}`).join("\n")}`,
      ),
    ).toThrow("more than 500 rows");
    expect(() => parsePlannerCsv(`title\n${"a".repeat(2_000_000)}`)).toThrow(
      "too large",
    );
  });
});

describe("comment classification", () => {
  it("separates questions, likely spam and sentiment without publishing", () => {
    expect(classifyCommentText("How did you build this? Awesome work!")).toEqual({
      isQuestion: true,
      isLikelySpam: false,
      sentiment: "positive",
    });
    expect(
      classifyCommentText(
        "Crypto giveaway https://one.example https://two.example WhatsApp",
      ).isLikelySpam,
    ).toBe(true);
  });
});
