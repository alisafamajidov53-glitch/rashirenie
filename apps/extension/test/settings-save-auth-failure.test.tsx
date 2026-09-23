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

it("reports a saved preference separately from a failed Google status check", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const originalSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  let failAuth = false;
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) =>
    failAuth && message.type === "AUTH_STATUS"
      ? { ok: false as const, error: "Auth status unavailable" }
      : originalSend(message);
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
  failAuth = true;
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(
        ".settings-page .section-heading .primary-button",
      )!
      .click();
  });
  expect(fixture.settings.generationLanguage).toBe("en");
  expect(document.querySelector(".settings-unsaved")).toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Settings saved, but the Google connection could not be checked",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).not.toContain(
    "Settings were not saved",
  );

  const clientId = document.querySelector<HTMLInputElement>(
    'input[placeholder="123456789-abc.apps.googleusercontent.com"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      clientId,
      "new-client.apps.googleusercontent.com",
    );
    clientId.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(
        ".settings-page .section-heading .primary-button",
      )!
      .click();
  });
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Overview"]')!.click();
  });
  expect(fixture.settings.googleClientId).toBe("new-client.apps.googleusercontent.com");
  expect(document.body.textContent).toContain("Connect YouTube Analytics");
  expect(document.querySelectorAll(".metric-card")).toHaveLength(0);
});
