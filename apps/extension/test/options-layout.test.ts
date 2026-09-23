import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import MAIN_SOURCE from "../src/options/main.tsx?raw";

// `?raw` works for the TSX but not for the stylesheet: vitest stubs CSS modules
// out entirely unless `test.css` is enabled, and enabling it for one assertion
// would make every component test parse 130 KB of CSS. The file is read
// directly instead. The working directory is the package root under both
// `npm run test:ui` and a bare `vitest`, with the repo root as a fallback.
function readSource(relative: string): string {
  for (const base of [process.cwd(), resolve(process.cwd(), "apps/extension")]) {
    const candidate = resolve(base, relative);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  throw new Error(`cannot locate ${relative} from ${process.cwd()}`);
}

const CSS_SOURCE = readSource("src/options/options.css");

/**
 * Layout invariants of the dashboard that only show up once the page is
 * rendered with real data, and that each stood behind a visible bug:
 *
 *  - the video table's track list and the cells the component renders got out
 *    of step, so a column quietly fell off the right edge of the card;
 *  - `.momentum-score` combined `white-space: nowrap` with visible overflow and
 *    painted across the action buttons next to it;
 *  - `.ai-ideas` was the only section card with no padding, so its button sat
 *    on the card border.
 */
function block(selector: string): string {
  const index = CSS_SOURCE.indexOf(selector);
  expect(index, `${selector} is missing from options.css`).toBeGreaterThan(-1);
  const open = CSS_SOURCE.indexOf("{", index);
  const close = CSS_SOURCE.indexOf("}", open);
  return CSS_SOURCE.slice(open + 1, close);
}

/** Counts top-level tracks in a `grid-template-columns` value. */
function trackCount(value: string): number {
  let depth = 0;
  let tracks = 0;
  let inTrack = false;
  for (const character of value) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth === 0 && /\s/.test(character)) {
      inTrack = false;
      continue;
    }
    if (!inTrack) {
      tracks += 1;
      inTrack = true;
    }
  }
  return tracks;
}

function gridOf(selector: string): string {
  const declaration = /grid-template-columns:([^;]+);/.exec(block(selector));
  expect(declaration, `${selector} declares no grid-template-columns`).not.toBeNull();
  return declaration![1]!.replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

describe("video table grid", () => {
  it("has one desktop track per cell the row renders", () => {
    // `.video-table-head` renders "Видео", six sort buttons and a spacer;
    // `.analytics-video-row` renders the title cell, five stats, the status
    // cell and the actions. Both are eight.
    expect(trackCount(gridOf(".video-table-head,\n.analytics-video-row"))).toBe(8);
    expect(MAIN_SOURCE).toContain('<div className="video-table-head">');
    expect(MAIN_SOURCE).toContain('<div className="status-cell">');
    expect(MAIN_SOURCE).toContain('<div className="row-actions">');
  });

  it("drops exactly the actions column where the row actions fold away", () => {
    const start = CSS_SOURCE.indexOf(
      "@media (min-width: 721px) and (max-width: 1459px)",
    );
    expect(start).toBeGreaterThan(-1);
    const scoped = CSS_SOURCE.slice(start, start + 900);
    const declaration = /grid-template-columns:([^;]+);/.exec(scoped);
    expect(declaration).not.toBeNull();
    expect(trackCount(declaration![1]!.trim())).toBe(7);
    expect(scoped).toContain(".analytics-video-row > .row-actions");
  });

  it("wraps the performance score and its data-coverage label inside the cell", () => {
    const rule = block(".momentum-score");
    expect(rule).toContain("display: grid");
    expect(rule).toContain("overflow-wrap: anywhere");
    expect(MAIN_SOURCE).toContain('{tr(language, "Полнота", "Coverage")}');
    expect(MAIN_SOURCE).toContain(
      'aria-label={`${tr(language, "Показать расчёт индекса"',
    );
    expect(rule).toContain("color: var(--muted, #a2a4b3)");
  });
});

describe("dashboard section cards", () => {
  it("gives the AI ideas card the same padding as its neighbours", () => {
    expect(block(".ai-ideas {")).toMatch(/padding:\s*24px/);
  });

  it("styles the row actions in the light theme too", () => {
    const light = CSS_SOURCE.slice(CSS_SOURCE.indexOf('html[data-theme="light"]'));
    expect(light).toContain(".row-actions button");
    for (const state of [
      "hot",
      "growing",
      "warming",
      "collecting",
      "cooling",
      "stable",
    ]) {
      expect(light).toContain(`.status-chip.${state}`);
    }
  });
});

describe("mobile controls", () => {
  it("shows every video format filter without horizontal scrolling", () => {
    const mobile = CSS_SOURCE.slice(
      CSS_SOURCE.indexOf(
        "@media (max-width: 720px) {",
        CSS_SOURCE.indexOf(".video-table-preview"),
      ),
    );
    expect(mobile).toContain(".cohort-controls .filter-tabs {");
    expect(mobile).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(mobile).toContain(".cohort-controls .filter-tabs button {");
  });

  it("keeps inactive AI format buttons legible in the light theme", () => {
    expect(CSS_SOURCE).toContain(
      'html[data-theme="light"] .content-format-switch button:not(.active)',
    );
  });
});
