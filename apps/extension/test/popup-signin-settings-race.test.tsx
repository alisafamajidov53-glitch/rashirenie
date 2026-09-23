import { act } from "react";
import { afterAll, expect, it, vi } from "vitest";
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
  vi.unstubAllGlobals();
});

it("does not overwrite another window's preferences when signing in from a stale popup", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  fixture.settings.googleClientId = "client.apps.googleusercontent.com";
  await fixture.chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  const sent: ExtensionRequest[] = [];
  const originalSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) => {
    sent.push(message);
    const response = await originalSend(message);
    if (message.type === "SAVE_SETTINGS_TRUSTED_PATCH") fixture.emitStoredSettings();
    return response;
  };
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/popup/main");
  });

  fixture.settings.theme = "light";
  const language = document.querySelector<HTMLSelectElement>(".quick-settings select")!;
  await act(async () => {
    language.value = "ru";
    language.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    document.querySelector<HTMLButtonElement>(".signin > button.primary")!.click();
  });

  expect(sent).toContainEqual({
    type: "SAVE_SETTINGS_TRUSTED_PATCH",
    payload: { interfaceLanguage: "ru" },
  });
  expect(sent.some((message) => message.type === "SAVE_SETTINGS")).toBe(false);
  expect(sent).toContainEqual({ type: "SIGN_IN" });
  expect(fixture.settings).toMatchObject({ theme: "light", interfaceLanguage: "ru" });
});
