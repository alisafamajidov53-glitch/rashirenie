import { describe, expect, it, vi } from "vitest";
import type { ExtensionSettings } from "@channelpilot/shared";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const firstWriteStarted = deferred<void>();
const finishFirstWrite = deferred<void>();
let storedSettings: ExtensionSettings | undefined;
let settingsWrites = 0;
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
      get: vi.fn(async () => ({ settings: storedSettings })),
      set: vi.fn(async (value: { settings?: ExtensionSettings }) => {
        if (!value.settings) return;
        settingsWrites += 1;
        if (settingsWrites === 1) {
          firstWriteStarted.resolve(undefined);
          await finishFirstWrite.promise;
        }
        storedSettings = value.settings;
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

function patch(payload: Record<string, unknown>) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    listener(
      { type: "SAVE_SETTINGS_PATCH", payload },
      {
        id: extensionId,
        origin: "https://www.youtube.com",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
      },
      resolve,
    );
  });
}

describe("concurrent settings edits", () => {
  it("merges two widget edits instead of losing the second one", async () => {
    const language = patch({ interfaceLanguage: "en" });
    await firstWriteStarted.promise;
    const visibility = patch({ showHeaderWidget: false });
    finishFirstWrite.resolve(undefined);
    await expect(Promise.all([language, visibility])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
    expect(storedSettings).toMatchObject({
      interfaceLanguage: "en",
      showHeaderWidget: false,
    });
    expect(settingsWrites).toBe(2);
  });
});
