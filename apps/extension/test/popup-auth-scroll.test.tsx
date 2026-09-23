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

it("locks popup actions while saving visibility and starts onboarding at the top", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const sendMessage = fixture.chrome.runtime.sendMessage;
  let finishVisibilitySave!: () => void;
  const visibilitySave = new Promise<void>((resolve) => {
    finishVisibilitySave = resolve;
  });
  vi.spyOn(fixture.chrome.runtime, "sendMessage").mockImplementation(
    async (message) => {
      if (message.type === "SAVE_SETTINGS_PATCH") await visibilitySave;
      return sendMessage(message);
    },
  );
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/popup/main");
  });

  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const topWidget = buttons.find((button) =>
    button.textContent?.includes("Top widget"),
  );
  expect(topWidget).toBeDefined();
  const signOut = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Sign out",
  );
  expect(signOut).toBeDefined();
  await act(async () => topWidget!.click());
  expect(signOut!.disabled).toBe(true);
  finishVisibilitySave();
  await act(async () => visibilitySave);
  expect(signOut!.disabled).toBe(false);

  const root = document.getElementById("root")!;
  root.scrollTop = 320;
  await act(async () => signOut!.click());

  expect(root.scrollTop).toBe(0);
  expect(document.body.textContent).toContain("Video decisions — directly in Studio");
});
