import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCK_METRICS,
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WIDGET_SECTIONS,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  addWidgetEntry,
  dockMetricLabel,
  dockWidthForMetrics,
  isExtensionRequest,
  moveWidgetEntry,
  normalizeDockMetrics,
  normalizeExtensionSettings,
  normalizeWidgetSections,
  removeWidgetEntry,
  sanitizeContentSettingsPatch,
  toggleDockMetric,
  WIDGET_SECTION_IDS,
  widgetSectionLabel,
} from "../src/index.js";

describe("widget composition normalization", () => {
  it("keeps known ids in the user's order and drops duplicates", () => {
    expect(normalizeWidgetSections(["leaders", "primary", "leaders", "kpis"])).toEqual([
      "leaders",
      "primary",
      "kpis",
    ]);
  });

  it("drops unknown ids and non-strings", () => {
    expect(normalizeWidgetSections(["primary", "revenue", 42, null])).toEqual([
      "primary",
    ]);
  });

  it("accepts an empty list as a deliberate choice", () => {
    // The widget renders an "add a block" placeholder for this state.
    expect(normalizeWidgetSections([])).toEqual([]);
    expect(normalizeDockMetrics([])).toEqual([]);
  });

  it("falls back to the defaults for garbage, never to an empty widget", () => {
    expect(normalizeWidgetSections(undefined)).toEqual([...DEFAULT_WIDGET_SECTIONS]);
    expect(normalizeWidgetSections("primary")).toEqual([...DEFAULT_WIDGET_SECTIONS]);
    // Non-empty input with nothing recognizable is a malformed payload, not a
    // user who removed every block.
    expect(normalizeWidgetSections(["nope"])).toEqual([...DEFAULT_WIDGET_SECTIONS]);
    expect(normalizeDockMetrics(["1y"])).toEqual([...DEFAULT_DOCK_METRICS]);
  });

  it("is part of the settings defaults and survives normalization", () => {
    const settings = normalizeExtensionSettings({
      ...DEFAULT_EXTENSION_SETTINGS,
      widgetSections: ["sources", "primary"],
      widgetDockMetrics: ["subs", "60m"],
    });
    expect(settings.widgetSections).toEqual(["sources", "primary"]);
    expect(settings.widgetDockMetrics).toEqual(["subs", "60m"]);
    expect(normalizeExtensionSettings({}).widgetSections).toEqual([
      ...DEFAULT_WIDGET_SECTIONS,
    ]);
  });
});

describe("widget composition editing", () => {
  const all = [...WIDGET_SECTION_IDS];

  it("moves an entry and clamps at both ends", () => {
    expect(moveWidgetEntry(all, "kpis", -1)).toEqual([
      "kpis",
      "primary",
      "subscribers",
      "leaders",
      "sources",
    ]);
    expect(moveWidgetEntry(all, "primary", -1)).toEqual(all);
    expect(moveWidgetEntry(all, "sources", 5)).toEqual(all);
    expect(moveWidgetEntry(all, "primary", 99).at(-1)).toBe("primary");
  });

  it("adds only known, absent ids and removes by id", () => {
    const without = removeWidgetEntry(all, "leaders");
    expect(without).not.toContain("leaders");
    expect(addWidgetEntry(without, WIDGET_SECTION_IDS, "leaders").at(-1)).toBe(
      "leaders",
    );
    expect(addWidgetEntry(all, WIDGET_SECTION_IDS, "leaders")).toEqual(all);
  });

  it("keeps strip metrics in window order whatever order they are ticked in", () => {
    expect(toggleDockMetric(["all"], "60m")).toEqual(["60m", "all"]);
    expect(toggleDockMetric(["60m", "all"], "48h")).toEqual(["60m", "48h", "all"]);
    expect(toggleDockMetric(["60m", "48h", "all"], "48h")).toEqual(["60m", "all"]);
  });

  it("names every block and metric in both languages", () => {
    for (const id of WIDGET_SECTION_IDS) {
      expect(widgetSectionLabel(id, "ru")).not.toBe(widgetSectionLabel(id, "en"));
    }
    expect(dockMetricLabel("48h", "ru")).toBe("48 часов");
  });
});

describe("dock width", () => {
  it("matches the widths the strip had before it was configurable", () => {
    // Three metrics is the default; these are the widths the fixed layout used.
    expect(dockWidthForMetrics(3, 1_920)).toBe(288);
    expect(dockWidthForMetrics(3, 1_500)).toBe(273);
    expect(dockWidthForMetrics(3, 1_280)).toBe(255);
    expect(dockWidthForMetrics(3, 1_000)).toBe(212);
  });

  it("grows with the metric count on a wide screen", () => {
    expect(dockWidthForMetrics(5, 1_920)).toBeGreaterThan(
      dockWidthForMetrics(3, 1_920),
    );
  });

  it("stops growing past two metrics below 1180px, where the rest are hidden", () => {
    expect(dockWidthForMetrics(5, 1_000)).toBe(dockWidthForMetrics(2, 1_000));
  });

  it("never drops below the width the host will still render", () => {
    for (const count of [0, 1, 2, 3, 4, 5]) {
      for (const width of [800, 1_000, 1_300, 1_600, 2_400]) {
        const value = dockWidthForMetrics(count, width);
        expect(value).toBeGreaterThanOrEqual(DOCK_MIN_WIDTH);
        expect(value).toBeLessThanOrEqual(DOCK_MAX_WIDTH);
      }
    }
  });
});

describe("widget composition over the message boundary", () => {
  it("lets a content script save the widget layout", () => {
    expect(
      isExtensionRequest({
        type: "SAVE_SETTINGS_PATCH",
        payload: { widgetSections: ["primary"], widgetDockMetrics: ["60m"] },
      }),
    ).toBe(true);
  });

  it("rejects lists of the wrong shape before they reach the normalizer", () => {
    for (const payload of [
      { widgetSections: "primary" },
      { widgetSections: [1, 2] },
      { widgetSections: Array.from({ length: 40 }, () => "primary") },
      { widgetDockMetrics: [{ id: "60m" }] },
    ]) {
      expect(isExtensionRequest({ type: "SAVE_SETTINGS_PATCH", payload })).toBe(false);
    }
  });

  it("normalizes a patch the content script sends", () => {
    expect(
      sanitizeContentSettingsPatch({
        widgetSections: ["kpis", "kpis", "unknown", "primary"],
      }),
    ).toEqual({ widgetSections: ["kpis", "primary"] });
  });
});
