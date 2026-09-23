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

it("refreshes popup analytics when another window changes the interface language", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const send = vi.spyOn(fixture.chrome.runtime, "sendMessage");
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/popup/main");
  });
  const dashboardCalls = () =>
    send.mock.calls.filter(([message]) => message.type === "GET_DASHBOARD").length;
  expect(dashboardCalls()).toBe(1);

  fixture.settings.interfaceLanguage = "ru";
  await act(async () => fixture.emitStoredSettings());
  expect(dashboardCalls()).toBe(2);
  expect(document.documentElement.lang).toBe("ru");
  expect(document.body.textContent).toContain("Просмотры канала");
  expect(document.body.textContent).toContain("Всё время");

  await fixture.chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  fixture.settings.googleClientId = "another-client.apps.googleusercontent.com";
  await act(async () => fixture.emitStoredSettings());
  expect(dashboardCalls()).toBe(2);
  expect(document.body.textContent).toContain("Решения по видео — прямо в Studio");
});
