import { afterAll, expect, it, vi } from "vitest";
import { act } from "react";
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

it("says why the dashboard did not open instead of leaving a dead button", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const fixture = createChromeFixture();
  const sendMessage = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  // What Chrome does for an orphaned content script after an extension update.
  fixture.chrome.runtime.sendMessage = (async (message: { type: string }) => {
    if (message.type === "OPEN_OPTIONS_PAGE") {
      throw new Error("Extension context invalidated.");
    }
    return sendMessage(message as never);
  }) as typeof fixture.chrome.runtime.sendMessage;
  vi.stubGlobal("chrome", fixture.chrome);
  vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=abcdefghijk"));
  document.body.innerHTML = "";
  await act(async () => {
    await import("../src/content/index");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500);
  });
  const shadow = () =>
    document.getElementById("channelpilot-extension-root")!.shadowRoot!;
  await act(async () => {
    shadow()
      .querySelector<HTMLButtonElement>('button[aria-label="Open detailed analytics"]')!
      .click();
  });
  const dashboardButton = [
    ...shadow().querySelectorAll<HTMLButtonElement>(".cp-widget-footer-actions button"),
  ].find((button) => button.textContent === "Dashboard");
  expect(dashboardButton).toBeDefined();
  await act(async () => {
    dashboardButton!.click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(shadow().querySelector(".cp-widget-alert")?.textContent).toContain(
    "Reload the page",
  );
});
