import { describe, expect, it } from "vitest";
import {
  fileSlug,
  formatBytes,
  headlineFromTitle,
  headlinePlainText,
  hitThumbnailElement,
  JPEG_QUALITY_STEPS,
  matchesSearch,
  normalizeStyle,
  parseHeadline,
  readableInk,
  sameDesign,
  searchText,
  toggleHeadlineWord,
  wrapWords,
  YOUTUBE_THUMBNAIL_MAX_BYTES,
  youtubeSafeJpeg,
  type ThumbnailDesign,
} from "../src/options/editor-utils";

describe("headlineFromTitle", () => {
  it("keeps the part before a title separator", () => {
    expect(headlineFromTitle("Minecraft Mobs Evolution: 2009 to 2026!", 34)).toBe(
      "Minecraft Mobs Evolution",
    );
    expect(headlineFromTitle("Обзор новинок — выпуск 12", 34)).toBe("Обзор новинок");
  });

  it("does not treat a hyphen inside a word as a separator", () => {
    // The old split on /[:—|-]/ turned "Pre-launch" into "Pre".
    expect(headlineFromTitle("Pre-launch review of the mod", 34)).toBe(
      "Pre-launch review of the mod",
    );
  });

  it("cuts at a word boundary, not mid-word", () => {
    const headline = headlineFromTitle(
      "Я построил самую длинную железную дорогу в выживании за 100 дней",
      34,
    );
    expect(headline.length).toBeLessThanOrEqual(34);
    expect(headline).toBe("Я построил самую длинную железную");
  });

  it("falls back to a hard cut when there is no usable space", () => {
    expect(headlineFromTitle("Суперкалифраджилистикэкспиалидоциус", 10)).toHaveLength(
      10,
    );
  });
});

describe("fileSlug", () => {
  it("keeps Cyrillic and digits, joins everything else with hyphens", () => {
    expect(fileSlug("Секретная комната: часть 2!")).toBe("секретная-комната-часть-2");
  });

  it("never returns an empty name or a trailing hyphen", () => {
    expect(fileSlug("!!!")).toBe("thumbnail");
    expect(fileSlug("a".repeat(47) + " b")).not.toMatch(/-$/);
  });
});

describe("youtubeSafeJpeg", () => {
  const blobOfSize = (size: number) => new Blob([new Uint8Array(size)]);

  it("keeps the first quality when it already fits", async () => {
    const result = await youtubeSafeJpeg(async () => blobOfSize(900_000));
    expect(result.quality).toBe(0.95);
  });

  it("steps quality down only until the file fits the 2 MB limit", async () => {
    const tried: number[] = [];
    const result = await youtubeSafeJpeg(async (quality) => {
      tried.push(quality);
      return blobOfSize(quality > 0.85 ? 2_600_000 : 1_500_000);
    });
    expect(result.quality).toBe(0.84);
    expect(result.blob.size).toBeLessThanOrEqual(YOUTUBE_THUMBNAIL_MAX_BYTES);
    expect(tried).toEqual([0.95, 0.92, 0.88, 0.84]);
  });

  it("returns the smallest attempt when nothing fits", async () => {
    const result = await youtubeSafeJpeg(async () => blobOfSize(3_000_000));
    expect(result.quality).toBe(JPEG_QUALITY_STEPS.at(-1));
  });
});

describe("search", () => {
  it("folds case and ё", () => {
    expect(searchText("  ЁЛКА   Майнкрафт ")).toBe("елка майнкрафт");
  });

  it("requires every word, in any order", () => {
    const title = "Minecraft Mobs Evolution: 2009 to 2026!";
    expect(matchesSearch("2026 mobs", title)).toBe(true);
    expect(matchesSearch("mobs 2030", title)).toBe(false);
    expect(matchesSearch("   ", title)).toBe(true);
  });
});

describe("formatBytes / sameDesign", () => {
  it("formats sizes in the interface language", () => {
    expect(formatBytes(2.5 * 1024 * 1024, "ru")).toBe("2.50 МБ");
    expect(formatBytes(300 * 1024, "en")).toBe("300 KB");
  });

  it("compares designs field by field", () => {
    const design = {
      format: "16:9",
      headline: "A",
      subline: "",
      font: "heavy",
      uppercase: true,
      elements: [
        {
          id: "a",
          kind: "arrow",
          x: 70,
          y: 40,
          size: 18,
          rotation: 0,
          color: "#ff3b30",
          text: "",
        },
      ],
      fontSize: 94,
      textX: 50,
      textY: 66,
      textColor: "#fff",
      accentColor: "#ffd23f",
      brightness: 100,
      contrast: 110,
      saturation: 120,
      zoom: 100,
      overlay: 22,
      textBackdrop: 24,
      headlineWidth: 78,
      lineSpacing: 104,
      strokeStrength: 13,
      shadowStrength: 72,
      align: "center",
      fitMode: "fill",
      focusX: 50,
      focusY: 50,
      backgroundBlur: 18,
      vignette: 18,
      flipHorizontal: false,
    } satisfies ThumbnailDesign;
    expect(sameDesign(design, { ...design })).toBe(true);
    expect(sameDesign(design, { ...design, zoom: 101 })).toBe(false);
    // History round-trips designs through JSON: equal content must compare
    // equal even though the element array is a different object.
    expect(sameDesign(design, JSON.parse(JSON.stringify(design)))).toBe(true);
    expect(
      sameDesign(design, {
        ...design,
        elements: [{ ...design.elements[0]!, x: 71 }],
      }),
    ).toBe(false);
  });
});

describe("headline accents", () => {
  it("marks words wrapped in asterisks", () => {
    expect(parseHeadline("ЭТО *НЕВОЗМОЖНО* сделать")).toEqual([
      { text: "ЭТО", accent: false },
      { text: "НЕВОЗМОЖНО", accent: true },
      { text: "сделать", accent: false },
    ]);
    expect(parseHeadline("*очень круто* да").map((word) => word.accent)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("toggles one word and keeps neighbouring accents in one span", () => {
    expect(toggleHeadlineWord("я построил дорогу", 1)).toBe("я *построил* дорогу");
    expect(toggleHeadlineWord("я *построил* дорогу", 2)).toBe("я *построил дорогу*");
    expect(toggleHeadlineWord("я *построил дорогу*", 1)).toBe("я построил *дорогу*");
    expect(headlinePlainText("я *построил дорогу*")).toBe("я построил дорогу");
  });
});

describe("wrapWords", () => {
  const measure = (text: string) => text.length * 10;

  it("returns word indexes per line", () => {
    expect(wrapWords(measure, ["aa", "bb", "cc"], 50, 3)).toEqual({
      lines: [[0, 1], [2]],
      complete: true,
    });
  });

  it("reports overflow in lines or in a single long word", () => {
    expect(wrapWords(measure, ["aaaa", "bbbb", "cccc"], 40, 2).complete).toBe(false);
    expect(wrapWords(measure, ["aaaaaaaa"], 40, 3).complete).toBe(false);
  });
});

describe("elements and styles", () => {
  const circle = {
    id: "c",
    kind: "circle" as const,
    x: 50,
    y: 50,
    size: 10,
    rotation: 0,
    color: "#ff0000",
    text: "",
  };

  it("hit-tests the topmost element under the pointer", () => {
    const badge = { ...circle, id: "b", kind: "badge" as const, text: "NEW" };
    expect(hitThumbnailElement([circle, badge], 640, 360, 1280, 720)?.id).toBe("b");
    expect(hitThumbnailElement([circle], 50, 50, 1280, 720)).toBeUndefined();
  });

  it("picks readable ink for a background colour", () => {
    expect(readableInk("#ffd23f")).toBe("#111111");
    expect(readableInk("#1b1b2a")).toBe("#ffffff");
  });

  it("round-trips a style and rejects a malformed one", () => {
    const style = {
      font: "modern",
      uppercase: false,
      textColor: "#ffffff",
      accentColor: "#ffd23f",
      strokeStrength: 13,
      shadowStrength: 72,
      textBackdrop: 24,
      lineSpacing: 104,
      align: "left",
      overlay: 22,
      vignette: 18,
      brightness: 100,
      contrast: 110,
      saturation: 120,
    };
    expect(normalizeStyle(style)).toEqual(style);
    expect(normalizeStyle({ ...style, font: "comic" })).toBeNull();
    expect(normalizeStyle({ ...style, textColor: "red" })).toBeNull();
  });
});
