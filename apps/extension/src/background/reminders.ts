import type { PlannerItem } from "@channelpilot/shared";
import { getWorkspaceState } from "./workspace-store";

export const PLANNER_REMINDER_ALARM = "channelpilot-planner-reminders";
const REMINDER_STATE_KEY = "channelpilotPlannerReminderStateV1";
// Every workspace save used to start a full reminder sweep (a storage read and
// a normalization of the whole workspace). Typing in a planner card saves on
// each keystroke, so the sweeps are coalesced into one after the burst.
const SAVE_SWEEP_DELAY_MS = 2_000;

interface ReminderState {
  [plannerId: string]: string;
}
let reminderCheckQueue: Promise<void> = Promise.resolve();
let scheduledSweep: ReturnType<typeof setTimeout> | undefined;

export async function ensurePlannerReminderAlarm(): Promise<void> {
  await chrome.alarms.create(PLANNER_REMINDER_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: 15,
  });
}

function dueSoon(item: PlannerItem, now: number): boolean {
  if (item.status !== "scheduled" && item.status !== "ready") return false;
  const publishAt = Date.parse(item.publishAt);
  return (
    Number.isFinite(publishAt) &&
    now >= publishAt - 60 * 60_000 &&
    now <= publishAt + 15 * 60_000
  );
}

async function runPlannerReminderCheck(): Promise<void> {
  const stored = await chrome.storage.local.get(["settings", REMINDER_STATE_KEY]);
  const settings = stored.settings as
    { notificationsEnabled?: unknown; interfaceLanguage?: unknown } | undefined;
  if (settings?.notificationsEnabled === false) return;
  // The rest of the extension defaults to Russian; the notification used to be
  // hard-coded English whatever the interface language was.
  const english = settings?.interfaceLanguage === "en";
  const sent =
    stored[REMINDER_STATE_KEY] && typeof stored[REMINDER_STATE_KEY] === "object"
      ? (stored[REMINDER_STATE_KEY] as ReminderState)
      : {};
  const workspace = await getWorkspaceState();
  const now = Date.now();
  const activeIds = new Set(workspace.planner.map((item) => item.id));
  for (const id of Object.keys(sent)) {
    if (!activeIds.has(id)) delete sent[id];
  }
  for (const item of workspace.planner) {
    if (!dueSoon(item, now) || sent[item.id] === item.publishAt) continue;
    const publishAt = new Date(item.publishAt);
    const when = publishAt.toLocaleString(english ? "en-US" : "ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    try {
      await chrome.notifications.create(`channelpilot-planner-${item.id}`, {
        type: "basic",
        // Chrome cannot rasterise SVG for notifications ("Unable to download all
        // specified images"), which silently killed every planner reminder.
        iconUrl: chrome.runtime.getURL("icon-128.png"),
        title: english
          ? "ChannelPilot · Publishing soon"
          : "ChannelPilot · Скоро публикация",
        message: `${item.title} · ${when}`,
        priority: 1,
      });
    } catch {
      // One rejected notification must not abort the whole sweep, otherwise the
      // sent-state below is never persisted and reminders repeat forever.
      continue;
    }
    sent[item.id] = item.publishAt;
  }
  await chrome.storage.local.set({ [REMINDER_STATE_KEY]: sent });
}

export function checkPlannerReminders(): Promise<void> {
  const task = reminderCheckQueue.then(runPlannerReminderCheck);
  reminderCheckQueue = task.catch(() => undefined);
  return task;
}

/** One sweep shortly after a burst of workspace saves, not one per save. */
export function schedulePlannerReminderCheck(): void {
  if (scheduledSweep !== undefined) clearTimeout(scheduledSweep);
  scheduledSweep = setTimeout(() => {
    scheduledSweep = undefined;
    void checkPlannerReminders().catch(() => undefined);
  }, SAVE_SWEEP_DELAY_MS);
}
