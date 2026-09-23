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

it("keeps unsaved settings while refreshing analytics and merges external changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const sent: ExtensionRequest[] = [];
  const originalSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) => {
    sent.push(message);
    return originalSend(message);
  };
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Connections"]')!
      .click();
  });

  const generation = document.querySelectorAll<HTMLSelectElement>(
    ".language-settings select",
  )[1]!;
  await act(async () => {
    generation.value = "en";
    generation.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(document.querySelector(".settings-unsaved")?.textContent).toContain(
    "Unsaved changes",
  );
  expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(
    false,
  );
  fixture.settings.accentColor = "cyan";
  await act(async () => fixture.emitStoredSettings());
  expect(
    document.querySelectorAll<HTMLSelectElement>(".appearance-grid select")[1]?.value,
  ).toBe("cyan");
  expect(generation.value).toBe("en");
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Refresh data"]')!
      .click();
  });
  expect(generation.value).toBe("en");

  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(
        ".settings-page .section-heading .primary-button",
      )!
      .click();
  });
  expect(sent).toContainEqual({
    type: "SAVE_SETTINGS_TRUSTED_PATCH",
    payload: { generationLanguage: "en" },
  });
  expect(fixture.settings).toMatchObject({
    accentColor: "cyan",
    generationLanguage: "en",
  });
  expect(document.querySelector(".settings-unsaved")).toBeNull();
  expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(
    true,
  );
});
