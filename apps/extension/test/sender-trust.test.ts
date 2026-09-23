import { beforeEach, describe, expect, it, vi } from "vitest";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

// The service worker module runs top-level chrome.* calls on import, so the
// global is stubbed before it is loaded.
vi.stubGlobal("chrome", {
  runtime: {
    id: EXTENSION_ID,
    onMessage: { addListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
  },
  alarms: { onAlarm: { addListener: vi.fn() }, create: vi.fn() },
  notifications: { onClicked: { addListener: vi.fn() } },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
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

const { isUntrustedSender, isContentScriptOperationAllowed, isStudioContentSender } =
  await import("../src/background/service-worker");

type Sender = chrome.runtime.MessageSender;

describe("isUntrustedSender", () => {
  beforeEach(() => vi.clearAllMocks());

  it("trusts the options page, which is opened as a tab", () => {
    // Regression guard. Keying off `sender.tab` treated the options page as a
    // content script: it lost the API-key fields and every save was rejected.
    const optionsInTab = {
      origin: EXTENSION_ORIGIN,
      url: `${EXTENSION_ORIGIN}/src/options/index.html`,
      tab: { id: 7 },
    } as unknown as Sender;
    expect(isUntrustedSender(optionsInTab)).toBe(false);
  });

  it("trusts the popup, which has no tab", () => {
    const popup = {
      origin: EXTENSION_ORIGIN,
      url: `${EXTENSION_ORIGIN}/src/popup/index.html`,
    } as unknown as Sender;
    expect(isUntrustedSender(popup)).toBe(false);
  });

  it("does not trust a content script on YouTube", () => {
    const contentScript = {
      origin: "https://www.youtube.com",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      tab: { id: 9 },
    } as unknown as Sender;
    expect(isUntrustedSender(contentScript)).toBe(true);
  });

  it("does not trust an origin that merely starts with the extension origin", () => {
    const lookalike = {
      origin: `${EXTENSION_ORIGIN}.evil.example`,
      url: `${EXTENSION_ORIGIN}.evil.example/page.html`,
    } as unknown as Sender;
    expect(isUntrustedSender(lookalike)).toBe(true);
  });

  it("falls back to the url when origin is absent", () => {
    expect(
      isUntrustedSender({
        url: `${EXTENSION_ORIGIN}/src/options/index.html`,
      } as unknown as Sender),
    ).toBe(false);
    expect(
      isUntrustedSender({
        url: "https://www.youtube.com/",
      } as unknown as Sender),
    ).toBe(true);
  });

  it("treats a sender with neither origin nor url as untrusted", () => {
    expect(isUntrustedSender({} as unknown as Sender)).toBe(true);
  });
});

describe("isStudioContentSender", () => {
  it("accepts only the exact Studio origin", () => {
    expect(
      isStudioContentSender({
        origin: "https://studio.youtube.com",
        url: "https://studio.youtube.com/video/abcdefghijk/edit",
      } as Sender),
    ).toBe(true);
    expect(
      isStudioContentSender({
        origin: "https://www.youtube.com",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
      } as Sender),
    ).toBe(false);
    expect(
      isStudioContentSender({
        origin: "https://studio.youtube.com",
        url: "https://studio.youtube.com.evil.example/",
      } as Sender),
    ).toBe(false);
  });
});

describe("content script operation boundary", () => {
  it("allows the operations used by the YouTube widget", () => {
    for (const type of [
      "GET_SETTINGS",
      "GET_DASHBOARD",
      "ANALYZE_TEXT",
      "CREATE_MEDIA_BRIDGE_SESSION",
      "SAVE_SETTINGS_PATCH",
      "GET_AI_PROVIDER_COOLDOWNS",
      "SET_AI_PROVIDER_COOLDOWN",
      "SIGN_IN",
      "AUTH_STATUS",
      "OPEN_OPTIONS_PAGE",
    ] as const) {
      expect(isContentScriptOperationAllowed(type)).toBe(true);
    }
  });

  it("rejects account, cache, workspace and secret-management operations", () => {
    for (const type of [
      "SIGN_OUT",
      "CLEAR_CACHES",
      "RESET_LOCAL_DATA",
      "SAVE_WORKSPACE_STATE",
      "GET_WORKSPACE_STATE",
      "SAVE_SETTINGS",
      "SAVE_SETTINGS_TRUSTED_PATCH",
      "REDEEM_MEDIA_BRIDGE_SESSION",
      "TEST_AI_KEYS",
      "LIST_AI_MODELS",
    ] as const) {
      expect(isContentScriptOperationAllowed(type)).toBe(false);
    }
  });
});
