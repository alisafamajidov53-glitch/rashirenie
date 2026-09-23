// The thumbnail and clip editor. Split out of options/main.tsx, which had grown
// past 8 000 lines with this component making up a third of it.
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  AiProviderCooldowns,
  AnalysisResult,
  ExtensionSettings,
  SupportedLanguage,
  ThumbnailDiagnostics,
  VideoSummary,
} from "@channelpilot/shared";
import {
  analyzeThumbnailPixels,
  formatMetric,
  parseRetryAfterMs,
  safeErrorMessage,
} from "@channelpilot/shared";
import { analyzeMediaDirect } from "../lib/ai-direct";
import { rpc } from "../lib/rpc";
import {
  canvasBlob,
  elementHitRadius,
  fileSlug,
  formatBytes,
  formatTimestamp,
  headlineFromTitle,
  headlinePlainText,
  hitThumbnailElement,
  normalizeStyle,
  parseHeadline,
  pickStyle,
  readableInk,
  sameDesign,
  THUMBNAIL_FONTS,
  toggleHeadlineWord,
  wrapWords,
  YOUTUBE_THUMBNAIL_MAX_BYTES,
  youtubeSafeJpeg,
  type ThumbnailDesign,
  type ThumbnailElement,
  type ThumbnailElementKind,
  type ThumbnailFont,
  type ThumbnailFormat,
  type ThumbnailStyle,
} from "./editor-utils";

type MediaType = "image" | "video";

function tr(language: SupportedLanguage, ru: string, en: string): string {
  return language === "ru" ? ru : en;
}

export interface ThumbnailEditorProps {
  sourceVideo: VideoSummary | null;
  initialMediaFile: File | null;
  initialTimestampSeconds: number | null;
  onNotice: (message: string) => void;
  /**
   * Failures. They used to go through `onNotice` as well, which the dashboard
   * renders as a green success toast — "the browser could not decode this
   * video" looked like a confirmation.
   */
  onError: (message: string) => void;
  language: SupportedLanguage;
  initialFormat: ThumbnailFormat;
  initialHeadline: string;
  allowAiMediaUploads: boolean;
  settings: ExtensionSettings;
  /**
   * Whether the editor is the page on screen. It stays mounted while the user
   * visits other pages so a half-finished thumbnail survives the round trip;
   * while hidden it must not react to global keys.
   */
  active: boolean;
  /** For the "how viewers will see it" feed preview. */
  channelTitle?: string;
  channelAvatarUrl?: string;
}

interface FrameChoice {
  time: number;
  url: string;
}

type EditorTab = "text" | "elements" | "photo" | "style" | "ai" | "clip";

/** A saved alternative for A/B comparison in the feed preview. */
interface EditorVariant {
  id: string;
  label: string;
  design: ThumbnailDesign;
  preview: string;
  videoTime: number | null;
}

interface SavedStyle {
  id: string;
  name: string;
  style: ThumbnailStyle;
}

const STYLE_STORAGE_KEY = "channelpilot.thumbnailStyles.v1";
const MAX_SAVED_STYLES = 8;
const MAX_VARIANTS = 4;

function loadSavedStyles(): SavedStyle[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STYLE_STORAGE_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const style = normalizeStyle(record.style);
      return style && typeof record.id === "string" && typeof record.name === "string"
        ? [{ id: record.id, name: record.name.slice(0, 32), style }]
        : [];
    });
  } catch {
    return [];
  }
}

function persistSavedStyles(styles: SavedStyle[]): void {
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(styles));
  } catch {
    // Storage can be unavailable (quota, private mode); styles then live for
    // this session only.
  }
}

/** Ready-made looks. Each sets the whole style, not just two colours. */
const STYLE_PRESETS: Array<{
  id: string;
  label: readonly [ru: string, en: string];
  style: ThumbnailStyle;
}> = [
  {
    id: "impact",
    label: ["Импакт", "Impact"],
    style: {
      font: "heavy",
      uppercase: true,
      textColor: "#ffffff",
      accentColor: "#ffd23f",
      strokeStrength: 14,
      shadowStrength: 78,
      textBackdrop: 0,
      lineSpacing: 100,
      align: "center",
      overlay: 24,
      vignette: 26,
      brightness: 102,
      contrast: 118,
      saturation: 125,
    },
  },
  {
    id: "clean",
    label: ["Чистый", "Clean"],
    style: {
      font: "modern",
      uppercase: false,
      textColor: "#ffffff",
      accentColor: "#70e1a9",
      strokeStrength: 6,
      shadowStrength: 55,
      textBackdrop: 38,
      lineSpacing: 108,
      align: "left",
      overlay: 30,
      vignette: 10,
      brightness: 100,
      contrast: 105,
      saturation: 100,
    },
  },
  {
    id: "neon",
    label: ["Неон", "Neon"],
    style: {
      font: "condensed",
      uppercase: true,
      textColor: "#f4efff",
      accentColor: "#ff4fd8",
      strokeStrength: 10,
      shadowStrength: 90,
      textBackdrop: 0,
      lineSpacing: 96,
      align: "center",
      overlay: 30,
      vignette: 38,
      brightness: 96,
      contrast: 124,
      saturation: 150,
    },
  },
  {
    id: "contrast",
    label: ["Контраст", "Contrast"],
    style: {
      font: "heavy",
      uppercase: true,
      textColor: "#ffd23f",
      accentColor: "#ff3b30",
      strokeStrength: 18,
      shadowStrength: 85,
      textBackdrop: 0,
      lineSpacing: 98,
      align: "left",
      overlay: 12,
      vignette: 20,
      brightness: 106,
      contrast: 130,
      saturation: 135,
    },
  },
  {
    id: "cinema",
    label: ["Кино", "Cinema"],
    style: {
      font: "serif",
      uppercase: false,
      textColor: "#fff6e6",
      accentColor: "#f3b562",
      strokeStrength: 4,
      shadowStrength: 70,
      textBackdrop: 0,
      lineSpacing: 110,
      align: "center",
      overlay: 34,
      vignette: 48,
      brightness: 96,
      contrast: 112,
      saturation: 88,
    },
  },
];

/** Quick colour picks for text, accent and element colours. */
const COLOR_SWATCHES = [
  "#ffffff",
  "#ffd23f",
  "#ff3b30",
  "#ff8a00",
  "#3ddc97",
  "#3aa0ff",
  "#b388ff",
  "#111111",
];

const EMOJI_CHOICES = [
  "😱",
  "🔥",
  "🤯",
  "😂",
  "💰",
  "✅",
  "❌",
  "👉",
  "⚠️",
  "🏆",
  "❤️",
  "👀",
];

function newElementId(): string {
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Paints one element in canvas pixels. Everything gets a dark outline and a
 * soft shadow, so an arrow or a label reads on a busy frame as well as on a
 * flat one — the same treatment the headline gets.
 */
function drawThumbnailElement(
  context: CanvasRenderingContext2D,
  element: ThumbnailElement,
  width: number,
  height: number,
): void {
  const unit = (element.size / 100) * Math.min(width, height);
  context.save();
  context.translate((element.x / 100) * width, (element.y / 100) * height);
  context.rotate((element.rotation * Math.PI) / 180);
  context.shadowColor = "rgba(0,0,0,.55)";
  context.shadowBlur = unit * 0.16;
  context.shadowOffsetY = unit * 0.06;
  context.lineJoin = "round";
  if (element.kind === "arrow") {
    const length = unit * 2;
    const shaft = unit * 0.3;
    const headLength = unit * 0.78;
    const headWidth = unit * 1.0;
    const left = -length / 2;
    const neck = length / 2 - headLength;
    context.beginPath();
    context.moveTo(left, -shaft / 2);
    context.lineTo(neck, -shaft / 2);
    context.lineTo(neck, -headWidth / 2);
    context.lineTo(length / 2, 0);
    context.lineTo(neck, headWidth / 2);
    context.lineTo(neck, shaft / 2);
    context.lineTo(left, shaft / 2);
    context.closePath();
    context.lineWidth = unit * 0.12;
    context.strokeStyle = "#0b0a10";
    context.stroke();
    context.shadowColor = "transparent";
    context.fillStyle = element.color;
    context.fill();
  } else if (element.kind === "circle") {
    context.beginPath();
    context.arc(0, 0, unit, 0, Math.PI * 2);
    context.lineWidth = unit * 0.22;
    context.strokeStyle = "rgba(10,9,14,.75)";
    context.stroke();
    context.shadowColor = "transparent";
    context.lineWidth = unit * 0.13;
    context.strokeStyle = element.color;
    context.stroke();
  } else if (element.kind === "emoji") {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${unit * 1.5}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    context.fillText(element.text || "🔥", 0, unit * 0.06);
  } else {
    const label = (element.text || "NEW").toUpperCase();
    const fontSize = unit * 0.55;
    context.font = `900 ${fontSize}px ${THUMBNAIL_FONTS.heavy.family}`;
    const textWidth = context.measureText(label).width;
    const padX = unit * 0.36;
    const padY = unit * 0.22;
    const boxWidth = textWidth + padX * 2;
    const boxHeight = fontSize + padY * 2;
    context.beginPath();
    context.roundRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, unit * 0.16);
    context.lineWidth = unit * 0.08;
    context.strokeStyle = "#0b0a10";
    context.stroke();
    context.shadowColor = "transparent";
    context.fillStyle = element.color;
    context.fill();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = readableInk(element.color);
    context.fillText(label, 0, fontSize * 0.04);
  }
  context.restore();
}

async function waitForVideo(
  video: HTMLVideoElement,
  event: "loadeddata" | "seeked",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(event, onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video decoding failed"));
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Video ${event} timeout`));
    }, 12_000);
    video.addEventListener(event, onReady);
    video.addEventListener("error", onError);
  });
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) <= 0.02) return;
  const ready = waitForVideo(video, "seeked");
  video.currentTime = time;
  await ready;
}

function lastSeekableTime(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.01) : 0;
}

function clampVideoTime(duration: number, time: number): number {
  return Math.max(0, Math.min(lastSeekableTime(duration), time));
}

function drawFrameCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = Math.max(0, (video.videoWidth - sourceWidth) / 2);
  const sourceY = Math.max(0, (video.videoHeight - sourceHeight) / 2);
  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );
}

async function buildFrameChoices(
  mediaUrl: string,
  duration: number,
  isCurrent: () => boolean = () => true,
): Promise<FrameChoice[]> {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    const loaded = waitForVideo(video, "loadeddata");
    video.src = mediaUrl;
    await loaded;
    const count = duration < 8 ? 10 : duration < 30 ? 12 : 16;
    const result: FrameChoice[] = [];
    for (let index = 0; index < count; index += 1) {
      if (!isCurrent()) break;
      const ratio = index / (count - 1);
      const time = clampVideoTime(duration, duration * ratio);
      await seekVideo(video, time);
      if (!isCurrent()) break;
      const portrait = video.videoHeight > video.videoWidth;
      const canvas = document.createElement("canvas");
      canvas.width = portrait ? 90 : 160;
      canvas.height = portrait ? 160 : 90;
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      drawFrameCover(context, video, canvas.width, canvas.height);
      result.push({
        time,
        url: canvas.toDataURL("image/jpeg", 0.82),
      });
    }
    return result;
  } finally {
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}

async function bestYouTubeThumbnail(
  videoId: string,
  fallbackUrl: string,
): Promise<{ blob: Blob; width: number; height: number }> {
  const urls = [
    ...new Set(
      [
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        fallbackUrl,
      ].filter(Boolean),
    ),
  ];
  const loadCandidate = async (url: string) => {
    const response = await fetch(url, {
      cache: "no-cache",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Thumbnail HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error("Thumbnail response is not an image");
    }
    const blob = await response.blob();
    if (blob.size === 0 || blob.size > 10 * 1024 * 1024) {
      throw new Error("Thumbnail size is invalid");
    }
    const bitmap = await createImageBitmap(blob);
    const result = { blob, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  };
  const primary = urls[0]
    ? await loadCandidate(urls[0]).catch(() => undefined)
    : undefined;
  if (primary && primary.width >= 1_280 && primary.height >= 720) {
    return primary;
  }
  const candidates = await Promise.allSettled(urls.slice(1).map(loadCandidate));
  const available = [
    ...(primary ? [primary] : []),
    ...candidates.flatMap((candidate) =>
      candidate.status === "fulfilled" ? [candidate.value] : [],
    ),
  ];
  const best = available
    .filter((candidate) => candidate.width >= 320 && candidate.height >= 180)
    .sort((left, right) => right.width * right.height - left.width * left.height)[0];
  if (!best) throw new Error("No usable YouTube thumbnail");
  return best;
}

function findGeneratedImage(
  value: unknown,
  depth = 0,
): { data: string; mimeType: string } | undefined {
  if (depth > 9 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findGeneratedImage(value[index], depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const data = typeof record.data === "string" ? record.data : "";
  const mimeType =
    typeof record.mime_type === "string"
      ? record.mime_type
      : typeof record.mimeType === "string"
        ? record.mimeType
        : "";
  if (data.length > 100 && data.length < 40_000_000 && mimeType.startsWith("image/")) {
    return { data, mimeType };
  }
  for (const child of Object.values(record)) {
    const found = findGeneratedImage(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function base64ImageBlob(data: string, mimeType: string): Blob {
  const normalized = data.replace(/^data:[^;]+;base64,/, "");
  const binary = atob(normalized);
  if (binary.length === 0 || binary.length > 24 * 1024 * 1024) {
    throw new Error("Generated image size is invalid");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || "image/jpeg" });
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

export function ThumbnailEditor({
  sourceVideo,
  initialMediaFile,
  initialTimestampSeconds,
  onNotice,
  onError,
  language,
  initialFormat,
  initialHeadline,
  allowAiMediaUploads,
  settings,
  active,
  channelTitle,
  channelAvatarUrl,
}: ThumbnailEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ownedMediaUrlRef = useRef("");
  const aiImageAbortRef = useRef<AbortController | null>(null);
  const aiImagePendingRef = useRef(false);
  const aiImageUsesReferenceRef = useRef(false);
  const allowAiMediaUploadsRef = useRef(allowAiMediaUploads);
  allowAiMediaUploadsRef.current = allowAiMediaUploads;
  const frameBuildIdRef = useRef(0);
  const sourceLoadIdRef = useRef(0);
  const languageRef = useRef(language);
  languageRef.current = language;
  const appliedInitialFrameRef = useRef("");
  const [format, setFormat] = useState<ThumbnailFormat>(initialFormat);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [mediaReady, setMediaReady] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTime, setVideoTime] = useState(0);
  const [frameChoices, setFrameChoices] = useState<FrameChoice[]>([]);
  const [framesLoading, setFramesLoading] = useState(false);
  // The canvas used to open on "VIRAL ANIMATION / FRAME BY FRAME" — English
  // placeholder copy painted into a Russian creator's thumbnail. It now starts
  // from the video's own title, or a neutral prompt in the interface language,
  // and without an invented subheadline.
  const [headline, setHeadline] = useState(
    () =>
      initialHeadline ||
      (sourceVideo ? headlineFromTitle(sourceVideo.title, 34) : "") ||
      tr(language, "Ваш заголовок", "Your headline"),
  );
  const [subline, setSubline] = useState("");
  const [font, setFont] = useState<ThumbnailFont>("heavy");
  const [uppercase, setUppercase] = useState(true);
  const [elements, setElements] = useState<ThumbnailElement[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [controlTab, setControlTab] = useState<EditorTab>("text");
  const [feedTheme, setFeedTheme] = useState<"dark" | "light">("dark");
  const [feedPreviewUrl, setFeedPreviewUrl] = useState("");
  const [variants, setVariants] = useState<EditorVariant[]>([]);
  const [savedStyles, setSavedStyles] = useState<SavedStyle[]>(loadSavedStyles);
  const [styleName, setStyleName] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [fontSize, setFontSize] = useState(initialFormat === "9:16" ? 82 : 94);
  const [textX, setTextX] = useState(50);
  const [textY, setTextY] = useState(initialFormat === "9:16" ? 28 : 66);
  const [textColor, setTextColor] = useState("#ffffff");
  const [accentColor, setAccentColor] = useState("#ffd23f");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(110);
  const [saturation, setSaturation] = useState(120);
  const [zoom, setZoom] = useState(100);
  // Initial values match what "Сбросить" restores. They used to differ
  // (darkening 28 vs 22, block width 82 vs 78), so a fresh editor already
  // showed two sliders as "changed" and reset visibly altered an untouched
  // thumbnail.
  const [overlay, setOverlay] = useState(22);
  const [textBackdrop, setTextBackdrop] = useState(24);
  const [headlineWidth, setHeadlineWidth] = useState(
    initialFormat === "9:16" ? 82 : 78,
  );
  const [lineSpacing, setLineSpacing] = useState(104);
  const [strokeStrength, setStrokeStrength] = useState(13);
  const [shadowStrength, setShadowStrength] = useState(72);
  const [showGuides, setShowGuides] = useState(true);
  const [align, setAlign] = useState<CanvasTextAlign>("center");
  const [fitMode, setFitMode] = useState<"smart" | "fill">("fill");
  const [focusX, setFocusX] = useState(50);
  const [focusY, setFocusY] = useState(50);
  const [backgroundBlur, setBackgroundBlur] = useState(18);
  const [vignette, setVignette] = useState(18);
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [exportingVideo, setExportingVideo] = useState(false);
  const [aiImagePrompt, setAiImagePrompt] = useState("");
  const [aiImageSize, setAiImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [generatingImage, setGeneratingImage] = useState(false);
  const [mediaOrigin, setMediaOrigin] = useState<"youtube" | "upload" | "ai" | "">("");
  const [sourceRatio, setSourceRatio] = useState(0);
  const [sourceResolution, setSourceResolution] = useState({
    width: 0,
    height: 0,
  });
  const [diagnostics, setDiagnostics] = useState<ThumbnailDiagnostics | null>(null);
  const [aiThumbnailAudit, setAiThumbnailAudit] = useState<AnalysisResult | null>(null);
  const [aiThumbnailAuditLoading, setAiThumbnailAuditLoading] = useState(false);
  const [aiThumbnailAuditStatus, setAiThumbnailAuditStatus] = useState("");

  useEffect(() => {
    if (!allowAiMediaUploads && aiImageUsesReferenceRef.current) {
      aiImageAbortRef.current?.abort();
    }
  }, [allowAiMediaUploads]);

  useEffect(() => () => aiImageAbortRef.current?.abort(), []);

  const dimensions =
    format === "16:9" ? { width: 1280, height: 720 } : { width: 1080, height: 1920 };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#17131f";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const media = mediaType === "video" ? videoRef.current : imageRef.current;
    if (media && ("videoWidth" in media ? media.videoWidth : media.naturalWidth)) {
      const sourceWidth = "videoWidth" in media ? media.videoWidth : media.naturalWidth;
      const sourceHeight =
        "videoHeight" in media ? media.videoHeight : media.naturalHeight;
      const coverScale =
        Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight) *
        (zoom / 100);
      const containScale =
        Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight) *
        (zoom / 100);
      const drawSource = (
        scale: number,
        xPercent: number,
        yPercent: number,
        filter: string,
      ) => {
        const drawWidth = sourceWidth * scale;
        const drawHeight = sourceHeight * scale;
        context.save();
        context.filter = filter;
        if (flipHorizontal) {
          context.translate(canvas.width, 0);
          context.scale(-1, 1);
        }
        context.drawImage(
          media,
          (canvas.width - drawWidth) * (xPercent / 100),
          (canvas.height - drawHeight) * (yPercent / 100),
          drawWidth,
          drawHeight,
        );
        context.restore();
      };
      const baseFilter = showOriginal
        ? "none"
        : `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
      if (fitMode === "smart") {
        drawSource(
          coverScale * 1.04,
          focusX,
          focusY,
          `brightness(${brightness * 0.58}%) saturate(${saturation * 0.75}%) blur(${backgroundBlur}px)`,
        );
        context.fillStyle = "rgba(0,0,0,.16)";
        context.fillRect(0, 0, canvas.width, canvas.height);
        drawSource(containScale, 50, 50, baseFilter);
      } else {
        drawSource(coverScale, focusX, focusY, baseFilter);
      }
    } else {
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, "#432fa2");
      gradient.addColorStop(0.52, "#151522");
      gradient.addColorStop(1, "#e16d2b");
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    // "Hold to compare": the crop stays, everything the editor added on top of
    // the source — grading, darkening, vignette, text — is left out.
    if (showOriginal) return;

    context.fillStyle = `rgba(0,0,0,${overlay / 100})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (vignette > 0) {
      const gradient = context.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        Math.min(canvas.width, canvas.height) * 0.2,
        canvas.width / 2,
        canvas.height / 2,
        Math.max(canvas.width, canvas.height) * 0.72,
      );
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, vignette / 100)})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Graphics sit under the headline: an arrow crossing a word must never
    // make the word harder to read.
    for (const element of elements) {
      drawThumbnailElement(context, element, canvas.width, canvas.height);
    }

    const requestedSize = format === "9:16" ? fontSize * 1.35 : fontSize;
    const maxTextWidth = (headlineWidth / 100) * canvas.width;
    // The block is kept inside the frame: dragged to an edge it stops there
    // instead of cutting the headline in half.
    const edge = canvas.width * 0.02 + maxTextWidth / 2;
    const x =
      edge * 2 >= canvas.width
        ? canvas.width / 2
        : Math.min(canvas.width - edge, Math.max(edge, (textX / 100) * canvas.width));
    const y = (textY / 100) * canvas.height;
    const typeface = THUMBNAIL_FONTS[font];
    const setHeadlineFont = (size: number) => {
      context.font = `${typeface.weight} ${size}px ${typeface.family}`;
    };
    context.textBaseline = "middle";
    context.lineJoin = "round";
    // Words, not a string: each one can carry the accent colour.
    const words = parseHeadline(headline).map((word) => ({
      text: uppercase ? word.text.toLocaleUpperCase() : word.text,
      accent: word.accent,
    }));
    const wordTexts = words.map((word) => word.text);
    let actualSize = requestedSize;
    let headlineLines: number[][] = [];
    const maxLines = format === "9:16" ? 4 : 3;
    const minimumSize = format === "9:16" ? 54 : 38;
    while (actualSize >= minimumSize) {
      setHeadlineFont(actualSize);
      const wrapped = wrapWords(
        (text) => context.measureText(text).width,
        wordTexts,
        maxTextWidth,
        maxLines,
      );
      headlineLines = wrapped.lines;
      if (wrapped.complete) break;
      actualSize -= 4;
    }
    actualSize = Math.max(minimumSize, actualSize);
    setHeadlineFont(actualSize);
    // Words that did not fit even at the minimum size end with an ellipsis,
    // so a cut headline reads as cut rather than as a finished sentence.
    const shownWords = headlineLines.flat().length;
    const lastLine = headlineLines.at(-1);
    const lastWordIndex = lastLine?.at(-1);
    if (shownWords < words.length && lastWordIndex !== undefined) {
      words[lastWordIndex] = {
        ...words[lastWordIndex]!,
        text: `${words[lastWordIndex]!.text}…`,
      };
      wordTexts[lastWordIndex] = words[lastWordIndex].text;
    }
    const lineHeight = actualSize * (lineSpacing / 100);
    const subSize = actualSize * 0.42;
    const blockHeight =
      Math.max(1, headlineLines.length) * lineHeight +
      (subline.trim() ? subSize * 1.35 : 0);
    const blockTop = y - blockHeight / 2;
    // The text position is the centre of the block for every alignment;
    // alignment only arranges lines inside it. Left alignment used to start
    // the block at the centre point, pushing a long headline off the canvas.
    const boxLeft = x - maxTextWidth / 2;
    if (textBackdrop > 0) {
      const pad = actualSize * 0.32;
      const panelWidth = Math.min(canvas.width - 24, maxTextWidth + pad * 2);
      const panelHeight = Math.min(canvas.height - 24, blockHeight + pad * 2);
      const panelLeft = Math.max(
        12,
        Math.min(canvas.width - panelWidth - 12, boxLeft - pad),
      );
      const panelTop = Math.max(
        12,
        Math.min(canvas.height - panelHeight - 12, blockTop - pad),
      );
      context.fillStyle = `rgba(5,4,10,${textBackdrop / 100})`;
      roundedRect(
        context,
        panelLeft,
        panelTop,
        panelWidth,
        panelHeight,
        actualSize * 0.22,
      );
      context.fill();
    }
    context.strokeStyle = "#09080c";
    context.lineWidth = Math.max(3, actualSize * (strokeStrength / 100));
    context.shadowColor = `rgba(0,0,0,${shadowStrength / 100})`;
    context.shadowBlur = actualSize * 0.18 * (shadowStrength / 72);
    context.shadowOffsetY = actualSize * 0.08;
    context.textAlign = "left";
    const spaceWidth = context.measureText(" ").width;
    headlineLines.forEach((line, index) => {
      const lineY = blockTop + lineHeight * (index + 0.55);
      const lineText = line.map((wordIndex) => wordTexts[wordIndex]).join(" ");
      const naturalWidth = context.measureText(lineText).width;
      // A single word longer than the block at the minimum size is squeezed
      // horizontally rather than clipped, as fillText's maxWidth used to do.
      const squeeze = naturalWidth > maxTextWidth ? maxTextWidth / naturalWidth : 1;
      const lineWidth = naturalWidth * squeeze;
      const startX =
        align === "center"
          ? x - lineWidth / 2
          : align === "right"
            ? boxLeft + maxTextWidth - lineWidth
            : boxLeft;
      context.save();
      context.translate(startX, lineY);
      context.scale(squeeze, 1);
      let cursor = 0;
      for (const wordIndex of line) {
        const word = words[wordIndex]!;
        context.strokeText(word.text, cursor, 0);
        context.fillStyle = word.accent ? accentColor : textColor;
        context.fillText(word.text, cursor, 0);
        cursor += context.measureText(word.text).width + spaceWidth;
      }
      context.restore();
    });

    if (subline.trim()) {
      const subY = blockTop + headlineLines.length * lineHeight + subSize * 0.72;
      const subText = uppercase ? subline.toLocaleUpperCase() : subline;
      const subX =
        align === "center" ? x : align === "right" ? boxLeft + maxTextWidth : boxLeft;
      context.textAlign = align;
      context.font = `900 ${subSize}px ${typeface.family}`;
      context.lineWidth = Math.max(6, subSize * 0.14);
      context.strokeText(subText, subX, subY, maxTextWidth);
      context.fillStyle = accentColor;
      context.fillText(subText, subX, subY, maxTextWidth);
    }
    context.shadowColor = "transparent";
  }, [
    accentColor,
    align,
    elements,
    font,
    uppercase,
    backgroundBlur,
    brightness,
    contrast,
    dimensions.height,
    dimensions.width,
    fitMode,
    flipHorizontal,
    focusX,
    focusY,
    fontSize,
    format,
    headline,
    headlineWidth,
    lineSpacing,
    mediaType,
    overlay,
    saturation,
    shadowStrength,
    showOriginal,
    strokeStrength,
    subline,
    textColor,
    textBackdrop,
    textX,
    textY,
    vignette,
    zoom,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ---- Undo / redo ------------------------------------------------------
  // Thirty-odd independent controls and no way back from a bad slider drag was
  // the single biggest gap for an editor. History records whole designs, and a
  // burst of changes (dragging a slider, typing a word) settles into one step.
  const design: ThumbnailDesign = {
    format,
    headline,
    subline,
    font,
    uppercase,
    elements,
    fontSize,
    textX,
    textY,
    textColor,
    accentColor,
    brightness,
    contrast,
    saturation,
    zoom,
    overlay,
    textBackdrop,
    headlineWidth,
    lineSpacing,
    strokeStrength,
    shadowStrength,
    align,
    fitMode,
    focusX,
    focusY,
    backgroundBlur,
    vignette,
    flipHorizontal,
  };
  const historyRef = useRef<{
    committed: ThumbnailDesign | null;
    past: ThumbnailDesign[];
    future: ThumbnailDesign[];
    restoring: boolean;
  }>({ committed: null, past: [], future: [], restoring: false });
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const designKey = JSON.stringify(design);
  useEffect(() => {
    const history = historyRef.current;
    const timer = window.setTimeout(() => {
      const next = JSON.parse(designKey) as ThumbnailDesign;
      if (history.restoring) {
        history.restoring = false;
        history.committed = next;
        return;
      }
      if (history.committed && !sameDesign(history.committed, next)) {
        history.past = [...history.past.slice(-59), history.committed];
        history.future = [];
      }
      history.committed = next;
      setHistorySize({ past: history.past.length, future: history.future.length });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [designKey]);

  /**
   * Loads a whole design. Undo/redo pass `fromHistory` so the change is not
   * recorded as a new step; restoring an A/B variant is a normal, undoable edit.
   */
  function applyDesign(next: ThumbnailDesign, fromHistory = true) {
    if (fromHistory) historyRef.current.restoring = true;
    setFormat(next.format);
    setHeadline(next.headline);
    setSubline(next.subline);
    setFont(next.font);
    setUppercase(next.uppercase);
    setElements(next.elements);
    setSelectedElementId((current) =>
      next.elements.some((element) => element.id === current) ? current : null,
    );
    setFontSize(next.fontSize);
    setTextX(next.textX);
    setTextY(next.textY);
    setTextColor(next.textColor);
    setAccentColor(next.accentColor);
    setBrightness(next.brightness);
    setContrast(next.contrast);
    setSaturation(next.saturation);
    setZoom(next.zoom);
    setOverlay(next.overlay);
    setTextBackdrop(next.textBackdrop);
    setHeadlineWidth(next.headlineWidth);
    setLineSpacing(next.lineSpacing);
    setStrokeStrength(next.strokeStrength);
    setShadowStrength(next.shadowStrength);
    setAlign(next.align);
    setFitMode(next.fitMode);
    setFocusX(next.focusX);
    setFocusY(next.focusY);
    setBackgroundBlur(next.backgroundBlur);
    setVignette(next.vignette);
    setFlipHorizontal(next.flipHorizontal);
  }

  function stepHistory(direction: "undo" | "redo") {
    const history = historyRef.current;
    // Anything typed in the last 350 ms has not been committed yet; fold it in
    // first so undo reverts it instead of skipping over it.
    const current = JSON.parse(designKey) as ThumbnailDesign;
    if (history.committed && !sameDesign(history.committed, current)) {
      history.past = [...history.past.slice(-59), history.committed];
      history.future = [];
      history.committed = current;
    }
    const source = direction === "undo" ? history.past : history.future;
    const target = source.at(-1);
    if (!target || !history.committed) return;
    if (direction === "undo") {
      history.past = history.past.slice(0, -1);
      history.future = [...history.future, history.committed];
    } else {
      history.future = history.future.slice(0, -1);
      history.past = [...history.past, history.committed];
    }
    history.committed = target;
    setHistorySize({ past: history.past.length, future: history.future.length });
    applyDesign(target);
  }
  const stepHistoryRef = useRef(stepHistory);
  stepHistoryRef.current = stepHistory;

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const redo = key === "y" || (key === "z" && event.shiftKey);
      if (key !== "z" && !redo) return;
      // Text fields keep their own native undo for the characters being typed.
      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement &&
          (target.type === "text" || target.type === "number" || target.type === ""))
      ) {
        return;
      }
      event.preventDefault();
      stepHistoryRef.current(redo ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  useEffect(() => {
    setFormat(initialFormat);
    setFitMode("fill");
  }, [initialFormat]);

  useEffect(() => {
    if (initialHeadline.trim()) setHeadline(initialHeadline.slice(0, 38));
  }, [initialHeadline]);

  useEffect(() => {
    const seed = initialHeadline.trim() || sourceVideo?.title.trim() || "";
    if (seed) {
      setAiImagePrompt((current) => current || seed.slice(0, 280));
    }
  }, [initialHeadline, sourceVideo]);

  function changeFormat(next: ThumbnailFormat) {
    setFormat(next);
    if (next === "9:16") {
      setFitMode(sourceRatio > 1.4 ? "smart" : "fill");
      setTextY(28);
      setFontSize((current) => Math.min(current, 120));
      setHeadlineWidth(82);
    } else {
      setTextY(66);
      setHeadlineWidth(78);
    }
  }

  useEffect(() => {
    if (!sourceVideo || initialMediaFile) return;
    const loadId = ++sourceLoadIdRef.current;
    let cancelled = false;
    frameBuildIdRef.current += 1;
    if (ownedMediaUrlRef.current) {
      URL.revokeObjectURL(ownedMediaUrlRef.current);
      ownedMediaUrlRef.current = "";
    }
    setMediaUrl("");
    setMediaReady(false);
    setMediaOrigin("");
    setSourceRatio(0);
    setSourceResolution({ width: 0, height: 0 });
    setFrameChoices([]);
    setFramesLoading(false);
    void bestYouTubeThumbnail(sourceVideo.id, sourceVideo.thumbnailUrl)
      .then(({ blob, width, height }) => {
        if (cancelled || sourceLoadIdRef.current !== loadId) return;
        if (ownedMediaUrlRef.current) {
          URL.revokeObjectURL(ownedMediaUrlRef.current);
        }
        const objectUrl = URL.createObjectURL(blob);
        ownedMediaUrlRef.current = objectUrl;
        setMediaType("image");
        setMediaUrl(objectUrl);
        setMediaReady(false);
        setMediaOrigin("youtube");
        setSourceResolution({ width, height });
        frameBuildIdRef.current += 1;
        setFramesLoading(false);
        setFrameChoices([]);
        setHeadline(
          headlineFromTitle(sourceVideo.title, 34) ||
            tr(languageRef.current, "Ваш заголовок", "Your headline"),
        );
      })
      .catch(() => {
        if (cancelled || sourceLoadIdRef.current !== loadId) return;
        onError(
          tr(
            languageRef.current,
            "Не удалось загрузить исходное превью — выберите файл",
            "Could not load the source thumbnail — choose a file",
          ),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [sourceVideo, initialMediaFile, onError]);

  function chooseMedia(file?: File) {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const video =
      file.type.startsWith("video/") ||
      /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|ts)$/i.test(lowerName);
    const image =
      file.type.startsWith("image/") ||
      /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(lowerName);
    if (!video && !image) {
      onError(
        tr(
          language,
          "Редактор принимает только изображения и видео",
          "The editor accepts images and videos only",
        ),
      );
      return;
    }
    if (file.size <= 0) {
      onError(tr(language, "Выбранный файл пуст", "The selected file is empty"));
      return;
    }
    const maximumBytes = video ? 2 * 1024 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maximumBytes) {
      onError(
        tr(
          language,
          video
            ? "Видео превышает браузерный лимит 2 ГБ"
            : "Изображение превышает лимит 50 МБ",
          video
            ? "The video exceeds the 2 GB browser limit"
            : "The image exceeds the 50 MB limit",
        ),
      );
      return;
    }
    sourceLoadIdRef.current += 1;
    frameBuildIdRef.current += 1;
    setFramesLoading(false);
    if (ownedMediaUrlRef.current) {
      URL.revokeObjectURL(ownedMediaUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    ownedMediaUrlRef.current = objectUrl;
    setMediaType(video ? "video" : "image");
    setMediaUrl(objectUrl);
    setMediaReady(false);
    setMediaOrigin("upload");
    setVideoTime(0);
    setVideoDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setSourceRatio(0);
    setSourceResolution({ width: 0, height: 0 });
    setFrameChoices([]);
  }

  function currentMediaReference():
    { type: "image"; mime_type: "image/jpeg"; data: string } | undefined {
    const media = mediaType === "video" ? videoRef.current : imageRef.current;
    if (!media) return undefined;
    const sourceWidth =
      media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const sourceHeight =
      media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (!sourceWidth || !sourceHeight) return undefined;
    const scale = Math.min(1, 1_024 / Math.max(sourceWidth, sourceHeight));
    const reference = document.createElement("canvas");
    reference.width = Math.max(1, Math.round(sourceWidth * scale));
    reference.height = Math.max(1, Math.round(sourceHeight * scale));
    const referenceContext = reference.getContext("2d");
    if (!referenceContext) return undefined;
    referenceContext.imageSmoothingEnabled = true;
    referenceContext.imageSmoothingQuality = "high";
    referenceContext.drawImage(media, 0, 0, reference.width, reference.height);
    return {
      type: "image",
      mime_type: "image/jpeg",
      data: reference.toDataURL("image/jpeg", 0.88).split(",")[1] ?? "",
    };
  }

  async function generateAiBackground() {
    if (aiImagePendingRef.current) return;
    const request = aiImagePrompt.trim();
    if (request.length < 4) {
      onError(tr(language, "Опишите сцену для превью", "Describe the thumbnail scene"));
      return;
    }
    aiImagePendingRef.current = true;
    setGeneratingImage(true);
    try {
      const currentSettings = await rpc<ExtensionSettings>({
        type: "GET_SETTINGS",
      });
      if (!currentSettings.geminiApiKey) {
        throw new Error(
          tr(
            language,
            "Добавьте Gemini API key в разделе «Подключения»",
            "Add a Gemini API key under Connections",
          ),
        );
      }
      const cooldowns = await rpc<AiProviderCooldowns>({
        type: "GET_AI_PROVIDER_COOLDOWNS",
      });
      const remainingCooldown = Math.max(0, Number(cooldowns.gemini ?? 0) - Date.now());
      if (remainingCooldown > 0) {
        const seconds = Math.max(1, Math.ceil(remainingCooldown / 1_000));
        throw new Error(
          tr(
            language,
            `Gemini временно на паузе из-за квоты. Повторите примерно через ${seconds} сек.`,
            `Gemini is temporarily paused by its quota. Retry in about ${seconds}s.`,
          ),
        );
      }
      const reference =
        allowAiMediaUploadsRef.current && currentSettings.allowAiMediaUploads
          ? currentMediaReference()
          : undefined;
      const instruction = [
        `Create a professional high-click-through YouTube thumbnail background in ${format} format.`,
        `Scene brief: ${request.slice(0, 1_200)}`,
        "Use strong subject separation, expressive action, cinematic lighting, clear visual hierarchy and generous negative space for a headline.",
        "Do not render any words, letters, logos, watermarks, fake interface, borders or platform icons; ChannelPilot will add the text separately.",
        reference
          ? "Keep the main subject and factual visual context recognizable from the reference image; improve composition without inventing misleading events."
          : "Keep the scene honest to the supplied brief and avoid copyrighted logos or unrelated famous characters.",
        format === "9:16"
          ? "Keep the main subject inside the central Shorts safe area and leave the bottom-right controls area uncluttered."
          : "Keep the main subject away from the bottom-right timestamp area.",
      ].join("\n");
      const input: Array<Record<string, string>> = [
        { type: "text", text: instruction },
      ];
      if (reference?.data) input.push(reference);
      const controller = new AbortController();
      aiImageAbortRef.current = controller;
      aiImageUsesReferenceRef.current = Boolean(reference?.data);
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": currentSettings.geminiApiKey,
          },
          body: JSON.stringify({
            model: "gemini-3.1-flash-image",
            input,
            response_format: {
              type: "image",
              mime_type: "image/jpeg",
              aspect_ratio: format,
              image_size: aiImageSize,
            },
          }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(150_000)]),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        [key: string]: unknown;
      };
      if (!response.ok) {
        const detail = body.error?.message || `HTTP ${response.status}`;
        if (response.status === 429) {
          const retryAfterMs =
            parseRetryAfterMs(
              response.headers.get("retry-after"),
              detail,
              body.error,
            ) ?? 30_000;
          await rpc({
            type: "SET_AI_PROVIDER_COOLDOWN",
            provider: "gemini",
            until: Date.now() + retryAfterMs + 500,
          }).catch(() => undefined);
          throw new Error(
            tr(
              language,
              `Квота Gemini Image временно исчерпана: ${detail}`,
              `Gemini Image quota is temporarily exhausted: ${detail}`,
            ),
          );
        }
        throw new Error(`Gemini Image: ${detail}`);
      }
      const generated = findGeneratedImage(body);
      if (!generated) {
        throw new Error(
          tr(
            language,
            "Gemini не вернул изображение",
            "Gemini did not return an image",
          ),
        );
      }
      const blob = base64ImageBlob(generated.data, generated.mimeType);
      if (ownedMediaUrlRef.current) {
        URL.revokeObjectURL(ownedMediaUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(blob);
      ownedMediaUrlRef.current = objectUrl;
      sourceLoadIdRef.current += 1;
      frameBuildIdRef.current += 1;
      setMediaType("image");
      setMediaUrl(objectUrl);
      setMediaReady(false);
      setMediaOrigin("ai");
      setFrameChoices([]);
      setFramesLoading(false);
      setFitMode("fill");
      setFocusX(50);
      setFocusY(50);
      setOverlay(18);
      onNotice(
        tr(language, `AI-фон ${format} создан`, `${format} AI background created`),
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      onError(
        caught instanceof Error
          ? caught.message
          : tr(
              language,
              "Не удалось создать AI-фон",
              "Could not generate the AI background",
            ),
      );
    } finally {
      aiImageAbortRef.current = null;
      aiImageUsesReferenceRef.current = false;
      aiImagePendingRef.current = false;
      setGeneratingImage(false);
    }
  }

  const chooseMediaRef = useRef(chooseMedia);
  chooseMediaRef.current = chooseMedia;
  useEffect(() => {
    if (initialMediaFile) chooseMediaRef.current(initialMediaFile);
  }, [initialMediaFile]);

  const selectFrame = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!Number.isFinite(time)) return;
      const safeTime = clampVideoTime(videoDuration, time);
      setVideoTime(safeTime);
      if (!video) return;
      video.pause();
      if (Math.abs(video.currentTime - safeTime) <= 0.02) {
        draw();
        return;
      }
      video.currentTime = safeTime;
    },
    [draw, videoDuration],
  );

  useEffect(() => {
    if (
      mediaType !== "video" ||
      !mediaUrl ||
      videoDuration <= 0 ||
      initialTimestampSeconds === null
    ) {
      return;
    }
    const key = `${mediaUrl}:${initialTimestampSeconds}`;
    if (appliedInitialFrameRef.current === key) return;
    appliedInitialFrameRef.current = key;
    selectFrame(initialTimestampSeconds);
    onNotice(
      tr(
        language,
        `Открыт рекомендованный AI-кадр · ${formatTimestamp(initialTimestampSeconds)}`,
        `AI-recommended frame opened · ${formatTimestamp(initialTimestampSeconds)}`,
      ),
    );
  }, [
    initialTimestampSeconds,
    language,
    mediaType,
    mediaUrl,
    onNotice,
    selectFrame,
    videoDuration,
  ]);

  useEffect(() => {
    if (!active || mediaType !== "video" || !mediaUrl) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        // Arrows on the focused canvas nudge the text, not the video frame.
        target instanceof HTMLCanvasElement
      ) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      selectFrame(videoTime + direction * (event.shiftKey ? 1 : 0.1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, mediaType, mediaUrl, selectFrame, videoTime]);

  const createFrameStrip = useCallback((url: string, duration: number) => {
    const buildId = ++frameBuildIdRef.current;
    setFramesLoading(true);
    setFrameChoices([]);
    void buildFrameChoices(url, duration, () => frameBuildIdRef.current === buildId)
      .then((frames) => {
        if (frameBuildIdRef.current === buildId) setFrameChoices(frames);
      })
      .catch(() => {
        if (frameBuildIdRef.current === buildId) setFrameChoices([]);
      })
      .finally(() => {
        if (frameBuildIdRef.current === buildId) setFramesLoading(false);
      });
  }, []);

  useEffect(
    () => () => {
      frameBuildIdRef.current += 1;
      if (ownedMediaUrlRef.current) {
        URL.revokeObjectURL(ownedMediaUrlRef.current);
      }
    },
    [],
  );

  function resetEditor() {
    setFitMode("fill");
    setFocusX(50);
    setFocusY(50);
    setBrightness(100);
    setContrast(110);
    setSaturation(120);
    setZoom(100);
    setOverlay(22);
    setTextBackdrop(24);
    setHeadlineWidth(format === "9:16" ? 82 : 78);
    setLineSpacing(104);
    setStrokeStrength(13);
    setShadowStrength(72);
    setTextX(50);
    setTextY(format === "9:16" ? 28 : 66);
    setFontSize(format === "9:16" ? 82 : 94);
    setTextColor("#ffffff");
    setAccentColor("#ffd23f");
    setAlign("center");
    setBackgroundBlur(18);
    setVignette(18);
    setFlipHorizontal(false);
    setFont("heavy");
    setUppercase(true);
    onNotice(tr(language, "Настройки превью сброшены", "Thumbnail settings reset"));
  }

  function applyStyle(style: ThumbnailStyle) {
    setFont(style.font);
    setUppercase(style.uppercase);
    setTextColor(style.textColor);
    setAccentColor(style.accentColor);
    setStrokeStrength(style.strokeStrength);
    setShadowStrength(style.shadowStrength);
    setTextBackdrop(style.textBackdrop);
    setLineSpacing(style.lineSpacing);
    setAlign(style.align);
    setOverlay(style.overlay);
    setVignette(style.vignette);
    setBrightness(style.brightness);
    setContrast(style.contrast);
    setSaturation(style.saturation);
  }

  // ---- My styles ----------------------------------------------------------
  // A channel's thumbnails should look like one series. The style (font,
  // colours, outline, grading) is saved locally and applied in one click.
  function saveCurrentStyle() {
    const name =
      styleName.trim().slice(0, 32) ||
      tr(
        language,
        `Стиль ${savedStyles.length + 1}`,
        `Style ${savedStyles.length + 1}`,
      );
    const next = [
      ...savedStyles,
      { id: newElementId(), name, style: pickStyle(design) },
    ].slice(-MAX_SAVED_STYLES);
    setSavedStyles(next);
    persistSavedStyles(next);
    setStyleName("");
    onNotice(tr(language, `Стиль «${name}» сохранён`, `Style “${name}” saved`));
  }

  function removeSavedStyle(id: string) {
    const next = savedStyles.filter((style) => style.id !== id);
    setSavedStyles(next);
    persistSavedStyles(next);
  }

  // ---- Elements -------------------------------------------------------------
  const selectedElement = elements.find((element) => element.id === selectedElementId);

  function addElement(kind: ThumbnailElementKind, text = "") {
    const defaults: Record<ThumbnailElementKind, Partial<ThumbnailElement>> = {
      arrow: { color: "#ff3b30", size: 16, rotation: 0 },
      circle: { color: "#ff3b30", size: 14, rotation: 0 },
      emoji: { color: "#ffffff", size: 14, rotation: 0, text: text || "😱" },
      badge: {
        color: "#ff3b30",
        size: 16,
        rotation: -6,
        text: text || tr(language, "НОВОЕ", "NEW"),
      },
    };
    // New elements go to free slots on the side of the frame away from the
    // headline, one slot per element, so several added in a row neither pile
    // up on each other nor land on the text.
    const slots: Array<[number, number]> =
      textY > 50
        ? [
            [78, 24],
            [22, 24],
            [88, 46],
            [12, 46],
          ]
        : [
            [78, 78],
            [22, 78],
            [88, 55],
            [12, 55],
          ];
    const [x, y] = slots[elements.length % slots.length]!;
    // An arrow starts pointing at the middle of the frame, where the subject
    // usually is, instead of flatly to the right.
    const towardCentre =
      (Math.atan2(
        ((50 - y) / 100) * dimensions.height,
        ((50 - x) / 100) * dimensions.width,
      ) *
        180) /
      Math.PI;
    const element: ThumbnailElement = {
      id: newElementId(),
      kind,
      x,
      y,
      size: 14,
      rotation: 0,
      color: "#ff3b30",
      text: "",
      ...defaults[kind],
      ...(kind === "arrow" ? { rotation: Math.round(towardCentre) } : {}),
    };
    setElements((current) => [...current, element].slice(-12));
    setSelectedElementId(element.id);
  }

  function updateElement(id: string, patch: Partial<ThumbnailElement>) {
    setElements((current) =>
      current.map((element) =>
        element.id === id ? { ...element, ...patch } : element,
      ),
    );
  }

  function removeElement(id: string) {
    setElements((current) => current.filter((element) => element.id !== id));
    setSelectedElementId(null);
  }

  function duplicateElement(id: string) {
    const source = elements.find((element) => element.id === id);
    if (!source) return;
    const copy = {
      ...source,
      id: newElementId(),
      x: Math.min(94, source.x + 5),
      y: Math.min(94, source.y + 5),
    };
    setElements((current) => [...current, copy].slice(-12));
    setSelectedElementId(copy.id);
  }

  // ---- A/B variants ---------------------------------------------------------
  function snapshotPreview(): string {
    const canvas = canvasRef.current;
    if (!canvas) return "";
    const scale = (format === "16:9" ? 480 : 270) / canvas.width;
    const small = document.createElement("canvas");
    small.width = Math.round(canvas.width * scale);
    small.height = Math.round(canvas.height * scale);
    const context = small.getContext("2d");
    if (!context) return "";
    context.imageSmoothingQuality = "high";
    context.drawImage(canvas, 0, 0, small.width, small.height);
    try {
      return small.toDataURL("image/jpeg", 0.85);
    } catch {
      return "";
    }
  }

  function saveVariant() {
    if (variants.length >= MAX_VARIANTS) {
      onError(
        tr(
          language,
          `Можно сохранить до ${MAX_VARIANTS} вариантов — удалите лишний`,
          `Up to ${MAX_VARIANTS} variants — remove one first`,
        ),
      );
      return;
    }
    const used = new Set(variants.map((variant) => variant.label));
    const label = ["A", "B", "C", "D"].find((letter) => !used.has(letter)) ?? "A";
    setVariants((current) => [
      ...current,
      {
        id: newElementId(),
        label,
        design,
        preview: snapshotPreview(),
        videoTime: mediaType === "video" ? videoTime : null,
      },
    ]);
    onNotice(
      tr(
        language,
        `Вариант ${label} сохранён — сравните его в ленте ниже`,
        `Variant ${label} saved — compare it in the feed below`,
      ),
    );
  }

  function restoreVariant(variant: EditorVariant) {
    applyDesign(variant.design, false);
    if (variant.videoTime !== null && mediaType === "video") {
      void selectFrame(variant.videoTime);
    }
    onNotice(
      tr(
        language,
        `Открыт вариант ${variant.label}`,
        `Variant ${variant.label} opened`,
      ),
    );
  }

  // ---- Clipboard ------------------------------------------------------------
  async function copyToClipboard() {
    const canvas = canvasRef.current;
    if (!canvas || (mediaUrl && !mediaReady)) {
      // This used to return silently, so "Copy" looked broken while loading.
      onError(
        tr(
          language,
          "Дождитесь загрузки исходного кадра",
          "Wait for the source frame to finish loading",
        ),
      );
      return;
    }
    try {
      const blob = await canvasBlob(canvas, "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      onNotice(
        tr(
          language,
          "Превью скопировано в буфер обмена",
          "Thumbnail copied to the clipboard",
        ),
      );
    } catch {
      onError(
        tr(
          language,
          "Браузер не разрешил запись изображения в буфер обмена",
          "The browser did not allow copying the image",
        ),
      );
    }
  }

  function autoEnhance() {
    setBrightness(104);
    setContrast(118);
    setSaturation(128);
    setOverlay(format === "9:16" ? 18 : 22);
    setVignette(22);
    setTextBackdrop(24);
    setStrokeStrength(13);
    setShadowStrength(76);
    if (format === "9:16" && sourceRatio > 1.4) setFitMode("smart");
    onNotice(tr(language, "Автоулучшение применено", "Auto enhance applied"));
  }

  const [exporting, setExporting] = useState(false);
  // Drag-and-drop onto the stage. dragenter/dragleave fire for every child the
  // pointer crosses, so a depth counter decides when the file has really left.
  const [dropActive, setDropActive] = useState(false);
  const dropDepthRef = useRef(0);

  async function download(kind: "jpeg" | "png") {
    const canvas = canvasRef.current;
    if (!canvas || (mediaUrl && !mediaReady)) {
      onError(
        tr(
          language,
          "Дождитесь загрузки исходного кадра",
          "Wait for the source frame to finish loading",
        ),
      );
      return;
    }
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, quality } =
        kind === "png"
          ? { blob: await canvasBlob(canvas, "image/png"), quality: 1 }
          : await youtubeSafeJpeg((quality) =>
              canvasBlob(canvas, "image/jpeg", quality),
            );
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `${fileSlug(sourceVideo?.title || headline)}-${format.replace(":", "x")}.${kind === "png" ? "png" : "jpg"}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000);
      const size = formatBytes(blob.size, language);
      const fitsYouTube = blob.size <= YOUTUBE_THUMBNAIL_MAX_BYTES;
      onNotice(
        fitsYouTube
          ? tr(
              language,
              `Превью ${dimensions.width}×${dimensions.height} сохранено · ${size}${kind === "jpeg" && quality < 0.95 ? ` · качество ${Math.round(quality * 100)}%, чтобы уложиться в 2 МБ YouTube` : ""}`,
              `Thumbnail ${dimensions.width}×${dimensions.height} saved · ${size}${kind === "jpeg" && quality < 0.95 ? ` · quality ${Math.round(quality * 100)}% to fit YouTube's 2 MB` : ""}`,
            )
          : tr(
              language,
              `Сохранено, но файл ${size} — YouTube принимает превью до 2 МБ. Скачайте JPG.`,
              `Saved, but the file is ${size} — YouTube accepts thumbnails up to 2 MB. Download a JPG instead.`,
            ),
      );
    } catch {
      onError(
        tr(
          language,
          "Браузер не смог создать файл превью",
          "The browser could not create the thumbnail file",
        ),
      );
    } finally {
      setExporting(false);
    }
  }

  async function exportVideoClip() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || mediaType !== "video") return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const start = clampVideoTime(duration, trimStart);
    const end =
      trimEnd > trimStart
        ? Math.min(duration, trimEnd, start + 60)
        : Math.min(duration, start + 15);
    if (duration <= 0 || end - start < 0.05) {
      onError(
        tr(
          language,
          "Выберите фрагмент длиннее 0,05 секунды",
          "Select a clip longer than 0.05 seconds",
        ),
      );
      return;
    }
    setExportingVideo(true);
    let outputStream: MediaStream | undefined;
    let recorder: MediaRecorder | undefined;
    const originalTime = video.currentTime;
    try {
      video.pause();
      if (Math.abs(video.currentTime - start) > 0.04) {
        await seekVideo(video, start);
      }
      const stream = canvas.captureStream(30);
      outputStream = stream;
      const source = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
      };
      source
        .captureStream?.()
        .getAudioTracks()
        .forEach((track) => stream.addTrack(track));
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const activeRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: format === "9:16" ? 8_000_000 : 6_000_000,
      });
      recorder = activeRecorder;
      const chunks: Blob[] = [];
      activeRecorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const completed = new Promise<void>((resolve, reject) => {
        activeRecorder.onerror = () => reject(new Error("MediaRecorder failed"));
        activeRecorder.onstop = () => {
          if (chunks.length === 0) {
            reject(new Error("MediaRecorder returned an empty file"));
            return;
          }
          const blob = new Blob(chunks, { type: "video/webm" });
          const anchor = document.createElement("a");
          anchor.href = URL.createObjectURL(blob);
          anchor.download = `channelpilot-${format.replace(":", "x")}-clip.webm`;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000);
          resolve();
        };
      });
      activeRecorder.start(500);
      await video.play();
      const rendered = new Promise<void>((resolve, reject) => {
        const deadline =
          Date.now() + Math.max(30_000, Math.round((end - start) * 3_000 + 15_000));
        const render = () => {
          draw();
          if (video.currentTime >= end || video.ended) {
            video.pause();
            if (recorder?.state !== "inactive") recorder?.stop();
            resolve();
            return;
          }
          if (Date.now() > deadline) {
            video.pause();
            if (recorder?.state !== "inactive") recorder?.stop();
            reject(new Error("Video export timed out"));
            return;
          }
          requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
      });
      await Promise.all([rendered, completed]);
      onNotice(
        tr(language, "Видеоклип экспортирован в WebM", "Video clip exported as WebM"),
      );
    } catch (caught) {
      const detail =
        caught instanceof Error && caught.message
          ? ` · ${caught.message.slice(0, 120)}`
          : "";
      onError(
        `${tr(
          language,
          "Экспорт видео не поддерживается для этого файла",
          "Video export is not supported for this file",
        )}${detail}`,
      );
    } finally {
      video.pause();
      if (recorder && recorder.state !== "inactive") recorder.stop();
      outputStream?.getTracks().forEach((track) => track.stop());
      try {
        await seekVideo(video, originalTime);
      } catch {
        video.currentTime = clampVideoTime(
          video.duration || originalTime,
          originalTime,
        );
      }
      setExportingVideo(false);
    }
  }

  // Relative drag: the text moves by the distance the pointer travels. The
  // old handler snapped the block's centre to the pointer on the first move,
  // so grabbing a headline by its edge made it jump.
  const dragOriginRef = useRef<{
    pointerX: number;
    pointerY: number;
    textX: number;
    textY: number;
    /** Set when the drag started on an element rather than on the headline. */
    elementId: string | null;
  } | null>(null);
  const clampTextX = (value: number) => Math.max(4, Math.min(96, value));
  const clampTextY = (value: number) => Math.max(5, Math.min(92, value));
  const clampElement = (value: number) => Math.max(2, Math.min(98, value));

  function startTextDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * 100;
    const pointerY = ((event.clientY - bounds.top) / bounds.height) * 100;
    // Elements are hit-tested first, topmost wins; anywhere else moves the
    // headline, as before.
    const hit = hitThumbnailElement(
      elements,
      (pointerX / 100) * dimensions.width,
      (pointerY / 100) * dimensions.height,
      dimensions.width,
      dimensions.height,
    );
    setSelectedElementId(hit?.id ?? null);
    if (hit) setControlTab("elements");
    dragOriginRef.current = {
      pointerX,
      pointerY,
      textX: hit ? hit.x : textX,
      textY: hit ? hit.y : textY,
      elementId: hit?.id ?? null,
    };
  }

  function dragText(event: React.PointerEvent<HTMLCanvasElement>) {
    const origin = dragOriginRef.current;
    if (!origin) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * 100;
    const pointerY = ((event.clientY - bounds.top) / bounds.height) * 100;
    if (origin.elementId) {
      updateElement(origin.elementId, {
        x: clampElement(origin.textX + pointerX - origin.pointerX),
        y: clampElement(origin.textY + pointerY - origin.pointerY),
      });
      return;
    }
    setTextX(clampTextX(origin.textX + pointerX - origin.pointerX));
    setTextY(clampTextY(origin.textY + pointerY - origin.pointerY));
  }

  function endTextDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    dragOriginRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // The canvas is focusable, so the text can be placed without a mouse:
  // arrows move it by 1%, Shift+arrows by 5%.
  function nudgeText(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (selectedElement) {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeElement(selectedElement.id);
        return;
      }
      if (event.key === "Escape") {
        setSelectedElementId(null);
        return;
      }
    }
    const step = event.shiftKey ? 5 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    if (selectedElement) {
      updateElement(selectedElement.id, {
        x: clampElement(selectedElement.x + move[0]),
        y: clampElement(selectedElement.y + move[1]),
      });
      return;
    }
    setTextX((value) => clampTextX(value + move[0]));
    setTextY((value) => clampTextY(value + move[1]));
  }

  // Ctrl+V with an image or video on the clipboard loads it as the source,
  // unless the user is pasting into a text field.
  useEffect(() => {
    if (!active) return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      const file = [...(event.clipboardData?.files ?? [])].find(
        (item) => item.type.startsWith("image/") || item.type.startsWith("video/"),
      );
      if (!file) return;
      event.preventDefault();
      chooseMediaRef.current(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [active]);

  // The feed preview follows every edit, a beat after it settles: re-encoding
  // on every slider tick would cost more than it shows.
  useEffect(() => {
    if (!active || showOriginal) return;
    const timer = window.setTimeout(() => setFeedPreviewUrl(snapshotPreview()), 260);
    return () => window.clearTimeout(timer);
    // snapshotPreview reads the canvas, which `draw` repaints from these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, designKey, mediaUrl, mediaReady, videoTime, showOriginal]);

  function diagnoseThumbnail(): void {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      onError(tr(language, "Холст ещё не готов", "The canvas is not ready yet"));
      return;
    }
    try {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      setDiagnostics(analyzeThumbnailPixels(image.data, canvas.width, canvas.height));
      onNotice(
        tr(language, "Локальная диагностика готова", "Local diagnostics are ready"),
      );
    } catch {
      onError(
        tr(
          language,
          "Браузер не разрешил прочитать этот холст",
          "The browser could not read this canvas",
        ),
      );
    }
  }

  async function auditThumbnailWithAi(): Promise<void> {
    if (!allowAiMediaUploads) {
      // The toggle lives under Connections → "Передача медиа в AI"; there is
      // no "Privacy" section the old message pointed to.
      onError(
        tr(
          language,
          "Сначала включите «Передачу медиа в AI» в разделе «Подключения»",
          "Turn on “AI media uploads” under Connections first",
        ),
      );
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      onError(tr(language, "Холст ещё не готов", "The canvas is not ready yet"));
      return;
    }
    setAiThumbnailAuditLoading(true);
    setAiThumbnailAuditStatus(
      tr(language, "Подготавливаем превью…", "Preparing the thumbnail…"),
    );
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Thumbnail canvas could not be exported")),
          "image/jpeg",
          0.9,
        );
      });
      const file = new File([blob], "channelpilot-thumbnail-audit.jpg", {
        type: "image/jpeg",
      });
      const result = await analyzeMediaDirect(
        {
          title: sourceVideo?.title || headline,
          description: [
            "Audit this YouTube thumbnail.",
            "Inspect visible text and approximate text size, contrast, mobile readability, composition, faces and apparent emotion, primary object, clutter, safe zones, and alignment with the supplied title.",
            "Return concrete observations and probabilistic recommendations. Never promise a CTR increase.",
          ].join(" "),
          tags: sourceVideo?.tags ?? [],
          topic: sourceVideo?.title || headline,
          language: settings.generationLanguage,
          tone: "precise visual audit, concise, no fabricated certainty",
          task: "video_optimization",
          titleMode: "clean",
        },
        file,
        settings,
        (progress) => setAiThumbnailAuditStatus(progress.message),
      );
      setAiThumbnailAudit(result);
      onNotice(tr(language, "AI-аудит превью готов", "AI thumbnail audit is ready"));
    } catch (caught) {
      onError(
        safeErrorMessage(
          caught,
          tr(
            language,
            "Не удалось выполнить AI-аудит превью",
            "Could not run the AI thumbnail audit",
          ),
          220,
        ),
      );
    } finally {
      setAiThumbnailAuditLoading(false);
      setAiThumbnailAuditStatus("");
    }
  }

  const tabVisible = (tab: EditorTab) =>
    tab !== "clip" || (mediaType === "video" && Boolean(mediaUrl));
  const activeTab: EditorTab = tabVisible(controlTab) ? controlTab : "text";
  const headlineWords = parseHeadline(headline);
  const feedTitle =
    sourceVideo?.title ||
    headlinePlainText(headline) ||
    tr(language, "Ваш заголовок", "Your title");
  const feedChannel = channelTitle || tr(language, "Ваш канал", "Your channel");
  const feedDuration =
    sourceVideo && sourceVideo.durationSeconds > 0
      ? formatTimestamp(sourceVideo.durationSeconds)
      : format === "16:9"
        ? "12:34"
        : "";
  const feedMeta = sourceVideo
    ? tr(
        language,
        `${formatMetric(sourceVideo.views)} просмотров · недавно`,
        `${formatMetric(sourceVideo.views)} views · recently`,
      )
    : tr(language, "12 тыс. просмотров · 2 часа назад", "12K views · 2 hours ago");
  const elementLabel = (element: ThumbnailElement) =>
    element.kind === "arrow"
      ? tr(language, "Стрелка", "Arrow")
      : element.kind === "circle"
        ? tr(language, "Круг", "Circle")
        : element.kind === "badge"
          ? `${tr(language, "Бейдж", "Badge")} «${element.text}»`
          : element.text;
  // Variants are compared the way they will be shown: a feed card for 16:9,
  // a Shorts tile for 9:16 (a vertical frame in a 16:9 box was cropped).
  const variantCard = (image: string, caption: string, highlighted = false) =>
    format === "16:9" ? (
      <FeedCard
        layout="home"
        image={image}
        title={feedTitle}
        channel={feedChannel}
        avatarUrl={channelAvatarUrl}
        duration={feedDuration}
        meta={feedMeta}
        caption={caption}
        highlighted={highlighted}
      />
    ) : (
      <figure className={`feed-short small${highlighted ? " highlighted" : ""}`}>
        <div className="feed-short-frame">
          {image && <img src={image} alt="" />}
          <b>{feedTitle}</b>
        </div>
        <figcaption>{caption}</figcaption>
      </figure>
    );
  const tabs: Array<[EditorTab, string]> = [
    ["text", tr(language, "Текст", "Text")],
    ["elements", tr(language, "Элементы", "Elements")],
    ["photo", tr(language, "Фото", "Photo")],
    ["style", tr(language, "Стиль", "Style")],
    ["ai", "AI"],
    ["clip", tr(language, "Клип", "Clip")],
  ];

  return (
    <section className="thumbnail-workspace">
      <div className="section-heading editor-heading">
        <div>
          <span className="eyebrow">
            {tr(language, "ВИЗУАЛЬНАЯ МАСТЕРСКАЯ", "PREVIEW LAB")}
          </span>
          <h2>{tr(language, "Редактор превью и видео", "Thumbnail & video editor")}</h2>
          <p>
            {tr(
              language,
              "Загрузите, перетащите или вставьте (Ctrl+V) изображение или видео. Текст и элементы двигаются прямо на холсте.",
              "Upload, drop or paste (Ctrl+V) an image or video. Move text and elements directly on the canvas.",
            )}
          </p>
        </div>
        <div className="format-actions">
          <div className="format-switch">
            {(["16:9", "9:16"] as ThumbnailFormat[]).map((item) => (
              <button
                key={item}
                className={format === item ? "active" : ""}
                onClick={() => changeFormat(item)}
              >
                <i className={item === "16:9" ? "landscape-icon" : "portrait-icon"} />
                {item}
                <span>{item === "16:9" ? "YouTube" : "Shorts"}</span>
              </button>
            ))}
          </div>
          <div
            className="history-buttons"
            role="group"
            aria-label={tr(language, "История изменений", "Edit history")}
          >
            <button
              className="secondary-button"
              onClick={() => stepHistory("undo")}
              disabled={historySize.past === 0}
              aria-label={tr(language, "Отменить", "Undo")}
              title={tr(language, "Отменить · Ctrl+Z", "Undo · Ctrl+Z")}
            >
              ↶
            </button>
            <button
              className="secondary-button"
              onClick={() => stepHistory("redo")}
              disabled={historySize.future === 0}
              aria-label={tr(language, "Повторить", "Redo")}
              title={tr(language, "Повторить · Ctrl+Shift+Z", "Redo · Ctrl+Shift+Z")}
            >
              ↷
            </button>
          </div>
          <button className="secondary-button editor-reset" onClick={resetEditor}>
            ↺ {tr(language, "Сбросить", "Reset")}
          </button>
          <div
            className="export-group"
            role="group"
            aria-label={tr(language, "Экспорт", "Export")}
          >
            <button
              className="primary-button"
              disabled={(Boolean(mediaUrl) && !mediaReady) || exporting}
              aria-busy={exporting}
              onClick={() => void download("jpeg")}
              title={tr(
                language,
                "JPG до 2 МБ — столько принимает YouTube",
                "JPG under 2 MB — what YouTube accepts",
              )}
            >
              {exporting
                ? tr(language, "Сохраняем…", "Saving…")
                : tr(language, "Скачать JPG", "Download JPG")}
            </button>
            <button
              className="secondary-button"
              disabled={(Boolean(mediaUrl) && !mediaReady) || exporting}
              onClick={() => void download("png")}
            >
              PNG
            </button>
            <button
              className="secondary-button"
              disabled={Boolean(mediaUrl) && !mediaReady}
              onClick={() => void copyToClipboard()}
              title={tr(
                language,
                "Скопировать превью как изображение",
                "Copy the thumbnail as an image",
              )}
            >
              {tr(language, "Копировать", "Copy")}
            </button>
          </div>
        </div>
      </div>

      <div className="editor-layout">
        <div className="canvas-column">
          <div
            className={`canvas-stage format-${format.replace(":", "-")}${dropActive ? " drop-active" : ""}`}
            onDragEnter={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              dropDepthRef.current += 1;
              setDropActive(true);
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={() => {
              dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
              if (dropDepthRef.current === 0) setDropActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dropDepthRef.current = 0;
              setDropActive(false);
              chooseMedia(event.dataTransfer.files[0]);
            }}
          >
            <canvas
              ref={canvasRef}
              tabIndex={0}
              role="img"
              aria-label={tr(
                language,
                `Превью ${format}. Стрелки двигают текст, Shift — шагом 5%.`,
                `${format} thumbnail. Arrow keys move the text, Shift for 5% steps.`,
              )}
              onPointerDown={startTextDrag}
              onPointerMove={dragText}
              onPointerUp={endTextDrag}
              onPointerCancel={endTextDrag}
              onKeyDown={nudgeText}
            />
            {selectedElement && !showOriginal && (
              <div
                className="element-selection"
                aria-hidden="true"
                style={{
                  left: `${selectedElement.x}%`,
                  top: `${selectedElement.y}%`,
                  width: `${
                    ((elementHitRadius(
                      selectedElement,
                      Math.min(dimensions.width, dimensions.height),
                    ) *
                      2) /
                      dimensions.width) *
                    100
                  }%`,
                }}
              />
            )}
            {format === "9:16" && showGuides && !showOriginal && (
              <div className="shorts-safe-zone">
                <span>{tr(language, "БЕЗОПАСНАЯ ЗОНА", "SAFE AREA")}</span>
              </div>
            )}
            {format === "16:9" && showGuides && !showOriginal && (
              <div className="youtube-safe-zone">
                <span>{tr(language, "ЗОНА ТЕКСТА", "SAFE TEXT")}</span>
                <i>12:34</i>
              </div>
            )}
            {mediaUrl && (
              // Press and hold, not a toggle: comparing is a glance, and a
              // toggle left on is an easy way to export the wrong image.
              <button
                className={`compare-button${showOriginal ? " active" : ""}`}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setShowOriginal(true);
                }}
                onPointerUp={() => setShowOriginal(false)}
                onPointerCancel={() => setShowOriginal(false)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    setShowOriginal(true);
                  }
                }}
                onKeyUp={() => setShowOriginal(false)}
                onBlur={() => setShowOriginal(false)}
                aria-pressed={showOriginal}
              >
                {showOriginal
                  ? tr(language, "Оригинал", "Original")
                  : tr(language, "Удерживайте — оригинал", "Hold to compare")}
              </button>
            )}
            {!mediaUrl && (
              // A compact prompt at the top edge. It used to cover the whole
              // stage and sit directly under the headline, so the first thing
              // anyone typed collided with it.
              <label className="canvas-hint">
                <strong>
                  {tr(
                    language,
                    "Перетащите изображение или видео",
                    "Drop an image or video",
                  )}
                </strong>
                <span className="hint-pointer">
                  {tr(language, "или выберите файл", "or choose a file")}
                </span>
                <span className="hint-touch">
                  {tr(
                    language,
                    "Выбрать изображение или видео",
                    "Choose an image or video",
                  )}
                </span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(event) => {
                    chooseMedia(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            )}
            {dropActive && (
              <div className="canvas-drop-overlay" aria-hidden="true">
                {tr(language, "Отпустите, чтобы загрузить", "Release to upload")}
              </div>
            )}
          </div>
          <div className="stage-footer">
            <span>
              {dimensions.width} × {dimensions.height}px
            </span>
            {sourceRatio > 0 && (
              <span>
                {tr(language, "Источник", "Source")}{" "}
                {sourceRatio < 0.8
                  ? "9:16"
                  : sourceRatio > 1.4
                    ? "16:9"
                    : sourceRatio.toFixed(2)}
                {sourceResolution.width > 0
                  ? ` · ${sourceResolution.width}×${sourceResolution.height}`
                  : ""}
              </span>
            )}
            {sourceResolution.width > 0 && (
              <span
                className={
                  sourceResolution.width < dimensions.width ||
                  sourceResolution.height < dimensions.height
                    ? "source-quality low"
                    : "source-quality good"
                }
              >
                {sourceResolution.width < dimensions.width ||
                sourceResolution.height < dimensions.height
                  ? tr(
                      language,
                      "Источник меньше размера экспорта",
                      "Source is below export size",
                    )
                  : tr(
                      language,
                      "Качество источника подходит",
                      "Source quality is sufficient",
                    )}
              </span>
            )}
            <button
              className={`guide-toggle${showGuides ? " active" : ""}`}
              aria-pressed={showGuides}
              onClick={() => setShowGuides((value) => !value)}
            >
              {tr(language, "Безопасные зоны", "Safe zones")}
            </button>
            <label className="upload-button">
              {tr(language, "Загрузить медиа", "Upload media")}
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(event) => {
                  chooseMedia(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {mediaOrigin === "youtube" && (
            <div
              className={`source-warning ${format === "9:16" && sourceRatio > 1.4 ? "" : "info"}`}
            >
              <span>!</span>
              <div>
                <strong>
                  {tr(
                    language,
                    "Сейчас используется готовая обложка YouTube",
                    "The published YouTube thumbnail is being used",
                  )}
                </strong>
                <p>
                  {tr(
                    language,
                    "Загружена самая качественная доступная версия, но это не исходный видеокадр. Чтобы получить максимальную детализацию и выбрать любой момент, загрузите оригинальное видео.",
                    "The highest available version is loaded, but it is not an original video frame. Upload the source video for maximum detail and access to every moment.",
                  )}
                </p>
              </div>
              <label className="source-upload-action">
                {tr(
                  language,
                  "Загрузить видео и выбрать кадр",
                  "Upload video and choose frame",
                )}
                <input
                  type="file"
                  accept="video/*"
                  onChange={(event) => {
                    chooseMedia(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          )}
          {mediaType === "video" && mediaUrl && (
            <div className="frame-picker">
              <div className="frame-picker-head">
                <div>
                  <strong>
                    {tr(language, "Выберите любой кадр", "Choose any frame")}
                  </strong>
                  <span>
                    {tr(
                      language,
                      "Миниатюра, точный таймкод или клавиши ←/→; Shift — шаг 1 секунда",
                      "Thumbnail, exact timestamp or ←/→ keys; hold Shift for a 1-second step",
                    )}
                  </span>
                </div>
                <b>
                  {videoTime.toFixed(2)}s / {videoDuration.toFixed(2)}s
                </b>
              </div>
              <div className={`frame-strip ${framesLoading ? "loading" : ""}`}>
                {framesLoading && (
                  <div className="frame-strip-loading">
                    {tr(language, "Создаём ленту кадров…", "Building frame strip…")}
                  </div>
                )}
                {!framesLoading &&
                  frameChoices.map((frame, index) => (
                    <button
                      key={`${frame.time}-${index}`}
                      className={
                        Math.abs(videoTime - frame.time) <
                        Math.max(0.1, videoDuration / 30)
                          ? "active"
                          : ""
                      }
                      onClick={() => selectFrame(frame.time)}
                      title={`${frame.time.toFixed(2)}s`}
                    >
                      <img src={frame.url} alt="" />
                      <span>{frame.time.toFixed(1)}s</span>
                    </button>
                  ))}
              </div>
              <input
                className="frame-range"
                type="range"
                min="0"
                max={lastSeekableTime(videoDuration)}
                step=".01"
                value={videoTime}
                onChange={(event) => selectFrame(Number(event.target.value))}
              />
              <div className="precise-frame-controls">
                <button onClick={() => selectFrame(videoTime - 1)}>−1s</button>
                <button onClick={() => selectFrame(videoTime - 0.1)}>−0.1s</button>
                <label>
                  {tr(language, "Точный таймкод", "Exact timestamp")}
                  <input
                    type="number"
                    min="0"
                    max={lastSeekableTime(videoDuration)}
                    step=".01"
                    value={Number(videoTime.toFixed(2))}
                    onChange={(event) => {
                      if (event.target.value !== "") {
                        selectFrame(Number(event.target.value));
                      }
                    }}
                  />
                </label>
                <button onClick={() => selectFrame(videoTime + 0.1)}>+0.1s</button>
                <button onClick={() => selectFrame(videoTime + 1)}>+1s</button>
              </div>
            </div>
          )}
          {mediaUrl && mediaType === "image" && (
            <img
              ref={imageRef}
              src={mediaUrl}
              alt=""
              className="editor-media-source"
              onError={() => {
                if (ownedMediaUrlRef.current) {
                  URL.revokeObjectURL(ownedMediaUrlRef.current);
                  ownedMediaUrlRef.current = "";
                }
                setMediaUrl("");
                setMediaReady(false);
                setMediaOrigin("");
                setSourceRatio(0);
                setSourceResolution({ width: 0, height: 0 });
                onError(
                  tr(
                    language,
                    "Изображение повреждено или не поддерживается",
                    "The image is damaged or unsupported",
                  ),
                );
              }}
              onLoad={(event) => {
                const ratio =
                  event.currentTarget.naturalWidth /
                  Math.max(1, event.currentTarget.naturalHeight);
                setSourceRatio(ratio);
                if (format === "9:16" && ratio > 1.4) setFitMode("smart");
                setSourceResolution({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
                setMediaReady(true);
                draw();
              }}
            />
          )}
          {mediaUrl && mediaType === "video" && (
            <video
              ref={videoRef}
              src={mediaUrl}
              className="editor-media-source"
              muted
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration;
                if (!Number.isFinite(duration) || duration <= 0) {
                  onError(
                    tr(
                      language,
                      "Не удалось прочитать длительность видео",
                      "Could not read the video duration",
                    ),
                  );
                  return;
                }
                const ratio =
                  event.currentTarget.videoWidth /
                  Math.max(1, event.currentTarget.videoHeight);
                setSourceRatio(ratio);
                if (format === "9:16" && ratio > 1.4) setFitMode("smart");
                setSourceResolution({
                  width: event.currentTarget.videoWidth,
                  height: event.currentTarget.videoHeight,
                });
                setVideoDuration(duration);
                setTrimStart(0);
                setTrimEnd(Math.min(duration, 30));
                createFrameStrip(mediaUrl, duration);
              }}
              onLoadedData={() => {
                setMediaReady(true);
                draw();
              }}
              onSeeked={draw}
              onError={() => {
                if (ownedMediaUrlRef.current) {
                  URL.revokeObjectURL(ownedMediaUrlRef.current);
                  ownedMediaUrlRef.current = "";
                }
                setMediaUrl("");
                setMediaReady(false);
                setMediaOrigin("");
                setSourceRatio(0);
                setVideoDuration(0);
                setFramesLoading(false);
                setFrameChoices([]);
                setSourceResolution({ width: 0, height: 0 });
                onError(
                  tr(
                    language,
                    "Браузер не смог декодировать это видео",
                    "The browser could not decode this video",
                  ),
                );
              }}
            />
          )}
          <section className={`feed-preview surface feed-${feedTheme}`}>
            <header>
              <div>
                <span className="eyebrow">
                  {tr(language, "ПРЕДПРОСМОТР", "PREVIEW")}
                </span>
                <strong>
                  {tr(language, "Как это увидят зрители", "How viewers will see it")}
                </strong>
              </div>
              <div className="feed-actions">
                <div
                  className="feed-theme"
                  role="group"
                  aria-label={tr(language, "Тема YouTube", "YouTube theme")}
                >
                  {(["dark", "light"] as const).map((theme) => (
                    <button
                      key={theme}
                      className={feedTheme === theme ? "active" : ""}
                      aria-pressed={feedTheme === theme}
                      onClick={() => setFeedTheme(theme)}
                    >
                      {theme === "dark"
                        ? tr(language, "Тёмная", "Dark")
                        : tr(language, "Светлая", "Light")}
                    </button>
                  ))}
                </div>
                <button
                  className="secondary-button"
                  onClick={saveVariant}
                  disabled={variants.length >= MAX_VARIANTS}
                  title={tr(
                    language,
                    "Сохранить текущий дизайн, чтобы сравнить варианты",
                    "Save the current design to compare variants",
                  )}
                >
                  + {tr(language, "Вариант для сравнения", "Save variant")}
                </button>
              </div>
            </header>
            {format === "16:9" ? (
              <div className="feed-surfaces">
                <FeedCard
                  layout="home"
                  image={feedPreviewUrl}
                  title={feedTitle}
                  channel={feedChannel}
                  avatarUrl={channelAvatarUrl}
                  duration={feedDuration}
                  meta={feedMeta}
                  caption={tr(language, "Главная", "Home")}
                />
                <FeedCard
                  layout="search"
                  image={feedPreviewUrl}
                  title={feedTitle}
                  channel={feedChannel}
                  avatarUrl={channelAvatarUrl}
                  duration={feedDuration}
                  meta={feedMeta}
                  caption={tr(language, "Поиск", "Search")}
                />
                <FeedCard
                  layout="mobile"
                  image={feedPreviewUrl}
                  title={feedTitle}
                  channel={feedChannel}
                  avatarUrl={channelAvatarUrl}
                  duration={feedDuration}
                  meta={feedMeta}
                  caption={tr(language, "Телефон", "Phone")}
                />
              </div>
            ) : (
              <div className="feed-surfaces shorts">
                {(["large", "small"] as const).map((size) => (
                  <figure className={`feed-short ${size}`} key={size}>
                    <div className="feed-short-frame">
                      {feedPreviewUrl && <img src={feedPreviewUrl} alt="" />}
                      <b>{feedTitle}</b>
                      <small>{feedMeta.split(" · ")[0]}</small>
                    </div>
                    <figcaption>
                      {size === "large"
                        ? tr(language, "Полка Shorts", "Shorts shelf")
                        : tr(language, "Уменьшенный", "Small")}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            {variants.length > 0 && (
              <div className="feed-variants">
                <div className="feed-variants-head">
                  <strong>
                    {tr(language, "Сравнение вариантов", "Variant comparison")}
                  </strong>
                  <span>
                    {tr(
                      language,
                      "Нажмите на вариант, чтобы вернуть его в редактор",
                      "Click a variant to load it back into the editor",
                    )}
                  </span>
                </div>
                <div
                  className={`feed-variant-grid${format === "9:16" ? " shorts" : ""}`}
                >
                  {variantCard(
                    feedPreviewUrl,
                    tr(language, "Сейчас в редакторе", "In the editor"),
                    true,
                  )}
                  {variants.map((variant) => (
                    <div className="feed-variant" key={variant.id}>
                      {variantCard(
                        variant.preview,
                        `${tr(language, "Вариант", "Variant")} ${variant.label}`,
                      )}
                      <button
                        className="feed-variant-open"
                        onClick={() => restoreVariant(variant)}
                        aria-label={tr(
                          language,
                          `Открыть вариант ${variant.label}`,
                          `Open variant ${variant.label}`,
                        )}
                      />
                      <button
                        className="feed-variant-remove"
                        onClick={() =>
                          setVariants((current) =>
                            current.filter((item) => item.id !== variant.id),
                          )
                        }
                        aria-label={tr(
                          language,
                          `Удалить вариант ${variant.label}`,
                          `Remove variant ${variant.label}`,
                        )}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
          {diagnostics && (
            <section className="thumbnail-diagnostics surface">
              <div>
                <span className="eyebrow">
                  {tr(language, "ЛОКАЛЬНЫЙ АНАЛИЗ", "LOCAL ANALYSIS")}
                </span>
                <strong>{diagnostics.score}/100</strong>
                <p>
                  {tr(
                    language,
                    "Техническая читаемость, не прогноз CTR",
                    "Technical readability, not a CTR prediction",
                  )}
                </p>
              </div>
              <div className="diagnostic-metrics">
                <span>
                  {tr(language, "Яркость", "Brightness")}{" "}
                  <b>{diagnostics.brightness}</b>
                </span>
                <span>
                  {tr(language, "Контраст", "Contrast")} <b>{diagnostics.contrast}</b>
                </span>
                <span>
                  {tr(language, "Цвет", "Color")} <b>{diagnostics.saturation}</b>
                </span>
                <span>
                  {tr(language, "Детали", "Detail")} <b>{diagnostics.edgeDensity}</b>
                </span>
              </div>
            </section>
          )}
          {(aiThumbnailAuditLoading || aiThumbnailAudit) && (
            <section className="thumbnail-ai-audit surface">
              <header>
                <div>
                  <span className="eyebrow">
                    {tr(language, "AI-ОЦЕНКА", "AI ESTIMATE")}
                  </span>
                  <strong>
                    {tr(language, "Визуальный аудит превью", "Visual thumbnail audit")}
                  </strong>
                </div>
                <small>
                  {aiThumbnailAuditLoading
                    ? aiThumbnailAuditStatus
                    : tr(
                        language,
                        "Вероятностные рекомендации, не гарантия CTR",
                        "Probabilistic recommendations, not a CTR guarantee",
                      )}
                </small>
              </header>
              {aiThumbnailAudit && (
                <div>
                  <article>
                    <strong>{tr(language, "Что распознано", "Observed")}</strong>
                    <ul>
                      {aiThumbnailAudit.contentInsights.visualElements
                        .slice(0, 6)
                        .map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                    </ul>
                  </article>
                  <article>
                    <strong>{tr(language, "Рекомендации", "Recommendations")}</strong>
                    <ul>
                      {aiThumbnailAudit.recommendations.slice(0, 8).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                  <article>
                    <strong>
                      {tr(language, "Варианты композиции", "Composition options")}
                    </strong>
                    <ul>
                      {aiThumbnailAudit.thumbnailIdeas.slice(0, 4).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                  {aiThumbnailAudit.thumbnailPrompt && (
                    <article>
                      <strong>
                        {tr(language, "Промпт улучшения", "Improvement prompt")}
                      </strong>
                      <p>{aiThumbnailAudit.thumbnailPrompt}</p>
                    </article>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="editor-controls">
          <div
            className="editor-tabs"
            role="tablist"
            aria-label={tr(language, "Настройки превью", "Thumbnail settings")}
          >
            {tabs
              .filter(([tab]) => tabVisible(tab))
              .map(([tab, label]) => (
                <button
                  key={tab}
                  role="tab"
                  id={`editor-tab-${tab}`}
                  aria-selected={activeTab === tab}
                  aria-controls="editor-tab-panel"
                  className={activeTab === tab ? "active" : ""}
                  onClick={() => setControlTab(tab)}
                >
                  {label}
                  {tab === "elements" && elements.length > 0 && (
                    <i>{elements.length}</i>
                  )}
                </button>
              ))}
          </div>
          <div
            className="editor-tab-panel"
            role="tabpanel"
            id="editor-tab-panel"
            aria-labelledby={`editor-tab-${activeTab}`}
          >
            {activeTab === "text" && (
              <>
                <div className="control-section">
                  <div className="control-title">
                    <strong>{tr(language, "Заголовок", "Headline")}</strong>
                    <span>{headlinePlainText(headline).length}/40</span>
                  </div>
                  <label>
                    {tr(language, "Главный заголовок", "Headline")}
                    <input
                      value={headline}
                      maxLength={48}
                      onChange={(event) => setHeadline(event.target.value)}
                    />
                  </label>
                  {headlineWords.length > 0 && (
                    <div
                      className="accent-words"
                      role="group"
                      aria-label={tr(
                        language,
                        "Выделить слова акцентным цветом",
                        "Highlight words in the accent colour",
                      )}
                    >
                      <span>{tr(language, "Выделить цветом", "Highlight")}</span>
                      {headlineWords.map((word, index) => (
                        <button
                          key={`${word.text}-${index}`}
                          className={word.accent ? "active" : ""}
                          aria-pressed={word.accent}
                          style={
                            word.accent
                              ? {
                                  background: accentColor,
                                  color: readableInk(accentColor),
                                }
                              : undefined
                          }
                          onClick={() =>
                            setHeadline(toggleHeadlineWord(headline, index))
                          }
                        >
                          {word.text}
                        </button>
                      ))}
                    </div>
                  )}
                  <label>
                    {tr(language, "Подзаголовок", "Subheadline")}
                    <input
                      value={subline}
                      maxLength={30}
                      onChange={(event) => setSubline(event.target.value)}
                    />
                  </label>
                </div>
                <div className="control-section">
                  <div className="control-title">
                    <strong>{tr(language, "Шрифт и цвет", "Type & colour")}</strong>
                  </div>
                  <div className="font-grid">
                    {(Object.keys(THUMBNAIL_FONTS) as ThumbnailFont[]).map((key) => (
                      <button
                        key={key}
                        className={font === key ? "active" : ""}
                        aria-pressed={font === key}
                        onClick={() => setFont(key)}
                      >
                        <b
                          style={{
                            fontFamily: THUMBNAIL_FONTS[key].family,
                            fontWeight: THUMBNAIL_FONTS[key].weight,
                          }}
                        >
                          {uppercase ? "АБВ" : "Абв"}
                        </b>
                        <small>
                          {THUMBNAIL_FONTS[key].label[language === "ru" ? 0 : 1]}
                        </small>
                      </button>
                    ))}
                  </div>
                  <button
                    className={`editor-toggle ${uppercase ? "active" : ""}`}
                    aria-pressed={uppercase}
                    onClick={() => setUppercase((value) => !value)}
                  >
                    {tr(language, "ВСЕ ЗАГЛАВНЫЕ", "ALL CAPS")}
                  </button>
                  <ColorField
                    label={tr(language, "Цвет текста", "Text colour")}
                    value={textColor}
                    onChange={setTextColor}
                  />
                  <ColorField
                    label={tr(
                      language,
                      "Акцент — выделенные слова и подзаголовок",
                      "Accent — highlighted words and subheadline",
                    )}
                    value={accentColor}
                    onChange={setAccentColor}
                  />
                </div>
                <div className="control-section">
                  <div className="control-title">
                    <strong>
                      {tr(language, "Размер и обводка", "Size & outline")}
                    </strong>
                  </div>
                  <Range
                    label={tr(language, "Размер текста", "Text size")}
                    value={fontSize}
                    defaultValue={format === "9:16" ? 82 : 94}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={44}
                    max={170}
                    suffix="px"
                    onChange={setFontSize}
                  />
                  <Range
                    label={tr(language, "Ширина блока", "Text block width")}
                    value={headlineWidth}
                    defaultValue={format === "9:16" ? 82 : 78}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={45}
                    max={92}
                    suffix="%"
                    onChange={setHeadlineWidth}
                  />
                  <Range
                    label={tr(language, "Межстрочный интервал", "Line spacing")}
                    value={lineSpacing}
                    defaultValue={104}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={86}
                    max={135}
                    suffix="%"
                    onChange={setLineSpacing}
                  />
                  <Range
                    label={tr(language, "Фон под текстом", "Text backdrop")}
                    value={textBackdrop}
                    defaultValue={24}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={0}
                    max={75}
                    suffix="%"
                    onChange={setTextBackdrop}
                  />
                  <Range
                    label={tr(language, "Толщина обводки", "Outline thickness")}
                    value={strokeStrength}
                    defaultValue={13}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={3}
                    max={24}
                    suffix="%"
                    onChange={setStrokeStrength}
                  />
                  <Range
                    label={tr(language, "Сила тени", "Shadow strength")}
                    value={shadowStrength}
                    defaultValue={72}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={0}
                    max={100}
                    suffix="%"
                    onChange={setShadowStrength}
                  />
                  <div className="align-row">
                    <span>{tr(language, "Выравнивание", "Alignment")}</span>
                    {(["left", "center", "right"] as CanvasTextAlign[]).map((value) => (
                      <button
                        key={value}
                        className={align === value ? "active" : ""}
                        aria-label={
                          value === "left"
                            ? tr(language, "По левому краю", "Align left")
                            : value === "center"
                              ? tr(language, "По центру", "Align center")
                              : tr(language, "По правому краю", "Align right")
                        }
                        aria-pressed={align === value}
                        onClick={() => setAlign(value)}
                      >
                        <i className={`align-icon align-icon-${value}`}>
                          <span />
                          <span />
                          <span />
                        </i>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === "elements" && (
              <>
                <div className="control-section">
                  <div className="control-title">
                    <strong>
                      {tr(language, "Добавить на кадр", "Add to the frame")}
                    </strong>
                    <span>{elements.length}/12</span>
                  </div>
                  <div className="element-add-grid">
                    <button onClick={() => addElement("arrow")}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 10h11V5l7 7-7 7v-5H3z" />
                      </svg>
                      {tr(language, "Стрелка", "Arrow")}
                    </button>
                    <button onClick={() => addElement("circle")}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="8" fill="none" strokeWidth="3" />
                      </svg>
                      {tr(language, "Круг", "Circle")}
                    </button>
                    <button onClick={() => addElement("badge")}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="7" width="18" height="10" rx="3" />
                      </svg>
                      {tr(language, "Бейдж", "Badge")}
                    </button>
                  </div>
                  <div
                    className="emoji-grid"
                    role="group"
                    aria-label={tr(language, "Эмодзи", "Emoji")}
                  >
                    {EMOJI_CHOICES.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => addElement("emoji", emoji)}
                        aria-label={`${tr(language, "Добавить", "Add")} ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <p className="control-note">
                    {tr(
                      language,
                      "Перетаскивайте элементы прямо на холсте. Стрелки двигают выбранный, Delete удаляет.",
                      "Drag elements on the canvas. Arrow keys move the selected one, Delete removes it.",
                    )}
                  </p>
                  {elements.length > 0 && (
                    <div className="element-list">
                      {elements.map((element) => (
                        <button
                          key={element.id}
                          className={element.id === selectedElementId ? "active" : ""}
                          aria-pressed={element.id === selectedElementId}
                          onClick={() => setSelectedElementId(element.id)}
                        >
                          <i style={{ background: element.color }} />
                          {elementLabel(element)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedElement && (
                  <div className="control-section element-inspector">
                    <div className="control-title">
                      <strong>{elementLabel(selectedElement)}</strong>
                      <span>{tr(language, "выбран", "selected")}</span>
                    </div>
                    {selectedElement.kind === "badge" && (
                      <label>
                        {tr(language, "Текст бейджа", "Badge text")}
                        <input
                          value={selectedElement.text}
                          maxLength={14}
                          onChange={(event) =>
                            updateElement(selectedElement.id, {
                              text: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    {selectedElement.kind === "emoji" ? (
                      <div className="emoji-grid compact">
                        {EMOJI_CHOICES.map((emoji) => (
                          <button
                            key={emoji}
                            className={selectedElement.text === emoji ? "active" : ""}
                            aria-pressed={selectedElement.text === emoji}
                            onClick={() =>
                              updateElement(selectedElement.id, { text: emoji })
                            }
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <ColorField
                        label={tr(language, "Цвет", "Colour")}
                        value={selectedElement.color}
                        onChange={(color) =>
                          updateElement(selectedElement.id, { color })
                        }
                      />
                    )}
                    <Range
                      label={tr(language, "Размер", "Size")}
                      value={selectedElement.size}
                      min={5}
                      max={40}
                      suffix="%"
                      onChange={(size) => updateElement(selectedElement.id, { size })}
                    />
                    <Range
                      label={tr(language, "Поворот", "Rotation")}
                      value={selectedElement.rotation}
                      defaultValue={0}
                      resetLabel={tr(language, "Сбросить", "Reset")}
                      min={-180}
                      max={180}
                      suffix="°"
                      onChange={(rotation) =>
                        updateElement(selectedElement.id, { rotation })
                      }
                    />
                    <div className="element-actions">
                      <button
                        className="secondary-button"
                        onClick={() => duplicateElement(selectedElement.id)}
                      >
                        {tr(language, "Дублировать", "Duplicate")}
                      </button>
                      <button
                        className="secondary-button danger"
                        onClick={() => removeElement(selectedElement.id)}
                      >
                        {tr(language, "Удалить", "Delete")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {activeTab === "photo" && (
              <>
                <div className="control-section">
                  <div className="control-title">
                    <strong>{tr(language, "Кадрирование", "Cropping")}</strong>
                    <button className="text-action" onClick={autoEnhance}>
                      ✦ {tr(language, "Автоулучшение", "Auto enhance")}
                    </button>
                  </div>
                  <div className="crop-mode">
                    <button
                      className={fitMode === "fill" ? "active" : ""}
                      aria-pressed={fitMode === "fill"}
                      onClick={() => setFitMode("fill")}
                    >
                      {tr(language, "Заполнить", "Fill")}
                      <small>{tr(language, "на весь кадр", "whole canvas")}</small>
                    </button>
                    <button
                      className={fitMode === "smart" ? "active" : ""}
                      aria-pressed={fitMode === "smart"}
                      onClick={() => setFitMode("smart")}
                    >
                      {tr(language, "Вписать", "Fit")}
                      <small>{tr(language, "без обрезки", "no cropping")}</small>
                    </button>
                  </div>
                  {fitMode === "fill" && (
                    <>
                      <Range
                        label={tr(language, "Фокус по горизонтали", "Horizontal focus")}
                        value={focusX}
                        defaultValue={50}
                        resetLabel={tr(language, "Сбросить", "Reset")}
                        min={0}
                        max={100}
                        suffix="%"
                        onChange={setFocusX}
                      />
                      <Range
                        label={tr(language, "Фокус по вертикали", "Vertical focus")}
                        value={focusY}
                        defaultValue={50}
                        resetLabel={tr(language, "Сбросить", "Reset")}
                        min={0}
                        max={100}
                        suffix="%"
                        onChange={setFocusY}
                      />
                    </>
                  )}
                  {fitMode === "smart" && (
                    <Range
                      label={tr(language, "Размытие фона", "Background blur")}
                      value={backgroundBlur}
                      defaultValue={18}
                      resetLabel={tr(language, "Сбросить", "Reset")}
                      min={0}
                      max={40}
                      suffix="px"
                      onChange={setBackgroundBlur}
                    />
                  )}
                  <Range
                    label={tr(language, "Масштаб", "Zoom")}
                    value={zoom}
                    defaultValue={100}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={100}
                    max={180}
                    suffix="%"
                    onChange={setZoom}
                  />
                  <button
                    className={`editor-toggle ${flipHorizontal ? "active" : ""}`}
                    aria-pressed={flipHorizontal}
                    onClick={() => setFlipHorizontal((value) => !value)}
                  >
                    ↔ {tr(language, "Отразить по горизонтали", "Flip horizontally")}
                  </button>
                </div>
                <div className="control-section">
                  <div className="control-title">
                    <strong>{tr(language, "Цвет и свет", "Colour & light")}</strong>
                  </div>
                  <Range
                    label={tr(language, "Яркость", "Brightness")}
                    value={brightness}
                    defaultValue={100}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={50}
                    max={150}
                    suffix="%"
                    onChange={setBrightness}
                  />
                  <Range
                    label={tr(language, "Контраст", "Contrast")}
                    value={contrast}
                    defaultValue={110}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={50}
                    max={170}
                    suffix="%"
                    onChange={setContrast}
                  />
                  <Range
                    label={tr(language, "Насыщенность", "Saturation")}
                    value={saturation}
                    defaultValue={120}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={0}
                    max={190}
                    suffix="%"
                    onChange={setSaturation}
                  />
                  <Range
                    label={tr(language, "Затемнение", "Darken")}
                    value={overlay}
                    defaultValue={22}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={0}
                    max={70}
                    suffix="%"
                    onChange={setOverlay}
                  />
                  <Range
                    label={tr(language, "Виньетка", "Vignette")}
                    value={vignette}
                    defaultValue={18}
                    resetLabel={tr(language, "Сбросить", "Reset")}
                    min={0}
                    max={70}
                    suffix="%"
                    onChange={setVignette}
                  />
                </div>
              </>
            )}

            {activeTab === "style" && (
              <>
                <div className="control-section">
                  <div className="control-title">
                    <strong>{tr(language, "Готовые стили", "Presets")}</strong>
                    <span>
                      {tr(language, "шрифт, цвета, обработка", "type, colour, grading")}
                    </span>
                  </div>
                  <div className="style-grid">
                    {STYLE_PRESETS.map((preset) => (
                      <StyleCard
                        key={preset.id}
                        name={preset.label[language === "ru" ? 0 : 1]}
                        style={preset.style}
                        onApply={() => applyStyle(preset.style)}
                      />
                    ))}
                  </div>
                </div>
                <div className="control-section">
                  <div className="control-title">
                    <strong>{tr(language, "Мои стили", "My styles")}</strong>
                    <span>
                      {savedStyles.length}/{MAX_SAVED_STYLES}
                    </span>
                  </div>
                  {savedStyles.length > 0 ? (
                    <div className="style-grid">
                      {savedStyles.map((saved) => (
                        <StyleCard
                          key={saved.id}
                          name={saved.name}
                          style={saved.style}
                          onApply={() => applyStyle(saved.style)}
                          onRemove={() => removeSavedStyle(saved.id)}
                          removeLabel={tr(language, "Удалить стиль", "Remove style")}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="control-note">
                      {tr(
                        language,
                        "Сохраните шрифт, цвета и обработку — и следующие превью канала будут выглядеть как одна серия.",
                        "Save the type, colours and grading so the channel's next thumbnails look like one series.",
                      )}
                    </p>
                  )}
                  <div className="save-style-row">
                    <input
                      value={styleName}
                      maxLength={32}
                      placeholder={tr(language, "Название стиля", "Style name")}
                      onChange={(event) => setStyleName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveCurrentStyle();
                      }}
                    />
                    <button className="secondary-button" onClick={saveCurrentStyle}>
                      {tr(language, "Сохранить", "Save")}
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === "ai" && (
              <>
                <div className="control-section ai-background-control">
                  <div className="control-title">
                    <strong>
                      {tr(language, "AI-фон для превью", "AI thumbnail background")}
                    </strong>
                    <span>Gemini 3.1 Image</span>
                  </div>
                  <label>
                    {tr(language, "Опишите сцену", "Describe the scene")}
                    <textarea
                      value={aiImagePrompt}
                      maxLength={1_200}
                      onChange={(event) => setAiImagePrompt(event.target.value)}
                      placeholder={tr(
                        language,
                        "Например: герой Minecraft видит скрытую комнату, сильное удивление, яркий контраст, место для текста слева",
                        "Example: Minecraft hero discovers a hidden room, strong surprise, vivid contrast, space for text on the left",
                      )}
                    />
                  </label>
                  <div className="ai-background-actions">
                    <label>
                      {tr(language, "Качество", "Quality")}
                      <select
                        value={aiImageSize}
                        onChange={(event) =>
                          setAiImageSize(event.target.value as "1K" | "2K" | "4K")
                        }
                      >
                        <option value="1K">
                          1K · {tr(language, "быстрее", "faster")}
                        </option>
                        <option value="2K">
                          2K · {tr(language, "детальнее", "more detail")}
                        </option>
                        <option value="4K">
                          4K · {tr(language, "максимум", "maximum")}
                        </option>
                      </select>
                    </label>
                    <button
                      onClick={() => void generateAiBackground()}
                      disabled={generatingImage || aiImagePrompt.trim().length < 4}
                    >
                      {generatingImage
                        ? tr(language, "Генерируем…", "Generating…")
                        : tr(language, "Создать AI-фон", "Generate AI background")}
                    </button>
                  </div>
                  <small>
                    {allowAiMediaUploads
                      ? tr(
                          language,
                          "Если загружен кадр, AI использует его как визуальный ориентир. Текст и логотипы добавляются в редакторе отдельно.",
                          "If a frame is loaded, AI uses it as visual reference. Add text and logos separately in the editor.",
                        )
                      : tr(
                          language,
                          "Фон создаётся только по описанию. Загруженный кадр не передаётся в AI.",
                          "The background uses only your description. A loaded frame is not sent to AI.",
                        )}
                  </small>
                </div>
                <div className="control-section">
                  <div className="control-title">
                    <strong>
                      {tr(language, "Проверка превью", "Thumbnail check")}
                    </strong>
                  </div>
                  <div className="check-actions">
                    <button className="secondary-button" onClick={diagnoseThumbnail}>
                      {tr(language, "Проверить читаемость", "Check readability")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={aiThumbnailAuditLoading || !allowAiMediaUploads}
                      aria-busy={aiThumbnailAuditLoading}
                      onClick={() => void auditThumbnailWithAi()}
                    >
                      {aiThumbnailAuditLoading
                        ? tr(language, "AI анализирует…", "AI is analyzing…")
                        : tr(language, "AI-аудит", "AI audit")}
                    </button>
                  </div>
                  <p className="control-note">
                    {allowAiMediaUploads
                      ? tr(
                          language,
                          "Читаемость считается локально. AI-аудит отправляет текущий холст выбранному провайдеру.",
                          "Readability is computed locally. The AI audit sends the current canvas to the selected provider.",
                        )
                      : tr(
                          language,
                          "Читаемость считается локально. Для AI-аудита включите передачу медиа в «Подключениях».",
                          "Readability is computed locally. Enable media uploads under Connections for the AI audit.",
                        )}
                  </p>
                </div>
              </>
            )}

            {activeTab === "clip" && (
              <div className="control-section clip-control">
                <div className="control-title">
                  <strong>{tr(language, "Монтаж клипа", "Clip editor")}</strong>
                  <span>WebM</span>
                </div>
                <p className="clip-note">
                  {tr(
                    language,
                    "Экспортируется выбранный фрагмент до 60 секунд с текущим кадрированием и текстом.",
                    "Exports up to 60 seconds with the current crop and text.",
                  )}
                </p>
                <Range
                  label={tr(language, "Начало", "Start")}
                  value={Math.round(trimStart * 10) / 10}
                  min={0}
                  max={Math.max(
                    0,
                    Math.floor(lastSeekableTime(videoDuration) * 10) / 10,
                  )}
                  step={0.1}
                  suffix="s"
                  onChange={(value) =>
                    setTrimStart(
                      Math.max(
                        0,
                        Math.min(
                          value,
                          lastSeekableTime(videoDuration),
                          Math.max(0, trimEnd - 0.1),
                        ),
                      ),
                    )
                  }
                />
                <Range
                  label={tr(language, "Конец", "End")}
                  value={Math.round(trimEnd * 10) / 10}
                  min={0}
                  max={Math.max(0, Math.floor(videoDuration * 10) / 10)}
                  step={0.1}
                  suffix="s"
                  onChange={(value) =>
                    setTrimEnd(
                      Math.min(videoDuration, Math.max(value, trimStart + 0.1)),
                    )
                  }
                />
                <button
                  className="export-video"
                  disabled={exportingVideo}
                  onClick={() => void exportVideoClip()}
                >
                  {exportingVideo
                    ? tr(language, "Экспортируем видео…", "Exporting video…")
                    : tr(language, "Экспортировать клип", "Export video clip")}
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="color-field">
      <span>{label}</span>
      <div className="color-swatches">
        {COLOR_SWATCHES.map((color) => (
          <button
            key={color}
            className={value.toLowerCase() === color ? "active" : ""}
            style={{ background: color }}
            aria-label={color}
            aria-pressed={value.toLowerCase() === color}
            onClick={() => onChange(color)}
          />
        ))}
        <label className="color-custom" title={label}>
          <input
            type="color"
            value={value}
            aria-label={label}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

/** A preset or saved style, drawn as a sample of what it does to text. */
function StyleCard({
  name,
  style,
  onApply,
  onRemove,
  removeLabel,
}: {
  name: string;
  style: ThumbnailStyle;
  onApply: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const typeface = THUMBNAIL_FONTS[style.font];
  const sample = style.uppercase ? "ЭТО ТОП" : "Это топ";
  const [first, second] = sample.split(" ");
  return (
    <div className="style-card">
      <button onClick={onApply}>
        <span
          className="style-sample"
          style={{
            fontFamily: typeface.family,
            fontWeight: typeface.weight,
            color: style.textColor,
            WebkitTextStroke: `${Math.max(0.5, style.strokeStrength / 10)}px #09080c`,
            filter: `brightness(${style.brightness}%) contrast(${style.contrast}%) saturate(${style.saturation}%)`,
          }}
        >
          {first} <em style={{ color: style.accentColor }}>{second}</em>
        </span>
        <small>{name}</small>
      </button>
      {onRemove && (
        <button
          className="style-card-remove"
          onClick={onRemove}
          aria-label={removeLabel}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** One placement of the thumbnail as YouTube lays it out. */
function FeedCard({
  layout,
  image,
  title,
  channel,
  avatarUrl,
  duration,
  meta,
  caption,
  highlighted = false,
}: {
  layout: "home" | "search" | "mobile";
  image: string;
  title: string;
  channel: string;
  avatarUrl: string | undefined;
  duration: string;
  meta: string;
  caption: string;
  highlighted?: boolean;
}) {
  return (
    <figure className={`feed-card feed-${layout}${highlighted ? " highlighted" : ""}`}>
      <div className="feed-card-body">
        <div className="feed-thumb">
          {image && <img src={image} alt="" />}
          {duration && <i>{duration}</i>}
        </div>
        <div className="feed-info">
          {layout !== "search" && (
            <span className="feed-avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : channel.slice(0, 1)}
            </span>
          )}
          <div>
            <b>{title}</b>
            <small>{channel}</small>
            <small>{meta}</small>
          </div>
        </div>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Range({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
  step = 1,
  defaultValue,
  resetLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
  step?: number;
  /**
   * Where the reset control and a double-click on the label return the slider,
   * as in any photo editor. Without it the only way back to neutral was to
   * remember the number.
   */
  defaultValue?: number;
  resetLabel?: string;
}) {
  const id = useId();
  const changed = defaultValue !== undefined && value !== defaultValue;
  const reset = () => {
    if (defaultValue !== undefined) onChange(defaultValue);
  };
  // A <div> rather than a wrapping <label>: the reset control is a button, and
  // a button inside a label becomes the label's target — clicking the caption
  // would have reset the slider.
  return (
    <div
      className={`range-control${changed ? " changed" : ""}`}
      onDoubleClick={defaultValue === undefined ? undefined : reset}
    >
      <span>
        <label htmlFor={id}>{label}</label>
        <b>
          {changed && (
            <button
              type="button"
              className="range-reset"
              aria-label={`${resetLabel ?? "Reset"}: ${label}`}
              title={resetLabel ?? "Reset"}
              onClick={reset}
            >
              ↺
            </button>
          )}
          <output htmlFor={id}>
            {value}
            {suffix}
          </output>
        </b>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
