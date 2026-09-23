import { expect, it, vi } from "vitest";
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WORKSPACE_STATE,
  type ExtensionRequest,
} from "@channelpilot/shared";

vi.mock("../src/background/google-auth", () => ({
  getGoogleToken: vi.fn(),
  hasGoogleSession: vi.fn(async () => false),
  invalidateGoogleToken: vi.fn(async () => undefined),
  signOutGoogle: vi.fn(async () => undefined),
}));

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
let listener!: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: { ok: boolean; data?: unknown; error?: string }) => void,
) => boolean;
let finishWrite!: () => void;
let writes = 0;
let clears = 0;
let storedWorkspace: unknown;
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
  alarms: {
    clear: vi.fn(async () => true),
    onAlarm: { addListener: vi.fn() },
  },
  notifications: { onClicked: { addListener: vi.fn() } },
  storage: {
    local: {
      get: vi.fn(async () => ({
        settings: DEFAULT_EXTENSION_SETTINGS,
        channelpilotWorkspaceV1: storedWorkspace,
      })),
      set: vi.fn((value: Record<string, unknown>) => {
        if ("channelpilotWorkspaceV1" in value) {
          writes += 1;
          if (writes === 1) {
            return new Promise<void>((resolve) => {
              finishWrite = () => {
                storedWorkspace = value.channelpilotWorkspaceV1;
                resolve();
              };
            });
          }
          storedWorkspace = value.channelpilotWorkspaceV1;
        }
        return Promise.resolve();
      }),
      remove: vi.fn(async () => undefined),
      clear: vi.fn(async () => {
        clears += 1;
        storedWorkspace = undefined;
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

function send(message: ExtensionRequest) {
  return new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    listener(
      message,
      { id: extensionId, origin: `chrome-extension://${extensionId}` },
      resolve,
    );
  });
}

it("serializes an in-flight write before reset and rejects writes during reset", async () => {
  const first = send({
    type: "SAVE_WORKSPACE_STATE",
    payload: DEFAULT_WORKSPACE_STATE,
  });
  await vi.waitFor(() => expect(writes).toBe(1));
  const reset = send({ type: "RESET_LOCAL_DATA", preserveSettings: true });
  const second = await send({
    type: "SAVE_WORKSPACE_STATE",
    payload: DEFAULT_WORKSPACE_STATE,
  });
  expect(second).toMatchObject({ ok: false });
  expect(writes).toBe(1);
  expect(clears).toBe(0);
  finishWrite();
  await expect(first).resolves.toMatchObject({ ok: true });
  await expect(reset).resolves.toMatchObject({ ok: true });
  expect(clears).toBe(1);
  expect(writes).toBe(2);
  const stale = await send({
    type: "SAVE_WORKSPACE_STATE",
    payload: DEFAULT_WORKSPACE_STATE,
  });
  expect(stale).toMatchObject({ ok: false, error: "WORKSPACE_CONFLICT" });
  expect(writes).toBe(2);
  const sameRevision = storedWorkspace as typeof DEFAULT_WORKSPACE_STATE;
  const competingA = send({
    type: "SAVE_WORKSPACE_STATE",
    payload: { ...sameRevision, favoriteTitles: ["First window"] },
  });
  const competingB = send({
    type: "SAVE_WORKSPACE_STATE",
    payload: { ...sameRevision, favoriteTitles: ["Second window"] },
  });
  await expect(competingA).resolves.toMatchObject({ ok: true });
  await expect(competingB).resolves.toMatchObject({
    ok: false,
    error: "WORKSPACE_CONFLICT",
  });
  expect(writes).toBe(3);
});
