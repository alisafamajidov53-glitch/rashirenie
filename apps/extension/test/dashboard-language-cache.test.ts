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
  getDashboard: vi.fn(),
  collectRealtime: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const cacheKey = "dashboardCacheV10";
const stored: Record<string, unknown> = {
  settings: { ...DEFAULT_EXTENSION_SETTINGS, interfaceLanguage: "ru" },
  [cacheKey]: {
    at: Date.now(),
    interfaceLanguage: "ru",
    data: dashboardFixture(),
  },
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
      addListener: vi.fn((callback: typeof listener) => {
        listener = callback;
      }),
    },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
  },
  alarms: { onAlarm: { addListener: vi.fn() } },
  notifications: { onClicked: { addListener: vi.fn() } },
  tabs: {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => undefined),
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(stored, value);
      }),
      remove: vi.fn(async (key: string) => {
        delete stored[key];
      }),
      setAccessLevel: vi.fn(async () => undefined),
    },
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
  },
});

await import("../src/background/service-worker");
const { collectRealtime, getDashboard } = await import("../src/background/youtube");

function send(message: Record<string, unknown>, contentScript = false) {
  return new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    listener(
      message,
      {
        id: extensionId,
        origin: contentScript
          ? "https://www.youtube.com"
          : `chrome-extension://${extensionId}`,
      },
      resolve,
    );
  });
}

describe("dashboard language cache", () => {
  it("keeps the cache compatible after a realtime refresh", async () => {
    stored.settings = { ...DEFAULT_EXTENSION_SETTINGS, interfaceLanguage: "ru" };
    stored[cacheKey] = {
      at: Date.now(),
      interfaceLanguage: "ru",
      data: dashboardFixture(),
    };
    vi.mocked(getDashboard).mockClear();
    vi.mocked(collectRealtime).mockResolvedValue(dashboardFixture());

    await expect(send({ type: "COLLECT_REALTIME" })).resolves.toMatchObject({
      ok: true,
    });
    expect(stored[cacheKey]).toMatchObject({ interfaceLanguage: "ru" });
    await expect(send({ type: "GET_DASHBOARD" })).resolves.toMatchObject({
      ok: true,
    });
    expect(getDashboard).not.toHaveBeenCalled();
  });

  it("refreshes translated data and rejects an in-flight result from the old language", async () => {
    const fetch = vi.mocked(getDashboard);
    fetch.mockImplementation(async (_token, language) => ({
      ...dashboardFixture(),
      analyticsWarnings: [language ?? "ru"],
    }));

    await expect(
      send({
        type: "SAVE_SETTINGS",
        payload: { ...DEFAULT_EXTENSION_SETTINGS, interfaceLanguage: "en" },
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(stored[cacheKey]).toBeUndefined();

    await expect(send({ type: "GET_DASHBOARD" })).resolves.toMatchObject({
      ok: true,
      data: { analyticsWarnings: ["en"] },
    });
    expect(fetch).toHaveBeenCalledWith("test-token", "en");

    const oldFetch = deferred<ReturnType<typeof dashboardFixture>>();
    const oldFetchStarted = deferred<void>();
    fetch.mockImplementationOnce(async () => {
      oldFetchStarted.resolve(undefined);
      return oldFetch.promise;
    });
    const pending = send({ type: "GET_DASHBOARD", force: true });
    await oldFetchStarted.promise;
    await expect(
      send({ type: "SAVE_SETTINGS_PATCH", payload: { interfaceLanguage: "ru" } }, true),
    ).resolves.toMatchObject({ ok: true });
    expect(stored[cacheKey]).toBeUndefined();

    oldFetch.resolve({
      ...dashboardFixture(),
      analyticsWarnings: ["en"],
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Interface language changed"),
    });
    expect(stored[cacheKey]).toBeUndefined();

    await expect(send({ type: "GET_DASHBOARD" })).resolves.toMatchObject({
      ok: true,
      data: { analyticsWarnings: ["ru"] },
    });

    const settingsWriteStarted = deferred<void>();
    const finishSettingsWrite = deferred<void>();
    const storageSet = chrome.storage.local.set as (
      value: Record<string, unknown>,
    ) => Promise<void>;
    vi.mocked(storageSet).mockImplementationOnce(async (value) => {
      Object.assign(stored, value);
      settingsWriteStarted.resolve(undefined);
      await finishSettingsWrite.promise;
    });
    const save = send(
      { type: "SAVE_SETTINGS_PATCH", payload: { interfaceLanguage: "en" } },
      true,
    );
    await settingsWriteStarted.promise;
    const fetchCount = fetch.mock.calls.length;
    const pendingDashboard = send({ type: "GET_DASHBOARD" });
    let authResolved = false;
    const pendingAuth = send({ type: "AUTH_STATUS" }).then((result) => {
      authResolved = true;
      return result;
    });
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
    expect(fetch).toHaveBeenCalledTimes(fetchCount);
    expect(authResolved).toBe(false);
    finishSettingsWrite.resolve(undefined);
    await expect(save).resolves.toMatchObject({ ok: true });
    await expect(pendingAuth).resolves.toMatchObject({ ok: true });
    await expect(pendingDashboard).resolves.toMatchObject({
      ok: true,
      data: { analyticsWarnings: ["en"] },
    });
  });

  it("does not merge an old-language realtime response into a new-language cache", async () => {
    await expect(
      send({ type: "SAVE_SETTINGS_PATCH", payload: { interfaceLanguage: "ru" } }, true),
    ).resolves.toMatchObject({ ok: true });
    stored[cacheKey] = {
      at: Date.now(),
      interfaceLanguage: "ru",
      data: dashboardFixture(),
    };
    stored.realtimeCollectorStatus = {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: "",
    };
    const started = deferred<void>();
    const response = deferred<ReturnType<typeof dashboardFixture>>();
    vi.mocked(collectRealtime).mockImplementationOnce(async () => {
      started.resolve(undefined);
      return response.promise;
    });
    const pending = send({ type: "COLLECT_REALTIME" });
    await started.promise;
    await expect(
      send({ type: "SAVE_SETTINGS_PATCH", payload: { interfaceLanguage: "en" } }, true),
    ).resolves.toMatchObject({ ok: true });
    stored[cacheKey] = {
      at: Date.now(),
      interfaceLanguage: "en",
      data: { ...dashboardFixture(), analyticsWarnings: ["new-language"] },
    };
    response.resolve(dashboardFixture());
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(stored[cacheKey]).toMatchObject({
      interfaceLanguage: "en",
      data: { analyticsWarnings: ["new-language"] },
    });
  });
});
