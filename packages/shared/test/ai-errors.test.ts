import { describe, expect, it } from "vitest";
import {
  aiFailureMessage,
  classifyAiFailure,
  parseRetryAfterMs,
} from "../src/ai-errors.js";

describe("AI provider errors", () => {
  it("extracts Gemini retry delay from the quota message", () => {
    expect(
      parseRetryAfterMs(null, "Quota exceeded. Please retry in 28.63931619s."),
    ).toBe(28_640);
  });

  it("prefers Retry-After and understands Google retry details", () => {
    expect(parseRetryAfterMs("12", "retry in 30s")).toBe(12_000);
    expect(
      parseRetryAfterMs(null, "", [
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "3.5s",
        },
      ]),
    ).toBe(3_500);
  });

  it("classifies quota, authentication and unavailable model errors", () => {
    expect(classifyAiFailure(429, "RESOURCE_EXHAUSTED")).toBe("rate-limit");
    expect(classifyAiFailure(403, "permission denied")).toBe("authentication");
    expect(classifyAiFailure(404, "model is not available")).toBe("model");
    expect(classifyAiFailure(403, "The model is blocked by your organization")).toBe(
      "model",
    );
    expect(classifyAiFailure(403, "You do not have access to the model")).toBe("model");
  });

  it("returns a concise localized quota message", () => {
    expect(aiFailureMessage("gemini", "rate-limit", 28_640, "ru")).toContain(
      "через 29 сек.",
    );
    expect(aiFailureMessage("gemini", "rate-limit", 28_640, "en")).toContain(
      "about 29s",
    );
    expect(aiFailureMessage("twelvelabs", "rate-limit", 5_000, "ru")).toContain(
      "TwelveLabs",
    );
  });
});
