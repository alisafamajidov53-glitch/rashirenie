import { afterAll, expect, it, vi } from "vitest";
import { DEFAULT_EXTENSION_SETTINGS } from "@channelpilot/shared";
import { analyzeMediaDirect } from "../src/lib/ai-direct";
import { rpc } from "../src/lib/rpc";

vi.mock("../src/lib/ai-direct", async (original) => {
  const module = await original<typeof import("../src/lib/ai-direct")>();
  return {
    ...module,
    analyzeMediaDirect: vi.fn(async () => ({
      provider: "gemini",
      titles: ["A tested result"],
    })),
  };
});
vi.mock("../src/lib/rpc", () => ({
  rpc: vi.fn(async (request: { token: string }) => {
    if (request.token === "invalid") throw new Error("Invalid token");
    return {
      geminiApiKey: "test-secret",
      groqApiKey: "",
      twelveLabsApiKey: "",
      geminiModel: "gemini-3.6-flash",
      groqModel: "openai/gpt-oss-120b",
      twelveLabsModel: "pegasus1.5",
      preferredProvider: "gemini",
      interfaceLanguage: "en",
    };
  }),
}));

const storageListeners: Array<
  (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
> = [];
vi.stubGlobal("chrome", {
  storage: {
    onChanged: {
      addListener: (listener: (typeof storageListeners)[number]) =>
        storageListeners.push(listener),
    },
    local: {
      get: vi.fn(async () => ({
        settings: { ...DEFAULT_EXTENSION_SETTINGS, allowAiMediaUploads: true },
      })),
    },
  },
});

afterAll(() => vi.unstubAllGlobals());

it("accepts only Studio handshakes and returns analysis without provider keys", async () => {
  await import("../src/media-bridge/main");
  const rejected = new MessageChannel();
  const rejectedEvent = new MessageEvent("message", {
    data: { type: "CHANNELPILOT_MEDIA_CONNECT", token: "invalid" },
    origin: "https://evil.example",
    source: window,
    ports: [rejected.port2],
  });
  expect(rejectedEvent.ports).toHaveLength(1);
  window.dispatchEvent(rejectedEvent);
  expect(rpc).not.toHaveBeenCalled();
  rejected.port1.close();
  rejected.port2.close();

  const invalid = new MessageChannel();
  const invalidResult = new Promise<unknown>((resolve) => {
    invalid.port1.onmessage = (event: MessageEvent<unknown>) => resolve(event.data);
  });
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "CHANNELPILOT_MEDIA_CONNECT", token: "invalid" },
      origin: "https://studio.youtube.com",
      source: window,
      ports: [invalid.port2],
    }),
  );
  expect(await invalidResult).toEqual({ type: "ERROR", error: "Invalid token" });
  invalid.port1.close();
  invalid.port2.close();

  const channel = new MessageChannel();
  const messages: unknown[] = [];
  const result = new Promise<unknown>((resolve) => {
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      messages.push(event.data);
      if ((event.data as { type?: string }).type === "READY") {
        channel.port2.onmessage?.(
          new MessageEvent("message", {
            data: {
              type: "ANALYZE",
              context: {
                title: "Test",
                description: "",
                tags: [],
                language: "en",
              },
              file: new File(["video"], "clip.mp4", { type: "video/mp4" }),
            },
          }),
        );
      } else if (
        (event.data as { type?: string }).type === "RESULT" ||
        (event.data as { type?: string }).type === "ERROR"
      ) {
        resolve(event.data);
      }
    };
  });
  const accepted = new MessageEvent("message", {
    data: {
      type: "CHANNELPILOT_MEDIA_CONNECT",
      token: "12345678-1234-1234-1234-123456789abc",
    },
    origin: "https://studio.youtube.com",
    source: window,
    ports: [channel.port2],
  });
  expect(accepted.source).toBe(window.parent);
  expect(accepted.ports).toHaveLength(1);
  window.dispatchEvent(accepted);
  await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(messages).toContainEqual({ type: "READY" }));
  expect(await result).toEqual({
    type: "RESULT",
    result: { provider: "gemini", titles: ["A tested result"] },
  });
  expect(vi.mocked(analyzeMediaDirect)).toHaveBeenCalledOnce();
  expect(JSON.stringify(messages)).not.toContain("test-secret");
  channel.port1.close();
  channel.port2.close();
});
