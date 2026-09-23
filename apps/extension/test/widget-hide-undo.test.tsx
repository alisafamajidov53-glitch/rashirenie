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
 * Hiding the header widget used to be instant and silent. It now says where
 * the widget can be restored and offers an immediate undo.
 */
it("offers to undo hiding the header widget", async () => {
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
  const tick = async (ms = 900) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  await tick();

  const dock = () => document.getElementById("channelpilot-top-dock-host")?.shadowRoot;
  const page = () =>
    document.getElementById("channelpilot-extension-root")!.shadowRoot!;
  const hide = dock()?.querySelector<HTMLButtonElement>(".cp-dock-hide");
  expect(hide).toBeTruthy();
  await act(async () => hide!.click());
  await tick();

  expect(sent).toContainEqual({
    type: "SAVE_SETTINGS_PATCH",
    payload: { showHeaderWidget: false, showLauncher: true },
  });
  const notice = page().querySelector(".cp-hidden-notice");
  expect(notice?.textContent).toContain("Top widget hidden");
  expect(notice?.textContent).toContain("Chrome toolbar");
  expect(dock()?.querySelector(".cp-top-dock") ?? null).toBeNull();

  const undo = notice!.querySelector<HTMLButtonElement>(".cp-media-notice-open");
  await act(async () => undo!.click());
  await tick();

  expect(sent.at(-1)).toEqual({
    type: "SAVE_SETTINGS_PATCH",
    payload: { showHeaderWidget: true, showLauncher: true },
  });
  expect(page().querySelector(".cp-hidden-notice")).toBeNull();
  expect(dock()?.querySelector(".cp-top-dock")).toBeTruthy();
});
