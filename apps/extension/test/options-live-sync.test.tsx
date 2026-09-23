import { act } from "react";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKSPACE_STATE,
  WORKSPACE_STORAGE_KEY,
  type ExtensionRequest,
} from "@channelpilot/shared";
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
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await act(async () => mounted.roots.forEach((root) => root.unmount()));
  vi.unstubAllGlobals();
});

it("adopts workspace edits from another window and polls analytics while visible", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const fixture = createChromeFixture();
  const storageListeners: Array<(changes: unknown, area: string) => void> = [];
  const addListener = fixture.chrome.storage.onChanged.addListener;
  fixture.chrome.storage.onChanged.addListener = (listener) => {
    storageListeners.push(listener as (changes: unknown, area: string) => void);
    return addListener(listener);
  };
  const sent: ExtensionRequest["type"][] = [];
  const originalSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) => {
    sent.push(message.type);
    return originalSend(message);
  };
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });

  // Another cabinet window saves a planner item.
  await act(async () => {
    storageListeners.forEach((listener) =>
      listener(
        {
          [WORKSPACE_STORAGE_KEY]: {
            newValue: {
              ...DEFAULT_WORKSPACE_STATE,
              planner: [
                {
                  id: "planner-from-elsewhere",
                  title: "Saved in another window",
                  status: "draft",
                  publishAt: "2026-10-01T10:00:00.000Z",
                  notes: "",
                  tags: [],
                  createdAt: "2026-09-20T10:00:00.000Z",
                  updatedAt: "2026-09-20T10:00:00.000Z",
                },
              ],
              updatedAt: "2026-09-20T10:00:00.000Z",
            },
          },
        },
        "local",
      ),
    );
  });
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Planner"]')!.click();
  });
  expect(document.body.textContent).toContain("Saved in another window");

  // The overview's live counters refresh on the configured interval.
  const dashboardReads = () => sent.filter((type) => type === "GET_DASHBOARD").length;
  const before = dashboardReads();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(dashboardReads()).toBe(before + 1);
});
