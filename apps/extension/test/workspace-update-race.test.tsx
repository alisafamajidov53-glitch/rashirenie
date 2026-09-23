import { afterAll, expect, it, vi } from "vitest";
import { act } from "react";
import { type WorkspaceState } from "@channelpilot/shared";
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

function inputText(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
    input,
    value,
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("preserves both edits made while the first workspace write is pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  const sendMessage = fixture.chrome.runtime.sendMessage;
  const writes: WorkspaceState[] = [];
  let finishFirst!: () => void;
  fixture.chrome.runtime.sendMessage = async (message) => {
    if (message.type === "SAVE_WORKSPACE_STATE") {
      writes.push(message.payload);
      if (writes.length === 1) {
        await new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
      }
    }
    return sendMessage(message);
  };
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });
  const plannerButton = [
    ...document.querySelectorAll<HTMLButtonElement>("nav button"),
  ].find((button) => button.textContent?.includes("Planner"));
  await act(async () => plannerButton!.click());
  await act(async () =>
    inputText(
      document.querySelector<HTMLInputElement>(".planner-toolbar input")!,
      "New video",
    ),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>(".planner-toolbar button")!.click(),
  );
  expect(writes).toHaveLength(1);
  await act(async () =>
    inputText(
      document.querySelector<HTMLInputElement>(
        '.goal-composer input[aria-label="Goal name"]',
      )!,
      "Reach 1000",
    ),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>(".goal-composer button")!.click(),
  );
  expect(writes).toHaveLength(1);
  expect(document.querySelectorAll(".planner-column > article")).toHaveLength(1);
  expect(document.querySelectorAll(".goal-list article")).toHaveLength(1);
  await act(async () => finishFirst());
  expect(writes).toHaveLength(2);
  expect(writes[1]?.planner[0]?.title).toBe("New video");
  expect(writes[1]?.goals[0]?.label).toBe("Reach 1000");
});
