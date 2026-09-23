// Development-only fixture entry. Not referenced by the extension manifest.
//
// Run it with:
//   cd apps/extension && npx vite --config test/preview.config.ts
//   http://127.0.0.1:5174/test/preview.html          (Russian, the default)
//   http://127.0.0.1:5174/test/preview.html?lang=en  (English)
//
// The dashboard is the densest surface in the extension and most of its layout
// bugs only appear with real-shaped data: long Russian video titles, populated
// audience breakdowns, five-digit counters. See preview-data.ts.
import type { SupportedLanguage, ThemeMode } from "@channelpilot/shared";
import { createChromeFixture } from "./analytics-fixtures";
import { enrichPreviewFixture } from "./preview-data";

const fixture = createChromeFixture();
enrichPreviewFixture(fixture);
const params = new URLSearchParams(window.location.search);
const language: SupportedLanguage = params.get("lang") === "en" ? "en" : "ru";
fixture.settings.interfaceLanguage = language;
fixture.settings.generationLanguage = language;
// `?theme=light` — the dashboard re-applies `data-theme` from settings on every
// render, so flipping the attribute by hand in devtools does not survive a
// navigation. This goes through the same path the real setting does.
const themeParam = params.get("theme");
if (themeParam === "light" || themeParam === "dark" || themeParam === "auto") {
  fixture.settings.theme = themeParam satisfies ThemeMode;
}

Object.defineProperty(window, "chrome", { configurable: true, value: fixture.chrome });
await import("../src/options/main");

// `?page=planner` opens a section directly, so a headless screenshot can reach
// every page without scripted clicks.
const initialPage = params.get("page");
if (initialPage) {
  const openPage = () => {
    const button = document.querySelector<HTMLElement>(
      `button[data-page="${CSS.escape(initialPage)}"]`,
    );
    if (button) button.click();
    else window.setTimeout(openPage, 50);
  };
  openPage();
}
