import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedRequest, clearRequestCache } from "../src/background/request-cache";

const storeKey = "requestCacheV1";
let stored: Record<string, unknown>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  stored = {};
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: vi.fn(async () => ({ [storeKey]: stored[storeKey] })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(stored, value);
        }),
        remove: vi.fn(async (key: string) => {
          delete stored[key];
        }),
      },
    },
  });
});

afterEach(async () => {
  await clearRequestCache();
  vi.unstubAllGlobals();
});

describe("request cache invalidation", () => {
  it("does not resurrect a response completed after sign-out", async () => {
    const late = deferred<string>();
    const started = deferred<void>();
    const request = cachedRequest("private:analytics", 60_000, false, () => {
      started.resolve(undefined);
      return late.promise;
    });
    await started.promise;
    await clearRequestCache();
    late.resolve("old-account");
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(stored[storeKey]).toBeUndefined();
    await expect(
      cachedRequest("private:analytics", 60_000, false, async () => "new-account"),
    ).resolves.toBe("new-account");
  });

  it("keeps both values when distinct requests finish together", async () => {
    await Promise.all([
      cachedRequest("video:a", 60_000, false, async () => "a"),
      cachedRequest("video:b", 60_000, false, async () => "b"),
    ]);
    expect(stored[storeKey]).toMatchObject({
      "video:a": { value: "a" },
      "video:b": { value: "b" },
    });
  });

  it("does not let a superseded request overwrite the fresh result", async () => {
    const late = deferred<string>();
    const started = deferred<void>();
    const oldRequest = cachedRequest("video:a", 60_000, false, () => {
      started.resolve(undefined);
      return late.promise;
    });
    await started.promise;
    await expect(
      cachedRequest("video:a", 60_000, true, async () => "fresh"),
    ).resolves.toBe("fresh");
    late.resolve("stale");
    await expect(oldRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(stored[storeKey]).toMatchObject({ "video:a": { value: "fresh" } });
  });
});
