import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_EXTENSION_SETTINGS,
  type ExtensionSettings,
} from "@channelpilot/shared";

// commentThreads.list rejects the extension's read-only OAuth token with
// ACCESS_TOKEN_SCOPE_INSUFFICIENT, so comments are read with an API key.

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
let storedSettings: ExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };
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
  tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined) },
  storage: {
    local: {
      get: vi.fn(async () => ({ settings: storedSettings })),
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

function getComments(videoId = "abcdefghijk", force = true) {
  return new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    listener(
      { type: "GET_COMMENTS", videoId, force },
      {
        id: extensionId,
        origin: `chrome-extension://${extensionId}`,
        url: `chrome-extension://${extensionId}/src/options/index.html`,
      },
      resolve,
    );
  });
}

function googleError(status: number, reasons: string[], message: string) {
  return new Response(
    JSON.stringify({
      error: {
        code: status,
        message,
        errors: [{ message, domain: "youtube.commentThread", reason: reasons[0] }],
        details: reasons.slice(1).map((reason) => ({
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason,
        })),
      },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.mocked(fetch).mockReset();
  storedSettings = { ...DEFAULT_EXTENSION_SETTINGS };
});

vi.stubGlobal("fetch", vi.fn());

it("explains the missing key without spending a request", async () => {
  const response = await getComments();
  expect(response.ok).toBe(false);
  expect(response.error).toContain("ключ YouTube Data API");
  expect(fetch).not.toHaveBeenCalled();
});

it("reads public comments with the key and no OAuth header", async () => {
  storedSettings = { ...DEFAULT_EXTENSION_SETTINGS, youtubeApiKey: "AIzaTestKey" };
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        items: [
          {
            id: "thread-1",
            snippet: {
              videoId: "abcdefghijk",
              totalReplyCount: 0,
              topLevelComment: {
                id: "comment-1",
                snippet: {
                  authorDisplayName: "Viewer",
                  textOriginal: "Great video?",
                  publishedAt: "2026-09-20T10:00:00Z",
                  likeCount: 3,
                },
              },
            },
          },
        ],
      }),
      { status: 200 },
    ),
  );
  const response = await getComments();
  expect(response.ok).toBe(true);
  expect(response.data).toMatchObject([{ id: "comment-1", text: "Great video?" }]);
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(String(url)).toContain("/commentThreads?");
  expect(String(url)).toContain("key=AIzaTestKey");
  expect(new Headers(init?.headers).has("Authorization")).toBe(false);
});

it("turns Google's error envelope into a sentence the creator can act on", async () => {
  storedSettings = { ...DEFAULT_EXTENSION_SETTINGS, youtubeApiKey: "AIzaTestKey" };
  vi.mocked(fetch).mockResolvedValueOnce(
    googleError(403, ["commentsDisabled"], "The video has disabled comments."),
  );
  await expect(getComments()).resolves.toMatchObject({
    ok: false,
    error: "Комментарии к этому видео отключены.",
  });

  vi.mocked(fetch).mockResolvedValueOnce(
    googleError(
      400,
      ["badRequest", "API_KEY_INVALID"],
      "API key not valid. Please pass a valid API key.",
    ),
  );
  const invalid = await getComments();
  expect(invalid.error).toContain("Ключ YouTube Data API недействителен");
  expect(invalid.error).not.toContain("{");

  // An unmapped failure still reads as one line, not the raw JSON body.
  vi.mocked(fetch).mockResolvedValueOnce(
    googleError(500, ["backendError"], "Backend Error"),
  );
  const unknown = await getComments();
  expect(unknown.error).toBe("YouTube API 500: Backend Error (backendError)");
});
