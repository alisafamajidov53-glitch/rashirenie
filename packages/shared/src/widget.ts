/**
 * Composition of the on-page widget.
 *
 * The widget is a column of blocks on top of someone else's page, and which of
 * them are worth the vertical space depends entirely on what the user is doing:
 * a creator watching a launch wants the live counter and the leaderboard, a
 * creator reviewing a month wants retention and subscriber sources. Rather than
 * guess, both the collapsed strip and the expanded card are described by an
 * ordered list of ids that the user edits in place.
 *
 * The lists are ordinary settings, so they sync through the same
 * `SAVE_SETTINGS_PATCH` path as the rest of the interface preferences and stay
 * consistent between the widget and the dashboard.
 */

/** A block in the expanded widget, in its default order. */
export type WidgetSectionId =
  "primary" | "kpis" | "subscribers" | "leaders" | "sources";

export const WIDGET_SECTION_IDS: readonly WidgetSectionId[] = [
  "primary",
  "kpis",
  "subscribers",
  "leaders",
  "sources",
];

export const DEFAULT_WIDGET_SECTIONS: readonly WidgetSectionId[] = WIDGET_SECTION_IDS;

/** A metric in the collapsed strip. */
export type DockMetricId = "60m" | "24h" | "48h" | "all" | "subs";

export const DOCK_METRIC_IDS: readonly DockMetricId[] = [
  "60m",
  "24h",
  "48h",
  "all",
  "subs",
];

/**
 * Three metrics is what the strip has room for next to YouTube's search field
 * at a typical window width — the same three it showed before it was editable.
 */
export const DEFAULT_DOCK_METRICS: readonly DockMetricId[] = ["60m", "24h", "all"];

/**
 * Widest the strip is ever allowed to get, and the narrowest that
 * `positionTopDockHost` will still render. Kept here so the content script's
 * width arithmetic and this module cannot drift apart.
 */
export const DOCK_MIN_WIDTH = 190;
export const DOCK_MAX_WIDTH = 460;

function normalizeIdList<T extends string>(
  value: unknown,
  known: readonly T[],
  fallback: readonly T[],
): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<T>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry as T;
    if (!known.includes(id) || seen.has(id)) continue;
    seen.add(id);
  }
  // An empty list is a legitimate choice — the widget then renders its "add a
  // block" placeholder — but it can only be reached by removing every entry,
  // never by a malformed payload.
  return value.length > 0 && seen.size === 0 ? [...fallback] : [...seen];
}

export function normalizeWidgetSections(value: unknown): WidgetSectionId[] {
  return normalizeIdList(value, WIDGET_SECTION_IDS, DEFAULT_WIDGET_SECTIONS);
}

export function normalizeDockMetrics(value: unknown): DockMetricId[] {
  return normalizeIdList(value, DOCK_METRIC_IDS, DEFAULT_DOCK_METRICS);
}

/** Adds an id at the end if it is known and not already present. */
export function addWidgetEntry<T extends string>(
  list: readonly T[],
  known: readonly T[],
  id: T,
): T[] {
  if (!known.includes(id) || list.includes(id)) return [...list];
  return [...list, id];
}

export function removeWidgetEntry<T extends string>(list: readonly T[], id: T): T[] {
  return list.filter((entry) => entry !== id);
}

/**
 * Moves an entry by `delta` positions, clamped to the ends of the list.
 * Reordering is exposed as two buttons rather than drag-and-drop: the widget
 * lives in a shadow root inside a page that runs its own pointer handlers, and
 * buttons are operable from the keyboard without any extra work.
 */
export function moveWidgetEntry<T extends string>(
  list: readonly T[],
  id: T,
  delta: number,
): T[] {
  const index = list.indexOf(id);
  if (index < 0) return [...list];
  const target = Math.min(list.length - 1, Math.max(0, index + delta));
  if (target === index) return [...list];
  const next = [...list];
  const [entry] = next.splice(index, 1);
  next.splice(target, 0, entry!);
  return next;
}

type Localized = readonly [ru: string, en: string];

const SECTION_COPY: Record<WidgetSectionId, { label: Localized; hint: Localized }> = {
  primary: {
    label: ["Главный счётчик", "Primary counter"],
    hint: [
      "Просмотры выбранного периода крупно и график",
      "Views for the selected period, large, with a chart",
    ],
  },
  kpis: {
    label: ["Ключевые метрики", "Key metrics"],
    hint: [
      "60 минут, 24 часа, удержание и всё время",
      "60 minutes, 24 hours, retention and all time",
    ],
  },
  subscribers: {
    label: ["Подписчики · 28д", "Subscribers · 28d"],
    hint: ["Подписались, отписались и чистый прирост", "Gained, lost and net growth"],
  },
  leaders: {
    label: ["Набирают сейчас", "Growing now"],
    hint: [
      "Три ролика с самым быстрым приростом",
      "The three videos gaining views fastest",
    ],
  },
  sources: {
    label: ["Приводят подписчиков", "Driving subscribers"],
    hint: [
      "Ролики, после которых подписываются чаще всего",
      "Videos that convert viewers into subscribers",
    ],
  },
};

const DOCK_METRIC_COPY: Record<DockMetricId, Localized> = {
  "60m": ["60 минут", "60 minutes"],
  "24h": ["24 часа", "24 hours"],
  "48h": ["48 часов", "48 hours"],
  all: ["Всё время", "All time"],
  subs: ["Подписчики · 28д", "Subscribers · 28d"],
};

/**
 * Names are shared so the widget editor on the page and the one in the
 * dashboard settings call each block the same thing.
 */
export function widgetSectionLabel(id: WidgetSectionId, language: "ru" | "en"): string {
  return SECTION_COPY[id].label[language === "ru" ? 0 : 1];
}

export function widgetSectionHint(id: WidgetSectionId, language: "ru" | "en"): string {
  return SECTION_COPY[id].hint[language === "ru" ? 0 : 1];
}

export function dockMetricLabel(id: DockMetricId, language: "ru" | "en"): string {
  return DOCK_METRIC_COPY[id][language === "ru" ? 0 : 1];
}

/**
 * Toggles a strip metric while keeping the natural shortest-to-longest window
 * order: the strip has no reorder controls, so ticking "60 минут" last must
 * not put it at the end.
 */
export function toggleDockMetric(
  list: readonly DockMetricId[],
  id: DockMetricId,
): DockMetricId[] {
  return DOCK_METRIC_IDS.filter((metric) =>
    metric === id ? !list.includes(id) : list.includes(metric),
  );
}

/**
 * Width the masthead spacer reserves for the collapsed strip.
 *
 * The strip holds a live dot, `metricCount` metrics, an expand button and a
 * dismiss button. Everything except the metrics is fixed, so the width is a
 * base plus a per-metric column that narrows with the viewport — below 1180px
 * the strip only has room for two metrics and the stylesheet hides the rest.
 */
export function dockWidthForMetrics(
  metricCount: number,
  viewportWidth: number,
): number {
  const perMetric =
    viewportWidth >= 1_700
      ? 68
      : viewportWidth >= 1_450
        ? 63
        : viewportWidth >= 1_180
          ? 57
          : 64;
  const visible = Math.max(1, Math.min(metricCount, viewportWidth >= 1_180 ? 5 : 2));
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, 84 + visible * perMetric));
}
