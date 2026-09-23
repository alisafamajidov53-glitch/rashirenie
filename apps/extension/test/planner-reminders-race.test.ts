import { expect, it, vi } from "vitest";
import {
  DEFAULT_WORKSPACE_STATE,
  type PlannerItem,
  type WorkspaceState,
} from "@channelpilot/shared";

vi.mock("../src/background/workspace-store", () => ({
  getWorkspaceState: vi.fn(),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const stored: Record<string, unknown> = {};
const notificationStarted = deferred();
const finishNotification = deferred();
const createNotification = vi.fn(async () => {
  notificationStarted.resolve();
  await finishNotification.promise;
  return "planner-notification";
});

vi.stubGlobal("chrome", {
  runtime: { getURL: (path: string) => path },
  notifications: { create: createNotification },
  storage: {
    local: {
      get: vi.fn(async (keys: string[]) =>
        Object.fromEntries(keys.map((key) => [key, stored[key]])),
      ),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(stored, value);
      }),
    },
  },
});

const { getWorkspaceState } = await import("../src/background/workspace-store");
const { checkPlannerReminders } = await import("../src/background/reminders");

it("serializes concurrent reminder sweeps without notifying twice", async () => {
  const publishAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const item: PlannerItem = {
    id: "scheduled-video",
    title: "Publish video",
    status: "scheduled",
    publishAt,
    notes: "",
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  vi.mocked(getWorkspaceState).mockResolvedValue({
    ...DEFAULT_WORKSPACE_STATE,
    planner: [item],
  } satisfies WorkspaceState);

  const first = checkPlannerReminders();
  await notificationStarted.promise;
  const second = checkPlannerReminders();
  finishNotification.resolve();
  await Promise.all([first, second]);

  expect(createNotification).toHaveBeenCalledOnce();
  expect(stored.channelpilotPlannerReminderStateV1).toEqual({
    [item.id]: publishAt,
  });
});
