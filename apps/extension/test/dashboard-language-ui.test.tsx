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

it("reloads translated analytics after switching the interface language", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const send = vi.spyOn(fixture.chrome.runtime, "sendMessage");
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';

  await act(async () => {
    await import("../src/options/main");
  });
  const dashboardCalls = () =>
    send.mock.calls.filter(([message]) => message.type === "GET_DASHBOARD").length;
  expect(dashboardCalls()).toBe(1);

  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="Русский язык"]')!.click();
  });
  expect(fixture.settings.interfaceLanguage).toBe("ru");
  expect(send.mock.calls).toContainEqual([
    { type: "SAVE_SETTINGS_PATCH", payload: { interfaceLanguage: "ru" } },
  ]);
  expect(send.mock.calls.some(([message]) => message.type === "SAVE_SETTINGS")).toBe(
    false,
  );
  expect(dashboardCalls()).toBe(2);
  expect(document.body.textContent).toContain("АНАЛИТИКА КАНАЛА");
  expect(document.body.textContent).toContain("АНАЛИТИКА YOUTUBE");
  expect(document.querySelectorAll(".metric-card").length).toBeGreaterThan(0);

  fixture.settings.interfaceLanguage = "en";
  await act(async () => fixture.emitStoredSettings());
  expect(dashboardCalls()).toBe(3);
  expect(document.body.textContent).toContain("CHANNEL INTELLIGENCE");
  expect(document.body.textContent).toContain("YOUTUBE ANALYTICS");

  await fixture.chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  fixture.settings.googleClientId = "another-client.apps.googleusercontent.com";
  await act(async () => fixture.emitStoredSettings());
  expect(dashboardCalls()).toBe(3);
  expect(document.body.textContent).toContain("Connect YouTube Analytics");
  expect(document.querySelectorAll(".metric-card")).toHaveLength(0);
});
