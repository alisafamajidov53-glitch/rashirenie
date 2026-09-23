import { afterEach, expect, it, vi } from "vitest";
import { rpc } from "../src/lib/rpc";

afterEach(() => vi.unstubAllGlobals());

it("turns Chrome's invalidated-context error into a reload hint", async () => {
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn(async () => {
        throw new Error("Extension context invalidated.");
      }),
    },
  });
  await expect(rpc({ type: "AUTH_STATUS" })).rejects.toThrow(
    "The extension was updated or disabled. Reload the page and try again.",
  );
});

it("passes other failures and service-worker errors through unchanged", async () => {
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error("Network down"))
        .mockResolvedValueOnce({ ok: false, error: "Quota exceeded" })
        .mockResolvedValueOnce({ ok: true, data: 42 }),
    },
  });
  await expect(rpc({ type: "AUTH_STATUS" })).rejects.toThrow("Network down");
  await expect(rpc({ type: "AUTH_STATUS" })).rejects.toThrow("Quota exceeded");
  await expect(rpc<number>({ type: "AUTH_STATUS" })).resolves.toBe(42);
});
