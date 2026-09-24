import { beforeEach, expect, it, vi } from "vitest";

const stored: Record<string, unknown> = {};
const get = vi.fn(async (keys: string | string[]) =>
  Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys])
      .filter((key) => key in stored)
      .map((key) => [key, structuredClone(stored[key])]),
  ),
);
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get,
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(stored, structuredClone(values));
      }),
      remove: vi.fn(async (keys: string[]) => {
        for (const key of keys) delete stored[key];
      }),
    },
  },
});

const { clearRealtimeSamples, observedStats, realtimeSeries, saveSamples } =
  await import("../src/background/realtime-store");

beforeEach(async () => {
  await clearRealtimeSamples();
  get.mockClear();
});

it("derives statistics from the saved snapshot with a single storage read", async () => {
  // The window statistics are measured back from the real clock.
  const start = Math.floor(Date.now() / 60_000) * 60_000 - 10 * 60_000;
  await saveSamples([{ id: "channel", views: 1_000 }], start, "UC-channel");
  const samples = await saveSamples(
    [{ id: "channel", views: 1_030 }],
    start + 10 * 60_000,
    "UC-channel",
  );
  // One combined read of the series and the channel id per save.
  expect(get).toHaveBeenCalledTimes(2);
  const stats = observedStats(samples, ["channel", "missing"]);
  expect(stats.channel).toMatchObject({ views: 30, observedMinutes: 10 });
  expect(stats.missing).toMatchObject({ views: 0, observedMinutes: 0 });
  expect(realtimeSeries(samples, ["channel"]).length).toBeGreaterThan(0);
});

it("starts a clean series when the channel changes", async () => {
  const start = Date.UTC(2026, 8, 1, 12, 0, 0);
  await saveSamples([{ id: "channel", views: 1_000 }], start, "UC-first");
  const samples = await saveSamples(
    [{ id: "channel", views: 5_000 }],
    start + 5 * 60_000,
    "UC-second",
  );
  expect(samples.channel).toHaveLength(1);
  expect(observedStats(samples, ["channel"]).channel?.views).toBe(0);
});
