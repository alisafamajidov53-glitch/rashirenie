import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../components/ErrorBoundary";
import type {
  AiProvider,
  AnalysisResult,
  ContentSettingsPatch,
  DashboardData,
  DashboardPage,
  DockMetricId,
  ExtensionSettings,
  GoogleAuthStatus,
  GoogleSignInResult,
  PublicExtensionSettings,
  RealtimeSource,
  SupportedLanguage,
  VideoContext,
  VideoSummary,
  WidgetSectionId,
} from "@channelpilot/shared";
import {
  accentPalette,
  addWidgetEntry,
  buildChannelStyleContext,
  bucketAverage,
  dailyPace,
  DEFAULT_DOCK_METRICS,
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WIDGET_SECTIONS,
  DOCK_METRIC_IDS,
  dockWidthForMetrics,
  engagementPercent,
  formatMetric,
  formatPercent,
  formatSignedMetric,
  hourlyPace,
  moveWidgetEntry,
  normalizeAnalysisResult,
  normalizeDockMetrics,
  normalizeExtensionSettings,
  normalizeWidgetSections,
  percentChange,
  persistablePanelLayout,
  REALTIME_COLLECTION_PERIOD_MINUTES,
  realtimeWindowCoverage,
  removeWidgetEntry,
  resolvePanelLayout,
  smoothTrendPath,
  TITLE_MODE_OPTIONS,
  toggleDockMetric,
  TONE_OPTIONS,
  toPublicSettings,
  dockMetricLabel,
  WIDGET_SECTION_IDS,
  widgetSectionLabel,
} from "@channelpilot/shared";
import { rpc } from "../lib/rpc";
import { panelStyles } from "./styles";

/**
 * Attaches the panel stylesheet to a shadow root.
 *
 * The extension opens up to four shadow roots on a Studio page — the panel, the
 * header dock and the two inline assistants — and each used to get its own
 * `<style>` element holding the same ~85 KB of CSS, parsed independently. A
 * single constructed stylesheet is parsed once and shared by reference.
 *
 * `CSSStyleSheet` construction is guarded because it is unavailable in some
 * test environments (jsdom) and in older Chromium; the `<style>` path remains
 * as the fallback.
 */
let sharedPanelStyleSheet: CSSStyleSheet | null | undefined;

function applyPanelStyles(shadow: ShadowRoot): HTMLStyleElement | null {
  if (sharedPanelStyleSheet === undefined) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(panelStyles);
      sharedPanelStyleSheet = sheet;
    } catch {
      sharedPanelStyleSheet = null;
    }
  }
  if (sharedPanelStyleSheet) {
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sharedPanelStyleSheet];
    return null;
  }
  const style = document.createElement("style");
  style.textContent = panelStyles;
  shadow.append(style);
  return style;
}

/**
 * Opens the extension dashboard.
 *
 * `chrome.runtime.openOptionsPage` does not exist in a content script: the
 * content-script API surface only exposes `connect`, `getManifest`, `getURL`,
 * `id`, `onConnect`, `onMessage` and `sendMessage` from `chrome.runtime`.
 * Calling it threw `openOptionsPage is not a function` inside the click
 * handler, so every "Open dashboard" button in the widget looked alive and did
 * nothing. The service worker has the full API and opens it on request.
 */
function openDashboard(page?: DashboardPage): void {
  void rpc({ type: "OPEN_OPTIONS_PAGE", ...(page ? { page } : {}) }).catch(
    (error: unknown) => {
      // Only reachable when the extension was reloaded while this page stayed
      // open. A `window.open` fallback is not possible: the options page is not a
      // web-accessible resource, so a page-initiated navigation to it is blocked.
      // The reason ("reload the page") used to go to the console only, so the
      // button looked dead.
      const message = error instanceof Error ? error.message : String(error);
      dashboardOpenFailureListeners.forEach((listener) => listener(message));
    },
  );
}
/**
 * Module-scoped rather than a `window` event: the page shares `window` events
 * with this isolated world and could otherwise put its own text in our UI.
 */
const dashboardOpenFailureListeners = new Set<(message: string) => void>();

type Tab = "optimize" | "analytics";
/** Observation window the widget's counters are showing. */
type MetricPeriod = Exclude<DockMetricId, "subs">;
type InlinePhase = "idle" | "typing" | "analyzing" | "ready" | "error";

/** Colour class for a number that can legitimately be negative. */
function signedTone(value: number): "positive" | "negative" {
  return value >= 0 ? "positive" : "negative";
}
const RETRY_ANALYSIS_EVENT = "channelpilot:retry-analysis";
const TOP_DOCK_HOST_ID = "channelpilot-top-dock-host";
const TOP_DOCK_SPACER_ID = "channelpilot-top-dock-spacer";
const TOP_DOCK_VISIBILITY_EVENT = "channelpilot:dock-visibility";
const METRIC_PERIOD_KEY = "channelpilotMetricPeriod";
const CONTENT_SCRIPT_VERSION = chrome.runtime.getManifest().version;

interface TopDockMount {
  spacer: HTMLElement;
  host: HTMLElement;
  mount: HTMLDivElement;
}

type DockParent = Node & ParentNode;

let topDockMount: TopDockMount | null = null;
let domRootsCache: ParentNode[] = [document];
let domRootsCachedAt = 0;
let lastDockPlacementCheck = 0;
let lastDockLocation = "";
let topDockRequestedVisible = false;

function isVisibleElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 10 &&
    rect.height > 10 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight
  );
}

function isRenderedElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function openDomRoots(): ParentNode[] {
  const now = Date.now();
  if (now - domRootsCachedAt < 3_000) return domRootsCache;
  const roots: ParentNode[] = [document];
  const seen = new Set<ShadowRoot>();
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]!;
    for (const element of root.querySelectorAll("*")) {
      const shadow = element.shadowRoot;
      if (shadow && !seen.has(shadow)) {
        seen.add(shadow);
        roots.push(shadow);
      }
    }
  }
  domRootsCache = roots;
  domRootsCachedAt = now;
  return domRootsCache;
}

function queryVisibleDeep(selectors: string[]): HTMLElement | undefined {
  for (const selector of selectors) {
    const direct = [...document.querySelectorAll<HTMLElement>(selector)].find(
      isVisibleElement,
    );
    if (direct) return direct;
  }
  const roots = openDomRoots().slice(1);
  for (const selector of selectors) {
    for (const root of roots) {
      const found = [...root.querySelectorAll<HTMLElement>(selector)].find(
        isVisibleElement,
      );
      if (found) return found;
    }
  }
  return undefined;
}

function closestAcrossOpenRoots(
  element: HTMLElement,
  selectors: string,
): HTMLElement | undefined {
  let current: HTMLElement | undefined = element;
  for (let depth = 0; current && depth < 10; depth += 1) {
    const found = current.closest<HTMLElement>(selectors);
    if (found && isVisibleElement(found)) return found;
    const root = current.getRootNode();
    current =
      root instanceof ShadowRoot && root.host instanceof HTMLElement
        ? root.host
        : undefined;
  }
  return undefined;
}

function parentAcrossOpenRoot(element: HTMLElement): HTMLElement | undefined {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof HTMLElement
    ? root.host
    : undefined;
}

function searchShell(element: HTMLElement): HTMLElement {
  const named = closestAcrossOpenRoots(
    element,
    "ytcp-search, ytd-searchbox, [role='search'], #search, .search-container",
  );
  if (named) return named;

  const initialWidth = Math.max(240, element.getBoundingClientRect().width);
  let current = element;
  let best = element;
  for (let depth = 0; depth < 7; depth += 1) {
    const parent = parentAcrossOpenRoot(current);
    if (!parent) break;
    const rect = parent.getBoundingClientRect();
    if (rect.height > 90 || rect.width > Math.max(980, initialWidth * 1.45)) {
      break;
    }
    if (rect.width >= 220 && rect.height >= 32) best = parent;
    current = parent;
  }
  return best;
}

function slotBefore(anchor: ChildNode): {
  parent: DockParent;
  before: ChildNode;
} | null {
  const parent = anchor.parentNode;
  return parent && "insertBefore" in parent ? { parent: parent, before: anchor } : null;
}

function siblingAfter(anchor: ChildNode): ChildNode | null {
  return anchor.nextSibling === topDockMount?.spacer
    ? topDockMount.spacer.nextSibling
    : anchor.nextSibling;
}

function findTopDockSlot(): {
  parent: DockParent;
  before: ChildNode | null;
} | null {
  if (location.hostname === "studio.youtube.com") {
    const search = queryVisibleDeep([
      "ytcp-header ytcp-search",
      "ytcp-header [role='search']",
      "ytcp-header input[placeholder*='search' i]",
      "ytcp-header input[placeholder*='поиск' i]",
      "ytcp-search",
      "input[placeholder*='search' i]",
      "input[placeholder*='поиск' i]",
      "input[aria-label*='search' i]",
      "input[aria-label*='поиск' i]",
    ]);
    if (search) {
      const shell = searchShell(search);
      const middleSection =
        closestAcrossOpenRoots(
          shell,
          "#middle-section, .middle-section, [class*='middle-section']",
        ) ?? shell;
      const parent = middleSection.parentNode;
      if (parent && "insertBefore" in parent) {
        // Insert immediately after Studio's complete middle/search section.
        // Looking for a generic #buttons node first can select an inner action
        // group and place the widget between notification/Create controls.
        return {
          parent: parent,
          before: siblingAfter(middleSection),
        };
      }
    }

    const actions = queryVisibleDeep([
      "ytcp-header #right-section",
      "#right-section.ytcp-header",
      "ytcp-header .header-actions",
      "[aria-label*='Create' i]",
      "[aria-label*='Создать' i]",
    ]);
    const actionsParent = actions
      ? (closestAcrossOpenRoots(actions, "#right-section, .header-actions") ?? actions)
      : undefined;
    if (actionsParent) return slotBefore(actionsParent);
    return null;
  }

  // Join the right-aligned action cluster. A sibling before #end becomes a
  // separate item in the masthead's space-between layout and drifts to center.
  const mastheadEnd = queryVisibleDeep([
    "ytd-masthead #end",
    "ytd-masthead #buttons",
    "#masthead #end",
  ]);
  if (mastheadEnd) {
    return {
      parent: mastheadEnd,
      before:
        [...mastheadEnd.childNodes].find((node) => node !== topDockMount?.spacer) ??
        null,
    };
  }
  const search = queryVisibleDeep([
    "ytd-masthead ytd-searchbox",
    "ytd-masthead [role='search']",
    "ytd-masthead input[placeholder*='search' i]",
    "ytd-masthead input[placeholder*='поиск' i]",
  ]);
  if (search) {
    const shell = searchShell(search);
    const parent = shell.parentNode;
    if (parent && "insertBefore" in parent) {
      return {
        parent: parent,
        before: siblingAfter(shell),
      };
    }
  }
  return null;
}

/**
 * How many metrics the collapsed strip is currently showing.
 *
 * The spacer that reserves room in YouTube's masthead is positioned by plain
 * DOM code outside React, but its width depends on a setting React owns. The
 * widget pushes the count here whenever it changes; see `setDockMetricCount`.
 */
let dockMetricCount = DEFAULT_DOCK_METRICS.length;

function topDockWidth(): number {
  return dockWidthForMetrics(dockMetricCount, window.innerWidth);
}

function setDockMetricCount(count: number): void {
  if (count === dockMetricCount) return;
  dockMetricCount = count;
  if (!topDockMount) return;
  applyTopDockSpacerLayout(topDockMount.spacer);
  positionTopDockHost(topDockMount.host, topDockMount.spacer);
}

function applyTopDockSpacerLayout(spacer: HTMLElement): void {
  const width = topDockWidth();
  spacer.style.width = `${width}px`;
  spacer.style.minWidth = "0";
  spacer.style.maxWidth = `${width}px`;
  spacer.style.height = "40px";
  spacer.style.flex = `0 1 ${width}px`;
  spacer.style.flexShrink = "1";
  spacer.style.alignSelf = "center";
  // 4px on the left let the capsule sit flush against YouTube's search field.
  spacer.style.margin = "0 10px 0 10px";
  spacer.style.position = "relative";
  spacer.style.pointerEvents = "none";
  spacer.style.boxSizing = "border-box";
}

function positionTopDockHost(host: HTMLElement, spacer: HTMLElement): boolean {
  const rect = spacer.getBoundingClientRect();
  if (
    !spacer.isConnected ||
    rect.width < 190 ||
    rect.right <= 0 ||
    rect.left >= window.innerWidth ||
    rect.bottom <= 0 ||
    rect.top >= window.innerHeight
  ) {
    host.style.display = "none";
    return false;
  }
  const visibleLeft = Math.max(0, rect.left);
  const visibleRight = Math.min(window.innerWidth, rect.right);
  const visibleWidth = Math.floor(visibleRight - visibleLeft);
  if (visibleWidth < 190) {
    host.style.display = "none";
    return false;
  }
  const renderedHeight = 40;
  const centeredTop = rect.top + (rect.height - renderedHeight) / 2;
  host.style.display = "block";
  host.style.left = `${Math.round(visibleLeft)}px`;
  host.style.top = `${Math.max(0, Math.round(centeredTop))}px`;
  host.style.width = `${visibleWidth}px`;
  host.style.minWidth = "0";
  host.style.maxWidth = "none";
  host.style.height = `${renderedHeight}px`;
  host.style.flex = "none";
  host.style.position = "fixed";
  host.style.zIndex = "2147483644";
  host.style.overflow = "visible";
  host.style.boxSizing = "border-box";
  host.style.pointerEvents = "auto";
  return true;
}

function positionedTopDockMount(): HTMLDivElement | null {
  if (!topDockMount) return null;
  if (positionTopDockHost(topDockMount.host, topDockMount.spacer)) {
    return topDockMount.mount;
  }
  topDockMount.spacer.remove();
  return null;
}

function resetTopDockPlacement(): void {
  topDockMount?.spacer.remove();
  if (topDockMount) topDockMount.host.style.display = "none";
  lastDockPlacementCheck = 0;
}

function setTopDockVisibility(visible: boolean): void {
  const changed = topDockRequestedVisible !== visible;
  topDockRequestedVisible = visible;
  // Re-enabling the widget does not necessarily mutate YouTube's DOM, so the
  // observer cannot be relied on to mount it again before its 10s fallback.
  if (changed) document.dispatchEvent(new Event(TOP_DOCK_VISIBILITY_EVENT));
  if (!topDockMount) return;
  topDockMount.spacer.style.display = visible ? "block" : "none";
  if (visible) {
    positionTopDockHost(topDockMount.host, topDockMount.spacer);
  } else {
    topDockMount.spacer.remove();
    topDockMount.host.style.display = "none";
  }
}

function ensureTopDockMount(): HTMLDivElement | null {
  // A narrow masthead cannot reserve a readable analytics strip without
  // pushing YouTube's search/actions outside the viewport. Use the floating
  // capsule below the header instead, and restore docking on resize.
  if (
    !topDockRequestedVisible ||
    document.fullscreenElement ||
    window.innerWidth < 640
  ) {
    topDockMount?.spacer.remove();
    if (topDockMount) topDockMount.host.style.display = "none";
    return null;
  }
  const now = Date.now();
  const locationChanged = lastDockLocation !== location.href;
  if (
    topDockMount?.host.isConnected &&
    topDockMount.spacer.isConnected &&
    !locationChanged &&
    now - lastDockPlacementCheck < 2_500
  ) {
    applyTopDockSpacerLayout(topDockMount.spacer);
    return positionedTopDockMount();
  }
  lastDockPlacementCheck = now;
  lastDockLocation = location.href;
  const slot = findTopDockSlot();
  if (!slot) {
    if (
      topDockMount?.host.isConnected &&
      topDockMount.spacer.isConnected &&
      !locationChanged &&
      isRenderedElement(topDockMount.spacer)
    ) {
      applyTopDockSpacerLayout(topDockMount.spacer);
      return positionedTopDockMount();
    }
    resetTopDockPlacement();
    return null;
  }
  if (!topDockMount) {
    const spacer = document.createElement("div");
    spacer.id = TOP_DOCK_SPACER_ID;
    spacer.setAttribute("aria-hidden", "true");
    const host = document.createElement("div");
    host.id = TOP_DOCK_HOST_ID;
    host.dataset.channelpilotVersion = CONTENT_SCRIPT_VERSION;
    host.setAttribute("aria-label", "ChannelPilot realtime analytics");
    const shadow = host.attachShadow({ mode: "open" });
    applyPanelStyles(shadow);
    const mount = document.createElement("div");
    shadow.append(mount);
    document.documentElement.append(host);
    topDockMount = { spacer, host, mount };
  }
  const { spacer } = topDockMount;
  applyTopDockSpacerLayout(spacer);
  if (
    !slot.parent.isConnected ||
    (slot.before !== null && slot.before.parentNode !== slot.parent)
  ) {
    resetTopDockPlacement();
    return null;
  }
  if (spacer.parentNode !== slot.parent || spacer.nextSibling !== slot.before) {
    try {
      slot.parent.insertBefore(spacer, slot.before);
    } catch {
      // Studio can replace the header between slot discovery and insertion.
      // Fall back for this frame and retry against the new SPA tree.
      resetTopDockPlacement();
      return null;
    }
  }
  return positionedTopDockMount();
}

function installTopDockPageStyles(): void {
  if (document.getElementById("channelpilot-top-dock-page-styles")) return;
  const style = document.createElement("style");
  style.id = "channelpilot-top-dock-page-styles";
  style.textContent = `
    #${TOP_DOCK_SPACER_ID} {
      box-sizing: border-box;
      flex-shrink: 1;
      align-self: center;
    }
    #${TOP_DOCK_HOST_ID} {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
  `;
  (document.head ?? document.documentElement).append(style);
}

function ui(language: SupportedLanguage, ru: string, en: string): string {
  return language === "ru" ? ru : en;
}

/**
 * The theme YouTube or Studio is actually rendered in.
 *
 * Both mark dark mode with a `dark` attribute on <html>. The painted page
 * background is the fallback for a page that marks it some other way; `null`
 * means "cannot tell", and the caller falls back to the OS preference.
 */
function detectPageTheme(): "dark" | "light" | null {
  if (document.documentElement.hasAttribute("dark")) return "dark";
  for (const element of [document.body, document.documentElement]) {
    if (!element) continue;
    const channels = getComputedStyle(element)
      .backgroundColor.match(/[\d.]+/g)
      ?.map(Number);
    if (!channels || channels.length < 3) continue;
    const [red = 0, green = 0, blue = 0, alpha = 1] = channels;
    if (alpha < 0.5) continue;
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    return luminance < 0.5 ? "dark" : "light";
  }
  return null;
}

function seoText(language: SupportedLanguage, value: string): string {
  if (language === "ru") return value;
  const translations: Record<string, string> = {
    "Длина заголовка": "Title length",
    "Полнота описания": "Description completeness",
    "Ключи в заголовке": "Keywords in title",
    "Ключи в описании": "Keywords in description",
    Теги: "Tags",
    "Ясность и интрига": "Clarity and intrigue",
    "Оптимальный ориентир — 42–65 символов без обрезания смысла.":
      "Aim for 42–65 characters without truncating the promise.",
    "Добавьте краткий лид, структуру, полезные ссылки и естественные ключевые фразы.":
      "Add a concise lead, structure, useful links, and natural keywords.",
    "Главная поисковая фраза должна естественно появляться ближе к началу.":
      "Place the primary search phrase naturally near the beginning.",
    "Раскройте тему, не повторяя ключевые слова механически.":
      "Cover the topic without mechanically repeating keywords.",
    "Используйте 5–15 релевантных тегов: точные, широкие и брендовые.":
      "Use 5–15 relevant exact, broad, and branded tags.",
    "Обещайте конкретную пользу или создайте честный вопрос без кликбейта.":
      "Promise a concrete benefit or ask an honest question without clickbait.",
  };
  return translations[value] ?? value;
}

interface InlineSnapshot {
  phase: InlinePhase;
  result: AnalysisResult | null;
  error: string;
  mediaName?: string | undefined;
  progressMessage: string;
  previews: ThumbnailPreview[];
}

interface ThumbnailPreview {
  id: string;
  url: string;
  timestamp: number;
  title: string;
}

const TITLE_SELECTORS = [
  "ytcp-social-suggestions-textbox#title-textarea #textbox",
  "#title-textarea #textbox",
  "input[aria-label*='title' i]",
  "textarea[aria-label*='title' i]",
];
const DESCRIPTION_SELECTORS = [
  "ytcp-social-suggestions-textbox#description-textarea #textbox",
  "#description-textarea #textbox",
  "textarea[aria-label*='description' i]",
];

let inlineSnapshot: InlineSnapshot = {
  phase: "idle",
  result: null,
  error: "",
  progressMessage: "",
  previews: [],
};
const inlineListeners = new Set<(snapshot: InlineSnapshot) => void>();

function publishInline(next: Partial<InlineSnapshot>) {
  inlineSnapshot = { ...inlineSnapshot, ...next };
  for (const listener of inlineListeners) listener(inlineSnapshot);
}

function useInlineSnapshot(): InlineSnapshot {
  const [snapshot, setSnapshot] = useState(inlineSnapshot);
  useEffect(() => {
    inlineListeners.add(setSnapshot);
    return () => {
      inlineListeners.delete(setSnapshot);
    };
  }, []);
  return snapshot;
}

function findElement(selectors: string[]): HTMLElement | undefined {
  for (const selector of selectors) {
    const rendered = [...document.querySelectorAll<HTMLElement>(selector)].find(
      isRenderedElement,
    );
    if (rendered) return rendered;
  }
  return undefined;
}

function queryText(selectors: string[]): string {
  for (const selector of selectors) {
    const elements = [...document.querySelectorAll<HTMLElement>(selector)].filter(
      isRenderedElement,
    );
    for (const element of elements) {
      const value =
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.value
          : element.innerText || element.textContent || "";
      if (value.trim()) return value.trim();
    }
  }
  return "";
}

function videoIdFromLocation(): string | undefined {
  const url = new URL(location.href);
  return (
    url.searchParams.get("v") ??
    url.pathname.match(/\/video\/([^/]+)/)?.[1] ??
    undefined
  );
}

function readPageContext(): VideoContext {
  const title = queryText([
    ...TITLE_SELECTORS,
    "ytd-watch-metadata h1 yt-formatted-string",
    "h1.title",
  ]);
  const description = queryText([
    ...DESCRIPTION_SELECTORS,
    "#description-inline-expander yt-attributed-string",
  ]);
  const videoId = videoIdFromLocation();
  return {
    title,
    description,
    tags: [],
    topic: title,
    language: "ru",
    ...(videoId ? { videoId } : {}),
  };
}

function setElementValue(element: HTMLElement, value: string) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  } else {
    element.innerText = value;
  }
  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }),
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyToStudio(kind: "title" | "description", value: string): boolean {
  const element = findElement(
    kind === "title" ? TITLE_SELECTORS : DESCRIPTION_SELECTORS,
  );
  if (!element) return false;
  setElementValue(element, value);
  element.focus();
  return true;
}

function compact(value: number): string {
  return formatMetric(value);
}

function studioAnalyticsUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/analytics/tab-overview`;
}

function waitForMediaEvent(
  media: HTMLMediaElement,
  eventName: "loadedmetadata" | "seeked",
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout = 0;
    const cleanup = () => {
      window.clearTimeout(timeout);
      media.removeEventListener(eventName, onReady);
      media.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Браузер не смог декодировать загруженное медиа."));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Media analysis cancelled", "AbortError"));
    };
    timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Не удалось прочитать кадр видео: ${eventName}`));
    }, 12_000);
    media.addEventListener(eventName, onReady);
    media.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function drawCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (video.videoWidth - sourceWidth) / 2;
  const sourceY = (video.videoHeight - sourceHeight) / 2;
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

function drawSmartPortrait(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "brightness(55%) saturate(80%) blur(24px)";
  drawCover(context, video, width, height);
  context.restore();
  context.fillStyle = "rgba(0,0,0,.16)";
  context.fillRect(0, 0, width, height);
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  context.drawImage(
    video,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function drawThumbnailTitle(
  context: CanvasRenderingContext2D,
  title: string,
  width: number,
  height: number,
) {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) return;
  const words = normalized.split(" ");
  const lines: string[] = [];
  let line = "";
  const fontSize = height > width ? 86 : 62;
  context.font = `900 ${fontSize}px Arial, sans-serif`;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > width * 0.72 && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
    if (lines.length === 2 && index < words.length - 1) {
      const remaining = [line, ...words.slice(index + 1)].join(" ");
      let finalLine = remaining;
      while (
        finalLine.length > 1 &&
        context.measureText(`${finalLine}…`).width > width * 0.72
      ) {
        finalLine = finalLine.slice(0, -1).trimEnd();
      }
      line = `${finalLine}…`;
      break;
    }
  }
  if (line && lines.length < 3) lines.push(line);
  const visible = lines.slice(0, 3);
  const gradient = context.createLinearGradient(0, height * 0.4, 0, height);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,.88)");
  context.fillStyle = gradient;
  context.fillRect(0, height * 0.35, width, height * 0.65);
  context.textBaseline = "bottom";
  context.lineJoin = "round";
  context.lineWidth = 14;
  context.strokeStyle = "rgba(0,0,0,.88)";
  context.fillStyle = "#ffffff";
  visible.forEach((text, index) => {
    const baseline = height > width ? height * 0.78 : height - 58;
    const lineHeight = fontSize * 1.16;
    const x = height > width ? width * 0.09 : 58;
    const y = baseline - (visible.length - 1 - index) * lineHeight;
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
  });
  context.fillStyle = "#7b68ff";
  context.fillRect(
    height > width ? width * 0.09 : 58,
    height > width ? height * 0.81 : height - 34,
    height > width ? 220 : 170,
    8,
  );
}

async function buildThumbnailPreviews(
  file: File,
  titles: string[],
  recommendedTimestamps: number[] = [],
  signal?: AbortSignal,
): Promise<ThumbnailPreview[]> {
  if (signal?.aborted) throw new DOMException("Media analysis cancelled", "AbortError");
  if (!isVideoAnalysisFile(file)) return [];
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  try {
    const metadata = waitForMediaEvent(video, "loadedmetadata", signal);
    video.src = objectUrl;
    await metadata;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return [];
    const suggested = recommendedTimestamps
      .filter(
        (timestamp) =>
          Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= video.duration,
      )
      .filter(
        (timestamp, index, values) =>
          values.findIndex((candidate) => Math.abs(candidate - timestamp) < 0.25) ===
          index,
      )
      .slice(0, 3);
    const fractions = [0.18, 0.5, 0.82];
    const timestamps = [
      ...suggested,
      ...fractions.map((fraction) => video.duration * fraction),
    ]
      .filter(
        (timestamp, index, values) =>
          values.findIndex((candidate) => Math.abs(candidate - timestamp) < 0.25) ===
          index,
      )
      .slice(0, 3);
    const previews: ThumbnailPreview[] = [];
    for (let index = 0; index < timestamps.length; index += 1) {
      if (signal?.aborted)
        throw new DOMException("Media analysis cancelled", "AbortError");
      const timestamp = Math.min(
        Math.max(0, timestamps[index]!),
        Math.max(0, video.duration - 0.1),
      );
      const seeked = waitForMediaEvent(video, "seeked", signal);
      video.currentTime = timestamp;
      await seeked;
      if (signal?.aborted)
        throw new DOMException("Media analysis cancelled", "AbortError");
      const canvas = document.createElement("canvas");
      const isPortrait = video.videoHeight > video.videoWidth;
      canvas.width = isPortrait ? 1080 : 1280;
      canvas.height = isPortrait ? 1920 : 720;
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      if (isPortrait) {
        drawSmartPortrait(context, video, canvas.width, canvas.height);
      } else {
        drawCover(context, video, canvas.width, canvas.height);
      }
      const title = titles[index] ?? titles[0] ?? file.name.replace(/\.[^.]+$/, "");
      drawThumbnailTitle(context, title, canvas.width, canvas.height);
      previews.push({
        id: `${file.name}-${index}`,
        url: canvas.toDataURL("image/jpeg", 0.9),
        timestamp,
        title,
      });
    }
    return previews;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
    video.remove();
  }
}

function engagementRate(video: VideoSummary): string {
  return video.views > 0 ? formatPercent(engagementPercent(video)) : "0%";
}

function relativePublishedAt(
  value: string,
  language: SupportedLanguage = "ru",
): string {
  const publishedAt = new Date(value).getTime();
  if (!Number.isFinite(publishedAt))
    return ui(language, "дата неизвестна", "date unknown");
  const elapsed = Math.max(0, Date.now() - publishedAt);
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return ui(language, "меньше часа назад", "less than an hour ago");
  if (hours < 24) return ui(language, `${hours} ч назад`, `${hours}h ago`);
  const days = Math.floor(hours / 24);
  return ui(language, `${days} дн назад`, `${days}d ago`);
}

function velocityLabel(video: VideoSummary): {
  className: string;
} {
  const hour = video.observedViewsLastHour ?? 0;
  const trend = video.velocityTrendPercent ?? 0;
  const trendReady =
    video.observedMinutesLast15 >= 5 && video.previousObservedMinutes15 >= 5;
  if (video.observedMinutes < 5) {
    return { className: "warming" };
  }
  if (hour > 0 && trendReady && trend >= 40) {
    return { className: "hot" };
  }
  if (hour > 0 && (!trendReady || trend > -20)) {
    return { className: "growing" };
  }
  if (hour > 0) return { className: "cooling" };
  return { className: "quiet" };
}

function hashtags(result: AnalysisResult): string[] {
  // The model's own hashtags are chosen for the video; glued tag/keyword
  // phrases are only a fallback when it returned too few.
  return [
    ...new Set(
      [
        ...result.hashtags,
        ...(result.hashtags.length >= 3 ? [] : [...result.tags, ...result.keywords]),
      ]
        .map((item) => item.replace(/^#/, "").replace(/[^\p{L}\p{N}_]+/gu, ""))
        .filter(Boolean),
    ),
  ]
    .map((item) => `#${item}`)
    .filter((item) => item.length > 1)
    .slice(0, 8);
}

type WidgetIconName =
  "settings" | "check" | "refresh" | "collapse" | "expand" | "close" | "up" | "down";

/**
 * Stroke icons for the widget chrome. The controls used to be text glyphs
 * (⚙ ↻ × − ⌄): each font draws them at a different size and weight, so four
 * buttons side by side never lined up and looked like four different kits.
 */
function WidgetIcon({ name }: { name: WidgetIconName }) {
  const paths: Record<WidgetIconName, ReactNode> = {
    settings: (
      <>
        <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
        <circle cx="15" cy="7" r="2" />
        <circle cx="9" cy="17" r="2" />
      </>
    ),
    check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
    refresh: (
      <>
        <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
        <path d="M19.5 4.5v4h-4" />
      </>
    ),
    collapse: <path d="m6 15 6-6 6 6" />,
    expand: <path d="m6 9 6 6 6-6" />,
    close: <path d="M7 7l10 10M17 7 7 17" />,
    up: <path d="M12 18V6m-5 5 5-5 5 5" />,
    down: <path d="M12 6v12m-5-5 5 5 5-5" />,
  };
  return (
    <svg
      className="cp-widget-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

/** Smoothed area chart on a zero baseline for the widget's headline number. */
function TrendChart({ values }: { values: number[] }) {
  const gradientId = `cp-trend-fill-${useId()}`;
  const series = bucketAverage(values, 48);
  const { line, area, last } = smoothTrendPath(series, 300, 64);
  const hasData = values.length >= 2 && values.some((value) => value > 0);
  return (
    <svg
      className={`cp-trend${hasData ? "" : " empty"}`}
      viewBox="0 0 300 64"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--w-accent)" stopOpacity=".3" />
          <stop offset="1" stopColor="var(--w-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="cp-trend-area" d={area} fill={`url(#${gradientId})`} />
      <path
        className="cp-trend-line"
        d={line}
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
      {hasData && (
        <line
          className="cp-trend-now"
          x1={last.x}
          x2={last.x}
          y1={last.y}
          y2={64}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/**
 * Memoized for the same reason as RealtimeWidget: it sorts and derives over the
 * full video list, and without this it re-ran on every keystroke in the
 * Optimize tab's fields.
 */
const AnalyticsView = memo(function AnalyticsView({
  dashboard,
  currentVideo,
  loading,
  error,
  onRefresh,
  language,
}: {
  dashboard: DashboardData | null;
  currentVideo: VideoSummary | undefined;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  language: SupportedLanguage;
}) {
  if (!dashboard) {
    // Three distinct states used to collapse into one. When the dashboard
    // request failed, `dashboard` stayed null and this branch rendered
    // "Loading professional analytics…" forever, with the error in small print
    // underneath and no way to retry — even though `loading` and `onRefresh`
    // were passed in and simply went unused here.
    const failed = !loading && error.length > 0;
    return (
      <div className="cp-scroll">
        <div className="cp-analytics-loading" data-state={failed ? "error" : "loading"}>
          {failed ? (
            <>
              <strong>
                {ui(
                  language,
                  "Не удалось загрузить аналитику",
                  "Could not load analytics",
                )}
              </strong>
              <small>{error}</small>
              <button type="button" className="cp-retry" onClick={onRefresh}>
                {ui(language, "Повторить", "Try again")}
              </button>
            </>
          ) : (
            <>
              <span className="cp-live-dot" />
              <strong>
                {ui(
                  language,
                  "Получаем профессиональную аналитику…",
                  "Loading professional analytics…",
                )}
              </strong>
              <small>
                {ui(
                  language,
                  "Видео, скорость просмотров и метрики вовлечённости",
                  "Videos, view velocity and engagement metrics",
                )}
              </small>
              <div className="cp-skeleton-grid" aria-hidden="true">
                <span className="cp-skeleton" />
                <span className="cp-skeleton" />
                <span className="cp-skeleton" />
                <span className="cp-skeleton" />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (dashboard.videos.length === 0) {
    return (
      <div className="cp-scroll">
        <div className="cp-analytics-loading" data-state="empty">
          <strong>
            {ui(
              language,
              "На канале пока нет опубликованных видео",
              "This channel has no published videos yet",
            )}
          </strong>
          <small>
            {ui(
              language,
              "Метрики появятся после первой публикации.",
              "Metrics appear after the first upload.",
            )}
          </small>
          <button type="button" className="cp-retry" onClick={onRefresh}>
            {ui(language, "Обновить", "Refresh")}
          </button>
        </div>
      </div>
    );
  }

  const growing = [...dashboard.videos].sort(
    (left, right) =>
      hourlyPace(right) - hourlyPace(left) ||
      (right.velocityTrendPercent ?? 0) - (left.velocityTrendPercent ?? 0) ||
      (right.observedViewsLastHour ?? 0) - (left.observedViewsLastHour ?? 0),
  );
  const history = dashboard.history ?? [];
  const views60 = dashboard.channelObservedViewsLastHour;
  const views24 = dashboard.channelObservedViewsLast24Hours;
  const views48 = dashboard.channelObservedViewsLast48Hours;
  const hourCoverage = realtimeWindowCoverage(dashboard.channelObservedMinutes, 60);
  const dayCoverage = realtimeWindowCoverage(
    dashboard.channelObservedMinutes24Hours,
    24 * 60,
  );
  const twoDayCoverage = realtimeWindowCoverage(
    dashboard.channelObservedMinutes48Hours,
    48 * 60,
  );
  const observedHours = dayCoverage.observedMinutes / 60;
  const observedHoursText =
    observedHours >= 10 || Number.isInteger(observedHours)
      ? observedHours.toFixed(0)
      : observedHours.toFixed(1);
  const hourWindowText = hourCoverage.complete
    ? ui(language, "60 минут", "60 minutes")
    : `${hourCoverage.observedMinutes}/60 ${ui(language, "мин", "min")}`;
  const dayWindowText = dayCoverage.complete
    ? ui(language, "24 часа", "24 hours")
    : `${observedHoursText}/24 ${ui(language, "ч", "h")}`;
  const current7 = history.slice(-7).reduce((sum, day) => sum + day.views, 0);
  const previous7 = history.slice(-14, -7).reduce((sum, day) => sum + day.views, 0);
  const trendHistoryReady = history.length >= 14;
  const trend7Ready = trendHistoryReady && previous7 > 0;
  const trend7 = trend7Ready ? percentChange(current7, previous7) : 0;
  const totalHistoryViews = history.reduce((sum, day) => sum + day.views, 0);
  const retention =
    totalHistoryViews > 0 &&
    dashboard.historyDetailAvailable !== false &&
    history.every((day) => day.views === 0 || day.averageViewPercentage !== null)
      ? history.reduce(
          (sum, day) => sum + (day.averageViewPercentage ?? 0) * day.views,
          0,
        ) / totalHistoryViews
      : null;
  const watchedHours =
    history.reduce((sum, day) => sum + (day.estimatedMinutesWatched ?? 0), 0) / 60;
  const gainedSubscribers = history.reduce(
    (sum, day) => sum + (day.subscribersGained ?? 0),
    0,
  );
  const lostSubscribers = history.reduce(
    (sum, day) => sum + (day.subscribersLost ?? 0),
    0,
  );
  const netSubscribers = gainedSubscribers - lostSubscribers;
  const shares =
    dashboard.historyDetailAvailable === false ||
    history.some((day) => day.shares === null)
      ? null
      : history.reduce((sum, day) => sum + (day.shares ?? 0), 0);
  const maxVelocity = Math.max(1, ...growing.map(hourlyPace));
  // A rate for a complete window, how much is collected for an incomplete one.
  // "Full window" / "partial window" described the collector, not the channel.
  const windowNote = (
    views: number,
    coverage: ReturnType<typeof realtimeWindowCoverage>,
  ): string => {
    const hourly = coverage.targetMinutes > 60;
    if (!coverage.complete) {
      return hourly
        ? ui(
            language,
            `собрано ${Math.round(coverage.observedMinutes / 60)} из ${coverage.targetMinutes / 60} ч`,
            `${Math.round(coverage.observedMinutes / 60)} of ${coverage.targetMinutes / 60} h collected`,
          )
        : ui(
            language,
            `собрано ${coverage.observedMinutes} из 60 мин`,
            `${coverage.observedMinutes} of 60 min collected`,
          );
    }
    const rate = coverage.observedMinutes > 0 ? views / coverage.observedMinutes : 0;
    const value = hourly ? rate * 60 : rate;
    const formatted =
      value >= 100
        ? compact(Math.round(value))
        : value >= 10
          ? value.toFixed(0)
          : value.toFixed(1);
    return `≈ ${formatted} ${hourly ? ui(language, "/ ч", "/ h") : ui(language, "/ мин", "/ min")}`;
  };

  return (
    <div className="cp-scroll cp-analytics-scroll">
      <span className="cp-kicker">
        {ui(language, "АНАЛИТИКА КАНАЛА", "CHANNEL INTELLIGENCE")}
      </span>
      <div className="cp-heading-row cp-analytics-title">
        <div>
          <h2>
            {ui(language, "Профессиональная аналитика", "Professional analytics")}
          </h2>
          <span>
            {ui(
              language,
              "Что набирает просмотры прямо сейчас",
              "What is gaining views right now",
            )}
          </span>
        </div>
        {/* The same stroke icon as the widget header; the "↻"/"…" glyphs here
            were the last font-drawn controls in the panel. */}
        <button
          className={`cp-refresh${loading ? " spinning" : ""}`}
          onClick={onRefresh}
          disabled={loading}
          aria-busy={loading}
          aria-label={ui(language, "Обновить данные", "Refresh data")}
          title={ui(language, "Обновить данные", "Refresh data")}
        >
          <WidgetIcon name="refresh" />
        </button>
      </div>

      {dashboard.realtimeWarmup && (
        <div className="cp-warmup">
          {ui(
            language,
            `Каждый обнаруженный просмотр показывается сразу. Полное окно ещё накапливается: ${hourCoverage.observedMinutes} из 60 минут.`,
            `Every detected view is shown immediately. The full window is still accumulating: ${hourCoverage.observedMinutes} of 60 minutes.`,
          )}
        </div>
      )}
      {Boolean(dashboard.analyticsWarnings?.length) && (
        <div className="cp-provider-notice">
          <b>!</b>
          <span>
            {ui(
              language,
              "Часть YouTube Analytics недоступна. Проверьте Analytics API в подключениях. ",
              "Some YouTube Analytics data is unavailable. Check the Analytics API under connections. ",
            )}
            {dashboard.analyticsWarnings![0]}
          </span>
        </div>
      )}

      <div className="cp-pro-kpis">
        <article className="accent">
          <span>{hourWindowText}</span>
          <b>{compact(views60)}</b>
          <em className={hourCoverage.complete ? undefined : "warn"}>
            {windowNote(views60, hourCoverage)}
          </em>
        </article>
        <article>
          <span>{dayWindowText}</span>
          <b>{compact(views24)}</b>
          <em className={dayCoverage.complete ? undefined : "warn"}>
            {windowNote(views24, dayCoverage)}
          </em>
        </article>
        <article>
          <span>{ui(language, "48 часов", "48 hours")}</span>
          <b>{compact(views48)}</b>
          <em className={twoDayCoverage.complete ? undefined : "warn"}>
            {windowNote(views48, twoDayCoverage)}
          </em>
        </article>
        <article>
          <span>{ui(language, "Динамика 7 дней", "7-day trend")}</span>
          {/* A flat week is neither growth nor decline: it used to render as a
              green "↑ 0%" next to "Positive trend". */}
          <b
            className={
              trend7Ready && trend7 !== 0 ? (trend7 > 0 ? "positive" : "negative") : ""
            }
          >
            {!trend7Ready
              ? "—"
              : trend7 === 0
                ? "0%"
                : `${trend7 > 0 ? "↑" : "↓"} ${Math.abs(trend7)}%`}
          </b>
          <em>
            {trend7Ready
              ? `${compact(current7)} ${ui(language, "просмотров", "views")}`
              : trendHistoryReady
                ? ui(
                    language,
                    "нет базы за прошлую неделю",
                    "no previous-week baseline",
                  )
                : ui(language, "нужно 14 дней", "needs 14 days")}
          </em>
        </article>
        <article>
          <span>{ui(language, "Удержание", "Retention")}</span>
          <b>{retention === null ? "—" : formatPercent(retention)}</b>
          <em>
            {retention === null
              ? ui(language, "метрика недоступна", "metric unavailable")
              : ui(language, "средний просмотр", "average viewed")}
          </em>
        </article>
      </div>

      <section className="cp-history-chart">
        <header>
          <div>
            <strong>
              {ui(language, "Просмотры за 14 дней", "Views over 14 days")}
            </strong>
            <span>
              {compact(history.slice(-14).reduce((sum, day) => sum + day.views, 0))}
            </span>
          </div>
          <em>
            {trend7Ready
              ? trend7 > 0
                ? ui(language, "Положительная динамика", "Positive trend")
                : trend7 < 0
                  ? ui(language, "Есть снижение", "Declining")
                  : ui(language, "Без изменений", "No change")
              : trendHistoryReady
                ? ui(language, "Формируется новая база", "A new baseline is forming")
                : ui(language, "Данные накапливаются", "Data is accumulating")}
          </em>
        </header>
        <TrendChart values={history.slice(-14).map((day) => day.views)} />
        <footer>
          <span>{ui(language, "−14 дней", "−14 days")}</span>
          <span>
            {history.at(-1)?.date
              ? // Analytics dates are calendar days, so format them in UTC to
                // avoid shifting a day west of Greenwich.
                new Date(`${history.at(-1)!.date}T00:00:00Z`).toLocaleDateString(
                  language,
                  { day: "numeric", month: "short", timeZone: "UTC" },
                )
              : ui(language, "нет данных", "no data")}
          </span>
        </footer>
      </section>

      <section className="cp-pro-section">
        <div className="cp-pro-section-head">
          <div>
            <strong>
              {ui(language, "Набирают прямо сейчас", "Growing right now")}
            </strong>
            <span>
              {ui(
                language,
                `Рейтинг за ${hourWindowText}`,
                `Ranking over ${hourWindowText}`,
              )}
            </span>
          </div>
          <em>{ui(language, "Публичный счётчик", "Public counter")}</em>
        </div>
        <div className="cp-momentum-list">
          {growing.slice(0, 8).map((video, index) => {
            const status = velocityLabel(video);
            const observedVideoMinutes = Math.max(
              0,
              Math.min(60, video.observedMinutes ?? 0),
            );
            const projected24h =
              observedVideoMinutes >= 15
                ? Math.max(
                    0,
                    ((video.observedViewsLastHour ?? 0) / observedVideoMinutes) *
                      60 *
                      24,
                  )
                : null;
            return (
              <article
                className={currentVideo?.id === video.id ? "current" : ""}
                key={video.id}
              >
                <span className="cp-rank">{index + 1}</span>
                <img src={video.thumbnailUrl} alt="" />
                {/* The status badge used to share a line with the title and
                    left it ~120px ("Old Minecraft Just…"); the right column
                    stacked four lines of 11px text. The title now has the full
                    width and is the link; the status sits under it. */}
                <div className="cp-momentum-main">
                  <a
                    className="cp-momentum-title"
                    href={studioAnalyticsUrl(video.id)}
                    target="_blank"
                    rel="noreferrer"
                    title={`${video.title} — ${ui(language, "открыть аналитику видео", "open video analytics")}`}
                  >
                    {video.title}
                  </a>
                  <div className="cp-momentum-meta">
                    <span className={`cp-status ${status.className}`}>
                      {status.className === "hot"
                        ? ui(language, "Ускоряется", "Accelerating")
                        : status.className === "growing"
                          ? ui(language, "Набирает", "Growing")
                          : status.className === "cooling"
                            ? ui(language, "Замедляется", "Cooling")
                            : status.className === "warming"
                              ? ui(language, "Наблюдаем", "Observing")
                              : ui(language, "Без движения", "No movement")}
                    </span>
                    <small
                      title={
                        projected24h === null
                          ? undefined
                          : ui(
                              language,
                              `Если темп сохранится: ≈ ${compact(projected24h)} просмотров за сутки`,
                              `At this pace: ≈ ${compact(projected24h)} views a day`,
                            )
                      }
                    >
                      {relativePublishedAt(video.publishedAt, language)} · ER{" "}
                      {engagementRate(video)}
                      {projected24h !== null &&
                        ` · ≈ ${compact(projected24h)} ${ui(language, "за сутки", "/ day")}`}
                    </small>
                  </div>
                  <div className="cp-velocity-bar">
                    <i
                      style={{
                        width: `${Math.max(
                          2,
                          (hourlyPace(video) / maxVelocity) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="cp-momentum-metrics">
                  <b>+{compact(video.observedViewsLastHour ?? 0)}</b>
                  {video.observedMinutesLast15 >= 5 &&
                  video.previousObservedMinutes15 >= 5 ? (
                    <em
                      className={
                        (video.velocityTrendPercent ?? 0) > 0
                          ? "positive"
                          : (video.velocityTrendPercent ?? 0) < 0
                            ? "negative"
                            : undefined
                      }
                      title={ui(
                        language,
                        "Темп последних 15 минут против предыдущих 15",
                        "Last 15 minutes versus the 15 before",
                      )}
                    >
                      {(video.velocityTrendPercent ?? 0) === 0
                        ? "0%"
                        : `${(video.velocityTrendPercent ?? 0) > 0 ? "↑" : "↓"} ${Math.abs(video.velocityTrendPercent ?? 0)}%`}
                    </em>
                  ) : (
                    <em>
                      {ui(
                        language,
                        `${video.observedMinutesLast15}/15 мин`,
                        `${video.observedMinutesLast15}/15 min`,
                      )}
                    </em>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="cp-pro-section">
        <div className="cp-pro-section-head">
          <div>
            <strong>
              {ui(language, "Эффективность за 28 дней", "28-day performance")}
            </strong>
            <span>
              {ui(
                language,
                "Удержание, время просмотра и аудитория",
                "Retention, watch time and audience",
              )}
            </span>
          </div>
        </div>
        <div className="cp-efficiency-grid">
          <article>
            <span>{ui(language, "Время просмотра", "Watch time")}</span>
            <b>
              {compact(Math.round(watchedHours))} {ui(language, "ч", "h")}
            </b>
          </article>
          <article>
            <span>{ui(language, "Подписались", "Gained subscribers")}</span>
            <b className="positive">+{compact(gainedSubscribers)}</b>
          </article>
          <article>
            <span>{ui(language, "Отписались", "Lost subscribers")}</span>
            <b className="negative">−{compact(lostSubscribers)}</b>
          </article>
          <article>
            <span>{ui(language, "Чистый прирост", "Net growth")}</span>
            <b className={netSubscribers >= 0 ? "positive" : "negative"}>
              {formatSignedMetric(netSubscribers)}
            </b>
          </article>
          <article>
            <span>{ui(language, "Поделились", "Shares")}</span>
            <b>{shares === null ? "—" : compact(shares)}</b>
          </article>
          <article>
            <span>{ui(language, "Всего просмотров", "Total views")}</span>
            <b>{compact(totalHistoryViews)}</b>
          </article>
        </div>
      </section>

      <section className="cp-pro-section">
        <div className="cp-pro-section-head">
          <div>
            <strong>{ui(language, "Последние публикации", "Recent uploads")}</strong>
            <span>
              {ui(
                language,
                "Точные значения до 9 999 просмотров",
                "Exact values up to 9,999 views",
              )}
            </span>
          </div>
          <span>{dashboard.videos.length}</span>
        </div>
        <div className="cp-publication-list">
          {dashboard.videos.slice(0, 8).map((video) => (
            <article key={video.id}>
              <img src={video.thumbnailUrl} alt="" />
              <div>
                <strong>{video.title}</strong>
                <span>{relativePublishedAt(video.publishedAt, language)}</span>
                <small>
                  {compact(video.views)} {ui(language, "просмотров", "views")} ·{" "}
                  {compact(video.likes)} {ui(language, "лайков", "likes")} ·{" "}
                  {video.analyticsAvailable28Days ? (
                    <>
                      <b className="positive">
                        +{compact(video.subscribersGained28Days)}
                      </b>
                      /
                      <b className="negative">
                        −{compact(video.subscribersLost28Days)}
                      </b>{" "}
                      {ui(language, "подп.", "subs")}
                    </>
                  ) : (
                    ui(language, "подписки н/д", "subs n/a")
                  )}
                </small>
              </div>
              <b>{engagementRate(video)}</b>
            </article>
          ))}
        </div>
      </section>

      <div className="cp-data-note">
        <span>
          {ui(language, "Обновлено", "Updated")}{" "}
          {new Date(dashboard.sampledAt).toLocaleTimeString(language, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span>
          {ui(
            language,
            "Официальные YouTube Data + Analytics API",
            "Official YouTube Data + Analytics APIs",
          )}
        </span>
      </div>
      {error && <div className="cp-error">{error}</div>}
    </div>
  );
});

/**
 * Marks a metric for a moment whenever its value actually changes, so a live
 * counter update is visible instead of silently swapping digits.
 */
function useValueFlash(entries: ReadonlyArray<readonly [string, number]>): Set<string> {
  const signature = entries.map(([key, value]) => `${key}:${value}`).join("|");
  const previousRef = useRef(new Map<string, number>());
  const timersRef = useRef(new Map<string, number>());
  const [flashing, setFlashing] = useState<Set<string>>(new Set());

  useEffect(() => {
    const changed: string[] = [];
    for (const [key, value] of entries) {
      const previous = previousRef.current.get(key);
      if (previous !== undefined && previous !== value) changed.push(key);
      previousRef.current.set(key, value);
    }
    if (changed.length === 0) return;
    setFlashing((current) => new Set([...current, ...changed]));
    for (const key of changed) {
      const running = timersRef.current.get(key);
      if (running) window.clearTimeout(running);
      timersRef.current.set(
        key,
        window.setTimeout(() => {
          timersRef.current.delete(key);
          setFlashing((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }, 900),
      );
    }
    // `signature` is a serialization of `entries`, so it already tracks the
    // values this effect reads. Depending on `entries` itself would depend on
    // the array's identity, which is new on every render, and the flash would
    // re-arm continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);

  return flashing;
}

/**
 * Memoized: this subtree is portalled into the YouTube masthead and only needs
 * to re-render when its own data changes. Its props are all primitives, the
 * dashboard snapshot object, and the stable handlers built in App.
 */
const RealtimeWidget = memo(function RealtimeWidget({
  dashboard,
  signedIn,
  loading,
  failure,
  signingIn,
  panelOpen,
  docked,
  reauthRequired,
  theme,
  sections,
  dockMetrics,
  launcherVisible,
  onOpen,
  onRefresh,
  onSignIn,
  onHide,
  onComposition,
  language,
}: {
  dashboard: DashboardData | null;
  signedIn: boolean | null;
  loading: boolean;
  /** Last analytics error; empty once a refresh succeeds. */
  failure: string;
  signingIn: boolean;
  panelOpen: boolean;
  docked: boolean;
  reauthRequired: boolean;
  theme: "dark" | "light";
  sections: WidgetSectionId[];
  dockMetrics: DockMetricId[];
  /** The floating launcher shares the bottom-right corner with this card. */
  launcherVisible: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onSignIn: () => void;
  onHide: () => void;
  onComposition: (patch: {
    widgetSections?: WidgetSectionId[];
    widgetDockMetrics?: DockMetricId[];
  }) => void;
  language: SupportedLanguage;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const editToggleRef = useRef<HTMLButtonElement>(null);
  // Read by the document-level Escape handler, which is registered once per
  // expansion and must not be re-bound every time edit mode toggles.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // Leaving the editor unmounts whatever had focus inside it. Focus goes back
  // to the toggle from an effect rather than a requestAnimationFrame: rAF does
  // not run in a background tab, and the effect runs right after the commit
  // that removed the editor.
  const restoreToggleFocusRef = useRef(false);
  useEffect(() => {
    if (editing || !restoreToggleFocusRef.current) return;
    restoreToggleFocusRef.current = false;
    editToggleRef.current?.focus();
  }, [editing]);
  const finishEditing = () => {
    restoreToggleFocusRef.current = true;
    setEditing(false);
  };
  const widgetRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      // composedPath preserves the actual target across our shadow boundary.
      if (widgetRef.current && !event.composedPath().includes(widgetRef.current)) {
        setExpanded(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement) return;
      // Escape unwinds one layer at a time: out of the editor first, and only
      // then out of the expanded card.
      if (editingRef.current) {
        restoreToggleFocusRef.current = true;
        setEditing(false);
        return;
      }
      setExpanded(false);
      requestAnimationFrame(() => expandRef.current?.focus());
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);
  // The masthead spacer is sized by plain DOM code, so the count has to be
  // pushed to it rather than read from React state.
  useEffect(() => {
    setDockMetricCount(dockMetrics.length);
  }, [dockMetrics.length]);
  // Leaving the expanded card closes the editor with it: an edit mode that
  // survives out of sight is a surprise the next time the widget is opened.
  useEffect(() => {
    if (!expanded) setEditing(false);
  }, [expanded]);
  const [metricPeriod, setMetricPeriod] = useState<MetricPeriod>(() => {
    try {
      const saved = sessionStorage.getItem(METRIC_PERIOD_KEY);
      return saved === "24h" || saved === "48h" || saved === "all" ? saved : "60m";
    } catch {
      return "60m";
    }
  });
  const chooseMetricPeriod = (next: MetricPeriod) => {
    setMetricPeriod(next);
    try {
      sessionStorage.setItem(METRIC_PERIOD_KEY, next);
    } catch {
      // The metric still switches when page storage is unavailable.
    }
  };
  const views60 = dashboard?.channelObservedViewsLastHour ?? 0;
  const views24 = dashboard?.channelObservedViewsLast24Hours ?? 0;
  const views48 = dashboard?.channelObservedViewsLast48Hours ?? 0;
  const allViews = dashboard?.channel.views ?? 0;
  const hourCoverage = realtimeWindowCoverage(
    dashboard?.channelObservedMinutes ?? 0,
    60,
  );
  const dayCoverage = realtimeWindowCoverage(
    dashboard?.channelObservedMinutes24Hours ?? 0,
    24 * 60,
  );
  const twoDayCoverage = realtimeWindowCoverage(
    dashboard?.channelObservedMinutes48Hours ?? 0,
    48 * 60,
  );
  const shortCoverageLabel = (coverage: ReturnType<typeof realtimeWindowCoverage>) => {
    if (coverage.targetMinutes === 60) {
      return ui(language, "60 мин", "60 min");
    }
    if (coverage.targetMinutes === 48 * 60) {
      return ui(language, "48 часов", "48 hours");
    }
    return ui(language, "24 часа", "24 hours");
  };
  const observedHoursLabel = (coverage: ReturnType<typeof realtimeWindowCoverage>) => {
    const value = coverage.observedMinutes / 60;
    return value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  };
  const coverageDescription = (coverage: ReturnType<typeof realtimeWindowCoverage>) =>
    ui(
      language,
      coverage.complete
        ? `Полное окно ${coverage.targetMinutes} минут`
        : `Накоплено ${coverage.observedMinutes} из ${coverage.targetMinutes} минут`,
      coverage.complete
        ? `Full ${coverage.targetMinutes}-minute window`
        : `${coverage.observedMinutes} of ${coverage.targetMinutes} minutes observed`,
    );
  const sourceDescription = (source: RealtimeSource | undefined) =>
    source === "hybrid_video_delta"
      ? ui(
          language,
          "быстрый сигнал: максимум общего счётчика и прироста видео",
          "fast signal: maximum of channel and per-video deltas",
        )
      : source === "channel_total"
        ? ui(
            language,
            "публичный счётчик просмотров канала",
            "public channel view counter",
          )
        : ui(language, "источник недоступен", "source unavailable");
  const history = dashboard?.history ?? [];
  const subscribersGained = history.reduce(
    (sum, day) => sum + (day.subscribersGained ?? 0),
    0,
  );
  const subscribersLost = history.reduce(
    (sum, day) => sum + (day.subscribersLost ?? 0),
    0,
  );
  const subscribersNet = subscribersGained - subscribersLost;
  const flashing = useValueFlash([
    ["60m", views60],
    ["24h", views24],
    ["48h", views48],
    ["all", allViews],
    ["subs", subscribersNet],
  ]);
  const totalHistoryViews = history.reduce((sum, day) => sum + day.views, 0);
  const retention =
    totalHistoryViews > 0 &&
    dashboard?.historyDetailAvailable !== false &&
    history.every((day) => day.views === 0 || day.averageViewPercentage !== null)
      ? history.reduce(
          (sum, day) => sum + (day.averageViewPercentage ?? 0) * day.views,
          0,
        ) / totalHistoryViews
      : null;
  const metricForVideo = (video: VideoSummary) =>
    metricPeriod === "60m"
      ? video.observedViewsLastHour
      : metricPeriod === "24h"
        ? video.observedViewsLast24Hours
        : metricPeriod === "48h"
          ? video.observedViewsLast48Hours
          : video.views;
  const comparisonMetricForVideo = (video: VideoSummary) =>
    metricPeriod === "60m"
      ? hourlyPace(video)
      : metricPeriod === "24h"
        ? dailyPace(video)
        : metricPeriod === "48h"
          ? video.observedViewsLast48Hours
          : video.views;
  const leaders = [...(dashboard?.videos ?? [])].sort(
    (left, right) =>
      comparisonMetricForVideo(right) - comparisonMetricForVideo(left) ||
      metricForVideo(right) - metricForVideo(left),
  );
  const visibleLeaders =
    metricPeriod === "all"
      ? leaders
      : leaders.filter((video) => metricForVideo(video) > 0);
  const subscriberSources = [...(dashboard?.videos ?? [])]
    .filter(
      (video) => video.subscribersGained28Days > 0 || video.subscribersLost28Days > 0,
    )
    .sort(
      (left, right) =>
        right.subscribersGained28Days -
        right.subscribersLost28Days -
        (left.subscribersGained28Days - left.subscribersLost28Days),
    );
  const realtimeSeries = dashboard?.realtimeSeries ?? [];
  const realtimeRates = realtimeSeries.slice(1).map((point, index) => {
    const previous = realtimeSeries[index]!;
    const elapsedMinutes = Math.max(
      1 / 60,
      (point.capturedAt - previous.capturedAt) / 60_000,
    );
    return {
      capturedAt: point.capturedAt,
      viewsPerMinute: Math.max(0, point.views - previous.views) / elapsedMinutes,
    };
  });
  const latestRealtimeAt = realtimeSeries.at(-1)?.capturedAt ?? 0;
  const periodValue =
    metricPeriod === "60m"
      ? views60
      : metricPeriod === "24h"
        ? views24
        : metricPeriod === "48h"
          ? views48
          : allViews;
  const compactMetricValue = (value: number): string => {
    if (dashboard) return compact(value);
    if (loading || signedIn === null) return "…";
    if (signedIn === false || reauthRequired) return "↻";
    return "!";
  };
  // The dot promised "live" even with no channel connected or after a failed
  // load. Grey means no data yet, amber means data you should not trust as live.
  const liveDotState = !dashboard
    ? failure || reauthRequired
      ? "warning"
      : "idle"
    : reauthRequired || failure || dashboard.stale || dashboard.realtimeWarmup
      ? "warning"
      : "";
  const compactMetricState = dashboard
    ? ""
    : loading || signedIn === null
      ? ui(language, "Данные загружаются", "Data is loading")
      : signedIn === false
        ? ui(language, "Подключите Google", "Connect Google")
        : reauthRequired
          ? ui(language, "Обновите Google-сессию", "Refresh the Google session")
          : ui(
              language,
              "Данные временно недоступны",
              "Data is temporarily unavailable",
            );
  const periodLabel =
    metricPeriod === "60m"
      ? hourCoverage.complete
        ? ui(language, "Просмотры за 60 минут", "Views in the last 60 minutes")
        : ui(
            language,
            `Просмотры за ${hourCoverage.observedMinutes} мин наблюдения`,
            `Views during ${hourCoverage.observedMinutes} observed minutes`,
          )
      : metricPeriod === "24h"
        ? dayCoverage.complete
          ? ui(language, "Просмотры за 24 часа", "Views in the last 24 hours")
          : ui(
              language,
              `Просмотры за ${observedHoursLabel(dayCoverage)} ч наблюдения`,
              `Views during ${observedHoursLabel(dayCoverage)} observed hours`,
            )
        : metricPeriod === "48h"
          ? twoDayCoverage.complete
            ? ui(language, "Просмотры за 48 часов", "Views in the last 48 hours")
            : ui(
                language,
                `Просмотры за ${observedHoursLabel(twoDayCoverage)} ч наблюдения`,
                `Views during ${observedHoursLabel(twoDayCoverage)} observed hours`,
              )
          : ui(language, "Просмотры за всё время", "All-time views");
  const periodNote =
    metricPeriod === "60m"
      ? `${sourceDescription(dashboard?.channelRealtimeSource)} · ${coverageDescription(hourCoverage)}`
      : metricPeriod === "24h"
        ? `${sourceDescription(dashboard?.channelRealtimeSource24Hours)} · ${coverageDescription(dayCoverage)}`
        : metricPeriod === "48h"
          ? `${sourceDescription(dashboard?.channelRealtimeSource48Hours)} · ${coverageDescription(twoDayCoverage)}`
          : ui(
              language,
              `${compact(dashboard?.channel.videos ?? 0)} опубликованных видео`,
              `${compact(dashboard?.channel.videos ?? 0)} published videos`,
            );
  const primarySeries =
    metricPeriod === "all"
      ? history.map((day) => day.views)
      : metricPeriod === "24h"
        ? realtimeRates
            .filter((point) => point.capturedAt >= latestRealtimeAt - 24 * 60 * 60_000)
            .map((point) => point.viewsPerMinute)
        : metricPeriod === "48h"
          ? realtimeRates
              .filter(
                (point) => point.capturedAt >= latestRealtimeAt - 48 * 60 * 60_000,
              )
              .map((point) => point.viewsPerMinute)
          : realtimeRates
              .filter((point) => point.capturedAt >= latestRealtimeAt - 60 * 60_000)
              .map((point) => point.viewsPerMinute);

  /**
   * Everything the collapsed strip needs to render one metric. It used to
   * hard-code three of these inline; now that the user picks which appear they
   * are described once and looked up by id.
   */
  const dockMetricDefs: Record<
    DockMetricId,
    {
      label: string;
      editorLabel: string;
      value: number;
      coverage: ReturnType<typeof realtimeWindowCoverage> | null;
      source: RealtimeSource | undefined;
      signed: boolean;
    }
  > = {
    // Strip labels are abbreviated on purpose: with all five metrics switched
    // on each column gets ~47px of text, and "48 ЧАСОВ" / "ПОДПИСКИ" ellipsised.
    // The full wording lives in the tooltip and in the editor.
    "60m": {
      label: ui(language, "60 мин", "60 min"),
      editorLabel: dockMetricLabel("60m", language),
      value: views60,
      coverage: hourCoverage,
      source: dashboard?.channelRealtimeSource,
      signed: false,
    },
    "24h": {
      label: ui(language, "24 ч", "24 h"),
      editorLabel: dockMetricLabel("24h", language),
      value: views24,
      coverage: dayCoverage,
      source: dashboard?.channelRealtimeSource24Hours,
      signed: false,
    },
    "48h": {
      label: ui(language, "48 ч", "48 h"),
      editorLabel: dockMetricLabel("48h", language),
      value: views48,
      coverage: twoDayCoverage,
      source: dashboard?.channelRealtimeSource48Hours,
      signed: false,
    },
    all: {
      label: ui(language, "Всего", "Total"),
      editorLabel: dockMetricLabel("all", language),
      value: allViews,
      coverage: null,
      source: undefined,
      signed: false,
    },
    subs: {
      label: ui(language, "Подп.", "Subs"),
      editorLabel: dockMetricLabel("subs", language),
      value: subscribersNet,
      coverage: null,
      source: undefined,
      signed: true,
    },
  };
  const sectionLabels: Record<WidgetSectionId, string> = {
    primary: widgetSectionLabel("primary", language),
    kpis: widgetSectionLabel("kpis", language),
    subscribers: widgetSectionLabel("subscribers", language),
    // The leaderboard ranks by pace inside a window, and by lifetime total when
    // the window is "all time" — the heading follows what it is showing.
    leaders:
      metricPeriod === "all"
        ? ui(language, "Лучшие видео", "Top videos")
        : widgetSectionLabel("leaders", language),
    sources: widgetSectionLabel("sources", language),
  };
  const hiddenSections = WIDGET_SECTION_IDS.filter((id) => !sections.includes(id));
  /**
   * Where keyboard focus should land once the next composition renders.
   *
   * Every edit re-renders or unmounts the control that triggered it: a moved
   * block is re-inserted by key, a removed block takes its × with it, an added
   * block's chip disappears. Each of those dropped focus to <body>, so a
   * keyboard user lost their place after every single step.
   */
  const focusAfterEditRef = useRef<string | null>(null);
  useEffect(() => {
    const selector = focusAfterEditRef.current;
    focusAfterEditRef.current = null;
    if (!selector || !widgetRef.current) return;
    const target = widgetRef.current.querySelector<HTMLButtonElement>(selector);
    // A block moved to either end has its matching arrow disabled; the other
    // arrow of the same block is the next useful stop.
    const usable =
      target && !target.disabled
        ? target
        : (target
            ?.closest(".cp-block-tools")
            ?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? null);
    usable?.focus();
  }, [sections]);
  const changeSections = (next: WidgetSectionId[], focusSelector?: string) => {
    focusAfterEditRef.current = focusSelector ?? null;
    onComposition({ widgetSections: next });
  };

  // Plain-language rates. The cards used to say "Full 1440-minute window",
  // which is how the collector thinks, not how a creator reads a counter.
  const perMinute = (views: number, minutes: number) =>
    minutes > 0 ? views / minutes : 0;
  const formatRate = (value: number) =>
    value >= 100
      ? compact(Math.round(value))
      : value >= 10
        ? value.toFixed(0)
        : value.toFixed(1);
  const hourRate = `≈ ${formatRate(perMinute(views60, hourCoverage.observedMinutes))} ${ui(language, "/ мин", "/ min")}`;
  const dayRate = `≈ ${formatRate(perMinute(views24, dayCoverage.observedMinutes) * 60)} ${ui(language, "/ ч", "/ h")}`;
  const twoDayRate = `≈ ${formatRate(perMinute(views48, twoDayCoverage.observedMinutes) * 60)} ${ui(language, "/ ч", "/ h")}`;
  const collectedLabel = (coverage: ReturnType<typeof realtimeWindowCoverage>) =>
    coverage.targetMinutes === 60
      ? ui(
          language,
          `собрано ${coverage.observedMinutes} из 60 мин`,
          `${coverage.observedMinutes} of 60 min collected`,
        )
      : ui(
          language,
          `собрано ${observedHoursLabel(coverage)} из ${coverage.targetMinutes / 60} ч`,
          `${observedHoursLabel(coverage)} of ${coverage.targetMinutes / 60} h collected`,
        );
  const activeCoverage =
    metricPeriod === "60m"
      ? hourCoverage
      : metricPeriod === "24h"
        ? dayCoverage
        : metricPeriod === "48h"
          ? twoDayCoverage
          : null;
  const heroRate =
    metricPeriod === "60m"
      ? hourRate
      : metricPeriod === "24h"
        ? dayRate
        : metricPeriod === "48h"
          ? twoDayRate
          : ui(
              language,
              `+${compact(totalHistoryViews)} за 28 дней`,
              `+${compact(totalHistoryViews)} in 28 days`,
            );
  const heroBadge: { text: string; tone: "live" | "warn" | "muted" } | null =
    dashboard?.stale || failure
      ? { text: ui(language, "Снимок", "Snapshot"), tone: "warn" }
      : activeCoverage && !activeCoverage.complete
        ? { text: ui(language, "Сбор данных", "Collecting"), tone: "warn" }
        : activeCoverage
          ? { text: "Live", tone: "live" }
          : { text: ui(language, "28 дней", "28 days"), tone: "muted" };
  const shortDate = (iso: string | undefined) =>
    iso
      ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(language, {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })
      : "";
  const chartAxis: [string, string] =
    metricPeriod === "all"
      ? [shortDate(history[0]?.date), shortDate(history.at(-1)?.date)]
      : [
          metricPeriod === "60m"
            ? ui(language, "−60 мин", "−60 min")
            : metricPeriod === "24h"
              ? ui(language, "−24 ч", "−24 h")
              : ui(language, "−48 ч", "−48 h"),
          ui(language, "сейчас", "now"),
        ];
  const subscriberTotal = subscribersGained + subscribersLost;
  const gainedShare =
    subscriberTotal > 0 ? (subscribersGained / subscriberTotal) * 100 : 50;
  const statusText = (status: ReturnType<typeof velocityLabel>) =>
    status.className === "hot"
      ? ui(language, "ускоряется", "accelerating")
      : status.className === "growing"
        ? ui(language, "набирает", "growing")
        : status.className === "cooling"
          ? ui(language, "замедляется", "cooling")
          : status.className === "warming"
            ? ui(language, "наблюдаем", "observing")
            : ui(language, "без движения", "no movement");

  /**
   * The blocks of the expanded card, keyed by id.
   *
   * `dashboard` is read defensively here even though the record is only ever
   * rendered on the branch where it exists: the branch narrowing does not reach
   * into this object, and a `!` would be a promise to the compiler rather than
   * a check.
   */
  const sectionContent: Record<WidgetSectionId, ReactNode> = {
    // One headline number with its rate and a readable trend under it. The
    // chart used to be drawn behind the number, so the line cut through it.
    primary: (
      <section className="cp-realtime-primary">
        <div className="cp-metric-label">
          <span>{periodLabel}</span>
          {heroBadge && (
            <em className={heroBadge.tone} title={periodNote}>
              {heroBadge.tone === "live" && <i aria-hidden="true" />}
              {heroBadge.text}
            </em>
          )}
        </div>
        <div className="cp-primary-value">
          <strong className={flashing.has(metricPeriod) ? "flash" : undefined}>
            {compact(periodValue)}
          </strong>
          <span>{heroRate}</span>
        </div>
        <TrendChart values={primarySeries} />
        <div className="cp-trend-axis" aria-hidden="true">
          <span>{chartAxis[0]}</span>
          {activeCoverage && !activeCoverage.complete ? (
            <span className="warn">{collectedLabel(activeCoverage)}</span>
          ) : (
            <span />
          )}
          <span>{chartAxis[1]}</span>
        </div>
      </section>
    ),
    kpis: (
      <div className="cp-realtime-grid">
        {/* The two window tiles double as a period switch and mark the window
            the headline shows, so repeating its number has a purpose. */}
        <button
          className={metricPeriod === "60m" ? "active" : undefined}
          aria-pressed={metricPeriod === "60m"}
          onClick={() => chooseMetricPeriod("60m")}
        >
          <span>{ui(language, "60 минут", "60 minutes")}</span>
          <b>{compact(views60)}</b>
          <small className={hourCoverage.complete ? undefined : "warn"}>
            {hourCoverage.complete ? hourRate : collectedLabel(hourCoverage)}
          </small>
        </button>
        <button
          className={metricPeriod === "24h" ? "active" : undefined}
          aria-pressed={metricPeriod === "24h"}
          onClick={() => chooseMetricPeriod("24h")}
        >
          <span>{ui(language, "24 часа", "24 hours")}</span>
          <b>{compact(views24)}</b>
          <small className={dayCoverage.complete ? undefined : "warn"}>
            {dayCoverage.complete ? dayRate : collectedLabel(dayCoverage)}
          </small>
        </button>
        <article>
          <span>{ui(language, "Удержание", "Retention")}</span>
          <b>{retention === null ? "—" : formatPercent(retention)}</b>
          <small>
            {retention === null
              ? ui(language, "нет данных Analytics", "no Analytics data")
              : ui(language, "средний % просмотра", "average viewed")}
          </small>
        </article>
        <article>
          <span>{ui(language, "Всего просмотров", "Total views")}</span>
          <b>{compact(allViews)}</b>
          <small>
            {compact(dashboard?.channel.subscribers ?? 0)}{" "}
            {ui(language, "подписчиков", "subscribers")}
          </small>
        </article>
      </div>
    ),
    // One card instead of three: the net result first, then what it is made
    // of, with a bar that shows the balance at a glance.
    subscribers: (
      <section className="cp-widget-subscribers">
        <div className="cp-widget-subscribers-head">
          <span>{ui(language, "Подписчики · 28 дней", "Subscribers · 28 days")}</span>
          <b className={signedTone(subscribersNet)}>
            {formatSignedMetric(subscribersNet)}
          </b>
        </div>
        <div
          className="cp-widget-balance"
          role="img"
          aria-label={ui(
            language,
            `Пришли ${subscribersGained}, ушли ${subscribersLost}`,
            `Gained ${subscribersGained}, lost ${subscribersLost}`,
          )}
        >
          <i className="gain" style={{ width: `${gainedShare}%` }} />
          <i className="loss" style={{ width: `${100 - gainedShare}%` }} />
        </div>
        <div className="cp-widget-subscribers-legend">
          <span>
            <i className="gain" aria-hidden="true" />
            {ui(language, "Пришли", "Gained")} <b>+{compact(subscribersGained)}</b>
          </span>
          <span>
            <i className="loss" aria-hidden="true" />
            {ui(language, "Ушли", "Lost")} <b>−{compact(subscribersLost)}</b>
          </span>
        </div>
      </section>
    ),
    leaders: (
      <section className="cp-widget-list-block">
        <div className="cp-widget-section-title">
          <span>{sectionLabels.leaders}</span>
          <em>
            {metricPeriod === "60m"
              ? shortCoverageLabel(hourCoverage)
              : metricPeriod === "24h"
                ? shortCoverageLabel(dayCoverage)
                : metricPeriod === "48h"
                  ? shortCoverageLabel(twoDayCoverage)
                  : ui(language, "всё время", "all time")}
          </em>
        </div>
        <div className="cp-widget-leaders">
          {visibleLeaders.slice(0, 3).map((video, index) => {
            const status = velocityLabel(video);
            return (
              // A row opens that video's analytics in Studio. It used to open
              // the AI panel, which shows the same list again, bigger.
              <a
                key={video.id}
                className="cp-widget-video"
                href={studioAnalyticsUrl(video.id)}
                target="_blank"
                rel="noreferrer"
                title={`${video.title} — ${ui(language, "аналитика в Studio", "analytics in Studio")}`}
              >
                <span className="cp-widget-rank">{index + 1}</span>
                <img src={video.thumbnailUrl} alt="" />
                <span className="cp-widget-video-copy">
                  <b title={video.title}>{video.title}</b>
                  <small>
                    {compact(video.views)} {ui(language, "просм.", "views")} · ER{" "}
                    {engagementRate(video)}
                  </small>
                </span>
                <span className="cp-widget-speed">
                  <b>
                    {metricPeriod === "all" ? "" : "+"}
                    {compact(metricForVideo(video))}
                  </b>
                  <small
                    className={metricPeriod === "all" ? "quiet" : status.className}
                  >
                    {metricPeriod === "all"
                      ? ui(language, "всего", "total")
                      : statusText(status)}
                  </small>
                </span>
              </a>
            );
          })}
          {visibleLeaders.length === 0 && (
            <div className="cp-widget-empty">
              {ui(
                language,
                "За этот период прирост у последних 50 видео не зафиксирован.",
                "No growth among the latest 50 videos in this period.",
              )}
            </div>
          )}
        </div>
      </section>
    ),
    sources: (
      <section className="cp-widget-list-block">
        <div className="cp-widget-section-title">
          <span>{sectionLabels.sources}</span>
          <em>{ui(language, "28 дней", "28 days")}</em>
        </div>
        <div className="cp-widget-subscriber-list">
          {subscriberSources.slice(0, 3).map((video) => {
            const net = video.subscribersGained28Days - video.subscribersLost28Days;
            const perThousand =
              video.analyticsViews28Days > 0
                ? (video.subscribersGained28Days / video.analyticsViews28Days) * 1_000
                : 0;
            return (
              <a
                key={video.id}
                className="cp-widget-video"
                href={studioAnalyticsUrl(video.id)}
                target="_blank"
                rel="noreferrer"
                title={`${video.title} — ${ui(language, "аналитика в Studio", "analytics in Studio")}`}
              >
                <img src={video.thumbnailUrl} alt="" />
                <span className="cp-widget-video-copy">
                  <b title={video.title}>{video.title}</b>
                  <small>
                    {perThousand.toFixed(1)}{" "}
                    {ui(language, "на 1K просмотров", "per 1K views")}
                  </small>
                </span>
                <span className="cp-widget-speed">
                  <b className={signedTone(net)}>{formatSignedMetric(net)}</b>
                  <small className="quiet">
                    +{compact(video.subscribersGained28Days)} / −
                    {compact(video.subscribersLost28Days)}
                  </small>
                </span>
              </a>
            );
          })}
          {subscriberSources.length === 0 && (
            // Previously this whole block disappeared when Analytics had no
            // attribution yet, which read as the widget losing a section.
            <div className="cp-widget-empty">
              {ui(
                language,
                "Analytics пока не связала подписки с конкретными видео.",
                "Analytics has not attributed subscribers to individual videos yet.",
              )}
            </div>
          )}
        </div>
      </section>
    ),
  };
  const switchDockMetric = (id: DockMetricId) =>
    onComposition({ widgetDockMetrics: toggleDockMetric(dockMetrics, id) });

  return (
    <aside
      className={`cp-realtime ${expanded ? "expanded" : "collapsed"} ${docked ? "docked" : "undocked"} ${panelOpen ? "panel-open" : ""}${launcherVisible && !panelOpen ? " launcher-clear" : ""}`}
      ref={widgetRef}
      data-theme={theme}
      lang={language}
    >
      {!expanded ? (
        <div className="cp-top-dock">
          <span className={`cp-live-dot ${liveDotState}`} />
          <div className="cp-dock-metrics">
            {dockMetrics.length === 0 && (
              // Every metric switched off still leaves a usable capsule rather
              // than an empty pill with two icons in it.
              <button className="cp-dock-empty" onClick={() => setExpanded(true)}>
                <small>ChannelPilot</small>
                <b>{ui(language, "Аналитика", "Analytics")}</b>
              </button>
            )}
            {dockMetrics.map((id) => {
              const { label, editorLabel, value, coverage, source, signed } =
                dockMetricDefs[id];
              const selected = !signed && metricPeriod === id;
              return (
                <button
                  key={id}
                  className={[
                    selected ? "active" : "",
                    coverage && !coverage.complete ? "incomplete" : "",
                    !dashboard ? "pending" : "",
                    flashing.has(id) ? "flash" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  // The subscriber metric has no period to switch to, so it
                  // opens the card where its breakdown lives instead.
                  onClick={() =>
                    id === "subs" ? setExpanded(true) : chooseMetricPeriod(id)
                  }
                  aria-pressed={signed ? undefined : selected}
                  aria-busy={!dashboard && (loading || signedIn === null)}
                  title={
                    !dashboard
                      ? compactMetricState
                      : coverage
                        ? `${editorLabel}: ${compact(value)}. ${coverageDescription(coverage)}. ${sourceDescription(source)}.`
                        : `${editorLabel}: ${signed ? formatSignedMetric(value) : compact(value)}`
                  }
                >
                  <small>{label}</small>
                  <b className={signed ? signedTone(value) : undefined}>
                    {signed
                      ? signedIn && dashboard
                        ? formatSignedMetric(value)
                        : "—"
                      : compactMetricValue(value)}
                  </b>
                </button>
              );
            })}
          </div>
          <button
            className="cp-dock-expand"
            ref={expandRef}
            aria-expanded={expanded}
            aria-label={ui(
              language,
              "Открыть подробную аналитику",
              "Open detailed analytics",
            )}
            onClick={() => setExpanded(true)}
            title={ui(
              language,
              "Открыть подробную аналитику",
              "Open detailed analytics",
            )}
          >
            <WidgetIcon name="expand" />
          </button>
          <button
            className="cp-dock-hide"
            onClick={onHide}
            title={ui(language, "Скрыть верхний виджет", "Hide top widget")}
            aria-label={ui(language, "Скрыть верхний виджет", "Hide top widget")}
          >
            <WidgetIcon name="close" />
          </button>
        </div>
      ) : (
        <div className="cp-realtime-head">
          <button className="cp-realtime-brand" onClick={onOpen}>
            <span className={`cp-live-dot ${liveDotState}`} />
            <span>
              {/* The channel's own name reads as "my numbers"; the product name
                  in English sat in the Russian interface and said nothing. */}
              <b>{dashboard?.channel.title || "ChannelPilot"}</b>
              <small>
                {editing
                  ? ui(language, "Настройка блоков", "Arranging blocks")
                  : dashboard
                    ? `${dashboard.stale ? ui(language, "Сохранено", "Saved") : ui(language, "Обновлено", "Updated")} ${new Date(
                        dashboard.sampledAt,
                      ).toLocaleTimeString(language, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })} · ${ui(
                        language,
                        `каждые ${REALTIME_COLLECTION_PERIOD_MINUTES} мин`,
                        `every ${REALTIME_COLLECTION_PERIOD_MINUTES} min`,
                      )}`
                    : ui(language, "Аналитика канала", "Channel analytics")}
              </small>
            </span>
          </button>
          <div>
            <button
              ref={editToggleRef}
              className={`cp-icon-button${editing ? " active" : ""}`}
              onClick={() => setEditing((value) => !value)}
              // There are no blocks to arrange until there is data to show.
              disabled={!dashboard && !editing}
              aria-pressed={editing}
              aria-label={ui(
                language,
                editing ? "Закончить настройку" : "Настроить виджет",
                editing ? "Finish arranging" : "Customize the widget",
              )}
              title={ui(
                language,
                editing ? "Закончить настройку" : "Настроить виджет",
                editing ? "Finish arranging" : "Customize the widget",
              )}
            >
              <WidgetIcon name={editing ? "check" : "settings"} />
            </button>
            <button
              className={`cp-icon-button${loading ? " spinning" : ""}`}
              onClick={onRefresh}
              disabled={loading || !signedIn}
              aria-busy={loading}
              aria-label={ui(language, "Обновить", "Refresh")}
              title={ui(language, "Обновить", "Refresh")}
            >
              <WidgetIcon name="refresh" />
            </button>
            {/* "Hide" moved to the footer: next to "collapse" in the header the
                two looked alike and one of them removed the widget entirely. */}
            <button
              className="cp-icon-button"
              onClick={() => setExpanded(false)}
              aria-label={ui(
                language,
                "Свернуть в верхнюю строку",
                "Collapse to the top bar",
              )}
              title={ui(
                language,
                "Свернуть в верхнюю строку",
                "Collapse to the top bar",
              )}
            >
              <WidgetIcon name="collapse" />
            </button>
          </div>
        </div>
      )}
      {expanded && (
        <div className="cp-realtime-body">
          {signedIn === false || reauthRequired ? (
            <div className="cp-widget-login">
              <strong>
                {reauthRequired
                  ? ui(
                      language,
                      "Обновите Google-сессию",
                      "Refresh your Google session",
                    )
                  : ui(language, "Подключите канал", "Connect your channel")}
              </strong>
              <span>
                {reauthRequired
                  ? ui(
                      language,
                      "Подключение сохранено, но Google запросил повторное подтверждение. Данные и настройки не удалены.",
                      "Your connection is preserved, but Google requested confirmation again. Your data and settings were not removed.",
                    )
                  : ui(
                      language,
                      "Данные в реальном времени появятся после входа через Google.",
                      "Realtime data will appear after Google sign-in.",
                    )}
              </span>
              <button onClick={onSignIn} disabled={signingIn} aria-busy={signingIn}>
                {signingIn
                  ? ui(language, "Подключаем…", "Connecting…")
                  : reauthRequired
                    ? ui(language, "Продолжить через Google", "Continue with Google")
                    : ui(language, "Войти через Google", "Sign in with Google")}
              </button>
            </div>
          ) : !dashboard && failure && !loading ? (
            // Without this branch a failed first load showed "Waiting for
            // channel data" indefinitely, with no reason and no way to retry.
            <div className="cp-widget-login" role="alert">
              <strong>
                {ui(
                  language,
                  "Не удалось загрузить аналитику",
                  "Could not load analytics",
                )}
              </strong>
              <span>{failure}</span>
              <button onClick={onRefresh}>
                {ui(language, "Повторить", "Try again")}
              </button>
            </div>
          ) : !dashboard ? (
            <div className="cp-widget-loading">
              <i />
              <i />
              <i />
              <span>
                {loading
                  ? ui(language, "Получаем аналитику…", "Loading analytics…")
                  : ui(language, "Ожидаем данные канала", "Waiting for channel data")}
              </span>
            </div>
          ) : (
            <>
              {failure && !loading && (
                // A failed refresh used to leave the previous numbers on
                // screen with nothing saying they were no longer current.
                <div className="cp-widget-alert" role="status">
                  <span>
                    <b>{ui(language, "Данные не обновились", "Data not refreshed")}</b>
                    {failure}
                  </span>
                  <button onClick={onRefresh} disabled={!signedIn}>
                    {ui(language, "Повторить", "Retry")}
                  </button>
                </div>
              )}
              <div className="cp-widget-periods">
                {(
                  [
                    ["60m", shortCoverageLabel(hourCoverage)],
                    ["24h", shortCoverageLabel(dayCoverage)],
                    ["48h", shortCoverageLabel(twoDayCoverage)],
                    ["all", ui(language, "Всё время", "All time")],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={[
                      metricPeriod === id ? "active" : "",
                      id === "60m" && !hourCoverage.complete ? "incomplete" : "",
                      id === "24h" && !dayCoverage.complete ? "incomplete" : "",
                      id === "48h" && !twoDayCoverage.complete ? "incomplete" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => chooseMetricPeriod(id)}
                    aria-pressed={metricPeriod === id}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {sections.map((id, index) => (
                <div
                  className={`cp-widget-block${editing ? " editing" : ""}`}
                  key={id}
                  data-block={id}
                >
                  {editing && (
                    <div
                      className="cp-block-bar"
                      role="group"
                      aria-label={sectionLabels[id]}
                    >
                      <span>{sectionLabels[id]}</span>
                      <span className="cp-block-tools">
                        <button
                          data-tool="up"
                          onClick={() =>
                            changeSections(
                              moveWidgetEntry(sections, id, -1),
                              `[data-block="${id}"] [data-tool="up"]`,
                            )
                          }
                          disabled={index === 0}
                          aria-label={`${ui(language, "Выше", "Move up")}: ${sectionLabels[id]}`}
                          title={ui(language, "Выше", "Move up")}
                        >
                          <WidgetIcon name="up" />
                        </button>
                        <button
                          data-tool="down"
                          onClick={() =>
                            changeSections(
                              moveWidgetEntry(sections, id, 1),
                              `[data-block="${id}"] [data-tool="down"]`,
                            )
                          }
                          disabled={index === sections.length - 1}
                          aria-label={`${ui(language, "Ниже", "Move down")}: ${sectionLabels[id]}`}
                          title={ui(language, "Ниже", "Move down")}
                        >
                          <WidgetIcon name="down" />
                        </button>
                        <button
                          className="danger"
                          data-tool="remove"
                          onClick={() =>
                            // Focus lands on the chip that brings this block
                            // back, so an accidental removal is one Enter away
                            // from being undone.
                            changeSections(
                              removeWidgetEntry(sections, id),
                              `[data-add="${id}"]`,
                            )
                          }
                          aria-label={`${ui(language, "Убрать блок", "Remove block")}: ${sectionLabels[id]}`}
                          title={ui(language, "Убрать блок", "Remove block")}
                        >
                          <WidgetIcon name="close" />
                        </button>
                      </span>
                    </div>
                  )}
                  {sectionContent[id]}
                </div>
              ))}
              {sections.length === 0 && !editing && (
                <div className="cp-widget-empty">
                  <p>
                    {ui(
                      language,
                      "Все блоки убраны из виджета.",
                      "Every block has been removed from the widget.",
                    )}
                  </p>
                  <button onClick={() => setEditing(true)}>
                    {ui(language, "Вернуть блоки", "Bring blocks back")}
                  </button>
                </div>
              )}
              {editing && (
                <div className="cp-widget-editor">
                  <div className="cp-editor-group">
                    <span>{ui(language, "Добавить блок", "Add a block")}</span>
                    <div className="cp-editor-chips">
                      {hiddenSections.map((id) => (
                        <button
                          key={id}
                          data-add={id}
                          onClick={() =>
                            // The block arrives at the bottom; focus follows it
                            // to its "up" arrow so it can be walked into place.
                            changeSections(
                              addWidgetEntry(sections, WIDGET_SECTION_IDS, id),
                              `[data-block="${id}"] [data-tool="up"]`,
                            )
                          }
                        >
                          <i aria-hidden="true">+</i>
                          {sectionLabels[id]}
                        </button>
                      ))}
                      {hiddenSections.length === 0 && (
                        <em>
                          {ui(
                            language,
                            "Все блоки уже на месте",
                            "Every block is already shown",
                          )}
                        </em>
                      )}
                    </div>
                  </div>
                  <div className="cp-editor-group">
                    <span>
                      {ui(
                        language,
                        "Метрики в строке YouTube",
                        "Metrics in the YouTube bar",
                      )}
                    </span>
                    <div className="cp-editor-chips">
                      {DOCK_METRIC_IDS.map((id) => {
                        const on = dockMetrics.includes(id);
                        return (
                          <button
                            key={id}
                            className={on ? "on" : ""}
                            aria-pressed={on}
                            onClick={() => switchDockMetric(id)}
                          >
                            <i aria-hidden="true">{on ? "✓" : "+"}</i>
                            {dockMetricDefs[id].editorLabel}
                          </button>
                        );
                      })}
                    </div>
                    <small>
                      {ui(
                        language,
                        "Ниже 1180 px в строку помещаются две метрики — остальные остаются здесь, в развёрнутой карточке.",
                        "Below 1180px the bar fits two metrics; the rest stay here, in the expanded card.",
                      )}
                    </small>
                  </div>
                  <div className="cp-editor-actions">
                    <button
                      onClick={() =>
                        onComposition({
                          widgetSections: [...DEFAULT_WIDGET_SECTIONS],
                          widgetDockMetrics: [...DEFAULT_DOCK_METRICS],
                        })
                      }
                    >
                      {ui(language, "Вернуть по умолчанию", "Reset to default")}
                    </button>
                    <button className="cp-editor-done" onClick={finishEditing}>
                      {ui(language, "Готово", "Done")}
                    </button>
                  </div>
                </div>
              )}
              <div className="cp-widget-footer">
                <button className="cp-widget-hide" onClick={onHide}>
                  {ui(language, "Скрыть виджет", "Hide widget")}
                </button>
                <span className="cp-widget-footer-actions">
                  <button onClick={() => openDashboard()}>
                    {ui(language, "Кабинет", "Dashboard")}
                  </button>
                  <button className="primary" onClick={onOpen}>
                    {ui(language, "AI-панель", "AI panel")}
                  </button>
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
});

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function InlineAssistant({ kind }: { kind: "title" | "metadata" }) {
  const snapshot = useInlineSnapshot();
  const [copied, setCopied] = useState("");
  const [language, setLanguage] = useState<SupportedLanguage>("ru");
  const [routing, setRouting] = useState<{
    mode: AiProvider;
    groqReady: boolean;
    twelveLabsReady: boolean;
  }>({ mode: "auto", groqReady: false, twelveLabsReady: false });
  const result = snapshot.result;

  useEffect(() => {
    void rpc<PublicExtensionSettings>({ type: "GET_SETTINGS" })
      .then((settings) => {
        setLanguage(settings.interfaceLanguage);
        setRouting({
          mode: settings.preferredProvider,
          groqReady: settings.groqReady,
          twelveLabsReady: settings.twelveLabsReady,
        });
      })
      .catch(() => undefined);
  }, [snapshot.phase]);

  function retryAnalysis() {
    window.dispatchEvent(new CustomEvent(RETRY_ANALYSIS_EVENT));
  }

  async function enableAutoAndRetry() {
    try {
      const settings = await rpc<PublicExtensionSettings>({
        type: "SAVE_SETTINGS_PATCH",
        payload: { preferredProvider: "auto" },
      });
      setRouting({
        mode: "auto",
        groqReady: settings.groqReady,
        twelveLabsReady: settings.twelveLabsReady,
      });
      retryAnalysis();
    } catch {
      openDashboard("settings");
    }
  }

  // One timer for all copy buttons: with a timer per click, copying a second
  // item within 1.4s had the first timer wipe the second one's "Copied".
  const copiedTimerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(copiedTimerRef.current), []);
  function flashCopy(id: string, value: string) {
    // A refused clipboard write (the tab lost focus, a page policy) used to
    // leave the button unchanged, as if the click had not registered.
    const mark = (state: string) => {
      setCopied(state);
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopied(""), 1_800);
    };
    void copyText(value).then(
      () => mark(id),
      () => mark(`!${id}`),
    );
  }
  const copyLabel = (id: string, idle: string) =>
    copied === id
      ? ui(language, "Скопировано", "Copied")
      : copied === `!${id}`
        ? ui(language, "Не скопировалось", "Not copied")
        : idle;

  if (snapshot.phase === "idle" || snapshot.phase === "typing") {
    return (
      <section className="cp-inline-shell">
        <div className="cp-inline-head">
          <span className="cp-mini-logo">CP</span>
          <strong>
            {kind === "title"
              ? ui(language, "AI-варианты заголовка", "AI title variants")
              : ui(language, "AI-метаданные видео", "AI video metadata")}
          </strong>
          <em>
            {snapshot.phase === "typing"
              ? ui(language, "ожидаем паузу…", "waiting for a pause…")
              : ui(language, "готов", "ready")}
          </em>
        </div>
        <p className="cp-inline-empty">
          {kind === "title"
            ? ui(
                language,
                "Загрузите видео — анализ начнётся сам. Заголовок необязателен; при вводе рекомендации обновятся.",
                "Upload a video — analysis starts automatically. A title is optional; recommendations update as you type.",
              )
            : ui(
                language,
                "Описание, теги, ключи, хэштеги, кадры превью и SEO появятся после автоматического анализа файла.",
                "Description, tags, keywords, hashtags, preview frames and SEO appear after automatic file analysis.",
              )}
        </p>
      </section>
    );
  }

  if (snapshot.phase === "analyzing") {
    return (
      <section className="cp-inline-shell cp-inline-loading">
        <div className="cp-inline-head">
          <span className="cp-mini-logo">CP</span>
          <strong>
            {snapshot.mediaName
              ? ui(
                  language,
                  `Анализируем ${snapshot.mediaName}`,
                  `Analyzing ${snapshot.mediaName}`,
                )
              : ui(
                  language,
                  "Анализируем видео и метаданные",
                  "Analyzing video and metadata",
                )}
          </strong>
          <em>{ui(language, "AI работает", "AI is working")}</em>
        </div>
        <p className="cp-inline-progress">
          {snapshot.progressMessage ||
            ui(
              language,
              "Подготавливаем файл и выбираем подходящую модель…",
              "Preparing the file and selecting the right model…",
            )}
        </p>
        <div className="cp-skeleton">
          <i />
          <i />
          <i />
        </div>
      </section>
    );
  }

  if (snapshot.phase === "error") {
    if (kind === "metadata") return null;
    const hasBackup = routing.groqReady || routing.twelveLabsReady;
    const backupNames = [
      routing.twelveLabsReady ? "TwelveLabs" : "",
      routing.groqReady ? "Groq" : "",
    ]
      .filter(Boolean)
      .join(" + ");
    const routingHint = !hasBackup
      ? ui(
          language,
          "Резервный API не подключён: добавьте TwelveLabs или Groq для автоматического продолжения анализа.",
          "No fallback API is connected. Add TwelveLabs or Groq to continue analysis automatically.",
        )
      : routing.mode !== "auto"
        ? ui(
            language,
            `${backupNames} подключён, но выбран режим без автоматического переключения.`,
            `${backupNames} is connected, but the selected mode does not allow automatic failover.`,
          )
        : ui(
            language,
            `Режим Auto включён. Повторите запрос — ${backupNames} будет использован, если поддерживает этот файл.`,
            `Auto mode is enabled. Retry the request; ${backupNames} will be used when it supports this file.`,
          );
    return (
      <section className="cp-inline-shell cp-inline-error">
        <div className="cp-inline-head">
          <span className="cp-mini-logo">CP</span>
          <strong>{ui(language, "Анализ не выполнен", "Analysis failed")}</strong>
          <em>v{chrome.runtime.getManifest().version}</em>
        </div>
        <p>{snapshot.error}</p>
        <small>{routingHint}</small>
        <div className="cp-inline-error-actions">
          <button className="primary" onClick={retryAnalysis}>
            {ui(language, "Повторить анализ", "Retry analysis")}
          </button>
          {hasBackup && routing.mode !== "auto" ? (
            <button onClick={() => void enableAutoAndRetry()}>
              {ui(language, "Включить Auto", "Enable Auto")}
            </button>
          ) : (
            <button onClick={() => openDashboard("settings")}>
              {ui(language, "Настройки API", "API settings")}
            </button>
          )}
        </div>
      </section>
    );
  }

  if (!result) return null;

  if (kind === "title") {
    return (
      <section className="cp-inline-shell">
        <div className="cp-inline-head">
          <span className="cp-mini-logo">CP</span>
          <strong>{ui(language, "AI-варианты заголовка", "AI title variants")}</strong>
          <em>
            SEO {result.seo.total}/100 · {result.provider}
          </em>
        </div>
        {result.providerNotice && (
          <div className="cp-provider-notice">
            <b>⇄</b>
            <span>{result.providerNotice}</span>
          </div>
        )}
        <div className="cp-inline-titles">
          {result.titles.slice(0, 5).map((title, index) => (
            <article key={`${title}-${index}`}>
              <span>{index + 1}</span>
              <p>{title}</p>
              <strong
                className={`cp-inline-title-score ${result.titleScores[index]?.label ?? "medium"}`}
              >
                {result.titleScores[index]?.total ?? 0}%
              </strong>
              <button onClick={() => flashCopy(`title-${index}`, title)}>
                {copyLabel(`title-${index}`, ui(language, "Копировать", "Copy"))}
              </button>
            </article>
          ))}
        </div>
      </section>
    );
  }

  const resultHashtags = hashtags(result);
  return (
    <section className="cp-inline-shell">
      <div className="cp-inline-head">
        <span className="cp-mini-logo">CP</span>
        <strong>
          {ui(language, "Результаты анализа видео", "Video analysis results")}
        </strong>
        <em>
          {new Date(result.generatedAt).toLocaleTimeString(language, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </em>
      </div>
      {result.providerNotice && (
        <div className="cp-provider-notice">
          <b>⇄</b>
          <span>{result.providerNotice}</span>
        </div>
      )}
      <div className="cp-inline-grid">
        <article className="cp-inline-card cp-inline-wide cp-understanding">
          <header>
            <strong>
              {ui(
                language,
                "Что AI понял из видео",
                "What AI understood from the video",
              )}
            </strong>
            <span>
              {result.contentInsights.detectedFormat ||
                ui(language, "контент", "content")}
            </span>
          </header>
          <p>{result.contentInsights.summary}</p>
          <div className="cp-understanding-grid">
            <div>
              <span>{ui(language, "Главный хук", "Primary hook")}</span>
              <b>{result.contentInsights.primaryHook || "—"}</b>
            </div>
            <div>
              <span>{ui(language, "Аудитория", "Audience")}</span>
              <b>{result.contentInsights.targetAudience || "—"}</b>
            </div>
          </div>
          {result.contentInsights.hookAnalysis && (
            <div className="cp-hook-inline">
              <strong>
                {result.contentInsights.hookAnalysis.score}
                <small>/100</small>
              </strong>
              <div>
                <span>0–1s</span>
                <p>{result.contentInsights.hookAnalysis.firstSecond || "—"}</p>
              </div>
              <div>
                <span>0–3s</span>
                <p>{result.contentInsights.hookAnalysis.firstThreeSeconds || "—"}</p>
              </div>
              <div>
                <span>0–10s</span>
                <p>{result.contentInsights.hookAnalysis.firstTenSeconds || "—"}</p>
              </div>
            </div>
          )}
          {result.contentInsights.keyMoments.length > 0 && (
            <ul>
              {result.contentInsights.keyMoments.slice(0, 5).map((moment) => (
                <li key={moment}>{moment}</li>
              ))}
            </ul>
          )}
          {(result.contentInsights.retentionRisks?.length ?? 0) > 0 && (
            <div className="cp-retention-inline">
              <b>{ui(language, "Риски удержания", "Retention risks")}</b>
              <span>
                {result.contentInsights.retentionRisks!.slice(0, 3).join(" · ")}
              </span>
            </div>
          )}
        </article>
        <article className="cp-inline-card cp-inline-wide">
          <header>
            <strong>{ui(language, "Готовое описание", "Ready description")}</strong>
            <span>{ui(language, "SEO-текст", "SEO copy")}</span>
          </header>
          <p className="cp-inline-description">{result.description}</p>
          <footer>
            <button
              className="primary"
              onClick={() => flashCopy("description", result.description)}
            >
              {copyLabel(
                "description",
                ui(language, "Копировать описание", "Copy description"),
              )}
            </button>
          </footer>
        </article>
        <article className="cp-inline-card">
          <header>
            <strong>{ui(language, "Теги", "Tags")}</strong>
            <span>{result.tags.length}</span>
          </header>
          <div className="cp-inline-chips">
            {result.tags.slice(0, 14).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <button onClick={() => flashCopy("tags", result.tags.join(", "))}>
            {copyLabel("tags", ui(language, "Копировать теги", "Copy tags"))}
          </button>
        </article>
        <article className="cp-inline-card">
          <header>
            <strong>{ui(language, "Хэштеги", "Hashtags")}</strong>
            <span>{resultHashtags.length}</span>
          </header>
          <div className="cp-inline-chips hashtags">
            {resultHashtags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <button onClick={() => flashCopy("hashtags", resultHashtags.join(" "))}>
            {copyLabel("hashtags", ui(language, "Копировать хэштеги", "Copy hashtags"))}
          </button>
        </article>
        <article className="cp-inline-card">
          <header>
            <strong>{ui(language, "Ключевые слова", "Keywords")}</strong>
            <span>{result.keywords.length}</span>
          </header>
          <ul>
            {result.keywords.slice(0, 8).map((keyword) => (
              <li key={keyword}>{keyword}</li>
            ))}
          </ul>
          <button onClick={() => flashCopy("keywords", result.keywords.join(", "))}>
            {copyLabel("keywords", ui(language, "Копировать ключи", "Copy keywords"))}
          </button>
        </article>
        <article className="cp-inline-card">
          <header>
            <strong>{ui(language, "Идеи для обложки", "Thumbnail ideas")}</strong>
            <span>{result.thumbnailIdeas.length}</span>
          </header>
          <ol>
            {result.thumbnailIdeas.slice(0, 4).map((idea) => (
              <li key={idea}>{idea}</li>
            ))}
          </ol>
        </article>
        {snapshot.previews.length > 0 && (
          <article className="cp-inline-card cp-inline-wide">
            <header>
              <strong>{ui(language, "Кадры для превью", "Thumbnail frames")}</strong>
              <span>
                {ui(language, "локально · автоформат", "local · auto format")}
              </span>
            </header>
            <div className="cp-preview-grid">
              {snapshot.previews.map((preview, index) => (
                <figure key={preview.id}>
                  <img
                    src={preview.url}
                    alt={ui(
                      language,
                      `Вариант превью ${index + 1}`,
                      `Thumbnail variant ${index + 1}`,
                    )}
                  />
                  <figcaption>
                    <span>
                      {Math.round(preview.timestamp)} {ui(language, "сек.", "sec.")}
                    </span>
                    <a
                      href={preview.url}
                      download={`channelpilot-preview-${index + 1}.jpg`}
                    >
                      {ui(language, "Скачать JPG", "Download JPG")}
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="cp-preview-note">
              {ui(
                language,
                "Кадры создаются в браузере из загруженного видео. Файл не отправляется стороннему генератору изображений.",
                "Frames are created locally in your browser from the uploaded video. The file is not sent to a third-party image generator.",
              )}
            </p>
          </article>
        )}
        <article className="cp-inline-card cp-inline-wide cp-inline-seo">
          <div className="cp-inline-score">
            <strong>{result.seo.total}</strong>
            <span>
              SEO
              <br />
              {ui(language, "потенциал", "potential")}
            </span>
          </div>
          <div>
            <header>
              <strong>
                {ui(
                  language,
                  "Что улучшить перед публикацией",
                  "What to improve before publishing",
                )}
              </strong>
            </header>
            <ul>
              {result.recommendations.slice(0, 5).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </article>
      </div>
    </section>
  );
}

type InlineKind = "title" | "metadata";
const inlineMounts = new Map<
  InlineKind,
  { host: HTMLDivElement; root: ReturnType<typeof createRoot> }
>();

function mountInlineAssistant(kind: InlineKind) {
  if (location.hostname !== "studio.youtube.com") return;
  const selector = `[data-channelpilot-inline="${kind}"]`;
  if (document.querySelector(selector)) return;
  const field = findElement(kind === "title" ? TITLE_SELECTORS : DESCRIPTION_SELECTORS);
  if (!field) return;
  const anchor =
    field.closest<HTMLElement>(
      "ytcp-social-suggestions-textbox, ytcp-form-input-container, #title-textarea, #description-textarea",
    ) ?? field.parentElement;
  const anchorParent = anchor?.parentElement;
  if (!anchor || !anchorParent || !anchor.isConnected) return;

  const host = document.createElement("div");
  host.dataset.channelpilotInline = kind;
  try {
    if (!anchor.isConnected || anchor.parentElement !== anchorParent) return;
    const inserted = anchor.insertAdjacentElement("afterend", host);
    if (inserted !== host) return;
  } catch {
    host.remove();
    return;
  }
  const shadow = host.attachShadow({ mode: "open" });
  applyPanelStyles(shadow);
  const mount = document.createElement("div");
  shadow.append(mount);
  const root = createRoot(mount);
  inlineMounts.set(kind, { host, root });
  root.render(<InlineAssistant kind={kind} />);
}

let inlineMountTimer = 0;
function scheduleInlineMounts() {
  if (inlineMountTimer) return;
  inlineMountTimer = window.setTimeout(() => {
    inlineMountTimer = 0;
    for (const [kind, mounted] of inlineMounts) {
      if (mounted.host.isConnected && isRenderedElement(mounted.host)) continue;
      mounted.root.unmount();
      mounted.host.remove();
      inlineMounts.delete(kind);
    }
    mountInlineAssistant("title");
    mountInlineAssistant("metadata");
  }, 180);
}

function isAutomaticUploadVideo(file: File): boolean {
  return file.size > 0 && isVideoAnalysisFile(file);
}

function isVideoAnalysisFile(file: File): boolean {
  return (
    file.type.startsWith("video/") ||
    /\.(mp4|mov|mkv|webm|m4v|avi|mpeg|mpg|ts)$/i.test(file.name)
  );
}

function isAudioAnalysisFile(file: File): boolean {
  return (
    file.type.startsWith("audio/") ||
    /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(file.name)
  );
}

function isImageAnalysisFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name)
  );
}

async function inspectMediaFile(file: File, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException("Media analysis cancelled", "AbortError");
  const base = [
    `filename=${file.name}`,
    `mime=${file.type || "unknown"}`,
    `sizeMB=${(file.size / 1024 / 1024).toFixed(1)}`,
  ];
  if (isImageAnalysisFile(file)) {
    const bitmap = await createImageBitmap(file);
    try {
      if (signal?.aborted)
        throw new DOMException("Media analysis cancelled", "AbortError");
      const ratio = bitmap.width / Math.max(1, bitmap.height);
      base.push(`resolution=${bitmap.width}x${bitmap.height}`);
      base.push(
        `orientation=${ratio < 0.8 ? "vertical 9:16" : ratio > 1.4 ? "horizontal 16:9" : "square"}`,
      );
    } finally {
      bitmap.close();
    }
    return base.join(", ");
  }
  if (!isVideoAnalysisFile(file) && !isAudioAnalysisFile(file)) {
    return base.join(", ");
  }

  const media = document.createElement(isVideoAnalysisFile(file) ? "video" : "audio");
  const objectUrl = URL.createObjectURL(file);
  media.preload = "metadata";
  try {
    const metadata = waitForMediaEvent(media, "loadedmetadata", signal);
    media.src = objectUrl;
    await metadata;
    base.push(
      `durationSec=${Number.isFinite(media.duration) ? media.duration.toFixed(1) : "unknown"}`,
    );
    if (media instanceof HTMLVideoElement) {
      const ratio = media.videoWidth / Math.max(1, media.videoHeight);
      base.push(`resolution=${media.videoWidth}x${media.videoHeight}`);
      base.push(
        `orientation=${ratio < 0.8 ? "vertical 9:16" : ratio > 1.4 ? "horizontal 16:9" : "square"}`,
      );
    }
  } finally {
    media.removeAttribute("src");
    media.load();
    URL.revokeObjectURL(objectUrl);
  }
  return base.join(", ");
}

function uploadTitleLooksAutomatic(title: string, file: File): boolean {
  // Locale-invariant on purpose: under a Turkish locale toLocaleLowerCase maps
  // "I" to dotless "ı", so camera defaults like "VID_0001" became "vıd_0001"
  // and stopped matching the ASCII patterns below.
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,8}$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  const normalizedTitle = normalize(title);
  if (!normalizedTitle) return true;
  const normalizedFilename = normalize(file.name);
  return (
    normalizedTitle === normalizedFilename ||
    /^\d{5,}$/.test(normalizedTitle.replace(/\s/g, "")) ||
    /^(?:vid|img|dsc|mov|recording|screen recording|снимок экрана)\s*\d/i.test(
      normalizedTitle,
    )
  );
}

function mediaFileFromEvent(event: Event): File | undefined {
  if (event instanceof DragEvent) {
    const dropped = [...(event.dataTransfer?.files ?? [])].find(isAutomaticUploadVideo);
    if (dropped) return dropped;
  }
  for (const node of event.composedPath()) {
    if (node instanceof HTMLInputElement && node.type === "file") {
      const selected = [...(node.files ?? [])].find(isAutomaticUploadVideo);
      if (selected) return selected;
    }
  }
  return undefined;
}

function eventComesFromChannelPilot(event: Event): boolean {
  return event
    .composedPath()
    .some(
      (node) =>
        node instanceof HTMLElement &&
        (node.id === "channelpilot-extension-root" ||
          node.id === TOP_DOCK_HOST_ID ||
          node.dataset.channelpilotInline !== undefined),
    );
}

function App() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("optimize");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [context, setContext] = useState<VideoContext>(readPageContext);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  // Read by the media analysis callback without re-creating it on every poll.
  const dashboardRef = useRef<DashboardData | null>(null);
  useEffect(() => {
    dashboardRef.current = dashboard;
  }, [dashboard]);
  const [interfaceLanguage, setInterfaceLanguage] = useState<SupportedLanguage>("ru");
  const [generationLanguage, setGenerationLanguage] = useState<SupportedLanguage>("ru");
  const [showHeaderWidget, setShowHeaderWidget] = useState(true);
  const [showLauncher, setShowLauncher] = useState(true);
  // Deliberately the redacted projection: the content script has no business
  // holding provider keys, and typing the state this way makes that a compile
  // error rather than a convention.
  const [uiSettings, setUiSettings] = useState<PublicExtensionSettings>(() =>
    toPublicSettings({ ...DEFAULT_EXTENSION_SETTINGS, allowAiMediaUploads: false }),
  );
  const [systemPrefersLight, setSystemPrefersLight] = useState(
    () => window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  const [pageTheme, setPageTheme] = useState<"dark" | "light" | null>(detectPageTheme);
  const [panelRect, setPanelRect] = useState(() =>
    resolvePanelLayout(DEFAULT_EXTENSION_SETTINGS.panelLayout, {
      width: window.innerWidth,
      height: window.innerHeight,
    }),
  );
  const [interfaceReady, setInterfaceReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  // Sign-in and analytics have their own busy/error state. They used to share
  // `loading` and `error` with the AI analysis: signing in while a media file
  // was being analysed re-enabled "Analyze" mid-request, and one failed
  // background poll left a "Failed to fetch" banner on both tabs that no later
  // successful refresh ever cleared.
  const [signingIn, setSigningIn] = useState(false);
  const signingInRef = useRef(false);
  const [dashboardError, setDashboardError] = useState("");
  const [error, setError] = useState("");
  // Confirmation for panel actions; errors keep their own red banner.
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2_600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const onDashboardOpenFailed = (message: string) => {
      setDashboardError(message);
      setError(message);
    };
    dashboardOpenFailureListeners.add(onDashboardOpenFailed);
    return () => {
      dashboardOpenFailureListeners.delete(onDashboardOpenFailed);
    };
  }, []);
  const [autoMediaNotice, setAutoMediaNotice] = useState<{
    fileName: string;
    status: "analyzing" | "ready" | "error";
    message: string;
  } | null>(null);
  const [pendingSuggestion, setPendingSuggestion] = useState<{
    kind: "title" | "description";
    value: string;
  } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // A requested analysis lands below a long form; bring the result into view.
  const resultRef = useRef<HTMLDivElement | null>(null);
  const revealResultRef = useRef(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelFocusReturnRef = useRef<HTMLElement | null>(null);
  const confirmModalRef = useRef<HTMLElement | null>(null);
  const confirmFocusReturnRef = useRef<HTMLElement | null>(null);
  const [dockContainer, setDockContainer] = useState<HTMLDivElement | null>(null);
  const [dockGraceExpired, setDockGraceExpired] = useState(false);
  const autoTimerRef = useRef<number | undefined>(undefined);
  const requestIdRef = useRef(0);
  const analysisBusyRef = useRef(false);
  const lastSignatureRef = useRef("");
  const lastMediaEvidenceRef = useRef("");
  const capturedMediaRef = useRef(new WeakSet<File>());
  const capturedMediaSignaturesRef = useRef(new Set<string>());
  const mediaAnalysisRef = useRef(0);
  const mediaAbortControllerRef = useRef<AbortController | null>(null);
  const queuedContextRef = useRef<VideoContext | null>(null);
  const dashboardRequestIdRef = useRef(0);
  const panelRectRef = useRef(panelRect);
  const panelInteractionRef = useRef<{
    mode: "drag" | "resize";
    startClientX: number;
    startClientY: number;
    startRect: typeof panelRect;
    target: HTMLElement;
  } | null>(null);
  // Drag state batched into one requestAnimationFrame; see movePanelInteraction.
  const dragFrameRef = useRef(0);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  // Always holds the current interface language, so effects that must not
  // re-run when it changes can still produce a correctly localized message.
  const languageRef = useRef<SupportedLanguage>("ru");
  // Stable handler identities for the memoized header widget; see the note
  // where `widgetHandlersRef.current` is assigned.
  const widgetHandlersRef = useRef<{
    onOpen: () => void;
    onRefresh: () => void;
    onSignIn: () => void;
    onHide: () => void;
    onComposition: (patch: ContentSettingsPatch) => void;
  }>({
    onOpen: () => undefined,
    onRefresh: () => undefined,
    onSignIn: () => undefined,
    onHide: () => undefined,
    onComposition: () => undefined,
  });
  const stableWidgetHandlers = useMemo(
    () => ({
      onOpen: () => widgetHandlersRef.current.onOpen(),
      onRefresh: () => widgetHandlersRef.current.onRefresh(),
      onSignIn: () => widgetHandlersRef.current.onSignIn(),
      onHide: () => widgetHandlersRef.current.onHide(),
      onComposition: (patch: ContentSettingsPatch) =>
        widgetHandlersRef.current.onComposition(patch),
    }),
    [],
  );
  const pageIdentityRef = useRef(
    `${location.hostname}:${videoIdFromLocation() ?? location.pathname}`,
  );

  useEffect(() => {
    panelRectRef.current = panelRect;
  }, [panelRect]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(".cp-tabs button.active")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!pendingSuggestion) return;
    const frame = window.requestAnimationFrame(() => {
      confirmModalRef.current
        ?.querySelector<HTMLElement>("[data-confirm-autofocus]")
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPendingSuggestion(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        confirmModalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const modalRoot = confirmModalRef.current?.getRootNode();
      const activeElement =
        modalRoot instanceof ShadowRoot
          ? modalRoot.activeElement
          : document.activeElement;
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      confirmFocusReturnRef.current?.focus();
    };
  }, [pendingSuggestion]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (event: MediaQueryListEvent) => {
      setSystemPrefersLight(event.matches);
      setPageTheme(detectPageTheme());
    };
    media.addEventListener("change", onChange);
    // YouTube and Studio switch theme by toggling attributes on <html>; that is
    // rare, so observing its attributes costs nothing on the hot path.
    const observer = new MutationObserver(() => setPageTheme(detectPageTheme()));
    observer.observe(document.documentElement, { attributes: true });
    return () => {
      media.removeEventListener("change", onChange);
      observer.disconnect();
    };
  }, []);

  const persistPanelRect = useCallback(async () => {
    try {
      // A targeted patch, not a read-modify-write of every setting. The old
      // version read the whole settings object and wrote it back on each
      // pointerup, so dragging the panel could silently revert an edit the
      // user had just made in the options page.
      const saved = await rpc<PublicExtensionSettings>({
        type: "SAVE_SETTINGS_PATCH",
        payload: { panelLayout: persistablePanelLayout(panelRectRef.current) },
      });
      setUiSettings(saved);
    } catch {
      // Failing to persist a window position is cosmetic and self-correcting:
      // the layout is re-clamped on the next load anyway. It used to raise the
      // shared `error` banner, which has no dismiss control, so one failed
      // drag pinned an error message over the analytics view for the rest of
      // the session.
    }
  }, []);

  const beginPanelInteraction = useCallback(
    (event: ReactPointerEvent<HTMLElement>, mode: "drag" | "resize") => {
      if (event.button !== 0) return;
      if (
        mode === "drag" &&
        event.target instanceof Element &&
        event.target.closest("button")
      ) {
        return;
      }
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      panelInteractionRef.current = {
        mode,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startRect: panelRectRef.current,
        target,
      };
      event.preventDefault();
    },
    [],
  );

  const movePanelInteraction = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const interaction = panelInteractionRef.current;
    if (!interaction) return;
    // A pointer reports at the display refresh rate — 60 to 120 events per
    // second on a modern machine — and each one used to setState synchronously,
    // re-rendering the entire panel tree plus the header-widget portal. Batch to
    // one update per frame; the pointer position is read at paint time, so the
    // drag is no less responsive.
    pendingPointerRef.current = { x: event.clientX, y: event.clientY };
    if (dragFrameRef.current) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = 0;
      const pending = pendingPointerRef.current;
      const active = panelInteractionRef.current;
      if (!pending || !active) return;
      const deltaX = pending.x - active.startClientX;
      const deltaY = pending.y - active.startClientY;
      const start = active.startRect;
      const next =
        active.mode === "drag"
          ? {
              width: start.width,
              height: start.height,
              x: start.x + deltaX,
              y: start.y + deltaY,
            }
          : {
              width: start.width + deltaX,
              height: start.height + deltaY,
              x: start.x,
              y: start.y,
            };
      setPanelRect((current) =>
        resolvePanelLayout(
          next,
          {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          current,
        ),
      );
    });
  }, []);

  const endPanelInteraction = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const interaction = panelInteractionRef.current;
      if (!interaction) return;
      if (dragFrameRef.current) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = 0;
      }
      pendingPointerRef.current = null;
      if (interaction.target.hasPointerCapture(event.pointerId)) {
        interaction.target.releasePointerCapture(event.pointerId);
      }
      panelInteractionRef.current = null;
      void persistPanelRect();
    },
    [persistPanelRect],
  );

  const runAnalysis = useCallback(
    async (nextContext: VideoContext, media: File | null = null, automatic = false) => {
      if (media) {
        lastMediaEvidenceRef.current = "";
        queuedContextRef.current = null;
      }
      const priorMediaEvidence = media ? "" : lastMediaEvidenceRef.current;
      if (!media && nextContext.title.trim().length < 4) {
        if (automatic && analysisBusyRef.current) return;
        requestIdRef.current += 1;
        mediaAbortControllerRef.current?.abort();
        mediaAbortControllerRef.current = null;
        mediaAnalysisRef.current = 0;
        analysisBusyRef.current = false;
        queuedContextRef.current = null;
        lastSignatureRef.current = "";
        setLoading(false);
        setAutoMediaNotice(null);
        publishInline({ phase: "idle", error: "", progressMessage: "" });
        return;
      }
      const signature = JSON.stringify({
        title: nextContext.title.trim(),
        description: nextContext.description.trim(),
        tags: nextContext.tags,
        transcript: nextContext.transcript?.slice(0, 2_000),
        language: nextContext.language,
        media: media ? `${media.name}:${media.size}:${media.lastModified}` : "",
        mediaEvidence: priorMediaEvidence.slice(0, 2_000),
      });
      if (automatic && signature === lastSignatureRef.current) return;
      if (automatic && !media && analysisBusyRef.current) {
        queuedContextRef.current = nextContext;
        publishInline({ phase: "typing", error: "" });
        return;
      }
      if (!automatic || !media) setAutoMediaNotice(null);
      lastSignatureRef.current = signature;
      const requestId = ++requestIdRef.current;
      // A newer request supersedes the previous upload, even when the new
      // request analyzes text only. Otherwise the old file keeps uploading.
      mediaAbortControllerRef.current?.abort();
      mediaAbortControllerRef.current = null;
      mediaAnalysisRef.current = 0;
      const mediaController = media ? new AbortController() : null;
      if (mediaController) {
        mediaAnalysisRef.current = requestId;
        mediaAbortControllerRef.current = mediaController;
      }
      analysisBusyRef.current = true;
      setLoading(true);
      setError("");
      publishInline({
        phase: "analyzing",
        error: "",
        progressMessage: ui(
          interfaceLanguage,
          "Подготавливаем файл и выбираем подходящую модель…",
          "Preparing the file and selecting the right model…",
        ),
        mediaName: media?.name,
        ...(media ? { previews: [] } : {}),
      });
      try {
        // Public projection: no provider keys. Media analysis asks for the
        // privileged variant separately, below, and only when the user has
        // opted in to sending the file itself.
        const settings = await rpc<PublicExtensionSettings>({ type: "GET_SETTINGS" });
        const mediaFacts = media
          ? await inspectMediaFile(media, mediaController?.signal).catch((caught) => {
              if (mediaController?.signal.aborted) throw caught;
              return `filename=${media.name}, mime=${media.type || "unknown"}`;
            })
          : "";
        const automaticUploadTitle =
          media && uploadTitleLooksAutomatic(nextContext.title, media);
        const semanticTitle = automaticUploadTitle ? "" : nextContext.title;
        const semanticTopic =
          automaticUploadTitle &&
          (nextContext.topic ?? "").trim().toLocaleLowerCase() ===
            nextContext.title.trim().toLocaleLowerCase()
            ? ""
            : (nextContext.topic ?? "");
        // Text requests get channel style from the service worker's cache;
        // media goes through the bridge, so it is attached here.
        const channelContext = media
          ? buildChannelStyleContext(dashboardRef.current, {
              excludeVideoId: nextContext.videoId,
            })
          : "";
        const localizedContext: VideoContext = {
          ...nextContext,
          title: semanticTitle,
          language: settings.generationLanguage,
          ...(channelContext ? { channelContext } : {}),
          ...(priorMediaEvidence
            ? {
                transcript: [
                  nextContext.transcript?.trim(),
                  "Verified findings from the previous full media analysis:",
                  priorMediaEvidence,
                ]
                  .filter(Boolean)
                  .join("\n"),
              }
            : {}),
          ...(mediaFacts
            ? {
                topic:
                  `${semanticTopic || semanticTitle}\nVerified source metadata: ${mediaFacts}`.trim(),
              }
            : {}),
        };
        const received = media
          ? await (async () => {
              const { analyzeMediaInBridge } = await import("./media-bridge");
              if (
                mediaController?.signal.aborted ||
                requestId !== requestIdRef.current
              ) {
                throw new DOMException("Media analysis cancelled", "AbortError");
              }
              return analyzeMediaInBridge(
                localizedContext,
                media,
                (progress) => {
                  if (requestId === requestIdRef.current) {
                    publishInline({ progressMessage: progress.message });
                  }
                },
                mediaController?.signal,
              );
            })()
          : await rpc<AnalysisResult>({
              type: "ANALYZE_TEXT",
              payload: {
                context: localizedContext,
                provider: settings.preferredProvider,
              },
            });
        // The result crosses a message boundary (service worker or media
        // bridge frame). Bring it to the full shape before anything renders
        // it: every list the panel and the Studio helpers read must exist.
        const analysis = normalizeAnalysisResult(received);
        if (!analysis) {
          throw new Error(
            ui(
              interfaceLanguage,
              "AI вернул ответ неправильного формата",
              "The AI returned an invalid response format",
            ),
          );
        }
        let previews = inlineSnapshot.previews;
        if (media) {
          try {
            previews = await buildThumbnailPreviews(
              media,
              analysis.titles,
              analysis.contentInsights.thumbnailMoments.map(
                (moment) => moment.timestampSeconds,
              ),
              mediaController?.signal,
            );
          } catch {
            previews = [];
          }
        }
        if (requestId !== requestIdRef.current) return;
        if (media) {
          lastMediaEvidenceRef.current = JSON.stringify({
            summary: analysis.contentInsights.summary,
            detectedFormat: analysis.contentInsights.detectedFormat,
            targetAudience: analysis.contentInsights.targetAudience,
            primaryHook: analysis.contentInsights.primaryHook,
            keyMoments: analysis.contentInsights.keyMoments,
            visualElements: analysis.contentInsights.visualElements,
            spokenTopics: analysis.contentInsights.spokenTopics,
            retentionRisks: analysis.contentInsights.retentionRisks,
            thumbnailMoments: analysis.contentInsights.thumbnailMoments,
          }).slice(0, 12_000);
        }
        revealResultRef.current = !automatic;
        setResult(analysis);
        if (automatic && media)
          setAutoMediaNotice({
            fileName: media.name,
            status: "ready",
            message: "",
          });
        publishInline({
          phase: "ready",
          result: analysis,
          error: "",
          progressMessage: "",
          mediaName: undefined,
          previews,
        });
      } catch (caught) {
        if (requestId !== requestIdRef.current) return;
        const message =
          caught instanceof Error
            ? caught.message
            : ui(interfaceLanguage, "Ошибка анализа", "Analysis failed");
        setError(message);
        if (automatic && media)
          setAutoMediaNotice({
            fileName: media.name,
            status: "error",
            message,
          });
        publishInline({
          phase: "error",
          error: message,
          progressMessage: "",
          mediaName: undefined,
        });
      } finally {
        if (media && mediaAnalysisRef.current === requestId) {
          mediaAnalysisRef.current = 0;
          mediaAbortControllerRef.current = null;
        }
        if (requestId === requestIdRef.current) {
          analysisBusyRef.current = false;
          setLoading(false);
        }
      }
    },
    [interfaceLanguage],
  );

  const loadDashboard = useCallback(
    async (force = false) => {
      const requestId = ++dashboardRequestIdRef.current;
      setDashboardLoading(true);
      try {
        const data = await rpc<DashboardData>({
          type: "GET_DASHBOARD",
          ...(force ? { force: true } : {}),
        });
        if (requestId === dashboardRequestIdRef.current) {
          setDashboard(data);
          setDashboardError("");
        }
      } catch (caught) {
        if (requestId === dashboardRequestIdRef.current) {
          const message =
            caught instanceof Error
              ? caught.message
              : ui(interfaceLanguage, "Ошибка аналитики", "Analytics failed");
          // The service worker localizes its errors, so both languages have to
          // match here — the English UI never offered the re-auth button.
          if (
            /Google-сессия|Google session|OAuth|login_required|interaction_required/i.test(
              message,
            )
          ) {
            setReauthRequired(true);
          }
          setDashboardError(message);
        }
      } finally {
        if (requestId === dashboardRequestIdRef.current) {
          setDashboardLoading(false);
        }
      }
    },
    [interfaceLanguage],
  );

  useEffect(() => {
    installTopDockPageStyles();
    let timer = 0;
    let recoveryTimers: number[] = [];
    let activeMount: HTMLDivElement | null = null;
    const mount = () => {
      timer = 0;
      let next: HTMLDivElement | null = null;
      try {
        next = ensureTopDockMount();
      } catch {
        // Never leak a transient Studio SPA DOM race into chrome://extensions
        // as an extension error. The fallback remains available until retry.
        resetTopDockPlacement();
      }
      activeMount = next;
      setDockContainer((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (!topDockRequestedVisible || document.fullscreenElement) return;
      // The portal survives fullscreen in its own shadow root, but YouTube can
      // detach its layout spacer. A connected portal alone is not a valid dock.
      if (
        activeMount?.isConnected &&
        topDockMount?.spacer.isConnected &&
        topDockMount.host.style.display !== "none"
      )
        return;
      if (!timer) timer = window.setTimeout(mount, 600);
    };
    const reposition = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(mount, 150);
    };
    const recover = () => {
      recoveryTimers.forEach(window.clearTimeout);
      reposition();
      // Header visibility can settle after the first fullscreen/SPA event,
      // without another DOM mutation. Retry briefly instead of waiting 10s.
      recoveryTimers = [600, 1500, 3000].map((delay) =>
        window.setTimeout(reposition, delay),
      );
    };
    mount();
    // Coalesce mutation bursts. YouTube emits thousands of childList records a
    // second on a watch page with live chat or on the infinite-scroll feed;
    // reacting once per animation frame is indistinguishable to the user and
    // keeps this observer off the hot path.
    let scheduleFrame = 0;
    const scheduleDebounced = () => {
      if (scheduleFrame) return;
      scheduleFrame = window.requestAnimationFrame(() => {
        scheduleFrame = 0;
        schedule();
      });
    };
    const observer = new MutationObserver(scheduleDebounced);
    // Watch the header itself once it exists. Observing documentElement with
    // subtree:true forces Chromium to allocate a MutationRecord for every DOM
    // change anywhere on the page, which on YouTube is constant traffic.
    // documentElement stays the target only while the header is still
    // hydrating and there is nothing narrower to watch.
    let observedRoot: Node | null = null;
    const retargetObserver = () => {
      const header =
        document.querySelector("ytd-masthead") ??
        document.querySelector("ytcp-header") ??
        document.querySelector("#masthead-container") ??
        document.documentElement;
      if (header === observedRoot) return;
      observer.disconnect();
      observedRoot = header;
      observer.observe(header, { childList: true, subtree: true });
    };
    retargetObserver();
    // The header element is replaced wholesale during some Studio SPA
    // transitions, so re-point the observer alongside the periodic re-check.
    const scheduleWithRetarget = () => {
      retargetObserver();
      schedule();
    };
    const interval = window.setInterval(scheduleWithRetarget, 10_000);
    // A ResizeObserver on the spacer catches header width changes that produce
    // no DOM mutation at all — collapsing the guide menu, a scrollbar
    // appearing, a zoom change — which previously left the dock mispositioned
    // for up to the full 10-second interval.
    const spacerResizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => reposition());
    let observedSpacer: Element | null = null;
    const retargetSpacerObserver = () => {
      const spacer = topDockMount?.spacer ?? null;
      if (spacer === observedSpacer) return;
      spacerResizeObserver?.disconnect();
      observedSpacer = spacer;
      if (spacer?.isConnected) spacerResizeObserver?.observe(spacer);
    };
    const spacerInterval = window.setInterval(retargetSpacerObserver, 2_000);
    retargetSpacerObserver();
    window.addEventListener("resize", reposition);
    document.addEventListener("fullscreenchange", recover);
    document.addEventListener("webkitfullscreenchange", recover);
    document.addEventListener("yt-navigate-finish", recover);
    document.addEventListener(TOP_DOCK_VISIBILITY_EVENT, reposition);
    return () => {
      observer.disconnect();
      spacerResizeObserver?.disconnect();
      if (scheduleFrame) window.cancelAnimationFrame(scheduleFrame);
      window.clearInterval(interval);
      window.clearInterval(spacerInterval);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("fullscreenchange", recover);
      document.removeEventListener("webkitfullscreenchange", recover);
      document.removeEventListener("yt-navigate-finish", recover);
      document.removeEventListener(TOP_DOCK_VISIBILITY_EVENT, reposition);
      recoveryTimers.forEach(window.clearTimeout);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // On a fresh page load YouTube's own header is often still hydrating when
  // this content script mounts, so the native dock slot briefly does not
  // exist yet. Give it a short grace window to appear before falling back to
  // the floating widget, so a normal load never flashes the fallback at the
  // bottom of the screen only to jump to the top a moment later.
  useEffect(() => {
    if (dockContainer) {
      setDockGraceExpired(false);
      return;
    }
    if (window.innerWidth < 640) {
      setDockGraceExpired(true);
      return;
    }
    const timer = window.setTimeout(() => setDockGraceExpired(true), 1_200);
    return () => window.clearTimeout(timer);
  }, [dockContainer]);

  useEffect(() => {
    setTopDockVisibility(interfaceReady && showHeaderWidget);
  }, [interfaceReady, showHeaderWidget, dockContainer]);

  useEffect(() => {
    const clampPanel = () => {
      setPanelRect((current) =>
        // Passing `current` lets resolvePanelLayout hand back the very same
        // object when nothing moved, so setState bails out. The observer below
        // watches documentElement, whose height changes on every YouTube
        // infinite-scroll append — without the identity check each append
        // re-rendered the panel and the header-widget portal.
        resolvePanelLayout(
          persistablePanelLayout(current),
          {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          current,
        ),
      );
    };
    window.addEventListener("resize", clampPanel);
    window.visualViewport?.addEventListener("resize", clampPanel);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(clampPanel);
    resizeObserver?.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", clampPanel);
      window.visualViewport?.removeEventListener("resize", clampPanel);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const applyInterfaceSettings = (
      next: Pick<
        ExtensionSettings,
        | "interfaceLanguage"
        | "generationLanguage"
        | "showHeaderWidget"
        | "showLauncher"
        | "theme"
        | "accentColor"
        | "panelTransparency"
        | "density"
        | "animationMode"
        | "panelLayout"
        | "widgetSections"
        | "widgetDockMetrics"
        | "analyticsRefreshSeconds"
        | "allowAiMediaUploads"
      >,
    ) => {
      setInterfaceLanguage(next.interfaceLanguage);
      setGenerationLanguage(next.generationLanguage);
      setShowHeaderWidget(next.showHeaderWidget);
      setShowLauncher(next.showLauncher);
      setUiSettings((current) => ({ ...current, ...next }));
      if (!panelInteractionRef.current) {
        setPanelRect(
          resolvePanelLayout(next.panelLayout, {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      }
      setInterfaceReady(true);
    };
    const handleSettingsChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes.settings?.newValue) return;
      // Only reachable where Chrome could not restrict local storage to trusted
      // contexts. The raw object holds the provider keys, and spreading it into
      // UI state would put them in this renderer; take the public view only.
      applyInterfaceSettings(
        toPublicSettings(normalizeExtensionSettings(changes.settings.newValue)),
      );
    };
    const handleRuntimeSettings = (message: unknown) => {
      if (
        !message ||
        typeof message !== "object" ||
        (message as { type?: unknown }).type !== "SETTINGS_CHANGED"
      ) {
        return;
      }
      const payload = (
        message as {
          payload?: Partial<ExtensionSettings>;
        }
      ).payload;
      if (
        (payload?.interfaceLanguage === "ru" || payload?.interfaceLanguage === "en") &&
        (payload.generationLanguage === "ru" || payload.generationLanguage === "en") &&
        typeof payload.showHeaderWidget === "boolean" &&
        typeof payload.showLauncher === "boolean" &&
        (payload.theme === "auto" ||
          payload.theme === "dark" ||
          payload.theme === "light") &&
        (payload.accentColor === "violet" ||
          payload.accentColor === "cyan" ||
          payload.accentColor === "emerald" ||
          payload.accentColor === "coral") &&
        typeof payload.panelTransparency === "number" &&
        (payload.density === "comfortable" || payload.density === "compact") &&
        (payload.animationMode === "system" ||
          payload.animationMode === "full" ||
          payload.animationMode === "reduced") &&
        Boolean(payload.panelLayout) &&
        Array.isArray(payload.widgetSections) &&
        Array.isArray(payload.widgetDockMetrics) &&
        typeof payload.analyticsRefreshSeconds === "number" &&
        typeof payload.allowAiMediaUploads === "boolean"
      ) {
        applyInterfaceSettings({
          interfaceLanguage: payload.interfaceLanguage,
          generationLanguage: payload.generationLanguage,
          showHeaderWidget: payload.showHeaderWidget,
          showLauncher: payload.showLauncher,
          theme: payload.theme,
          accentColor: payload.accentColor,
          panelTransparency: payload.panelTransparency,
          density: payload.density,
          animationMode: payload.animationMode,
          panelLayout: payload.panelLayout!,
          widgetSections: normalizeWidgetSections(payload.widgetSections),
          widgetDockMetrics: normalizeDockMetrics(payload.widgetDockMetrics),
          analyticsRefreshSeconds: payload.analyticsRefreshSeconds,
          allowAiMediaUploads: payload.allowAiMediaUploads,
        });
      }
    };
    chrome.storage.onChanged.addListener(handleSettingsChange);
    chrome.runtime.onMessage.addListener(handleRuntimeSettings);
    return () => {
      chrome.storage.onChanged.removeListener(handleSettingsChange);
      chrome.runtime.onMessage.removeListener(handleRuntimeSettings);
    };
  }, []);

  // Bootstrap: read the stored settings and the auth status once.
  //
  // This used to share an effect with the Studio file-capture setup below,
  // under the dependency list `[runAnalysis, uiSettings.allowAiMediaUploads]`.
  // Since `runAnalysis` depends on the interface language, switching the
  // language — or toggling "send media to AI" — re-issued both RPCs and, worse,
  // called `setPanelRect` with the *stored* layout, throwing away a panel
  // position the user had just dragged but not yet persisted.
  useEffect(() => {
    void rpc<PublicExtensionSettings>({ type: "GET_SETTINGS" })
      .then((settings) => {
        setInterfaceLanguage(settings.interfaceLanguage);
        setGenerationLanguage(settings.generationLanguage);
        setShowHeaderWidget(settings.showHeaderWidget);
        setShowLauncher(settings.showLauncher);
        setUiSettings(settings);
        setPanelRect((current) =>
          resolvePanelLayout(
            settings.panelLayout,
            { width: window.innerWidth, height: window.innerHeight },
            current,
          ),
        );
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : ui(languageRef.current, "Ошибка настроек", "Could not load settings"),
        );
      })
      .finally(() => setInterfaceReady(true));
    void rpc<GoogleAuthStatus>({ type: "AUTH_STATUS" })
      .then((status) => {
        setSignedIn(status.signedIn);
        setReauthRequired(status.reauthRequired);
      })
      .catch((caught: unknown) => {
        setSignedIn(false);
        setDashboardError(
          caught instanceof Error
            ? caught.message
            : ui(languageRef.current, "Ошибка авторизации", "Authentication failed"),
        );
      });
  }, []);

  useEffect(() => {
    if (uiSettings.allowAiMediaUploads) return;
    setAutoMediaNotice(null);
    if (mediaAnalysisRef.current === 0) return;
    requestIdRef.current += 1;
    mediaAbortControllerRef.current?.abort();
    mediaAbortControllerRef.current = null;
    mediaAnalysisRef.current = 0;
    analysisBusyRef.current = false;
    queuedContextRef.current = null;
    setLoading(false);
    setFile(null);
    publishInline({ phase: "idle", progressMessage: "", mediaName: undefined });
  }, [uiSettings.allowAiMediaUploads]);

  // Hiding the widget or the launcher was instant and silent: the element
  // vanished and nothing said it could be undone, or from where.
  const [hiddenNotice, setHiddenNotice] = useState<"widget" | "launcher" | null>(null);
  useEffect(() => {
    if (!hiddenNotice) return;
    const timer = window.setTimeout(() => setHiddenNotice(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [hiddenNotice]);
  // Brought back from the popup or the dashboard meanwhile: nothing to undo.
  useEffect(() => {
    if (
      (hiddenNotice === "widget" && showHeaderWidget) ||
      (hiddenNotice === "launcher" && showLauncher)
    )
      setHiddenNotice(null);
  }, [hiddenNotice, showHeaderWidget, showLauncher]);

  useEffect(() => {
    if (autoMediaNotice?.status !== "ready") return;
    const timer = window.setTimeout(
      () =>
        setAutoMediaNotice((current) => (current?.status === "ready" ? null : current)),
      15_000,
    );
    return () => window.clearTimeout(timer);
  }, [autoMediaNotice]);

  // Studio only: watch for the video file the user picks in the upload dialog.
  useEffect(() => {
    if (location.hostname !== "studio.youtube.com" || !uiSettings.allowAiMediaUploads) {
      return;
    }
    const analyzeSelectedFile = (selected: File) => {
      const signature = [
        selected.name,
        selected.size,
        selected.lastModified,
        selected.type,
      ].join(":");
      if (
        capturedMediaRef.current.has(selected) ||
        capturedMediaSignaturesRef.current.has(signature)
      ) {
        return;
      }
      capturedMediaRef.current.add(selected);
      capturedMediaSignaturesRef.current.add(signature);
      if (capturedMediaSignaturesRef.current.size > 50) {
        const oldest = capturedMediaSignaturesRef.current.values().next().value;
        if (oldest) capturedMediaSignaturesRef.current.delete(oldest);
      }
      lastMediaEvidenceRef.current = "";
      setFile(selected);
      setAutoMediaNotice({
        fileName: selected.name,
        status: "analyzing",
        message: "",
      });
      void runAnalysis(readPageContext(), selected, true);
    };
    const capture = (event: Event) => {
      if (eventComesFromChannelPilot(event)) return;
      const selected = mediaFileFromEvent(event);
      if (selected) analyzeSelectedFile(selected);
    };
    const scanExistingInputs = () => {
      if (document.visibilityState !== "visible") return;
      for (const input of document.querySelectorAll<HTMLInputElement>(
        'input[type="file"]',
      )) {
        for (const file of input.files ?? []) {
          if (!isAutomaticUploadVideo(file)) continue;
          analyzeSelectedFile(file);
          return;
        }
      }
    };
    document.addEventListener("input", capture, true);
    document.addEventListener("change", capture, true);
    document.addEventListener("drop", capture, true);
    document.addEventListener("visibilitychange", scanExistingInputs);
    const scanInterval = window.setInterval(scanExistingInputs, 5_000);
    scanExistingInputs();
    return () => {
      document.removeEventListener("input", capture, true);
      document.removeEventListener("change", capture, true);
      document.removeEventListener("drop", capture, true);
      document.removeEventListener("visibilitychange", scanExistingInputs);
      window.clearInterval(scanInterval);
    };
  }, [runAnalysis, uiSettings.allowAiMediaUploads]);

  useEffect(() => {
    const detectNavigation = () => {
      const identity = `${location.hostname}:${videoIdFromLocation() ?? location.pathname}`;
      if (identity === pageIdentityRef.current) return;
      pageIdentityRef.current = identity;
      requestIdRef.current += 1;
      analysisBusyRef.current = false;
      mediaAnalysisRef.current = 0;
      queuedContextRef.current = null;
      lastSignatureRef.current = "";
      lastMediaEvidenceRef.current = "";
      mediaAbortControllerRef.current?.abort();
      mediaAbortControllerRef.current = null;
      setLoading(false);
      setFile(null);
      setAutoMediaNotice(null);
      setResult(null);
      const next = readPageContext();
      setContext(next);
      publishInline({
        phase: "idle",
        result: null,
        error: "",
        progressMessage: "",
        mediaName: undefined,
        previews: [],
      });
      scheduleInlineMounts();
    };
    // YouTube and Studio are SPAs that announce their own route changes. Acting
    // on the event means the panel swaps to the new video immediately instead
    // of showing the previous one's data for up to 750 ms.
    //
    // `detectNavigation` is idempotent — it compares the page identity and
    // returns early when nothing changed — so the slow interval below is a pure
    // safety net for the case where YouTube renames or stops firing an event.
    // It is kept at 3 s rather than 750 ms because it is no longer the primary
    // signal.
    const navigationEvents = [
      "yt-navigate-finish",
      "yt-page-data-updated",
      "yt-navigate-redirect",
    ] as const;
    for (const name of navigationEvents) {
      document.addEventListener(name, detectNavigation);
    }
    const interval = window.setInterval(detectNavigation, 3_000);
    window.addEventListener("popstate", detectNavigation);
    return () => {
      for (const name of navigationEvents) {
        document.removeEventListener(name, detectNavigation);
      }
      window.clearInterval(interval);
      window.removeEventListener("popstate", detectNavigation);
    };
  }, []);

  useEffect(() => {
    const handleRetry = () => {
      const next = readPageContext();
      lastSignatureRef.current = "";
      setContext((current) => ({
        ...current,
        ...next,
        topic: next.title || current.topic || "",
      }));
      void runAnalysis(next, file, false);
    };
    window.addEventListener(RETRY_ANALYSIS_EVENT, handleRetry);
    return () => window.removeEventListener(RETRY_ANALYSIS_EVENT, handleRetry);
  }, [file, runAnalysis]);

  useEffect(() => {
    if (location.hostname !== "studio.youtube.com") return;
    scheduleInlineMounts();
    // Same reasoning as the dock observer: coalesce per frame, and watch the
    // Studio app shell rather than the whole body so unrelated page churn does
    // not allocate a MutationRecord for this observer.
    let inlineFrame = 0;
    const scheduleInlineDebounced = () => {
      if (inlineFrame) return;
      inlineFrame = window.requestAnimationFrame(() => {
        inlineFrame = 0;
        scheduleInlineMounts();
      });
    };
    const observer = new MutationObserver(scheduleInlineDebounced);
    const observationRoot =
      document.querySelector("ytcp-app") ??
      document.querySelector("#content") ??
      document.body ??
      document.documentElement;
    observer.observe(observationRoot, { childList: true, subtree: true });

    const handleInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        !target.closest(TITLE_SELECTORS.join(",")) &&
        !target.closest(DESCRIPTION_SELECTORS.join(","))
      ) {
        return;
      }
      const next = readPageContext();
      setContext((current) => ({
        ...current,
        ...next,
        topic: next.title || current.topic || "",
      }));
      if (mediaAnalysisRef.current !== 0) {
        queuedContextRef.current = null;
        return;
      }
      if (analysisBusyRef.current) {
        queuedContextRef.current = next;
        return;
      }
      publishInline({ phase: "typing", error: "" });
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = window.setTimeout(
        () => void runAnalysis(next, null, true),
        1_400,
      );
    };
    document.addEventListener("input", handleInput, true);
    return () => {
      if (inlineFrame) window.cancelAnimationFrame(inlineFrame);
      observer.disconnect();
      document.removeEventListener("input", handleInput, true);
      window.clearTimeout(autoTimerRef.current);
    };
  }, [runAnalysis]);

  useEffect(() => {
    if (loading || mediaAnalysisRef.current !== 0) return;
    const queued = queuedContextRef.current;
    if (!queued) return;
    queuedContextRef.current = null;
    void runAnalysis(queued, null, true);
  }, [loading, runAnalysis]);

  useEffect(() => {
    if (open) setContext(readPageContext());
  }, [open]);

  useEffect(() => {
    if (!result || !revealResultRef.current) return;
    revealResultRef.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({
      block: "start",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [result]);

  useEffect(() => {
    if (!signedIn) return;
    void loadDashboard();
    const refreshVisibleDashboard = () => {
      if (document.visibilityState === "visible") void loadDashboard();
    };
    const interval = window.setInterval(
      refreshVisibleDashboard,
      Math.max(60, uiSettings.analyticsRefreshSeconds) * 1_000,
    );
    document.addEventListener("visibilitychange", refreshVisibleDashboard);
    // Back online: refresh now instead of waiting out the polling interval.
    window.addEventListener("online", refreshVisibleDashboard);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisibleDashboard);
      window.removeEventListener("online", refreshVisibleDashboard);
    };
  }, [signedIn, loadDashboard, uiSettings.analyticsRefreshSeconds]);

  const currentVideo = useMemo(
    () => dashboard?.videos.find((video) => video.id === context.videoId),
    [dashboard, context.videoId],
  );

  async function signIn() {
    // The widget and the panel both offer sign-in; a second click must not
    // open a second Google window while the first is still up.
    if (signingInRef.current) return;
    signingInRef.current = true;
    setSigningIn(true);
    setDashboardError("");
    try {
      const result = await rpc<GoogleSignInResult>({ type: "SIGN_IN" });
      setSignedIn(true);
      setReauthRequired(false);
      if (result.warning) setDashboardError(result.warning);
      await loadDashboard(true);
    } catch (caught) {
      setDashboardError(
        caught instanceof Error
          ? caught.message
          : ui(interfaceLanguage, "Не удалось войти", "Could not sign in"),
      );
    } finally {
      signingInRef.current = false;
      setSigningIn(false);
    }
  }

  async function analyze() {
    await runAnalysis(context, file);
  }

  async function changeGenerationLanguage(next: SupportedLanguage) {
    setGenerationLanguage(next);
    const nextContext = { ...context, language: next };
    setContext(nextContext);
    lastSignatureRef.current = "";
    try {
      await rpc({
        type: "SAVE_SETTINGS_PATCH",
        payload: { generationLanguage: next },
      });
      if (file || nextContext.title.trim().length >= 4) {
        void runAnalysis(nextContext, file, false);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : ui(
              interfaceLanguage,
              "Ошибка языка генерации",
              "Could not update generation language",
            ),
      );
    }
  }

  /**
   * Persists a widget layout change made on the page.
   *
   * The composition is applied optimistically so dragging a block up does not
   * wait on a round trip to the service worker, then reconciled with whatever
   * the normalizer actually stored.
   */
  async function saveWidgetComposition(patch: ContentSettingsPatch) {
    setUiSettings((current) => ({ ...current, ...patch }));
    try {
      const saved = await rpc<PublicExtensionSettings>({
        type: "SAVE_SETTINGS_PATCH",
        payload: patch,
      });
      setUiSettings((current) => ({
        ...current,
        widgetSections: saved.widgetSections,
        widgetDockMetrics: saved.widgetDockMetrics,
      }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : ui(
              interfaceLanguage,
              "Не удалось сохранить состав виджета",
              "Could not save the widget layout",
            ),
      );
    }
  }

  async function changeInterfaceVisibility(
    patch: Pick<ExtensionSettings, "showHeaderWidget" | "showLauncher">,
  ): Promise<boolean> {
    try {
      const saved = await rpc<PublicExtensionSettings>({
        type: "SAVE_SETTINGS_PATCH",
        payload: patch,
      });
      setShowHeaderWidget(saved.showHeaderWidget);
      setShowLauncher(saved.showLauncher);
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : ui(
              interfaceLanguage,
              "Не удалось сохранить видимость интерфейса",
              "Could not save interface visibility",
            ),
      );
      return false;
    }
  }

  function hideInterfaceElement(target: "widget" | "launcher"): void {
    void changeInterfaceVisibility(
      target === "widget"
        ? { showHeaderWidget: false, showLauncher }
        : { showHeaderWidget, showLauncher: false },
    ).then((saved) => {
      if (saved) setHiddenNotice(target);
    });
  }

  function undoHide(): void {
    const target = hiddenNotice;
    setHiddenNotice(null);
    if (!target) return;
    void changeInterfaceVisibility(
      target === "widget"
        ? { showHeaderWidget: true, showLauncher }
        : { showHeaderWidget, showLauncher: true },
    );
  }

  function focusedUiElement(): HTMLElement | null {
    const root = panelRef.current?.getRootNode();
    if (root instanceof ShadowRoot && root.activeElement instanceof HTMLElement) {
      return root.activeElement;
    }
    return document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  function openPanel(): void {
    panelFocusReturnRef.current = focusedUiElement();
    setOpen(true);
  }

  function closePanel(): void {
    setPendingSuggestion(null);
    setOpen(false);
    window.requestAnimationFrame(() => {
      if (showLauncher && launcherRef.current) {
        launcherRef.current.focus();
      } else {
        panelFocusReturnRef.current?.focus();
      }
    });
  }

  /**
   * Keeps every keystroke made inside the panel from reaching YouTube.
   *
   * The panel lives in a shadow root, so YouTube's global hotkey listeners see
   * the *host* element as `event.target`, not our `<textarea>`. Their
   * "is the user typing in a field?" check therefore returned false and the
   * page acted on the keystroke: space paused the player, arrows seeked, `f`
   * went fullscreen, `m` muted, digits jumped through the video. Stopping
   * propagation here is the whole fix — the event still reaches our own React
   * handlers, it simply never bubbles out to the document.
   */
  // Deliberately not memoized: it calls `closePanel`, which closes over
  // `showLauncher`. A useCallback with an empty dependency list would pin the
  // first render's copy and send focus to the wrong element later.
  function isolateKeyboard(event: ReactKeyboardEvent<HTMLElement>): void {
    event.stopPropagation();
    if (event.key !== "Escape" || event.type !== "keydown") return;
    const target = event.target as HTMLElement | null;
    // Let a native control (a <select>, an open combobox) consume Escape first.
    if (target?.getAttribute("aria-expanded") === "true") return;
    event.preventDefault();
    closePanel();
  }

  // Named `useSuggestion` until now, which made React's lint rules treat a
  // plain click handler as a hook. Renamed so the "use" prefix keeps meaning
  // "this is a hook" everywhere in the file.
  function applySuggestion(kind: "title" | "description", value: string) {
    // Outside Studio there is no field to replace, so the confirmation dialog
    // only ever ended in "field not found, copied instead". Copy directly.
    if (!isStudioPage) {
      copySuggestion(value);
      return;
    }
    confirmFocusReturnRef.current = focusedUiElement();
    setPendingSuggestion({ kind, value });
  }

  function copySuggestion(value: string, fieldMissing = false) {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setError("");
        setNotice(
          fieldMissing
            ? ui(
                interfaceLanguage,
                "Поле Studio не найдено — вариант скопирован в буфер обмена",
                "The Studio field was not found — the suggestion was copied",
              )
            : ui(
                interfaceLanguage,
                "Скопировано в буфер обмена",
                "Copied to clipboard",
              ),
        );
      })
      .catch(() =>
        setError(
          ui(
            interfaceLanguage,
            "Браузер запретил доступ к буферу обмена. Выделите текст и скопируйте вручную.",
            "The browser denied clipboard access. Select the text and copy it manually.",
          ),
        ),
      );
  }

  function confirmSuggestion() {
    if (!pendingSuggestion) return;
    const { kind, value } = pendingSuggestion;
    const applied = applyToStudio(kind, value);
    setContext({ ...context, [kind]: value });
    setPendingSuggestion(null);
    if (!applied) {
      copySuggestion(value, true);
    } else {
      setError("");
      setNotice(
        kind === "title"
          ? ui(
              interfaceLanguage,
              "Заголовок вставлен в Studio",
              "Title inserted in Studio",
            )
          : ui(
              interfaceLanguage,
              "Описание вставлено в Studio",
              "Description inserted in Studio",
            ),
      );
    }
  }

  // "Auto" follows the page the widget sits on. YouTube's own theme is set
  // independently of the OS, and a light capsule in a dark masthead (or the
  // reverse) looked pasted on. The OS preference is only the fallback.
  const resolvedPanelTheme =
    uiSettings.theme === "auto"
      ? (pageTheme ?? (systemPrefersLight ? "light" : "dark"))
      : uiSettings.theme;
  // The header widget is a ~700-line subtree rendered through a portal. Its
  // four callbacks used to be fresh arrow functions on every App render, so
  // React.memo could never hit and every keystroke in the panel's description
  // field re-rendered the whole widget.
  //
  // The handlers are read through a ref that is refreshed on each render, so
  // the identities below stay stable for the lifetime of the component while
  // still calling the current closures — no stale state, no dependency list to
  // keep in sync.
  languageRef.current = interfaceLanguage;
  widgetHandlersRef.current = {
    onOpen: () => {
      setTab("analytics");
      openPanel();
    },
    onRefresh: () => void loadDashboard(true),
    onSignIn: () => void signIn(),
    onHide: () => hideInterfaceElement("widget"),
    onComposition: (patch) => void saveWidgetComposition(patch),
  };
  // Its own boundary: a failure in the header widget used to take the panel
  // and the launcher down with it (and the other way round), leaving only the
  // error card on the page.
  const realtimeWidgetElement = (
    <ErrorBoundary compact language={interfaceLanguage}>
      <RealtimeWidget
        dashboard={dashboard}
        signedIn={signedIn}
        loading={dashboardLoading}
        failure={dashboardError}
        signingIn={signingIn}
        panelOpen={open}
        docked={Boolean(dockContainer)}
        reauthRequired={reauthRequired}
        theme={resolvedPanelTheme}
        sections={uiSettings.widgetSections}
        dockMetrics={uiSettings.widgetDockMetrics}
        launcherVisible={showLauncher}
        onOpen={stableWidgetHandlers.onOpen}
        onRefresh={stableWidgetHandlers.onRefresh}
        onSignIn={stableWidgetHandlers.onSignIn}
        onHide={stableWidgetHandlers.onHide}
        onComposition={stableWidgetHandlers.onComposition}
        language={interfaceLanguage}
      />
    </ErrorBoundary>
  );
  // YouTube occasionally replaces the masthead during SPA navigation. Keep a
  // compact floating fallback visible while the native slot is being found
  // beyond the initial grace window, then move the same widget into the
  // header as soon as the mount is ready.
  const realtimeWidget =
    interfaceReady && showHeaderWidget
      ? dockContainer
        ? createPortal(realtimeWidgetElement, dockContainer)
        : dockGraceExpired
          ? realtimeWidgetElement
          : null
      : null;
  // Accents come from @channelpilot/shared. This file used to keep a second,
  // hard-coded copy of the table whose four values had all drifted from the
  // cabinet's, so the same "brand colour" rendered differently depending on
  // where the user was looking.
  const panelPalette = accentPalette(uiSettings.accentColor);
  const panelStyle = {
    left: panelRect.x,
    top: panelRect.y,
    width: panelRect.width,
    height: panelRect.height,
    "--cp-purple": panelPalette.base,
    "--cp-purple-soft": panelPalette.soft,
    "--cp-accent-contrast":
      resolvedPanelTheme === "light" ? panelPalette.onLight : panelPalette.soft,
    "--cp-focus-ring": resolvedPanelTheme === "light" ? "#1f2440" : "#ffffff",
    "--cp-panel-alpha": uiSettings.panelTransparency / 100,
  } as CSSProperties & Record<string, string | number>;
  const isStudioPage = location.hostname === "studio.youtube.com";
  const uploadAssistantSteps: Array<{
    label: string;
    status: "done" | "active" | "review" | "pending";
  }> = [
    {
      label: ui(interfaceLanguage, "Анализ файла", "File analysis"),
      status: file
        ? loading && !result
          ? "active"
          : result
            ? "done"
            : "review"
        : "pending",
    },
    {
      label: ui(interfaceLanguage, "Проверка названия", "Title review"),
      status: context.title.trim().length >= 20 ? "done" : "pending",
    },
    {
      label: ui(interfaceLanguage, "Генерация метаданных", "Metadata generation"),
      status: result ? "done" : loading ? "active" : "pending",
    },
    {
      label: ui(interfaceLanguage, "Проверка описания", "Description review"),
      status:
        (result?.description.length ?? context.description.length) >= 120
          ? "done"
          : "pending",
    },
    {
      label: ui(interfaceLanguage, "Проверка превью", "Thumbnail review"),
      status: result?.thumbnailIdeas.length ? "review" : "pending",
    },
    {
      label: "SEO checklist",
      status: result ? "done" : "pending",
    },
    {
      label: ui(interfaceLanguage, "Финальная проверка", "Final review"),
      status: result ? "review" : "pending",
    },
  ];

  if (!open) {
    return (
      <>
        {realtimeWidget}
        {autoMediaNotice && (
          <div
            className={`cp-media-notice ${autoMediaNotice.status} ${showLauncher ? "with-launcher" : ""}`}
            data-theme={resolvedPanelTheme}
            role={autoMediaNotice.status === "error" ? "alert" : "status"}
          >
            <span className="cp-media-notice-icon" aria-hidden="true">
              {autoMediaNotice.status === "analyzing"
                ? ""
                : autoMediaNotice.status === "ready"
                  ? "✓"
                  : "!"}
            </span>
            <span className="cp-media-notice-copy">
              <strong>
                {autoMediaNotice.status === "analyzing"
                  ? ui(interfaceLanguage, "Анализируем видео", "Analyzing video")
                  : autoMediaNotice.status === "ready"
                    ? ui(interfaceLanguage, "AI-анализ готов", "AI analysis ready")
                    : ui(
                        interfaceLanguage,
                        "Не удалось проанализировать",
                        "Analysis failed",
                      )}
              </strong>
              <small title={autoMediaNotice.message || autoMediaNotice.fileName}>
                {autoMediaNotice.message || autoMediaNotice.fileName}
              </small>
            </span>
            <button
              type="button"
              className="cp-media-notice-open"
              onClick={() => {
                setTab("optimize");
                setAutoMediaNotice(null);
                openPanel();
              }}
            >
              {ui(interfaceLanguage, "Открыть", "Open")}
            </button>
            <button
              type="button"
              className="cp-media-notice-close"
              onClick={() => setAutoMediaNotice(null)}
              aria-label={ui(interfaceLanguage, "Скрыть уведомление", "Dismiss notice")}
            >
              ×
            </button>
          </div>
        )}
        {hiddenNotice && !autoMediaNotice && (
          <div
            className={`cp-media-notice ready cp-hidden-notice ${showLauncher ? "with-launcher" : ""}`}
            data-theme={resolvedPanelTheme}
            role="status"
          >
            <span className="cp-media-notice-icon" aria-hidden="true">
              ✓
            </span>
            <span className="cp-media-notice-copy">
              <strong>
                {hiddenNotice === "widget"
                  ? ui(interfaceLanguage, "Верхний виджет скрыт", "Top widget hidden")
                  : ui(
                      interfaceLanguage,
                      "Кнопка ChannelPilot скрыта",
                      "ChannelPilot button hidden",
                    )}
              </strong>
              <small>
                {ui(
                  interfaceLanguage,
                  "Вернуть можно в меню ChannelPilot на панели Chrome",
                  "Bring it back from the ChannelPilot menu in the Chrome toolbar",
                )}
              </small>
            </span>
            <button type="button" className="cp-media-notice-open" onClick={undoHide}>
              {ui(interfaceLanguage, "Вернуть", "Undo")}
            </button>
            <button
              type="button"
              className="cp-media-notice-close"
              onClick={() => setHiddenNotice(null)}
              aria-label={ui(interfaceLanguage, "Скрыть уведомление", "Dismiss notice")}
            >
              ×
            </button>
          </div>
        )}
        {interfaceReady && showLauncher && (
          <div className="cp-launcher-shell">
            <button ref={launcherRef} className="cp-launcher" onClick={openPanel}>
              <span className="cp-logo">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M20.7 3.3 3.8 10.4c-1.05.44-1 1.96.08 2.28l6.2 1.86 1.86 6.2c.32 1.08 1.84 1.13 2.28.08L20.7 3.3Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span>ChannelPilot</span>
              <span className="cp-badge">AI</span>
            </button>
            <button
              className="cp-launcher-hide"
              onClick={() => hideInterfaceElement("launcher")}
              title={ui(
                interfaceLanguage,
                "Скрыть кнопку ChannelPilot AI",
                "Hide ChannelPilot AI button",
              )}
              aria-label={ui(
                interfaceLanguage,
                "Скрыть кнопку ChannelPilot AI",
                "Hide ChannelPilot AI button",
              )}
            >
              ×
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {realtimeWidget}
      <aside
        ref={panelRef}
        className="cp-panel"
        tabIndex={-1}
        role="dialog"
        aria-label="ChannelPilot AI"
        lang={interfaceLanguage}
        onKeyDown={isolateKeyboard}
        onKeyUp={isolateKeyboard}
        style={panelStyle}
        data-theme={resolvedPanelTheme}
        data-density={uiSettings.density}
        data-motion={uiSettings.animationMode}
      >
        <header
          className="cp-header"
          onPointerDown={(event) => beginPanelInteraction(event, "drag")}
          onPointerMove={movePanelInteraction}
          onPointerUp={endPanelInteraction}
          onPointerCancel={endPanelInteraction}
          // Without this, losing capture some other way (a native drag starting,
          // the element being re-parented) left panelInteractionRef set and the
          // panel followed the cursor with no button held.
          onLostPointerCapture={endPanelInteraction}
        >
          <span className="cp-logo">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M20.7 3.3 3.8 10.4c-1.05.44-1 1.96.08 2.28l6.2 1.86 1.86 6.2c.32 1.08 1.84 1.13 2.28.08L20.7 3.3Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <div className="cp-brand">
            <strong>ChannelPilot AI</strong>
            {/* Live status rather than a tagline. The old "YouTube growth
                workspace" was English in the Russian interface and told the
                user nothing they did not already know. */}
            <span>
              {reauthRequired
                ? ui(
                    interfaceLanguage,
                    "Нужно обновить вход Google",
                    "Google sign-in needs a refresh",
                  )
                : signedIn === false
                  ? ui(
                      interfaceLanguage,
                      "Google не подключён",
                      "Google is not connected",
                    )
                  : dashboard
                    ? `${dashboard.channel.title} · ${new Date(dashboard.sampledAt).toLocaleTimeString(interfaceLanguage, { hour: "2-digit", minute: "2-digit" })}`
                    : dashboardLoading || signedIn === null
                      ? ui(
                          interfaceLanguage,
                          "Загружаем аналитику…",
                          "Loading analytics…",
                        )
                      : ui(
                          interfaceLanguage,
                          "Аналитика недоступна",
                          "Analytics unavailable",
                        )}
            </span>
          </div>
          {/* A separate "—" minimize button sat here and did exactly what × does:
              the panel keeps its state either way and the launcher reopens it. */}
          <button
            className="cp-close"
            onClick={closePanel}
            aria-label={ui(interfaceLanguage, "Закрыть", "Close")}
            title={ui(interfaceLanguage, "Закрыть", "Close")}
          >
            ×
          </button>
        </header>
        <nav className="cp-tabs">
          <button
            className={tab === "optimize" ? "active" : ""}
            aria-pressed={tab === "optimize"}
            onClick={() => setTab("optimize")}
          >
            {ui(interfaceLanguage, "Оптимизация", "Optimize")}
          </button>
          <button
            className={tab === "analytics" ? "active" : ""}
            aria-pressed={tab === "analytics"}
            onClick={() => setTab("analytics")}
          >
            {ui(interfaceLanguage, "Аналитика", "Analytics")}
          </button>
        </nav>

        {(signedIn === false || reauthRequired) && tab === "analytics" ? (
          <div className="cp-scroll">
            <div className="cp-login">
              <span className="cp-logo">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M20.7 3.3 3.8 10.4c-1.05.44-1 1.96.08 2.28l6.2 1.86 1.86 6.2c.32 1.08 1.84 1.13 2.28.08L20.7 3.3Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <h2>
                {reauthRequired
                  ? ui(
                      interfaceLanguage,
                      "Обновите Google-сессию",
                      "Refresh your Google session",
                    )
                  : ui(interfaceLanguage, "Подключите YouTube", "Connect YouTube")}
              </h2>
              <p>
                {reauthRequired
                  ? ui(
                      interfaceLanguage,
                      "Подключение сохранено. Подтвердите тот же аккаунт, чтобы возобновить обновление аналитики.",
                      "Your connection is preserved. Confirm the same account to resume analytics updates.",
                    )
                  : ui(
                      interfaceLanguage,
                      "Авторизация нужна для чтения данных канала и защищённого доступа к AI.",
                      "Sign-in is required to read channel data and access AI securely.",
                    )}
              </p>
              <button
                className="cp-primary"
                onClick={() => void signIn()}
                disabled={signingIn}
                aria-busy={signingIn}
              >
                {signingIn
                  ? ui(interfaceLanguage, "Подключаем…", "Connecting…")
                  : reauthRequired
                    ? ui(interfaceLanguage, "Обновить Google", "Refresh Google")
                    : ui(
                        interfaceLanguage,
                        "Войти через Google",
                        "Sign in with Google",
                      )}
              </button>
              <button
                className="cp-secondary"
                style={{ marginTop: 8 }}
                onClick={() => openDashboard("settings")}
              >
                {ui(
                  interfaceLanguage,
                  "Настроить OAuth и API keys",
                  "Configure OAuth and API keys",
                )}
              </button>
            </div>
            {dashboardError && <div className="cp-error">{dashboardError}</div>}
          </div>
        ) : tab === "optimize" ? (
          <div className="cp-scroll">
            <span className="cp-kicker">
              {ui(interfaceLanguage, "AI-ЛАБОРАТОРИЯ", "AI VIDEO LAB")}
            </span>
            <div className="cp-heading-row">
              {/* The hard <br /> used to split this across two lines at every
                  width. At the current heading size it fits on one. */}
              <h2>
                {ui(
                  interfaceLanguage,
                  "Сделаем ролик заметнее",
                  "Make your video stand out",
                )}
              </h2>
              {result && (
                <span className="cp-score-mini">
                  SEO <b>{result.seo.total}</b>/100
                </span>
              )}
            </div>
            {isStudioPage && (
              <section className="cp-upload-assistant">
                <header>
                  <div>
                    <span>
                      {ui(interfaceLanguage, "ПОМОЩНИК ЗАГРУЗКИ", "UPLOAD ASSISTANT")}
                    </span>
                    <strong>
                      {ui(
                        interfaceLanguage,
                        "Готовность к публикации",
                        "Publishing readiness",
                      )}
                    </strong>
                  </div>
                  <button onClick={() => openDashboard("seo")}>
                    {ui(interfaceLanguage, "Полный чек-лист", "Full checklist")} ↗
                  </button>
                </header>
                <ol>
                  {uploadAssistantSteps.map((step) => (
                    <li className={step.status} key={step.label}>
                      <i>
                        {step.status === "done"
                          ? "✓"
                          : step.status === "active"
                            ? "…"
                            : step.status === "review"
                              ? "!"
                              : "·"}
                      </i>
                      <span>{step.label}</span>
                    </li>
                  ))}
                </ol>
                <small>
                  {ui(
                    interfaceLanguage,
                    "«!» означает ручную проверку. ChannelPilot не публикует видео и не меняет поля без подтверждения.",
                    "“!” requires manual review. ChannelPilot never publishes or changes fields without confirmation.",
                  )}
                </small>
              </section>
            )}

            {file && (
              <div className="cp-detected">
                <i />
                <div>
                  <strong>{file.name}</strong>
                  <span>
                    {(file.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                    {ui(
                      interfaceLanguage,
                      "файл готов к анализу",
                      "file ready for analysis",
                    )}
                  </span>
                </div>
                <button
                  className="cp-use"
                  onClick={() => {
                    setFile(null);
                    lastMediaEvidenceRef.current = "";
                  }}
                >
                  {ui(interfaceLanguage, "убрать", "remove")}
                </button>
              </div>
            )}

            <label className="cp-field">
              <span>
                {ui(interfaceLanguage, "Тема видео", "Video topic")}{" "}
                <em>{context.topic?.length ?? 0}/300</em>
              </span>
              <input
                value={context.topic ?? ""}
                maxLength={300}
                onChange={(event) =>
                  setContext({ ...context, topic: event.target.value })
                }
                placeholder={ui(
                  interfaceLanguage,
                  "О чём это видео?",
                  "What is this video about?",
                )}
              />
            </label>
            <label className="cp-field">
              <span>
                {ui(interfaceLanguage, "Текущий заголовок", "Current title")}{" "}
                <em>{context.title.length}/100</em>
              </span>
              <input
                value={context.title}
                maxLength={100}
                onChange={(event) =>
                  setContext({ ...context, title: event.target.value })
                }
                placeholder={ui(
                  interfaceLanguage,
                  "Заголовок из YouTube Studio",
                  "Title from YouTube Studio",
                )}
              />
            </label>
            <label className="cp-field">
              <span>
                {ui(
                  interfaceLanguage,
                  "Описание или контекст",
                  "Description or context",
                )}
              </span>
              <textarea
                value={context.description}
                onChange={(event) =>
                  setContext({ ...context, description: event.target.value })
                }
                placeholder={ui(
                  interfaceLanguage,
                  "Основные тезисы, ссылки, CTA…",
                  "Key points, links, CTA…",
                )}
              />
            </label>
            <div className="cp-grid">
              <label className="cp-field">
                <span>
                  {ui(interfaceLanguage, "Язык генерации", "Generation language")}
                </span>
                <select
                  value={generationLanguage}
                  onChange={(event) =>
                    void changeGenerationLanguage(
                      event.target.value as SupportedLanguage,
                    )
                  }
                >
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="cp-field">
                <span>{ui(interfaceLanguage, "Тон", "Tone")}</span>
                <select
                  value={context.tone ?? "professional"}
                  onChange={(event) =>
                    setContext({ ...context, tone: event.target.value })
                  }
                >
                  {TONE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label[interfaceLanguage]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cp-field">
                <span>{ui(interfaceLanguage, "Стратегия", "Strategy")}</span>
                <select
                  value={context.titleMode ?? "seo"}
                  onChange={(event) =>
                    setContext({
                      ...context,
                      titleMode: event.target.value as NonNullable<
                        VideoContext["titleMode"]
                      >,
                    })
                  }
                >
                  {TITLE_MODE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label[interfaceLanguage]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="cp-field">
              <span>
                {ui(
                  interfaceLanguage,
                  "Субтитры / транскрипт",
                  "Subtitles / transcript",
                )}{" "}
                <em>{ui(interfaceLanguage, "необязательно", "optional")}</em>
              </span>
              <textarea
                value={context.transcript ?? ""}
                onChange={(event) =>
                  setContext({ ...context, transcript: event.target.value })
                }
                placeholder={ui(
                  interfaceLanguage,
                  "Вставьте SRT/VTT или расшифровку…",
                  "Paste SRT/VTT or transcript…",
                )}
              />
            </label>
            {/* The disabled state was a greyed-out picker saying "disabled in
                settings" with no way to get to that setting from here. */}
            {!uiSettings.allowAiMediaUploads ? (
              <div className="cp-upload disabled">
                <span>
                  {ui(
                    interfaceLanguage,
                    "Анализ файлов выключен — AI работает по тексту",
                    "File analysis is off — the AI works from text",
                  )}
                </span>
                <button type="button" onClick={() => openDashboard("settings")}>
                  {ui(interfaceLanguage, "Включить", "Turn on")}
                </button>
              </div>
            ) : (
              <label className="cp-upload">
                <span>
                  {ui(
                    interfaceLanguage,
                    "Видео, аудио или файл субтитров",
                    "Video, audio or subtitle file",
                  )}
                </span>
                <b>{`${ui(interfaceLanguage, "Выбрать", "Choose")} →`}</b>
                <input
                  type="file"
                  accept="video/*,audio/*,image/*,.srt,.vtt,.txt"
                  disabled={loading}
                  onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    if (selected?.size) {
                      lastMediaEvidenceRef.current = "";
                      setFile(selected);
                      void runAnalysis(context, selected, true);
                    } else if (selected) {
                      setError(
                        ui(
                          interfaceLanguage,
                          "Выбранный файл пуст",
                          "The selected file is empty",
                        ),
                      );
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            )}
            <div className="cp-actions">
              <button
                className="cp-primary"
                onClick={() => void analyze()}
                disabled={loading}
                aria-busy={loading}
              >
                {loading
                  ? ui(interfaceLanguage, "AI анализирует…", "AI is analyzing…")
                  : file
                    ? ui(interfaceLanguage, "Анализировать медиа", "Analyze media")
                    : ui(interfaceLanguage, "Создать варианты", "Create variants")}
              </button>
              {loading ? (
                <button
                  className="cp-secondary"
                  onClick={() => {
                    requestIdRef.current += 1;
                    analysisBusyRef.current = false;
                    mediaAnalysisRef.current = 0;
                    queuedContextRef.current = null;
                    mediaAbortControllerRef.current?.abort();
                    mediaAbortControllerRef.current = null;
                    setLoading(false);
                    setAutoMediaNotice(null);
                    publishInline({ phase: "idle", progressMessage: "" });
                  }}
                >
                  {ui(interfaceLanguage, "Отмена", "Cancel")}
                </button>
              ) : (
                <button
                  className="cp-secondary"
                  onClick={() => setContext(readPageContext())}
                  aria-label={ui(
                    interfaceLanguage,
                    "Подставить заголовок и описание со страницы",
                    "Fill in the title and description from the page",
                  )}
                  title={ui(
                    interfaceLanguage,
                    "Подставить заголовок и описание со страницы",
                    "Fill in the title and description from the page",
                  )}
                >
                  <WidgetIcon name="refresh" />
                </button>
              )}
            </div>
            {error && <div className="cp-error">{error}</div>}
            {notice && !error && (
              <div className="cp-notice" role="status">
                {notice}
              </div>
            )}

            {result && (
              <div className="cp-result" ref={resultRef}>
                <div className="cp-result-head">
                  <strong>
                    {ui(interfaceLanguage, "Результат анализа", "Analysis result")}
                  </strong>
                  <span className="cp-provider">{result.provider}</span>
                </div>
                {result.providerNotice && (
                  <div className="cp-provider-notice">
                    <b>⇄</b>
                    <span>{result.providerNotice}</span>
                  </div>
                )}
                <div className="cp-score-card">
                  <div
                    className="cp-score-ring"
                    style={{
                      background: `conic-gradient(#6ee0a8 ${result.seo.total}%, ${resolvedPanelTheme === "light" ? "#e7e0f5" : "#282431"} 0)`,
                    }}
                  >
                    <span>{result.seo.total}</span>
                  </div>
                  <div>
                    {result.seo.factors.slice(0, 4).map((factor) => (
                      <div
                        className="cp-factor"
                        key={factor.id}
                        title={seoText(interfaceLanguage, factor.hint)}
                      >
                        <div>
                          <span>{seoText(interfaceLanguage, factor.label)}</span>
                          <b>
                            {factor.score}/{factor.max}
                          </b>
                        </div>
                        <span className="cp-bar">
                          <i
                            style={{ width: `${(factor.score / factor.max) * 100}%` }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="cp-card">
                  <div className="cp-card-title">
                    <strong>
                      {ui(interfaceLanguage, "Варианты заголовка", "Title variants")}
                    </strong>
                    <span>{result.titles.length}</span>
                  </div>
                  {result.titles.map((title, index) => (
                    <div className="cp-title-option" key={title}>
                      <span>{index + 1}</span>
                      <p>{title}</p>
                      <b
                        className={`cp-title-seo ${result.titleScores[index]?.label ?? "medium"}`}
                      >
                        {result.titleScores[index]?.total ?? 0}%
                      </b>
                      <button
                        className="cp-use"
                        onClick={() => applySuggestion("title", title)}
                      >
                        {isStudioPage
                          ? ui(interfaceLanguage, "вставить", "insert")
                          : ui(interfaceLanguage, "копировать", "copy")}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="cp-card cp-understanding">
                  <div className="cp-card-title">
                    <strong>
                      {ui(interfaceLanguage, "Понимание видео", "Video understanding")}
                    </strong>
                    <span>{result.contentInsights.detectedFormat}</span>
                  </div>
                  <p>{result.contentInsights.summary}</p>
                  {result.contentInsights.hookAnalysis && (
                    <div className="cp-panel-hook-score">
                      <strong>{result.contentInsights.hookAnalysis.score}/100</strong>
                      <span>
                        {result.contentInsights.hookAnalysis.risk ||
                          ui(
                            interfaceLanguage,
                            "Разбор первых 10 секунд готов",
                            "First 10 seconds analyzed",
                          )}
                      </span>
                    </div>
                  )}
                  {result.contentInsights.keyMoments.length > 0 && (
                    <ol className="cp-list">
                      {result.contentInsights.keyMoments.slice(0, 4).map((moment) => (
                        <li key={moment}>{moment}</li>
                      ))}
                    </ol>
                  )}
                </div>

                <div className="cp-card">
                  <div className="cp-card-title">
                    <strong>
                      {ui(interfaceLanguage, "Готовое описание", "Ready description")}
                    </strong>
                    <button
                      className="cp-use"
                      onClick={() => applySuggestion("description", result.description)}
                    >
                      {isStudioPage
                        ? ui(interfaceLanguage, "вставить", "insert")
                        : ui(interfaceLanguage, "копировать", "copy")}
                    </button>
                  </div>
                  <div className="cp-description">{result.description}</div>
                </div>

                <div className="cp-card">
                  <div className="cp-card-title">
                    <strong>
                      {ui(interfaceLanguage, "Ключи и теги", "Keywords and tags")}
                    </strong>
                    <span>{result.tags.length}</span>
                  </div>
                  <div className="cp-chips">
                    {result.tags.map((tag) => (
                      <span className="cp-chip" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="cp-card">
                  <div className="cp-card-title">
                    <strong>
                      {ui(interfaceLanguage, "Идеи обложек", "Thumbnail ideas")}
                    </strong>
                  </div>
                  <ol className="cp-list">
                    {result.thumbnailIdeas.map((idea) => (
                      <li key={idea}>{idea}</li>
                    ))}
                  </ol>
                </div>
                <div className="cp-card">
                  <div className="cp-card-title">
                    <strong>
                      {ui(interfaceLanguage, "Что улучшить", "What to improve")}
                    </strong>
                  </div>
                  <ol className="cp-list">
                    {result.recommendations.map((recommendation) => (
                      <li key={recommendation}>{recommendation}</li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </div>
        ) : (
          <AnalyticsView
            dashboard={dashboard}
            currentVideo={currentVideo}
            loading={dashboardLoading}
            error={dashboardError}
            onRefresh={stableWidgetHandlers.onRefresh}
            language={interfaceLanguage}
          />
        )}
        {pendingSuggestion && (
          <div className="cp-confirm-backdrop" role="presentation">
            <section
              ref={confirmModalRef}
              className="cp-confirm-modal"
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cp-confirm-title"
              aria-describedby="cp-confirm-description"
            >
              <span className="cp-kicker">YOUTUBE STUDIO</span>
              <h3 id="cp-confirm-title">
                {ui(
                  interfaceLanguage,
                  "Проверить перед заменой",
                  "Review before replacing",
                )}
              </h3>
              <label>
                {ui(interfaceLanguage, "Текущее значение", "Current value")}
                <textarea readOnly value={context[pendingSuggestion.kind]} />
              </label>
              <label>
                {ui(interfaceLanguage, "Новое значение", "New value")}
                <textarea readOnly value={pendingSuggestion.value} />
              </label>
              <p id="cp-confirm-description">
                {ui(
                  interfaceLanguage,
                  "Изменение применяется только после подтверждения. Если поле Studio не найдено, текст будет скопирован.",
                  "The change is applied only after confirmation. If the Studio field is unavailable, the text will be copied.",
                )}
              </p>
              <div>
                <button
                  data-confirm-autofocus
                  className="cp-secondary"
                  onClick={() => setPendingSuggestion(null)}
                >
                  {ui(interfaceLanguage, "Отмена", "Cancel")}
                </button>
                <button className="cp-primary" onClick={confirmSuggestion}>
                  {ui(interfaceLanguage, "Применить", "Apply")}
                </button>
              </div>
            </section>
          </div>
        )}
        <button
          className="cp-resize-handle"
          aria-label={ui(interfaceLanguage, "Изменить размер панели", "Resize panel")}
          onPointerDown={(event) => beginPanelInteraction(event, "resize")}
          onPointerMove={movePanelInteraction}
          onPointerUp={endPanelInteraction}
          onPointerCancel={endPanelInteraction}
          onLostPointerCapture={endPanelInteraction}
        />
      </aside>
    </>
  );
}

/**
 * Tells a previous content-script instance to shut itself down.
 *
 * Reloading the extension injects a new script into pages that already have an
 * old one running. Removing the old DOM node was not enough: its React root,
 * its intervals and its document-level listeners stayed alive and kept calling
 * `rpc()`, which throws once the old extension context is invalidated — an
 * endless stream of unhandled rejections behind the working widget.
 *
 * The old instance listens for this event and unmounts itself properly.
 */
const CONTENT_SHUTDOWN_EVENT = "channelpilot:shutdown";

const existingExtensionRoot = document.getElementById("channelpilot-extension-root");
if (
  existingExtensionRoot &&
  existingExtensionRoot.dataset.channelpilotVersion !== CONTENT_SCRIPT_VERSION
) {
  document.dispatchEvent(
    new CustomEvent(CONTENT_SHUTDOWN_EVENT, { detail: CONTENT_SCRIPT_VERSION }),
  );
  existingExtensionRoot.remove();
  document.getElementById(TOP_DOCK_HOST_ID)?.remove();
  document.getElementById(TOP_DOCK_SPACER_ID)?.remove();
}

// Fullscreen means the viewer is watching, not working on the channel: nothing
// of ours should sit on top of the picture. The host is left in place (so the
// browser's top layer already covers it) and additionally hidden, which also
// stops it from reacting to pointer events along the screen edges. React state
// survives because only the host's visibility changes.
function hideWidgetsDuringFullscreenVideo(host: HTMLElement): void {
  const sync = () => {
    const fullscreen = document.fullscreenElement;
    const watching = Boolean(fullscreen) && fullscreen !== host;
    host.style.display = watching ? "none" : "";
    if (watching) host.dataset.channelpilotFullscreen = "true";
    else delete host.dataset.channelpilotFullscreen;
    // YouTube tears the masthead down for fullscreen and rebuilds it on the way
    // back. Invalidate the spacer on both transitions; the App listens directly
    // for fullscreen events and retries while the masthead is being rebuilt.
    resetTopDockPlacement();
  };
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  sync();
}

if (!document.getElementById("channelpilot-extension-root")) {
  const host = document.createElement("div");
  host.id = "channelpilot-extension-root";
  host.dataset.channelpilotVersion = CONTENT_SCRIPT_VERSION;
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  applyPanelStyles(shadow);
  const mount = document.createElement("div");
  shadow.append(mount);
  const root = createRoot(mount);
  root.render(
    <ErrorBoundary compact>
      <App />
    </ErrorBoundary>,
  );
  hideWidgetsDuringFullscreenVideo(host);

  const shutdown = (event: Event) => {
    // Ignore our own dispatch, which happens before this listener is attached
    // in practice, but stays correct if the ordering ever changes.
    if ((event as CustomEvent<string>).detail === CONTENT_SCRIPT_VERSION) return;
    document.removeEventListener(CONTENT_SHUTDOWN_EVENT, shutdown);
    // Unmounting runs every effect cleanup in the tree, which is what actually
    // clears the intervals, observers and document listeners this instance
    // registered.
    root.unmount();
    host.remove();
    document.getElementById(TOP_DOCK_HOST_ID)?.remove();
    document.getElementById(TOP_DOCK_SPACER_ID)?.remove();
  };
  document.addEventListener(CONTENT_SHUTDOWN_EVENT, shutdown);
}
