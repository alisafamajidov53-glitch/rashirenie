import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKSPACE_STATE,
  type PlannerItem,
  type WorkspaceState,
} from "@channelpilot/shared";

vi.mock("../src/background/workspace-store", () => ({
  getWorkspaceState: vi.fn(),
}));

const stored: Record<string, unknown> = {};
const createNotification = vi.fn(async () => "planner-notification");

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
const { checkPlannerReminders, schedulePlannerReminderCheck } =
  await import("../src/background/reminders");

function scheduledItem(id: string): PlannerItem {
  return {
    id,
    title: "Publish video",
    status: "scheduled",
    publishAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    notes: "",
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  createNotification.mockClear();
  vi.mocked(getWorkspaceState).mockReset();
  for (const key of Object.keys(stored)) delete stored[key];
});

it("titles the reminder in the interface language", async () => {
  vi.mocked(getWorkspaceState).mockResolvedValue({
    ...DEFAULT_WORKSPACE_STATE,
    planner: [scheduledItem("ru-card")],
  } satisfies WorkspaceState);
  stored.settings = { interfaceLanguage: "ru" };
  await checkPlannerReminders();
  expect(createNotification).toHaveBeenCalledWith(
    "channelpilot-planner-ru-card",
    expect.objectContaining({ title: "ChannelPilot · Скоро публикация" }),
  );

  vi.mocked(getWorkspaceState).mockResolvedValue({
    ...DEFAULT_WORKSPACE_STATE,
    planner: [scheduledItem("en-card")],
  } satisfies WorkspaceState);
  stored.settings = { interfaceLanguage: "en" };
  await checkPlannerReminders();
  expect(createNotification).toHaveBeenLastCalledWith(
    "channelpilot-planner-en-card",
    expect.objectContaining({ title: "ChannelPilot · Publishing soon" }),
  );
});

it("runs one sweep after a burst of workspace saves", async () => {
  vi.useFakeTimers();
  vi.mocked(getWorkspaceState).mockResolvedValue(DEFAULT_WORKSPACE_STATE);
  for (let index = 0; index < 20; index += 1) schedulePlannerReminderCheck();
  expect(getWorkspaceState).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(getWorkspaceState).toHaveBeenCalledOnce();
});
