// Development-only fixture entry for the on-page widget. Not referenced by the
// extension manifest. Renders the real content script against realistic
// analytics on a mock YouTube watch page, so the panel and the header dock can
// be looked at (and designed) without loading the extension into Chrome.
//
// `?theme=light|dark`, `?lang=en`, `?view=expand|edit|panel|analytics|none`
// and `?controls=0` put the preview straight into one state, which is what a
// headless screenshot needs.
import { createChromeFixture } from "./analytics-fixtures";
import { enrichPreviewFixture } from "./preview-data";

const fixture = createChromeFixture();
enrichPreviewFixture(fixture);
fixture.settings.interfaceLanguage = "ru";
const params = new URLSearchParams(window.location.search);
const themeParam = params.get("theme");
if (themeParam === "light" || themeParam === "dark")
  fixture.settings.theme = themeParam;
if (params.get("lang") === "en") fixture.settings.interfaceLanguage = "en";
const initialView = params.get("view") ?? "panel";
if (params.get("controls") === "0") document.querySelector(".controls")?.remove();
// `?state=signedout|offline|stale` renders the widget's sign-in and error
// states; "stale" loads data first and then fails a refresh.
const state = params.get("state");
if (state === "signedout")
  await fixture.chrome.runtime.sendMessage({ type: "SIGN_OUT" });
if (state === "offline") fixture.setOffline(true);
if (state === "stale")
  window.setTimeout(() => {
    fixture.setOffline(true);
    window.dispatchEvent(new Event("online"));
  }, 1_000);
Object.defineProperty(window, "chrome", { configurable: true, value: fixture.chrome });

await import("../src/content/index");

const extensionRoot = () => document.getElementById("channelpilot-extension-root");
const dockHost = () => document.getElementById("channelpilot-top-dock-host");

function query<T extends Element>(
  host: HTMLElement | null,
  selector: string,
): T | null {
  return (host?.shadowRoot?.querySelector(selector) as T | null) ?? null;
}

function togglePanel(): void {
  const launcher = query<HTMLButtonElement>(extensionRoot(), ".cp-launcher");
  if (launcher) {
    launcher.click();
    return;
  }
  query<HTMLButtonElement>(extensionRoot(), ".cp-close")?.click();
}

function setTheme(theme: "light" | "dark"): void {
  fixture.settings.theme = theme;
  fixture.emitSettings(fixture.settings.showHeaderWidget);
}

function expandDock(): void {
  query<HTMLButtonElement>(dockHost(), ".cp-dock-expand")?.click();
}

function editWidget(): void {
  expandDock();
  window.setTimeout(() => {
    query<HTMLButtonElement>(
      dockHost(),
      '.cp-realtime-head .cp-icon-button[aria-pressed="false"]',
    )?.click();
  }, 120);
}

document.querySelector(".controls")?.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).dataset.action;
  if (action === "panel") togglePanel();
  if (action === "light") setTheme("light");
  if (action === "dark") setTheme("dark");
  if (action === "expand") expandDock();
  if (action === "edit") editWidget();
});

// Open the requested view once the widget has mounted.
window.setTimeout(() => {
  if (initialView === "expand") expandDock();
  else if (initialView === "edit") editWidget();
  else if (initialView === "panel" || initialView === "analytics") {
    togglePanel();
    if (initialView === "analytics") {
      window.setTimeout(() => {
        query<HTMLButtonElement>(
          extensionRoot(),
          ".cp-tabs button:last-child",
        )?.click();
      }, 120);
    }
    // `?scroll=600` scrolls the panel body, to reach its lower sections.
    const scroll = Number(params.get("scroll") ?? 0);
    if (scroll > 0) {
      window.setTimeout(() => {
        const body = query<HTMLElement>(extensionRoot(), ".cp-scroll");
        if (body) body.scrollTop = scroll;
      }, 400);
    }
  }
}, 1_200);
