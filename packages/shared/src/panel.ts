import type { PanelLayoutSettings } from "./types.js";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ResolvedPanelLayout {
  width: number;
  height: number;
  x: number;
  y: number;
}

const PANEL_MARGIN = 12;
const MINIMUM_WIDTH = 340;
const MINIMUM_HEIGHT = 360;

/**
 * Distance from the top of the viewport the panel is placed at when it has no
 * stored position.
 *
 * YouTube's masthead is 56px tall and sticky. Opening at the plain 12px margin
 * put the panel straight over it — hiding the search field, the account menu
 * and the extension's own header widget behind the thing the user had just
 * opened. A stored position is still honoured exactly as saved: the user may
 * park the panel over the header if they want to.
 */
const DEFAULT_TOP_OFFSET = 68;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Converts persisted panel coordinates into a viewport-safe rectangle.
 * Coordinates are intentionally stored in CSS pixels: on every resize/zoom
 * they are clamped again, so an old monitor or zoom level cannot strand the
 * panel outside the visible area.
 */
export function panelLayoutEquals(
  a: ResolvedPanelLayout | null | undefined,
  b: ResolvedPanelLayout | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return a.width === b.width && a.height === b.height && a.x === b.x && a.y === b.y;
}

export function resolvePanelLayout(
  layout: PanelLayoutSettings,
  viewport: ViewportSize,
  /**
   * The rectangle currently held in React state. When the freshly resolved
   * rectangle is identical, this exact reference is returned instead of an
   * equal-but-new object, so `setState` bails out rather than re-rendering.
   *
   * This matters because a ResizeObserver on `documentElement` fires on every
   * YouTube infinite-scroll append: without the identity check each append
   * re-rendered the whole panel and the header widget portal.
   */
  previous?: ResolvedPanelLayout | null,
): ResolvedPanelLayout {
  const viewportWidth = Math.max(240, finite(viewport.width, 1_280));
  const viewportHeight = Math.max(240, finite(viewport.height, 800));
  const availableWidth = Math.max(240, viewportWidth - PANEL_MARGIN * 2);
  const availableHeight = Math.max(240, viewportHeight - PANEL_MARGIN * 2);
  const minimumWidth = Math.min(MINIMUM_WIDTH, availableWidth);
  const minimumHeight = Math.min(MINIMUM_HEIGHT, availableHeight);
  const width = clamp(
    Math.round(finite(layout.width, 440)),
    minimumWidth,
    availableWidth,
  );
  // Height a panel with no stored position gets: everything between the
  // header offset and the bottom margin. Without this the default height was
  // the full available height, and the y clamp below then had to pull the
  // panel back up over the masthead to make it fit.
  const defaultHeight = Math.max(
    minimumHeight,
    viewportHeight - DEFAULT_TOP_OFFSET - PANEL_MARGIN,
  );
  const positioned = layout.x !== null && layout.y !== null;
  const height = clamp(
    Math.round(finite(layout.height, defaultHeight)),
    minimumHeight,
    positioned ? availableHeight : defaultHeight,
  );
  const fallbackX = viewportWidth - width - PANEL_MARGIN;
  const fallbackY = DEFAULT_TOP_OFFSET;
  const x = clamp(
    Math.round(finite(layout.x ?? fallbackX, fallbackX)),
    PANEL_MARGIN,
    Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN),
  );
  const y = clamp(
    Math.round(finite(layout.y ?? fallbackY, fallbackY)),
    PANEL_MARGIN,
    Math.max(PANEL_MARGIN, viewportHeight - height - PANEL_MARGIN),
  );
  const resolved = { width, height, x, y };
  return panelLayoutEquals(previous, resolved) ? previous! : resolved;
}

export function persistablePanelLayout(
  layout: ResolvedPanelLayout,
): PanelLayoutSettings {
  return {
    width: Math.round(layout.width),
    height: Math.round(layout.height),
    x: Math.round(layout.x),
    y: Math.round(layout.y),
  };
}
