import { describe, expect, it } from "vitest";
import CONTENT_SOURCE from "../src/content/index.tsx?raw";

/**
 * Content scripts only get a slice of the `chrome.*` surface.
 *
 * `chrome.runtime` in an isolated world exposes `connect`, `getManifest`,
 * `getURL`, `id`, `onConnect`, `onMessage` and `sendMessage` — nothing else.
 * The rest of the namespace is simply absent, so a call to it throws
 * "… is not a function" from inside whatever handler made it.
 *
 * That is how every "Открыть кабинет" button in the widget came to be dead:
 * the click handler called `chrome.runtime.openOptionsPage()`, the call threw,
 * React swallowed it, and the button looked alive while doing nothing. tsc
 * cannot catch this — `@types/chrome` declares the whole API regardless of the
 * context it will run in — so the boundary is asserted against the source.
 */
/** `chrome.runtime` members a content script may use. */
const ALLOWED_RUNTIME_MEMBERS = new Set([
  "connect",
  "getManifest",
  "getURL",
  "id",
  "onConnect",
  "onMessage",
  "sendMessage",
]);

/** Top-level `chrome.*` namespaces reachable from a content script. */
const ALLOWED_NAMESPACES = new Set(["dom", "i18n", "runtime", "storage"]);

function usages(pattern: RegExp): string[] {
  // Comments describe the very APIs this test forbids, so they are stripped
  // before matching rather than special-cased per occurrence.
  const code = CONTENT_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /(^|[^:])\/\/[^\n]*/g,
    "$1",
  );
  return [...code.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("content script chrome API boundary", () => {
  it("only touches namespaces a content script actually has", () => {
    const used = new Set(usages(/\bchrome\.([a-zA-Z]+)/g));
    const forbidden = [...used].filter((name) => !ALLOWED_NAMESPACES.has(name));
    expect(forbidden).toEqual([]);
  });

  it("only touches chrome.runtime members a content script actually has", () => {
    const used = new Set(usages(/\bchrome\.runtime\.([a-zA-Z]+)/g));
    const forbidden = [...used].filter((name) => !ALLOWED_RUNTIME_MEMBERS.has(name));
    expect(forbidden).toEqual([]);
  });

  it("opens the dashboard through the service worker", () => {
    // The replacement for the five dead `openOptionsPage()` call sites.
    expect(CONTENT_SOURCE).toContain('rpc({ type: "OPEN_OPTIONS_PAGE" })');
    expect(CONTENT_SOURCE).toContain("function openDashboard()");
  });
});
