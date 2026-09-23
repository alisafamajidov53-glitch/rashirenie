import { describe, expect, it } from "vitest";
import { redactSecrets, safeErrorMessage } from "./errors.js";

describe("safe errors", () => {
  it("redacts provider keys and bearer tokens", () => {
    expect(
      redactSecrets(
        "AIza12345678901234567890 gsk_123456789abc Bearer abcdefghijklmnop",
      ),
    ).toBe("[redacted] [redacted] [redacted]");
  });

  it("redacts Google access tokens and credentials in URLs", () => {
    expect(redactSecrets("token ya29.a0AfB_byC-123456789 expired")).toBe(
      "token [redacted] expired",
    );
    expect(
      redactSecrets(
        "GET https://x.test/v1?alt=json&key=abc123secret&access_token=zzz failed",
      ),
    ).toBe(
      "GET https://x.test/v1?alt=json&key=[redacted]&access_token=[redacted] failed",
    );
  });

  it("normalizes and bounds unknown error messages", () => {
    expect(safeErrorMessage(new Error("one\n two"), "fallback", 7)).toBe("one two");
    expect(safeErrorMessage({ secret: true }, "fallback")).toBe("fallback");
  });
});
