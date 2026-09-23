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

it("keeps popup edits through refresh and saves only the changed field", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  fixture.settings.googleClientId = "client.apps.googleusercontent.com";
  await fixture.chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  const sent: ExtensionRequest[] = [];
  const originalSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) => {
    sent.push(message);
    return originalSend(message);
  };
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/popup/main");
  });

  const generation = document.querySelectorAll<HTMLSelectElement>(
    ".quick-settings select",
  )[1]!;
  await act(async () => {
    generation.value = "en";
    generation.dispatchEvent(new Event("change", { bubbles: true }));
  });
  fixture.settings.accentColor = "cyan";
  await act(async () => fixture.emitStoredSettings());
  expect(document.documentElement.dataset.accent).toBe("cyan");
  expect(generation.value).toBe("en");
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('header button[aria-label="Refresh"]')!
      .click();
  });
  expect(generation.value).toBe("en");

  await act(async () => {
    document.querySelector<HTMLButtonElement>(".signin > button.primary")!.click();
  });
  expect(sent).toContainEqual({
    type: "SAVE_SETTINGS_TRUSTED_PATCH",
    payload: { generationLanguage: "en" },
  });
  expect(fixture.settings).toMatchObject({
    accentColor: "cyan",
    generationLanguage: "en",
  });
});
