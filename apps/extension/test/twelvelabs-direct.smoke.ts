import assert from "node:assert/strict";
import {
  DEFAULT_EXTENSION_SETTINGS,
  type ContentInsights,
  type VideoContext,
} from "@channelpilot/shared";

const localStorageValues: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: localStorageValues[key] }),
      set: async (values: Record<string, unknown>) => {
        Object.assign(localStorageValues, values);
      },
    },
  },
};

// Extensionless: the runner is tsx, which resolves this, and tsc no longer
// rejects the path now that `test/` is part of the checked project.
const { analyzeMediaDirect, analyzeTextDirect } = await import("../src/lib/ai-direct");

const contentInsights: ContentInsights = {
  summary: "A concise video summary.",
  detectedFormat: "Shorts 9:16",
  targetAudience: "Minecraft players",
  primaryHook: "A surprising build",
  keyMoments: ["00:01 — hook", "00:06 — result"],
  thumbnailMoments: [
    {
      timestampSeconds: 6,
      score: 91,
      reason: "The finished build is clearly visible",
      visual: "Character on the left and build on the right",
    },
  ],
  visualElements: ["Minecraft world", "player character"],
  spokenTopics: ["building challenge"],
};

const rawResult = {
  titles: [
    "I Built the Impossible in Minecraft",
    "This Minecraft Build Should Not Work",
  ],
  description: "A complete description of the uploaded Minecraft video.",
  tags: ["minecraft", "shorts"],
  keywords: ["minecraft build"],
  thumbnailIdeas: ["Character left, impossible build right, bold contrast"],
  recommendations: ["Show the result in the first second"],
  contentInsights: {
    ...contentInsights,
    thumbnailMoments: [
      {
        timestampSeconds: "0:06.5",
        score: 110,
        reason: "The finished build is clearly visible",
        visual: "Character on the left and build on the right",
      },
      {
        timestampSeconds: "not-a-time",
        score: 80,
        reason: "Invalid timestamp must be ignored",
        visual: "Unknown frame",
      },
    ],
  },
};

const context: VideoContext = {
  title: "",
  description: "",
  tags: [],
  language: "en",
};
const video = new File([new Uint8Array([1, 2, 3])], "video.mp4", {
  type: "video/mp4",
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// `body` is recorded verbatim, including the undefined that a GET carries, so
// the property type has to admit undefined under exactOptionalPropertyTypes.
const successCalls: Array<{
  url: string;
  method: string;
  body?: BodyInit | null | undefined;
}> = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method ?? "GET";
  successCalls.push({ url, method, body: init.body });
  if (url.endsWith("/assets") && method === "POST") {
    return jsonResponse({ _id: "asset-success", status: "ready" }, 201);
  }
  if (url.endsWith("/analyze") && method === "POST") {
    return jsonResponse({ data: JSON.stringify(rawResult), finish_reason: "stop" });
  }
  if (url.endsWith("/assets/asset-success") && method === "DELETE") {
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
};

const progressStages: string[] = [];
const success = await analyzeMediaDirect(
  context,
  video,
  {
    ...DEFAULT_EXTENSION_SETTINGS,
    twelveLabsApiKey: "tlk_test",
    twelveLabsModel: "pegasus1.5",
    preferredProvider: "twelvelabs",
    interfaceLanguage: "en",
  },
  (progress) => progressStages.push(progress.stage),
);
assert.equal(success.provider, "twelvelabs");
assert.ok(success.titles.length >= 10);
assert.equal(success.shortDescription.length > 0, true);
assert.ok(Array.isArray(success.shortsIdeas));
assert.equal(success.contentInsights.thumbnailMoments.length, 1);
assert.equal(success.contentInsights.thumbnailMoments[0]?.timestampSeconds, 6.5);
assert.equal(success.contentInsights.thumbnailMoments[0]?.score, 100);
assert.deepEqual(progressStages, [
  "preparing",
  "uploading",
  "processing",
  "analyzing",
  "cleanup",
]);
assert.deepEqual(
  successCalls.map(({ url, method }) => [method, new URL(url).pathname]),
  [
    ["POST", "/v1.3/assets"],
    ["POST", "/v1.3/analyze"],
    ["DELETE", "/v1.3/assets/asset-success"],
  ],
);
const analysisCall = successCalls.find(({ url }) => url.endsWith("/analyze"));
const analysisBody = JSON.parse(String(analysisCall?.body)) as {
  model_name?: string;
  prompt_v2?: { input_text?: string };
};
assert.equal(analysisBody.model_name, "pegasus1.5");
assert.match(
  analysisBody.prompt_v2?.input_text ?? "",
  /прикреплённый файл|video file/i,
);

const cleanupCalls: string[] = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method ?? "GET";
  cleanupCalls.push(`${method} ${new URL(url).pathname}`);
  if (url.endsWith("/assets") && method === "POST") {
    return jsonResponse(
      { _id: "asset-failed", status: "failed", error: "decode failed" },
      201,
    );
  }
  if (url.endsWith("/assets/asset-failed") && method === "DELETE") {
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
};
await assert.rejects(
  analyzeMediaDirect(context, video, {
    ...DEFAULT_EXTENSION_SETTINGS,
    twelveLabsApiKey: "tlk_test",
    preferredProvider: "twelvelabs",
    interfaceLanguage: "en",
  }),
  /decode failed/,
);
assert.ok(
  cleanupCalls.includes("DELETE /v1.3/assets/asset-failed"),
  "failed TwelveLabs assets must be deleted",
);

const fallbackCalls: string[] = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method ?? "GET";
  fallbackCalls.push(`${method} ${url}`);
  if (url.includes("generativelanguage.googleapis.com/upload")) {
    return jsonResponse(
      { error: { message: "Gemini service temporarily unavailable." } },
      503,
    );
  }
  if (url.endsWith("/assets") && method === "POST") {
    return jsonResponse({ _id: "asset-fallback", status: "ready" }, 201);
  }
  if (url.endsWith("/analyze") && method === "POST") {
    return jsonResponse({ data: rawResult, finish_reason: "stop" });
  }
  if (url.endsWith("/assets/asset-fallback") && method === "DELETE") {
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
};

const fallbackProgress: string[] = [];
const fallback = await analyzeMediaDirect(
  context,
  video,
  {
    ...DEFAULT_EXTENSION_SETTINGS,
    geminiApiKey: "gemini-test",
    twelveLabsApiKey: "tlk_test",
    preferredProvider: "auto",
    interfaceLanguage: "en",
  },
  (progress) => fallbackProgress.push(progress.stage),
);
assert.equal(fallback.provider, "twelvelabs");
assert.match(fallback.providerNotice ?? "", /Gemini.*TwelveLabs/i);
assert.ok(fallbackProgress.includes("fallback"));
assert.equal(
  fallbackCalls.some((call) => call.includes("api.groq.com")),
  false,
);

let validationFetchCalled = false;
globalThis.fetch = async () => {
  validationFetchCalled = true;
  throw new Error("validation must reject before fetch");
};
await assert.rejects(
  analyzeMediaDirect(context, new File([], "empty.mp4", { type: "video/mp4" }), {
    ...DEFAULT_EXTENSION_SETTINGS,
    geminiApiKey: "gemini-test",
    preferredProvider: "gemini",
    interfaceLanguage: "en",
  }),
  /empty/i,
);
assert.equal(validationFetchCalled, false);

const oversizedTranscript = new File(
  [new Uint8Array(5 * 1024 * 1024 + 1)],
  "captions.srt",
  { type: "text/plain" },
);
await assert.rejects(
  analyzeMediaDirect(context, oversizedTranscript, {
    ...DEFAULT_EXTENSION_SETTINGS,
    groqApiKey: "groq-test",
    preferredProvider: "groq",
    interfaceLanguage: "en",
  }),
  /5 MB/i,
);
assert.equal(validationFetchCalled, false);

const geminiCleanupCalls: Array<[string, string]> = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method ?? "GET";
  geminiCleanupCalls.push([method, url]);
  if (url.includes("/upload/v1beta/files") && method === "POST") {
    return new Response(null, {
      status: 200,
      headers: { "x-goog-upload-url": "https://upload.test/session" },
    });
  }
  if (url === "https://upload.test/session" && method === "POST") {
    return jsonResponse({
      file: {
        name: "files/failed",
        state: "FAILED",
        mimeType: "video/mp4",
      },
    });
  }
  if (url.endsWith("/v1beta/files/failed") && method === "DELETE") {
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
};
await assert.rejects(
  analyzeMediaDirect(context, video, {
    ...DEFAULT_EXTENSION_SETTINGS,
    geminiApiKey: "gemini-test",
    preferredProvider: "gemini",
    interfaceLanguage: "en",
  }),
  /Gemini.*(?:файл|file)/i,
);
assert.ok(
  geminiCleanupCalls.some(
    ([method, url]) => method === "DELETE" && url.endsWith("/v1beta/files/failed"),
  ),
  "failed Gemini uploads must be deleted",
);

globalThis.fetch = async () =>
  jsonResponse(
    {
      error: {
        message: "Quota exceeded. Please retry in 300s.",
      },
    },
    429,
  );
const longRetryStartedAt = performance.now();
await assert.rejects(
  analyzeTextDirect(
    {
      ...context,
      title: "A test title",
    },
    {
      ...DEFAULT_EXTENSION_SETTINGS,
      geminiApiKey: "gemini-test",
      preferredProvider: "gemini",
      interfaceLanguage: "en",
    },
  ),
  /quota/i,
);
assert.ok(
  performance.now() - longRetryStartedAt < 1_000,
  "long Retry-After responses must fail fast instead of sleeping in the UI",
);

const cooldownRpcCalls: Array<Record<string, unknown>> = [];
const persistedCooldowns: Record<string, number> = {};
(globalThis as unknown as { window: Record<string, never> }).window = {};
const chromeMock = (
  globalThis as unknown as {
    chrome: {
      storage: {
        local: {
          get: (key: string) => Promise<Record<string, unknown>>;
          set: (values: Record<string, unknown>) => Promise<void>;
        };
      };
      runtime?: {
        sendMessage: (
          message: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>;
      };
    };
  }
).chrome;
chromeMock.storage.local.get = async () => {
  throw new Error("Storage is restricted to trusted contexts");
};
chromeMock.storage.local.set = async () => {
  throw new Error("Storage is restricted to trusted contexts");
};
chromeMock.runtime = {
  sendMessage: async (message) => {
    cooldownRpcCalls.push(message);
    if (message.type === "GET_AI_PROVIDER_COOLDOWNS") {
      return { ok: true, data: { ...persistedCooldowns } };
    }
    if (message.type === "SET_AI_PROVIDER_COOLDOWN") {
      const provider = String(message.provider);
      persistedCooldowns[provider] = Number(message.until) || 0;
      return { ok: true, data: { ...persistedCooldowns } };
    }
    return { ok: false, error: "Unexpected test RPC" };
  },
};
globalThis.fetch = async () =>
  jsonResponse({ error: { message: "Quota exceeded. Please retry in 300s." } }, 429);
await assert.rejects(
  analyzeTextDirect(
    { ...context, title: "Cooldown RPC test" },
    {
      ...DEFAULT_EXTENSION_SETTINGS,
      groqApiKey: "groq-test",
      preferredProvider: "groq",
      interfaceLanguage: "en",
    },
  ),
  /quota/i,
);
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert.ok(
  cooldownRpcCalls.some(
    (message) =>
      message.type === "SET_AI_PROVIDER_COOLDOWN" &&
      message.provider === "groq" &&
      Number(message.until) > Date.now(),
  ),
  "content scripts must persist provider cooldowns through the service worker",
);

let cooldownBypassFetches = 0;
globalThis.fetch = async () => {
  cooldownBypassFetches += 1;
  throw new Error("Known cooldown must prevent a duplicate API request");
};
await assert.rejects(
  analyzeTextDirect(
    { ...context, title: "Known cooldown test" },
    {
      ...DEFAULT_EXTENSION_SETTINGS,
      groqApiKey: "groq-test",
      preferredProvider: "groq",
      interfaceLanguage: "en",
    },
  ),
  /quota/i,
);
assert.equal(
  cooldownBypassFetches,
  0,
  "a known provider cooldown must not spend another request",
);

console.log("Direct AI integration smoke tests passed");
