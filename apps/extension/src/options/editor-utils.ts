import type { SupportedLanguage } from "@channelpilot/shared";

/**
 * Pure helpers for the thumbnail editor and the video table.
 *
 * Kept out of main.tsx so they can be tested without mounting the dashboard:
 * main.tsx renders itself on import.
 */

export type ThumbnailFormat = "16:9" | "9:16";

/**
 * Headline typefaces. Only fonts that ship with the operating system and carry
 * Cyrillic are listed, so a Russian headline never falls back mid-word.
 */
export type ThumbnailFont = "heavy" | "condensed" | "modern" | "serif";
export const THUMBNAIL_FONTS: Record<
  ThumbnailFont,
  { family: string; weight: number; label: readonly [ru: string, en: string] }
> = {
  heavy: {
    family: '"Arial Black", "Arial", sans-serif',
    weight: 900,
    label: ["Жирный", "Heavy"],
  },
  condensed: {
    family: 'Impact, "Haettenschweiler", "Arial Narrow", sans-serif',
    weight: 400,
    label: ["Узкий", "Condensed"],
  },
  modern: {
    family: '"Segoe UI", "Helvetica Neue", Roboto, system-ui, sans-serif',
    weight: 800,
    label: ["Современный", "Modern"],
  },
  serif: {
    family: 'Georgia, "Times New Roman", serif',
    weight: 700,
    label: ["С засечками", "Serif"],
  },
};

export type ThumbnailElementKind = "arrow" | "circle" | "emoji" | "badge";

/**
 * A graphic placed over the frame: the arrows, rings, emoji and labels that
 * most YouTube thumbnails lean on. Position is the centre, in percent of the
 * canvas; size is in percent of the canvas's shorter side.
 */
export interface ThumbnailElement {
  id: string;
  kind: ThumbnailElementKind;
  x: number;
  y: number;
  size: number;
  rotation: number;
  color: string;
  text: string;
}

/** Everything about a thumbnail design that undo/redo restores. */
export interface ThumbnailDesign {
  format: ThumbnailFormat;
  headline: string;
  subline: string;
  font: ThumbnailFont;
  uppercase: boolean;
  elements: ThumbnailElement[];
  fontSize: number;
  textX: number;
  textY: number;
  textColor: string;
  accentColor: string;
  brightness: number;
  contrast: number;
  saturation: number;
  zoom: number;
  overlay: number;
  textBackdrop: number;
  headlineWidth: number;
  lineSpacing: number;
  strokeStrength: number;
  shadowStrength: number;
  align: CanvasTextAlign;
  fitMode: "smart" | "fill";
  focusX: number;
  focusY: number;
  backgroundBlur: number;
  vignette: number;
  flipHorizontal: boolean;
}

export function sameDesign(left: ThumbnailDesign, right: ThumbnailDesign): boolean {
  return (Object.keys(left) as (keyof ThumbnailDesign)[]).every((key) => {
    const a = left[key];
    const b = right[key];
    // Designs are round-tripped through JSON for the history, so arrays
    // (elements) are never the same object twice: compare them by content.
    return typeof a === "object" && a !== null
      ? JSON.stringify(a) === JSON.stringify(b)
      : a === b;
  });
}

export interface HeadlineWord {
  text: string;
  accent: boolean;
}

/**
 * Splits a headline into words, marking those wrapped in *asterisks* as
 * accented: "ЭТО *НЕВОЗМОЖНО*" colours the second word. A span may cover
 * several words ("*очень круто*"); an unmatched asterisk runs to the end.
 */
export function parseHeadline(headline: string): HeadlineWord[] {
  const words: HeadlineWord[] = [];
  let accent = false;
  let current = "";
  let currentAccent = false;
  const flush = () => {
    if (current) words.push({ text: current, accent: currentAccent });
    current = "";
  };
  for (const character of headline) {
    if (character === "*") {
      accent = !accent;
      continue;
    }
    if (/\s/u.test(character)) {
      flush();
      continue;
    }
    if (!current) currentAccent = accent;
    else if (accent) currentAccent = true;
    current += character;
  }
  flush();
  return words;
}

/** The inverse of parseHeadline: neighbouring accented words share a span. */
export function serializeHeadline(words: HeadlineWord[]): string {
  const parts: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const opens = word.accent && !words[index - 1]?.accent;
    const closes = word.accent && !words[index + 1]?.accent;
    parts.push(`${opens ? "*" : ""}${word.text}${closes ? "*" : ""}`);
  }
  return parts.join(" ");
}

/** Flips the accent on one word, keeping every other word as it was. */
export function toggleHeadlineWord(headline: string, index: number): string {
  const words = parseHeadline(headline);
  const word = words[index];
  if (!word) return headline;
  words[index] = { ...word, accent: !word.accent };
  return serializeHeadline(words);
}

/** The headline as the viewer reads it, without accent markers. */
export function headlinePlainText(headline: string): string {
  return parseHeadline(headline)
    .map((word) => word.text)
    .join(" ");
}

/**
 * Greedy word wrap that returns word indexes per line, so a renderer can colour
 * individual words. `complete` is false when the words did not fit.
 */
export function wrapWords(
  measure: (text: string) => number,
  words: string[],
  maxWidth: number,
  maxLines: number,
): { lines: number[][]; complete: boolean } {
  const lines: number[][] = [];
  let current: number[] = [];
  let currentText = "";
  words.forEach((word, index) => {
    const candidate = currentText ? `${currentText} ${word}` : word;
    if (current.length > 0 && measure(candidate) > maxWidth) {
      lines.push(current);
      current = [index];
      currentText = word;
    } else {
      current.push(index);
      currentText = candidate;
    }
  });
  if (current.length) lines.push(current);
  const tooWide = lines.some(
    (line) => measure(line.map((index) => words[index]).join(" ")) > maxWidth,
  );
  return {
    lines: lines.slice(0, maxLines),
    complete: lines.length <= maxLines && !tooWide,
  };
}

/** Radius, in canvas pixels, that a click must fall within to pick an element. */
export function elementHitRadius(element: ThumbnailElement, unit: number): number {
  const base = (element.size / 100) * unit;
  if (element.kind === "badge") {
    return Math.max(base * 0.6, base * 0.18 * Math.max(2, element.text.length));
  }
  if (element.kind === "arrow") return base * 1.05;
  if (element.kind === "circle") return base * 1.1;
  return base * 0.75;
}

/** The topmost element under a canvas point, if any. */
export function hitThumbnailElement(
  elements: ThumbnailElement[],
  x: number,
  y: number,
  width: number,
  height: number,
): ThumbnailElement | undefined {
  const unit = Math.min(width, height);
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]!;
    const dx = x - (element.x / 100) * width;
    const dy = y - (element.y / 100) * height;
    if (Math.hypot(dx, dy) <= elementHitRadius(element, unit)) return element;
  }
  return undefined;
}

/** Black or white, whichever reads better on the given background. */
export function readableInk(hex: string): "#111111" | "#ffffff" {
  const match = /^#?([0-9a-f]{6})$/iu.exec(hex.trim());
  if (!match) return "#ffffff";
  const value = Number.parseInt(match[1]!, 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.45 ? "#111111" : "#ffffff";
}

/** The style half of a design: what "My styles" saves and re-applies. */
export const STYLE_KEYS = [
  "font",
  "uppercase",
  "textColor",
  "accentColor",
  "strokeStrength",
  "shadowStrength",
  "textBackdrop",
  "lineSpacing",
  "align",
  "overlay",
  "vignette",
  "brightness",
  "contrast",
  "saturation",
] as const satisfies readonly (keyof ThumbnailDesign)[];
export type ThumbnailStyle = Pick<ThumbnailDesign, (typeof STYLE_KEYS)[number]>;

export function pickStyle(design: ThumbnailDesign): ThumbnailStyle {
  return Object.fromEntries(
    STYLE_KEYS.map((key) => [key, design[key]]),
  ) as unknown as ThumbnailStyle;
}

/** Validates a stored style; anything malformed is dropped rather than applied. */
export function normalizeStyle(value: unknown): ThumbnailStyle | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const number = (key: string, min: number, max: number) => {
    const raw = source[key];
    return typeof raw === "number" && Number.isFinite(raw)
      ? Math.max(min, Math.min(max, raw))
      : null;
  };
  const color = (key: string) =>
    typeof source[key] === "string" && /^#[0-9a-f]{6}$/iu.test(source[key])
      ? source[key]
      : null;
  const font = source.font as ThumbnailFont;
  const align = source.align as CanvasTextAlign;
  const values = {
    font: font in THUMBNAIL_FONTS ? font : null,
    uppercase: typeof source.uppercase === "boolean" ? source.uppercase : null,
    textColor: color("textColor"),
    accentColor: color("accentColor"),
    strokeStrength: number("strokeStrength", 3, 24),
    shadowStrength: number("shadowStrength", 0, 100),
    textBackdrop: number("textBackdrop", 0, 75),
    lineSpacing: number("lineSpacing", 86, 135),
    align: align === "left" || align === "center" || align === "right" ? align : null,
    overlay: number("overlay", 0, 70),
    vignette: number("vignette", 0, 70),
    brightness: number("brightness", 50, 150),
    contrast: number("contrast", 50, 170),
    saturation: number("saturation", 0, 190),
  };
  return Object.values(values).some((entry) => entry === null)
    ? null
    : (values as ThumbnailStyle);
}

/** YouTube rejects custom thumbnails larger than 2 MB. */
export const YOUTUBE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

export function canvasBlob(
  canvas: HTMLCanvasElement,
  type: "image/jpeg" | "image/png",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      type,
      quality,
    );
  });
}

/** Quality steps tried in order until the file fits YouTube's limit. */
export const JPEG_QUALITY_STEPS = [
  0.95, 0.92, 0.88, 0.84, 0.8, 0.75, 0.7, 0.62,
] as const;

/**
 * The highest JPEG quality that still fits YouTube's upload limit.
 *
 * Measured on worst-case noise, a 0.95 JPEG is ~0.8 MB at 1280×720 and ~1.7 MB
 * at 1080×1920 — inside the limit, but with little headroom for the Shorts
 * size. This is the safety net for that case; quality only steps down as far
 * as it has to. The PNG export is where the limit really bites (2.2 MB and
 * 5 MB on the same frames), and there the user is told instead.
 */
export async function youtubeSafeJpeg(
  encode: (quality: number) => Promise<Blob>,
): Promise<{ blob: Blob; quality: number }> {
  let last: { blob: Blob; quality: number } | null = null;
  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await encode(quality);
    last = { blob, quality };
    if (blob.size <= YOUTUBE_THUMBNAIL_MAX_BYTES) return last;
  }
  return last!;
}

export function formatBytes(bytes: number, language: SupportedLanguage): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1
    ? `${megabytes.toFixed(2)} ${language === "ru" ? "МБ" : "MB"}`
    : `${Math.round(bytes / 1024)} ${language === "ru" ? "КБ" : "KB"}`;
}

/** A filesystem-safe slug that keeps Cyrillic, so Russian titles stay readable. */
export function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "thumbnail"
  );
}

/**
 * Cuts a title to a headline: the part before a separator (": ", " — ",
 * " | "), then at a word boundary rather than mid-word. The old code split on
 * any hyphen, so "Pre-launch review" became "Pre".
 */
export function headlineFromTitle(title: string, maximum: number): string {
  const lead = (title.split(/\s[:—|–-]\s|[:|]/)[0] ?? title).trim();
  if (lead.length <= maximum) return lead;
  const cut = lead.slice(0, maximum + 1);
  const boundary = cut.lastIndexOf(" ");
  return (
    boundary > maximum * 0.5 ? cut.slice(0, boundary) : lead.slice(0, maximum)
  ).trim();
}

/** "1:05", "1:02:07", with tenths when present ("0:12.4"). */
export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const remaining = whole % 60;
  const base =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
      : `${minutes}:${String(remaining).padStart(2, "0")}`;
  const tenths = Math.floor((safe - whole) * 10);
  return tenths > 0 ? `${base}.${tenths}` : base;
}

/** Lower-cases, folds ё into е and collapses whitespace for forgiving search. */
export function searchText(value: string): string {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** Every query word must appear somewhere in the haystack, in any order. */
export function matchesSearch(query: string, haystack: string): boolean {
  const terms = searchText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const text = searchText(haystack);
  return terms.every((term) => text.includes(term));
}
