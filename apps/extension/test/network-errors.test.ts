import { expect, it, vi } from "vitest";
import { DEFAULT_EXTENSION_SETTINGS } from "@channelpilot/shared";

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

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const stored: Record<string, unknown> = {
  settings: { ...DEFAULT_EXTENSION_SETTINGS, interfaceLanguage: "ru" },
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
      addListener: vi.fn((callback: typeof listener) => {
        listener = callback;
      }),
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
      remove: vi.fn(async () => undefined),
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
const { getDashboard } = await import("../src/background/youtube");

function send(message: Record<string, unknown>) {
  return new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    listener(
      message,
      { id: extensionId, origin: `chrome-extension://${extensionId}` },
      resolve,
    );
  });
}

it("describes a dropped connection instead of relaying 'Failed to fetch'", async () => {
  vi.mocked(getDashboard).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(send({ type: "GET_DASHBOARD", force: true })).resolves.toEqual({
    ok: false,
    error: "Нет связи с YouTube. Проверьте интернет — данные обновятся сами.",
  });
});

it("describes a timeout instead of 'signal is aborted without reason'", async () => {
  stored.settings = { ...DEFAULT_EXTENSION_SETTINGS, interfaceLanguage: "en" };
  vi.mocked(getDashboard).mockRejectedValueOnce(
    new DOMException("YouTube API request timed out", "TimeoutError"),
  );
  const response = await send({ type: "GET_DASHBOARD", force: true });
  expect(response.ok).toBe(false);
  expect(response.error).toContain("YouTube did not respond in time");
});

it("keeps the specific message of any other failure", async () => {
  vi.mocked(getDashboard).mockRejectedValueOnce(
    new Error("YouTube API 403: Access Not Configured (accessNotConfigured)"),
  );
  await expect(send({ type: "GET_DASHBOARD", force: true })).resolves.toMatchObject({
    ok: false,
    error: expect.stringContaining("accessNotConfigured"),
  });
});
