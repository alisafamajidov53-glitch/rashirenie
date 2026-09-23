interface CacheEntry<T> {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
  controller?: AbortController;
}

/**
 * In-memory view of the cache. Holds the in-flight promises and abort
 * controllers, neither of which can be serialised.
 */
const entries = new Map<string, CacheEntry<unknown>>();

/**
 * Durable mirror of the *resolved* values.
 *
 * An MV3 service worker is evicted after ~30 seconds of inactivity, which
 * wiped the Map above and with it every cached response. A competitor lookup
 * repeated two minutes later therefore cost another `search.list` — 100 YouTube
 * Data API units — even though its 10-minute TTL had not expired. Mirroring
 * resolved values into `chrome.storage.session` makes the TTL mean what it
 * says while still clearing everything when the browser closes.
 */
const STORE_KEY = "requestCacheV1";
let storeMutationQueue: Promise<void> = Promise.resolve();
let cacheEpoch = 0;

type StoredEntry = { expiresAt: number; value: unknown };

async function readStore(): Promise<Record<string, StoredEntry>> {
  try {
    const stored = await chrome.storage.session.get(STORE_KEY);
    const raw = stored[STORE_KEY];
    return raw && typeof raw === "object" ? (raw as Record<string, StoredEntry>) : {};
  } catch {
    return {};
  }
}

async function writeStore(store: Record<string, StoredEntry>): Promise<void> {
  try {
    await chrome.storage.session.set({ [STORE_KEY]: store });
  } catch {
    // session storage is best-effort: the in-memory Map above still works for
    // the lifetime of this worker.
  }
}

async function rememberValue(
  key: string,
  value: unknown,
  expiresAt: number,
  isCurrent: () => boolean,
): Promise<void> {
  await queueStoreMutation(async () => {
    if (!isCurrent()) return;
    const store = await readStore();
    if (!isCurrent()) return;
    const now = Date.now();
    for (const [existingKey, entry] of Object.entries(store)) {
      if (entry.expiresAt <= now) delete store[existingKey];
    }
    store[key] = { expiresAt, value };
    await writeStore(store);
  });
}

function queueStoreMutation(operation: () => Promise<void>): Promise<void> {
  const queued = storeMutationQueue.then(operation, operation);
  storeMutationQueue = queued.catch(() => undefined);
  return queued;
}

async function recallValue<T>(key: string): Promise<T | undefined> {
  await storeMutationQueue;
  const store = await readStore();
  const entry = store[key];
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.value as T;
}

export async function cachedRequest<T>(
  key: string,
  ttlMs: number,
  force: boolean,
  factory: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = entries.get(key) as CacheEntry<T> | undefined;
  if (!force && existing?.value !== undefined && existing.expiresAt > now) {
    return existing.value;
  }
  if (!force && existing?.promise) return existing.promise;
  if (!force && !existing) {
    // This worker was started after a previous one cached the value.
    const epoch = cacheEpoch;
    const restored = await recallValue<T>(key);
    if (epoch !== cacheEpoch) throw new DOMException("Request cancelled", "AbortError");
    const inFlight = entries.get(key) as CacheEntry<T> | undefined;
    if (inFlight?.promise) return inFlight.promise;
    if (inFlight?.value !== undefined && inFlight.expiresAt > Date.now())
      return inFlight.value;
    if (restored !== undefined) return restored;
  }
  existing?.controller?.abort();

  const controller = new AbortController();
  const entry: CacheEntry<T> = {
    expiresAt: now + Math.max(1_000, ttlMs),
    controller,
  };
  const promise = factory(controller.signal)
    .then(async (value) => {
      const isCurrent = () => !controller.signal.aborted && entries.get(key) === entry;
      if (!isCurrent()) throw new DOMException("Request cancelled", "AbortError");
      entry.value = value;
      delete entry.promise;
      delete entry.controller;
      entry.expiresAt = Date.now() + Math.max(1_000, ttlMs);
      await rememberValue(key, value, entry.expiresAt, isCurrent);
      if (!isCurrent()) throw new DOMException("Request cancelled", "AbortError");
      return value;
    })
    .catch((error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
  entry.promise = promise;
  entries.set(key, entry);
  return promise;
}

export async function clearRequestCache(prefix?: string): Promise<void> {
  cacheEpoch += 1;
  for (const [key, entry] of entries) {
    if (prefix && !key.startsWith(prefix)) continue;
    entry.controller?.abort();
    entries.delete(key);
  }
  await queueStoreMutation(async () => {
    if (!prefix) {
      await chrome.storage.session.remove(STORE_KEY).catch(() => undefined);
      return;
    }
    const store = await readStore();
    for (const key of Object.keys(store)) {
      if (key.startsWith(prefix)) delete store[key];
    }
    await writeStore(store);
  });
}
