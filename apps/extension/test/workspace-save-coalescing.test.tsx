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

it("folds edits made behind a pending write into a single follow-up write", async () => {
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
      "First video",
    ),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>(".planner-toolbar button")!.click(),
  );
  expect(writes).toHaveLength(1);

  // Three more edits while the first write is still pending: each is shown at
  // once, but they must not queue three separate full-workspace writes.
  const goalName = () =>
    document.querySelector<HTMLInputElement>(
      '.goal-composer input[aria-label="Goal name"]',
    )!;
  for (const label of ["Goal one", "Goal two", "Goal three"]) {
    await act(async () => inputText(goalName(), label));
    await act(async () =>
      document.querySelector<HTMLButtonElement>(".goal-composer button")!.click(),
    );
  }
  expect(document.querySelectorAll(".goal-list article")).toHaveLength(3);
  expect(writes).toHaveLength(1);

  await act(async () => finishFirst());
  expect(writes).toHaveLength(2);
  expect(writes[1]?.planner.map((item) => item.title)).toEqual(["First video"]);
  expect(writes[1]?.goals.map((goal) => goal.label)).toEqual([
    "Goal one",
    "Goal two",
    "Goal three",
  ]);
  expect(document.querySelectorAll(".goal-list article")).toHaveLength(3);
});
