// Development-only fixture entry for the browser action popup. Not referenced
// by the extension manifest.
//
//   cd apps/extension && npx vite --config test/preview.config.ts
//   http://127.0.0.1:5174/test/popup-preview.html
//   http://127.0.0.1:5174/test/popup-preview.html?lang=en&theme=light
//   http://127.0.0.1:5174/test/popup-preview.html?state=signedout  (setup form)
import type { SupportedLanguage, ThemeMode } from "@channelpilot/shared";
import { createChromeFixture } from "./analytics-fixtures";

const fixture = createChromeFixture();
const params = new URLSearchParams(window.location.search);
const language: SupportedLanguage = params.get("lang") === "en" ? "en" : "ru";
fixture.settings.interfaceLanguage = language;
fixture.settings.generationLanguage = language;
const themeParam = params.get("theme");
if (themeParam === "light" || themeParam === "dark" || themeParam === "auto") {
  fixture.settings.theme = themeParam satisfies ThemeMode;
}

if (params.get("state") === "signedout")
  await fixture.chrome.runtime.sendMessage({ type: "SIGN_OUT" });

Object.defineProperty(window, "chrome", { configurable: true, value: fixture.chrome });
await import("../src/popup/main");
