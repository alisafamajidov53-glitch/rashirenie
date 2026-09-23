import { describe, expect, it, vi } from "vitest";
import { dashboardFixture } from "./analytics-fixtures";

vi.mock("../src/background/google-auth", () => ({
  getGoogleToken: vi.fn(),
  hasGoogleSession: vi.fn(async () => false),
  invalidateGoogleToken: vi.fn(async () => undefined),
  signOutGoogle: vi.fn(async () => undefined),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const cacheRead = deferred<Record<string, unknown>>();
const readStarted = deferred<void>();
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
  alarms: {
    clear: vi.fn(async () => true),
    onAlarm: { addListener: vi.fn() },
  },
  notifications: { onClicked: { addListener: vi.fn() } },
  storage: {
    local: {
      get: vi.fn((key: string) => {
        if (key === "dashboardCacheV10") {
          readStarted.resolve(undefined);
          return cacheRead.promise;
        }
        return Promise.resolve({});
      }),
      set: vi.fn(async () => undefined),
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
const { getGoogleToken, hasGoogleSession } =
  await import("../src/background/google-auth");

function send(
  type: "GET_DASHBOARD" | "SIGN_OUT" | "SIGN_IN" | "AUTH_STATUS" | "COLLECT_REALTIME",
) {
  return new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    listener(
      { type },
      { id: extensionId, origin: `chrome-extension://${extensionId}` },
      resolve,
    );
  });
}

describe("dashboard session boundary", () => {
  it("never serves a cached dashboard after sign-out wins the read race", async () => {
    const pendingDashboard = send("GET_DASHBOARD");
    await readStarted.promise;
    await expect(send("SIGN_OUT")).resolves.toMatchObject({ ok: true });
    cacheRead.resolve({
      dashboardCacheV10: { at: Date.now(), data: dashboardFixture() },
    });
    await expect(pendingDashboard).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Google session changed"),
    });
  });

  it("does not reconnect an account after sign-out interrupts sign-in", async () => {
    vi.clearAllMocks();
    const tokenRequested = deferred<void>();
    const tokenResult = deferred<string>();
    vi.mocked(getGoogleToken).mockImplementationOnce(async () => {
      tokenRequested.resolve(undefined);
      return tokenResult.promise;
    });
    const signIn = send("SIGN_IN");
    await tokenRequested.promise;
    await expect(send("SIGN_OUT")).resolves.toMatchObject({ ok: true });
    tokenResult.resolve("expired-session-token");
    await expect(signIn).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Google session changed"),
    });
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith({
      googleOAuthConnected: true,
    });
  });

  it("does not report an old token as signed in after sign-out", async () => {
    vi.clearAllMocks();
    const tokenRequested = deferred<void>();
    const tokenResult = deferred<string>();
    vi.mocked(getGoogleToken).mockImplementationOnce(async () => {
      tokenRequested.resolve(undefined);
      return tokenResult.promise;
    });
    const status = send("AUTH_STATUS");
    await tokenRequested.promise;
    await expect(send("SIGN_OUT")).resolves.toMatchObject({ ok: true });
    tokenResult.resolve("previous-session-token");
    await expect(status).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Google session changed"),
    });
  });

  it("does not return an old collection status after sign-out", async () => {
    vi.clearAllMocks();
    const sessionChecked = deferred<void>();
    const sessionResult = deferred<boolean>();
    vi.mocked(hasGoogleSession).mockImplementationOnce(async () => {
      sessionChecked.resolve(undefined);
      return sessionResult.promise;
    });
    const collection = send("COLLECT_REALTIME");
    await sessionChecked.promise;
    const signOut = send("SIGN_OUT");
    sessionResult.resolve(true);
    await expect(signOut).resolves.toMatchObject({ ok: true });
    await expect(collection).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Google session changed"),
    });
  });
});
