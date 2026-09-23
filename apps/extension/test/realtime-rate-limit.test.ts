import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EXTENSION_SETTINGS } from "@channelpilot/shared";
import { dashboardFixture } from "./analytics-fixtures";

vi.mock("../src/background/google-auth", () => ({
  getGoogleToken: vi.fn(async () => "test-token"),
  hasGoogleSession: vi.fn(async () => true),
  invalidateGoogleToken: vi.fn(async () => undefined),
  signOutGoogle: vi.fn(async () => undefined),
}));
vi.mock("../src/background/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/background/youtube")>()),
  collectRealtime: vi.fn(),
}));

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const stored: Record<string, unknown> = {
  settings: DEFAULT_EXTENSION_SETTINGS,
  googleOAuthConnected: true,
};
let listener!: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: { ok: boolean; data?: unknown; error?: string }) => void,
) => boolean;

vi.stubGlobal("chrome", {
  runtime: {
    id: extensionId,
    onMessage: {
      addListener: vi.fn((callback: typeof listener) => (listener = callback)),
    },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
  },
  alarms: { onAlarm: { addListener: vi.fn() } },
  notifications: { onClicked: { addListener: vi.fn() } },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(stored, value);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
      }),
    },
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
  },
});

await import("../src/background/service-worker");
const { collectRealtime } = await import("../src/background/youtube");

function collect() {
  return new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    listener(
      { type: "COLLECT_REALTIME" },
      { id: extensionId, origin: `chrome-extension://${extensionId}` },
      resolve,
    );
  });
}

describe("realtime API limit recovery", () => {
  it("retries a short-window rate limit after five minutes, not at midnight", async () => {
    vi.mocked(collectRealtime).mockRejectedValueOnce(
      new Error(
        'YouTube API 403: {"error":{"errors":[{"reason":"rateLimitExceeded"}]}}',
      ),
    );
    await expect(collect()).resolves.toMatchObject({ ok: false });
    const pausedUntil = stored.youtubeCollectionPausedUntilV2 as number;
    expect(pausedUntil - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(pausedUntil - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    expect(stored.realtimeCollectorStatus).toMatchObject({
      lastError: expect.stringContaining("через 5 мин"),
    });

    await expect(collect()).resolves.toMatchObject({ ok: true });
    expect(collectRealtime).toHaveBeenCalledTimes(1);

    stored.youtubeCollectionPausedUntilV2 = Date.now() - 1;
    vi.mocked(collectRealtime).mockResolvedValueOnce(dashboardFixture());
    await expect(collect()).resolves.toMatchObject({
      ok: true,
      data: { lastError: "" },
    });
    expect(collectRealtime).toHaveBeenCalledTimes(2);
    expect(stored.youtubeCollectionPausedUntilV2).toBeUndefined();
  });

  it("keeps the next daily reset for a genuine quotaExceeded response", async () => {
    stored.realtimeCollectorStatus = {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: "",
    };
    vi.mocked(collectRealtime).mockRejectedValueOnce(
      new Error('YouTube API 403: {"error":{"errors":[{"reason":"quotaExceeded"}]}}'),
    );
    await expect(collect()).resolves.toMatchObject({ ok: false });
    expect(stored.youtubeCollectionPausedUntilV2).toBeGreaterThan(Date.now());
    expect(stored.realtimeCollectorStatus).toMatchObject({
      lastError: expect.stringContaining("Суточная квота"),
    });
  });

  it("uses the real Pacific midnight across both daylight-saving changes", async () => {
    vi.useFakeTimers();
    try {
      const transitions = [
        ["2026-03-08T08:30:00Z", "2026-03-09T07:00:00Z"],
        ["2026-11-01T07:30:00Z", "2026-11-02T08:00:00Z"],
      ] as const;
      for (const [current, reset] of transitions) {
        vi.setSystemTime(new Date(current));
        delete stored.youtubeCollectionPausedUntilV2;
        stored.realtimeCollectorStatus = {
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastError: "",
        };
        vi.mocked(collectRealtime).mockRejectedValueOnce(
          new Error('YouTube API 403: {"error":{"reason":"quotaExceeded"}}'),
        );
        await expect(collect()).resolves.toMatchObject({ ok: false });
        expect(
          Math.abs(
            (stored.youtubeCollectionPausedUntilV2 as number) - Date.parse(reset),
          ),
        ).toBeLessThan(1_000);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
