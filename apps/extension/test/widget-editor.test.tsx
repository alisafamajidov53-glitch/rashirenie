import { afterAll, expect, it, vi } from "vitest";
import { act } from "react";
import type { ExtensionRequest } from "@channelpilot/shared";
import { createChromeFixture } from "./analytics-fixtures";

const mounted = vi.hoisted(() => ({ roots: [] as Array<{ unmount: () => void }> }));
vi.mock("react-dom/client", async (original) => {
  const module = await original<typeof import("react-dom/client")>();
  return {
    ...module,
    createRoot: (...args: Parameters<typeof module.createRoot>) => {
      const root = module.createRoot(...args);
      mounted.roots.push(root);
      return root;
    },
  };
});
afterAll(async () => {
  await act(async () => mounted.roots.forEach((root) => root.unmount()));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * The widget editor end to end: the real content script, mounted into a mock
 * masthead, edited through its own buttons. What is asserted is what the user
 * would see and what reaches the service worker — not component internals.
 */
it("adds, removes, reorders and persists widget blocks from the page", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const fixture = createChromeFixture();
  const sent: ExtensionRequest[] = [];
  const sendMessage = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) => {
    sent.push(message);
    return sendMessage(message);
  };
  vi.stubGlobal("chrome", fixture.chrome);
  vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=abcdefghijk"));
  document.body.innerHTML =
    '<ytd-masthead><div id="end"><div id="buttons"><button>Create</button></div></div></ytd-masthead>';
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const visible = this.isConnected;
    return {
      x: 100,
      y: 8,
      left: 100,
      top: 8,
      right: 356,
      bottom: 48,
      width: visible ? 256 : 0,
      height: visible ? 40 : 0,
      toJSON: () => ({}),
    };
  });
  await act(async () => {
    await import("../src/content/index");
  });
  const tick = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
  };
  await tick();

  const root = () => document.getElementById("channelpilot-top-dock-host")!.shadowRoot!;
  const click = async (selector: string) => {
    const element = root().querySelector<HTMLElement>(selector);
    expect(element, selector).not.toBeNull();
    await act(async () => element!.click());
    await tick();
  };
  const blocks = () =>
    [...root().querySelectorAll<HTMLElement>("[data-block]")].map(
      (element) => element.dataset.block,
    );
  const dockLabels = () =>
    [...root().querySelectorAll(".cp-dock-metrics > button small")].map(
      (element) => element.textContent,
    );
  const lastPatch = () =>
    sent.filter((message) => message.type === "SAVE_SETTINGS_PATCH").at(-1);

  // Default strip: the three metrics it had before it was configurable.
  expect(dockLabels()).toHaveLength(3);

  await click(".cp-dock-expand");
  expect(blocks()).toEqual(["primary", "kpis", "subscribers", "leaders", "sources"]);

  await click('.cp-realtime-head .cp-icon-button[aria-pressed="false"]');
  expect(root().querySelector(".cp-widget-editor")).not.toBeNull();

  // Remove: the block leaves the card, the patch reaches the service worker,
  // and a chip to bring it back appears.
  await click('[data-block="kpis"] [data-tool="remove"]');
  expect(blocks()).not.toContain("kpis");
  expect(lastPatch()).toMatchObject({
    type: "SAVE_SETTINGS_PATCH",
    payload: { widgetSections: ["primary", "subscribers", "leaders", "sources"] },
  });
  expect(root().querySelector('[data-add="kpis"]')).not.toBeNull();

  // Reorder.
  await click('[data-block="sources"] [data-tool="up"]');
  expect(blocks()).toEqual(["primary", "subscribers", "sources", "leaders"]);

  // Add back: it returns at the end.
  await click('[data-add="kpis"]');
  expect(blocks().at(-1)).toBe("kpis");

  // Strip metric: switching one on adds it to the collapsed strip.
  const chip = [
    ...root().querySelectorAll<HTMLButtonElement>(".cp-editor-chips button"),
  ].find((button) => button.getAttribute("aria-pressed") === "false");
  expect(chip).toBeDefined();
  await act(async () => chip!.click());
  await tick();
  expect(lastPatch()?.type).toBe("SAVE_SETTINGS_PATCH");
  expect(fixture.settings.widgetDockMetrics).toHaveLength(4);

  // The stored settings are what the service worker would persist.
  expect(fixture.settings.widgetSections).toEqual([
    "primary",
    "subscribers",
    "sources",
    "leaders",
    "kpis",
  ]);

  // Reset restores both lists.
  await click(".cp-editor-actions button:not(.cp-editor-done)");
  expect(blocks()).toEqual(["primary", "kpis", "subscribers", "leaders", "sources"]);
  expect(fixture.settings.widgetDockMetrics).toEqual(["60m", "24h", "all"]);

  // Collapse and confirm the strip follows the settings.
  await click(".cp-editor-done");
  expect(root().querySelector(".cp-widget-editor")).toBeNull();
  await click(".cp-realtime-head .cp-icon-button:last-child");
  expect(dockLabels()).toHaveLength(3);
});
