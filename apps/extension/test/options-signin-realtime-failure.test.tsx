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

it("keeps a successful Google sign-in when realtime status is unavailable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  fixture.settings.googleClientId = "client.apps.googleusercontent.com";
  await fixture.chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  const originalSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) => {
    if (message.type === "GET_REALTIME_STATUS") {
      return { ok: false, error: "Realtime status unavailable" };
    }
    return originalSend(message);
  };
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });

  const signIn = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent?.includes("Sign in with Google"));
  expect(signIn).toBeTruthy();
  await act(async () => signIn!.click());

  expect(document.body.textContent).toContain("Demo · ChannelPilot");
  expect(document.body.textContent).not.toContain("Realtime status unavailable");
  expect(document.body.textContent).toContain("YouTube channel connected");
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Refresh data"]')!
      .click();
  });
  expect(document.body.textContent).toContain("Demo · ChannelPilot");
  expect(document.body.textContent).not.toContain("Realtime status unavailable");
});
