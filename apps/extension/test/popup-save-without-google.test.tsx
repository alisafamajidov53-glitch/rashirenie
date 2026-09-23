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

it("saves AI settings without requiring a Google OAuth Client ID", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
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
  const geminiKey = document.querySelector<HTMLInputElement>(
    '.quick-settings input[type="password"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      geminiKey,
      "AIza-test-key",
    );
    geminiKey.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const advanced = document.querySelector<HTMLDetailsElement>(".popup-advanced")!;
  expect(advanced.open).toBe(false);
  await act(async () => advanced.querySelector("summary")!.click());
  expect(advanced.open).toBe(true);
  const provider = advanced.querySelector<HTMLSelectElement>("select")!;
  await act(async () => {
    provider.value = "groq";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const save = document.querySelector<HTMLButtonElement>(".signin .save-setup")!;
  expect(save.disabled).toBe(false);
  await act(async () => save.click());

  expect(sent).toContainEqual({
    type: "SAVE_SETTINGS_TRUSTED_PATCH",
    payload: {
      generationLanguage: "en",
      geminiApiKey: "AIza-test-key",
      preferredProvider: "groq",
    },
  });
  expect(sent.some((message) => message.type === "SIGN_IN")).toBe(false);
  expect(fixture.settings).toMatchObject({
    generationLanguage: "en",
    geminiApiKey: "AIza-test-key",
    preferredProvider: "groq",
    googleClientId: "",
  });
  expect(save.disabled).toBe(true);
  expect(document.querySelector(".setup-saved")?.textContent).toContain(
    "Settings saved",
  );
});
