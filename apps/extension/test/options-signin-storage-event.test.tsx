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

it("completes sign-in when saving the local OAuth draft emits a storage event", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
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
    await import("../src/options/main");
  });
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Connections"]')!
      .click();
  });
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="123456789-abc.apps.googleusercontent.com"]',
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "client.apps.googleusercontent.com",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(".oauth-actions .primary-button")!
      .click();
  });
  expect(sent).toContainEqual({ type: "SIGN_IN" });
  expect(document.body.textContent).toContain("Google connected");
});
