import { act } from "react";
import { afterAll, expect, it, vi } from "vitest";
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
  vi.unstubAllGlobals();
});

it("updates only the selected visibility preference from the popup", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const send = vi.spyOn(fixture.chrome.runtime, "sendMessage");
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/popup/main");
  });

  const widget = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes("Top widget"),
  );
  expect(widget).toBeDefined();
  await act(async () => widget!.click());

  expect(send.mock.calls).toContainEqual([
    { type: "SAVE_SETTINGS_PATCH", payload: { showHeaderWidget: false } },
  ]);
  expect(send.mock.calls.some(([message]) => message.type === "SAVE_SETTINGS")).toBe(
    false,
  );
  expect(fixture.settings.showHeaderWidget).toBe(false);
  expect(fixture.settings.showLauncher).toBe(true);

  fixture.setOffline(true);
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('header button[aria-label="Refresh"]')!
      .click();
  });
  expect(document.querySelector(".live-pill")?.textContent).toContain("SNAPSHOT");
  expect(document.querySelector(".status-warning")?.textContent).toContain(
    "saved snapshot",
  );

  fixture.setOffline(false);
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('header button[aria-label="Refresh"]')!
      .click();
  });
  expect(document.querySelector(".live-pill")?.textContent).toContain("LIVE");
});
