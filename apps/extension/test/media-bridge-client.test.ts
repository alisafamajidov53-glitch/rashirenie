import { afterEach, expect, it, vi } from "vitest";
import { analyzeMediaInBridge } from "../src/content/media-bridge";
import { rpc } from "../src/lib/rpc";

vi.mock("../src/lib/rpc", () => ({
  rpc: vi.fn(async () => "12345678-1234-1234-1234-123456789abc"),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("rejects and removes the iframe immediately when File transfer fails", async () => {
  vi.stubGlobal("chrome", {
    runtime: {
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    },
  });

  class FakePort {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    closed = false;
    postMessage(message: { type: string }) {
      if (message.type === "ANALYZE")
        throw new DOMException("clone failed", "DataCloneError");
    }
    close() {
      this.closed = true;
    }
  }
  class FakeMessageChannel {
    port1 = new FakePort();
    port2 = new FakePort();
  }
  let channel: FakeMessageChannel | undefined;
  vi.stubGlobal(
    "MessageChannel",
    class extends FakeMessageChannel {
      constructor() {
        super();
        channel = this;
      }
    },
  );

  const detachedMount = document.createElement("div");
  let frame: HTMLIFrameElement | undefined;
  vi.spyOn(document.documentElement, "append").mockImplementation((...nodes) => {
    for (const node of nodes) {
      if (!(node instanceof HTMLIFrameElement)) continue;
      frame = node;
      Object.defineProperty(node, "contentWindow", {
        configurable: true,
        value: {
          postMessage: () =>
            queueMicrotask(() =>
              channel?.port1.onmessage?.(
                new MessageEvent("message", { data: { type: "READY" } }),
              ),
            ),
        },
      });
      queueMicrotask(() => node.onload?.(new Event("load")));
    }
    detachedMount.append(...nodes);
  });

  const request = analyzeMediaInBridge(
    { title: "Test", description: "", tags: [], language: "en" },
    new File(["video"], "clip.mp4", { type: "video/mp4" }),
  );
  await expect(request).rejects.toThrow("Could not transfer the video");
  expect(rpc).toHaveBeenCalledWith({ type: "CREATE_MEDIA_BRIDGE_SESSION" });
  expect(channel?.port1.closed).toBe(true);
  expect(channel?.port2.closed).toBe(true);
  expect(frame?.parentElement).toBeNull();
});
