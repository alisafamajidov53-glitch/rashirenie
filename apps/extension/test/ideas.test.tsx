import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WORKSPACE_STATE,
} from "@channelpilot/shared";
import { IdeasPage } from "../src/options/workspace-pages";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("does not silently evict a planner card when an idea is added to a full plan", async () => {
  const onWorkspace = vi.fn(async () => true);
  const onError = vi.fn();
  const planner = Array.from({ length: 500 }, (_, index) => ({
    id: `plan-${index}`,
    title: `Video ${index}`,
    status: "idea" as const,
    publishAt: "",
    notes: "",
    tags: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  }));
  await act(async () =>
    root.render(
      <IdeasPage
        language="ru"
        data={null}
        settings={DEFAULT_EXTENSION_SETTINGS}
        workspace={{
          ...DEFAULT_WORKSPACE_STATE,
          planner,
          ideas: [
            {
              id: "idea-1",
              title: "Новый ролик",
              angle: "Идея",
              format: "long",
              difficulty: "medium",
              interest: 70,
              source: "ai",
              createdAt: "2026-09-01T00:00:00.000Z",
            },
          ],
        }}
        onWorkspace={onWorkspace}
        onError={onError}
        onNotice={() => undefined}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".idea-grid footer button")!.click(),
  );
  expect(onWorkspace).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith("План заполнен (500 карточек)");
});
