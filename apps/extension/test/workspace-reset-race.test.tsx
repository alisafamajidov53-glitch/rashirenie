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

it("waits for an in-flight workspace write before clearing local data", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const sendMessage = fixture.chrome.runtime.sendMessage;
  let finishSave!: (value: { ok: boolean; data: unknown }) => void;
  let savedPayload: unknown;
  let resetCalls = 0;
  fixture.chrome.runtime.sendMessage = async (message) => {
    if (message.type === "SAVE_WORKSPACE_STATE") {
      savedPayload = message.payload;
      return new Promise((resolve) => {
        finishSave = resolve;
      });
    }
    if (message.type === "RESET_LOCAL_DATA") resetCalls += 1;
    return sendMessage(message);
  };
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });
  const nav = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("nav button")].find((button) =>
      button.textContent?.includes(name),
    )!;
  await act(async () => nav("Planner").click());
  const input = document.querySelector<HTMLInputElement>(".planner-toolbar input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Pending video",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    document.querySelector<HTMLButtonElement>(".planner-toolbar button")!.click(),
  );
  expect(document.querySelector(".planner-board")).not.toBeNull();
  await act(async () => nav("Connections").click());
  const openReset = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Reset local data",
  );
  expect(openReset).toBeDefined();
  await act(async () => openReset!.click());
  await act(async () =>
    document.querySelector<HTMLButtonElement>(".glass-modal .danger-button")!.click(),
  );
  expect(resetCalls).toBe(0);
  await act(async () =>
    finishSave({
      ok: true,
      data: savedPayload,
    }),
  );
  expect(resetCalls).toBe(1);
  expect(document.querySelector(".glass-modal")).toBeNull();
});
