import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WORKSPACE_STATE,
  type WorkspaceState,
} from "@channelpilot/shared";
import { PlannerPage } from "../src/options/workspace-pages";

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The page with a real workspace round trip, as the dashboard wires it. */
function Harness({ initial }: { initial: WorkspaceState }) {
  const [workspace, setWorkspace] = useState(initial);
  return (
    <PlannerPage
      language="ru"
      data={null}
      settings={DEFAULT_EXTENSION_SETTINGS}
      workspace={workspace}
      onWorkspace={async (next) => {
        setWorkspace((current) => (typeof next === "function" ? next(current) : next));
        return true;
      }}
      onError={() => undefined}
      onNotice={() => undefined}
    />
  );
}

const card = {
  id: "plan-1",
  title: "Секретная комната",
  status: "draft" as const,
  publishAt: "",
  notes: "Хук: открываем дверь в первые 3 секунды",
  tags: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const cards = () => container.querySelectorAll(".planner-column > article");

it("lets a deleted card, notes included, be brought back", async () => {
  await act(async () =>
    root.render(<Harness initial={{ ...DEFAULT_WORKSPACE_STATE, planner: [card] }} />),
  );
  expect(cards()).toHaveLength(1);
  // Four of the five columns are empty and say so.
  expect(container.querySelectorAll(".planner-empty")).toHaveLength(4);

  const remove = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Удалить карточку"]',
  );
  await act(async () => remove!.click());
  expect(cards()).toHaveLength(0);
  expect(container.querySelector(".planner-undo")?.textContent).toContain(
    "Секретная комната",
  );

  const undo = container.querySelector<HTMLButtonElement>(".planner-undo button");
  await act(async () => undo!.click());
  expect(cards()).toHaveLength(1);
  const notes = container.querySelector<HTMLTextAreaElement>(
    ".planner-column > article textarea",
  );
  expect(notes?.value).toBe(card.notes);
  expect(container.querySelector(".planner-undo")).toBeNull();
});

it("drops the undo offer after a few seconds", async () => {
  vi.useFakeTimers();
  await act(async () =>
    root.render(<Harness initial={{ ...DEFAULT_WORKSPACE_STATE, planner: [card] }} />),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Удалить карточку"]')!
      .click(),
  );
  expect(container.querySelector(".planner-undo")).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8_100);
  });
  expect(container.querySelector(".planner-undo")).toBeNull();
});

it("shows a scheduled UTC instant in the viewer's local datetime field", async () => {
  // Always in the future: the calendar lists upcoming publications only.
  const publishAt = new Date(
    Date.UTC(new Date().getUTCFullYear() + 1, 8, 20, 18, 45),
  ).toISOString();
  await act(async () =>
    root.render(
      <Harness
        initial={{
          ...DEFAULT_WORKSPACE_STATE,
          planner: [{ ...card, publishAt }],
        }}
      />,
    ),
  );
  const date = new Date(publishAt);
  const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  expect(
    container.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.value,
  ).toBe(expected);
  expect(container.querySelector(".planner-calendar em")?.textContent).toBe("В работе");
});

it("lists upcoming publications first and leaves past dates out of the calendar", async () => {
  const day = 86_400_000;
  const past = {
    ...card,
    id: "past",
    title: "Old video",
    publishAt: new Date(Date.now() - 30 * day).toISOString(),
  };
  const later = {
    ...card,
    id: "later",
    title: "Later video",
    publishAt: new Date(Date.now() + 9 * day).toISOString(),
  };
  const sooner = {
    ...card,
    id: "sooner",
    title: "Sooner video",
    publishAt: new Date(Date.now() + 2 * day).toISOString(),
  };
  await act(async () =>
    root.render(
      <Harness
        initial={{ ...DEFAULT_WORKSPACE_STATE, planner: [past, later, sooner] }}
      />,
    ),
  );
  const titles = [...container.querySelectorAll(".planner-calendar button span")].map(
    (node) => node.textContent,
  );
  expect(titles).toEqual(["Sooner video", "Later video"]);

  await act(async () =>
    root.render(
      <Harness
        key="past-only"
        initial={{ ...DEFAULT_WORKSPACE_STATE, planner: [past] }}
      />,
    ),
  );
  expect(container.querySelector(".planner-calendar p")?.textContent).toContain(
    "Предстоящих публикаций нет",
  );
});

it("does not discard existing cards when an import exceeds the planner limit", async () => {
  const existing = Array.from({ length: 499 }, (_, index) => ({
    ...card,
    id: `existing-${index}`,
    title: `Existing ${index}`,
  }));
  const onError = vi.fn();
  const onWorkspace = vi.fn(async () => true);
  await act(async () =>
    root.render(
      <PlannerPage
        language="ru"
        data={null}
        settings={DEFAULT_EXTENSION_SETTINGS}
        workspace={{ ...DEFAULT_WORKSPACE_STATE, planner: existing }}
        onWorkspace={onWorkspace}
        onError={onError}
        onNotice={() => undefined}
      />,
    ),
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const imported = [
    { ...card, id: "new-1", title: "New 1" },
    { ...card, id: "new-2", title: "New 2" },
  ];
  const file = new File([JSON.stringify({ planner: imported })], "plan.json", {
    type: "application/json",
  });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(onWorkspace).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining("Недостаточно места"));
});
