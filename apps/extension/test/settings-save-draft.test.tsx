import { act } from "react";
import { afterAll, expect, it, vi } from "vitest";
import type { ExtensionRequest, ExtensionSettings } from "@channelpilot/shared";
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

it("does not replace edits made while settings are being saved", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const originalSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  let finishSave!: (response: { ok: true; data: ExtensionSettings }) => void;
  let savedPayload: Partial<ExtensionSettings> | undefined;
  const pendingSave = new Promise<{ ok: true; data: ExtensionSettings }>((resolve) => {
    finishSave = resolve;
  });
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) => {
    if (message.type !== "SAVE_SETTINGS_TRUSTED_PATCH") return originalSend(message);
    savedPayload = message.payload;
    return pendingSave;
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

  const select = document.querySelector<HTMLSelectElement>(
    ".language-settings select",
  )!;
  const generation = document.querySelectorAll<HTMLSelectElement>(
    ".language-settings select",
  )[1]!;
  expect(select.value).toBe("en");
  fixture.settings.accentColor = "cyan";
  await act(async () => {
    generation.value = "en";
    generation.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(
        ".settings-page .section-heading .primary-button",
      )!
      .click();
  });
  expect(savedPayload).toEqual({ generationLanguage: "en" });

  await act(async () => {
    select.value = "ru";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(select.value).toBe("ru");

  await act(async () =>
    finishSave({ ok: true, data: { ...fixture.settings, ...savedPayload } }),
  );
  expect(select.value).toBe("ru");
  expect(generation.value).toBe("en");
  expect(fixture.settings.accentColor).toBe("cyan");
});
