import { afterAll, expect, it, vi } from "vitest";
import { act } from "react";
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

it("rolls back an optimistic planner edit when persistent storage rejects it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const sendMessage = fixture.chrome.runtime.sendMessage;
  fixture.chrome.runtime.sendMessage = async (message) =>
    message.type === "SAVE_WORKSPACE_STATE"
      ? { ok: false, error: "Storage full" }
      : sendMessage(message);
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });
  const plannerButton = [
    ...document.querySelectorAll<HTMLButtonElement>("nav button"),
  ].find((button) => button.textContent?.includes("Planner"));
  expect(plannerButton).toBeDefined();
  await act(async () => plannerButton!.click());
  const input = document.querySelector<HTMLInputElement>(".planner-toolbar input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Unsaved video",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    document.querySelector<HTMLButtonElement>(".planner-toolbar button")!.click(),
  );
  expect(document.body.textContent).toContain("Storage full");
  expect(document.querySelector(".planner-board")).toBeNull();
  expect(document.querySelector(".planner-first-run")).not.toBeNull();
});
