import { expect, it, vi } from "vitest";
import {
  DEFAULT_EXTENSION_SETTINGS,
  type ExtensionSettings,
} from "@channelpilot/shared";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
let storedSettings: ExtensionSettings = {
  ...DEFAULT_EXTENSION_SETTINGS,
  geminiApiKey: "keep-secret",
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
  alarms: { clear: vi.fn(async () => true), onAlarm: { addListener: vi.fn() } },
  notifications: { onClicked: { addListener: vi.fn() } },
  tabs: {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => undefined),
  },
  storage: {
    local: {
      get: vi.fn(async () => ({ settings: storedSettings })),
      set: vi.fn(async (value: { settings?: ExtensionSettings }) => {
        if (value.settings) storedSettings = value.settings;
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

function sendRequest(
  message: unknown,
  origin = `chrome-extension://${extensionId}`,
  url = `${origin}/video/abcdefghijk/edit`,
) {
  return new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    listener(
      message,
      {
        id: extensionId,
        origin,
        url,
      },
      resolve,
    );
  });
}

function send(payload: unknown, contentScript = false) {
  return sendRequest(
    { type: "SAVE_SETTINGS_TRUSTED_PATCH", payload },
    contentScript ? "https://www.youtube.com" : `chrome-extension://${extensionId}`,
  );
}

it("merges edits from separate extension windows without exposing trusted patches to tabs", async () => {
  await expect(
    Promise.all([send({ theme: "light" }), send({ accentColor: "cyan" })]),
  ).resolves.toEqual([
    expect.objectContaining({ ok: true }),
    expect.objectContaining({ ok: true }),
  ]);
  expect(storedSettings).toMatchObject({
    theme: "light",
    accentColor: "cyan",
    geminiApiKey: "keep-secret",
  });

  await expect(send({ geminiApiKey: "stolen" }, true)).resolves.toMatchObject({
    ok: false,
  });
  expect(storedSettings.geminiApiKey).toBe("keep-secret");
});

it("does not disconnect Google when a Client ID change cannot be stored", async () => {
  const previousClientId = storedSettings.googleClientId;
  const sessionRemove = vi.mocked(chrome.storage.session.remove);
  sessionRemove.mockClear();
  vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error("Storage full"));

  await expect(
    send({ googleClientId: "new.apps.googleusercontent.com" }),
  ).resolves.toMatchObject({
    ok: false,
    error: "Storage full",
  });
  expect(storedSettings.googleClientId).toBe(previousClientId);
  expect(sessionRemove).not.toHaveBeenCalled();
  expect(chrome.alarms.clear).not.toHaveBeenCalled();

  await expect(
    send({ googleClientId: "new.apps.googleusercontent.com" }),
  ).resolves.toMatchObject({
    ok: true,
  });
  expect(storedSettings.googleClientId).toBe("new.apps.googleusercontent.com");
  expect(sessionRemove).toHaveBeenCalledWith("googleOAuthToken");
  expect(chrome.alarms.clear).toHaveBeenCalled();
});

it("releases media keys only to a one-time bridge session from opted-in Studio", async () => {
  storedSettings = {
    ...storedSettings,
    allowAiMediaUploads: false,
    preferredProvider: "gemini",
    geminiApiKey: "gemini-secret",
    groqApiKey: "groq-secret",
    twelveLabsApiKey: "twelve-secret",
  };
  const request = { type: "CREATE_MEDIA_BRIDGE_SESSION" };
  await expect(sendRequest(request, "https://www.youtube.com")).resolves.toMatchObject({
    ok: false,
  });
  await expect(
    sendRequest(request, "https://studio.youtube.com"),
  ).resolves.toMatchObject({
    ok: false,
  });

  storedSettings.allowAiMediaUploads = true;
  const created = await sendRequest(request, "https://studio.youtube.com");
  expect(created.ok).toBe(true);
  expect(typeof created.data).toBe("string");
  expect(JSON.stringify(created)).not.toContain("gemini-secret");
  const redeem = { type: "REDEEM_MEDIA_BRIDGE_SESSION", token: created.data };
  await expect(
    sendRequest(redeem, "https://studio.youtube.com"),
  ).resolves.toMatchObject({
    ok: false,
  });
  const bridgeUrl = `chrome-extension://${extensionId}/src/media-bridge/index.html`;
  const response = await sendRequest(
    redeem,
    `chrome-extension://${extensionId}`,
    bridgeUrl,
  );
  expect(response.ok).toBe(true);
  expect(response.data).toMatchObject({
    geminiApiKey: "gemini-secret",
    groqApiKey: "",
    twelveLabsApiKey: "",
  });
  expect(response.data).not.toHaveProperty("googleClientId");
  expect(JSON.stringify(response.data)).not.toContain("groq-secret");
  expect(JSON.stringify(response.data)).not.toContain("twelve-secret");
  await expect(
    sendRequest(redeem, `chrome-extension://${extensionId}`, bridgeUrl),
  ).resolves.toMatchObject({ ok: false });
});
